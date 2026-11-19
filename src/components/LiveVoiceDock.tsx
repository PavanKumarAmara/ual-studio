import React from 'react';
import { AudioLines, Mic, MicOff, PhoneOff, RotateCcw, Wrench } from 'lucide-react';
import type { LiveVoiceStatus } from '../hooks/useLiveVoiceSession';

interface LiveVoiceDockProps {
  primaryColor: string;
  botName: string;
  voiceName: string;
  status: LiveVoiceStatus;
  muted: boolean;
  activeTool: string | null;
  inputLevel: number;
  outputLevel: number;
  liveUserTranscript: string;
  liveAssistantTranscript: string;
  error: string | null;
  onToggleMute: () => void;
  onRetry: () => void;
  onEnd: () => void;
}

const BAR_WEIGHTS = [0.35, 0.62, 0.85, 1.0, 0.78, 0.95, 0.7, 0.5, 0.32];

export function LiveVoiceDock({
  primaryColor,
  botName,
  voiceName,
  status,
  muted,
  activeTool,
  inputLevel,
  outputLevel,
  liveUserTranscript,
  liveAssistantTranscript,
  error,
  onToggleMute,
  onRetry,
  onEnd,
}: LiveVoiceDockProps) {
  const activeEnergy =
    status === 'speaking'
      ? Math.max(0.28, outputLevel)
      : status === 'listening' && !muted
        ? Math.max(0.14, inputLevel)
        : 0.08;

  const statusText = (() => {
    if (status === 'error') return 'Voice connection paused';
    if (status === 'connecting') return 'Connecting to Gemini Live...';
    if (activeTool) return `Checking ${activeTool.replace(/_/g, ' ')}...`;
    if (status === 'speaking') return 'Speaking — interrupt anytime';
    if (muted) return 'Microphone muted';
    return 'Listening — speak naturally';
  })();

  return (
    <section
      aria-label="Live voice session"
      className="absolute inset-0 z-30 bg-white flex flex-col justify-between p-6"
    >
      {/* Top voice context */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0"
            style={{ backgroundColor: primaryColor }}
          >
            <AudioLines className="w-4 h-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 truncate">
              Live Voice · {botName}
            </h2>
            <p className="text-xs text-slate-500">
              Voice: <span className="font-medium text-slate-700">{voiceName}</span> · Real-time audio
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onEnd}
          aria-label="Close live voice overlay"
          className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-slate-50"
        >
          Back to Text
        </button>
      </div>

      {/* Center visualizer & live captions */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 py-6 max-w-lg mx-auto w-full">
        {/* Organic audio bars */}
        <div
          className="h-24 flex items-center justify-center gap-2"
          aria-hidden="true"
        >
          {BAR_WEIGHTS.map((weight, idx) => {
            const heightPx = Math.round(14 + activeEnergy * weight * 66);
            return (
              <span
                key={idx}
                className="w-2 rounded-full transition-all duration-100"
                style={{
                  height: `${heightPx}px`,
                  backgroundColor: status === 'error' ? '#CBD5E1' : primaryColor,
                  opacity: status === 'speaking' ? 0.95 : muted ? 0.3 : 0.72,
                }}
              />
            );
          })}
        </div>

        <div className="text-center space-y-1.5">
          <p className="text-sm font-semibold text-slate-900">{statusText}</p>
          {activeTool && (
            <p className="inline-flex items-center gap-1.5 text-xs font-mono text-slate-600 bg-slate-100 px-2.5 py-1 rounded-md">
              <Wrench className="w-3 h-3" aria-hidden="true" />
              {activeTool}
            </p>
          )}
        </div>

        {/* Error banner if mic denied / disconnected */}
        {error && (
          <div
            role="alert"
            className="w-full bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-800 space-y-2.5"
          >
            <p className="leading-relaxed">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              Try Again
            </button>
          </div>
        )}

        {/* Live transcript preview */}
        {(liveUserTranscript || liveAssistantTranscript) && !error && (
          <div className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2.5 max-h-40 overflow-y-auto">
            {liveUserTranscript && (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">You</p>
                <p className="text-xs text-slate-800 leading-relaxed mt-0.5">{liveUserTranscript}</p>
              </div>
            )}
            {liveAssistantTranscript && (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  {botName}
                </p>
                <p className="text-xs text-slate-900 leading-relaxed mt-0.5">
                  {liveAssistantTranscript}
                </p>
              </div>
            )}
          </div>
        )}

        {!liveUserTranscript && !liveAssistantTranscript && !error && (
          <p className="text-xs text-slate-500 text-center max-w-sm leading-relaxed">
            Ask about policies, pricing, or connected live tools with your voice. Completed turns are added to your chat transcript automatically.
          </p>
        )}
      </div>

      {/* Bottom controls */}
      <div className="flex items-center justify-center gap-3 pt-4 border-t border-slate-200">
        <button
          type="button"
          onClick={onToggleMute}
          disabled={status !== 'listening' && status !== 'speaking'}
          aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
          className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-45 ${
            muted
              ? 'bg-slate-900 text-white border-slate-900'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          {muted ? (
            <>
              <MicOff className="w-4 h-4" aria-hidden="true" />
              Unmute
            </>
          ) : (
            <>
              <Mic className="w-4 h-4" aria-hidden="true" />
              Mute
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onEnd}
          aria-label="End live voice session"
          className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
        >
          <PhoneOff className="w-4 h-4" aria-hidden="true" />
          End Voice
        </button>
      </div>
    </section>
  );
}
