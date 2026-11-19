import type { LiveVoiceName } from '../types';

export const LIVE_INPUT_SAMPLE_RATE = 16000;
export const LIVE_OUTPUT_SAMPLE_RATE = 24000;
export const DEFAULT_LIVE_VOICE: LiveVoiceName = 'Zephyr';

export interface LiveVoiceOption {
  value: LiveVoiceName;
  label: string;
  tone: string;
}

export const LIVE_VOICE_OPTIONS: LiveVoiceOption[] = [
  { value: 'Zephyr', label: 'Zephyr', tone: 'Warm & balanced (Recommended)' },
  { value: 'Kore', label: 'Kore', tone: 'Clear & crisp' },
  { value: 'Puck', label: 'Puck', tone: 'Upbeat & friendly' },
  { value: 'Charon', label: 'Charon', tone: 'Calm & steady' },
  { value: 'Fenrir', label: 'Fenrir', tone: 'Confident & direct' },
];

const VALID_VOICES = new Set<LiveVoiceName>(['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir']);

export function normalizeVoiceName(val: unknown): LiveVoiceName {
  if (typeof val === 'string' && VALID_VOICES.has(val as LiveVoiceName)) {
    return val as LiveVoiceName;
  }
  return DEFAULT_LIVE_VOICE;
}

export function buildLiveWsUrl(
  locationLike: { protocol: string; host: string },
  botSlug: string,
  channel: 'hosted' | 'widget'
): string {
  const wsProto = locationLike.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProto}//${locationLike.host}/api/v1/bots/${encodeURIComponent(botSlug)}/live?channel=${channel}`;
}

export function downsampleFloat32(
  samples: Float32Array,
  inputSampleRate: number,
  targetSampleRate = LIVE_INPUT_SAMPLE_RATE
): Float32Array {
  if (samples.length === 0) return new Float32Array(0);
  if (!inputSampleRate || inputSampleRate <= targetSampleRate) {
    return samples;
  }
  const ratio = inputSampleRate / targetSampleRate;
  const outLength = Math.max(1, Math.floor(samples.length / ratio));
  const result = new Float32Array(outLength);

  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < outLength) {
    const nextOffsetBuffer = Math.min(samples.length, Math.round((offsetResult + 1) * ratio));
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer; i++) {
      accum += samples[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

export function float32ToInt16Pcm(float32: Float32Array): Int16Array {
  const pcm = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    pcm[i] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
  }
  return pcm;
}

export function int16PcmToFloat32(int16: Int16Array): Float32Array {
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] < 0 ? int16[i] / 0x8000 : int16[i] / 0x7fff;
  }
  return float32;
}

export function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  if (typeof Buffer !== 'undefined' && typeof btoa === 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToPcm16(base64: string): Int16Array {
  if (!base64) return new Int16Array(0);
  if (typeof Buffer !== 'undefined' && typeof atob === 'undefined') {
    const buf = Buffer.from(base64, 'base64');
    const alignedLen = Math.floor(buf.byteLength / 2);
    const out = new Int16Array(alignedLen);
    for (let i = 0; i < alignedLen; i++) {
      out[i] = buf.readInt16LE(i * 2);
    }
    return out;
  }
  const binary = atob(base64);
  const byteLen = binary.length - (binary.length % 2);
  const bytes = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const out = new Int16Array(byteLen / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = view.getInt16(i * 2, true);
  }
  return out;
}

export function computeRmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / samples.length);
  return Math.min(1, Math.max(0, rms * 3.5));
}
