import { useCallback, useEffect, useRef, useState } from 'react';
import {
  base64ToPcm16,
  buildLiveWsUrl,
  computeRmsLevel,
  downsampleFloat32,
  float32ToInt16Pcm,
  int16PcmToFloat32,
  LIVE_INPUT_SAMPLE_RATE,
  LIVE_OUTPUT_SAMPLE_RATE,
  pcm16ToBase64,
} from '../utils/voiceAudio';

export type LiveVoiceStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error';

interface UseLiveVoiceSessionOptions {
  orgSlug: string;
  botSlug: string;
  channel: 'hosted' | 'widget';
  onTurnComplete?: (turn: { userText: string; assistantText: string }) => void;
}

export function useLiveVoiceSession({
  orgSlug,
  botSlug,
  channel,
  onTurnComplete,
}: UseLiveVoiceSessionOptions) {
  const [status, setStatus] = useState<LiveVoiceStatus>('idle');
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [activeVoiceName, setActiveVoiceName] = useState<string>('');
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [liveUserTranscript, setLiveUserTranscript] = useState('');
  const [liveAssistantTranscript, setLiveAssistantTranscript] = useState('');

  // Mutable refs for real-time audio & WebSocket callbacks (avoids stale closures)
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const mutedRef = useRef<boolean>(false);
  const userBufRef = useRef<string>('');
  const assistantBufRef = useRef<string>('');
  const onTurnCompleteRef = useRef(onTurnComplete);
  const levelDecayTimerRef = useRef<number | null>(null);

  useEffect(() => {
    onTurnCompleteRef.current = onTurnComplete;
  }, [onTurnComplete]);

  const stopPlaybackQueue = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // Already stopped
      }
    }
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setOutputLevel(0);
  }, []);

  const cleanupResources = useCallback(() => {
    if (levelDecayTimerRef.current !== null) {
      window.clearTimeout(levelDecayTimerRef.current);
      levelDecayTimerRef.current = null;
    }
    stopPlaybackQueue();

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // Ignore
      }
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }

    if (inputCtxRef.current) {
      void inputCtxRef.current.close().catch(() => undefined);
      inputCtxRef.current = null;
    }

    if (outputCtxRef.current) {
      void outputCtxRef.current.close().catch(() => undefined);
      outputCtxRef.current = null;
    }

    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'stop' }));
        } catch {
          // Ignore
        }
      }
      try {
        ws.close();
      } catch {
        // Ignore
      }
    }

    setInputLevel(0);
    setOutputLevel(0);
    setActiveTool(null);
  }, [stopPlaybackQueue]);

  const stopSession = useCallback(() => {
    const u = userBufRef.current.trim();
    const a = assistantBufRef.current.trim();
    if (u || a) {
      onTurnCompleteRef.current?.({ userText: u, assistantText: a });
      userBufRef.current = '';
      assistantBufRef.current = '';
    }
    cleanupResources();
    setLiveUserTranscript('');
    setLiveAssistantTranscript('');
    setMuted(false);
    mutedRef.current = false;
    setError(null);
    setStatus('idle');
  }, [cleanupResources]);

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
    if (mutedRef.current) {
      setInputLevel(0);
    }
  }, []);

  const playOutputChunk = useCallback((base64Pcm: string) => {
    const ctx = outputCtxRef.current;
    if (!ctx) return;

    const pcm16 = base64ToPcm16(base64Pcm);
    if (pcm16.length === 0) return;

    const float32 = int16PcmToFloat32(pcm16);
    const buffer = ctx.createBuffer(1, float32.length, LIVE_OUTPUT_SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.01, nextStartTimeRef.current);
    source.start(startAt);
    nextStartTimeRef.current = startAt + buffer.duration;

    activeSourcesRef.current.add(source);
    setStatus('speaking');
    setOutputLevel(computeRmsLevel(float32));

    source.onended = () => {
      activeSourcesRef.current.delete(source);
      if (activeSourcesRef.current.size === 0) {
        setOutputLevel(0);
        setStatus((prev) => (prev === 'speaking' ? 'listening' : prev));
      }
    };
  }, []);

  const startSession = useCallback(async () => {
    if (status === 'connecting' || status === 'listening' || status === 'speaking') return;

    setError(null);
    setLiveUserTranscript('');
    setLiveAssistantTranscript('');
    userBufRef.current = '';
    assistantBufRef.current = '';
    setMuted(false);
    mutedRef.current = false;
    setStatus('connecting');

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Microphone access is not supported in this browser environment.');
      setStatus('error');
      return;
    }

    let micStream: MediaStream;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch (err) {
      const msg =
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Please allow microphone access to use Live Voice.'
          : 'No active microphone was detected. Connect a microphone or check browser permissions.';
      setError(msg);
      setStatus('error');
      return;
    }

    streamRef.current = micStream;

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const inputCtx = new AudioCtx({ sampleRate: LIVE_INPUT_SAMPLE_RATE });
      const outputCtx = new AudioCtx({ sampleRate: LIVE_OUTPUT_SAMPLE_RATE });
      if (inputCtx.state === 'suspended') await inputCtx.resume();
      if (outputCtx.state === 'suspended') await outputCtx.resume();
      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;

      const wsUrl = buildLiveWsUrl(window.location, orgSlug, botSlug, channel);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as {
            type?: string;
            data?: string;
            text?: string;
            message?: string;
            voiceName?: string;
            toolName?: string;
            status?: string;
          };

          if (msg.type === 'ready') {
            if (msg.voiceName) setActiveVoiceName(msg.voiceName);
            setStatus('listening');

            // Attach microphone capture once Gemini Live session is ready
            const source = inputCtx.createMediaStreamSource(micStream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (audioEvent) => {
              if (mutedRef.current || ws.readyState !== WebSocket.OPEN) return;
              const rawChannel = audioEvent.inputBuffer.getChannelData(0);
              const level = computeRmsLevel(rawChannel);
              setInputLevel(level);

              const resampled = downsampleFloat32(rawChannel, inputCtx.sampleRate, LIVE_INPUT_SAMPLE_RATE);
              const pcm16 = float32ToInt16Pcm(resampled);
              const base64 = pcm16ToBase64(pcm16);
              ws.send(JSON.stringify({ type: 'audio', data: base64 }));
            };

            source.connect(processor);
            // Connect through zero-gain node so ScriptProcessor runs without audible mic feedback
            const silentGain = inputCtx.createGain();
            silentGain.gain.value = 0;
            processor.connect(silentGain);
            silentGain.connect(inputCtx.destination);
          } else if (msg.type === 'audio' && msg.data) {
            playOutputChunk(msg.data);
          } else if (msg.type === 'inputTranscript' && msg.text) {
            userBufRef.current += msg.text;
            setLiveUserTranscript(userBufRef.current);
          } else if (msg.type === 'outputTranscript' && msg.text) {
            assistantBufRef.current += msg.text;
            setLiveAssistantTranscript(assistantBufRef.current);
          } else if (msg.type === 'tool') {
            setActiveTool(msg.status === 'calling' ? (msg.toolName ?? 'tool') : null);
          } else if (msg.type === 'interrupted') {
            stopPlaybackQueue();
            setStatus('listening');
          } else if (msg.type === 'turnComplete') {
            const u = userBufRef.current.trim();
            const a = assistantBufRef.current.trim();
            if (u || a) {
              onTurnCompleteRef.current?.({ userText: u, assistantText: a });
              userBufRef.current = '';
              assistantBufRef.current = '';
            }
            setActiveTool(null);
          } else if (msg.type === 'error') {
            setError(msg.message || 'Live voice session encountered an error.');
            setStatus('error');
            cleanupResources();
          }
        } catch {
          // Ignore invalid JSON frames
        }
      };

      ws.onerror = () => {
        setError('Unable to connect to the Live Voice server.');
        setStatus('error');
        cleanupResources();
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          cleanupResources();
          setStatus((prev) => (prev === 'error' ? 'error' : 'idle'));
        }
      };
    } catch (err) {
      cleanupResources();
      setError(err instanceof Error ? err.message : 'Failed to initialize Live Voice audio.');
      setStatus('error');
    }
  }, [orgSlug, botSlug, channel, cleanupResources, playOutputChunk, status, stopPlaybackQueue]);

  useEffect(() => {
    return () => {
      cleanupResources();
    };
  }, [cleanupResources]);

  return {
    status,
    muted,
    error,
    activeTool,
    activeVoiceName,
    inputLevel,
    outputLevel,
    liveUserTranscript,
    liveAssistantTranscript,
    startSession,
    stopSession,
    toggleMute,
  };
}
