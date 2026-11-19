import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base64ToPcm16,
  buildLiveWsUrl,
  computeRmsLevel,
  downsampleFloat32,
  float32ToInt16Pcm,
  int16PcmToFloat32,
  normalizeVoiceName,
  pcm16ToBase64,
} from './voiceAudio';

test('normalizeVoiceName validates allowlist and defaults to Zephyr', () => {
  assert.equal(normalizeVoiceName('Kore'), 'Kore');
  assert.equal(normalizeVoiceName('Fenrir'), 'Fenrir');
  assert.equal(normalizeVoiceName('invalid-voice'), 'Zephyr');
  assert.equal(normalizeVoiceName(undefined), 'Zephyr');
});

test('buildLiveWsUrl selects ws vs wss and encodes bot slug', () => {
  assert.equal(
    buildLiveWsUrl({ protocol: 'http:', host: 'localhost:3000' }, 'freight-support-bot', 'hosted'),
    'ws://localhost:3000/api/v1/bots/freight-support-bot/live?channel=hosted'
  );
  assert.equal(
    buildLiveWsUrl({ protocol: 'https:', host: 'chat.example.com' }, 'my shop', 'widget'),
    'wss://chat.example.com/api/v1/bots/my%20shop/live?channel=widget'
  );
});

test('float32ToInt16Pcm and int16PcmToFloat32 round-trip and clamp out-of-range samples', () => {
  const input = new Float32Array([-1.5, -1, -0.5, 0, 0.5, 1, 2.5]);
  const pcm = float32ToInt16Pcm(input);
  assert.equal(pcm[0], -32768);
  assert.equal(pcm[1], -32768);
  assert.equal(pcm[3], 0);
  assert.equal(pcm[5], 32767);
  assert.equal(pcm[6], 32767);

  const restored = int16PcmToFloat32(pcm);
  assert.ok(Math.abs(restored[2] - -0.5) < 0.001);
  assert.ok(Math.abs(restored[4] - 0.5) < 0.001);
});

test('pcm16ToBase64 and base64ToPcm16 preserve exact 16-bit little-endian samples', () => {
  const original = new Int16Array([-32768, -1024, -1, 0, 1, 2048, 32767]);
  const encoded = pcm16ToBase64(original);
  const decoded = base64ToPcm16(encoded);
  assert.deepEqual(Array.from(decoded), Array.from(original));
});

test('downsampleFloat32 reduces 48kHz buffers cleanly to 16kHz', () => {
  const buf48k = new Float32Array(480);
  for (let i = 0; i < buf48k.length; i++) {
    buf48k[i] = 0.25;
  }
  const out16k = downsampleFloat32(buf48k, 48000, 16000);
  assert.equal(out16k.length, 160);
  assert.ok(Math.abs(out16k[0] - 0.25) < 1e-6);
  assert.ok(Math.abs(out16k[159] - 0.25) < 1e-6);

  // Passthrough when already at target rate
  const passthrough = downsampleFloat32(out16k, 16000, 16000);
  assert.equal(passthrough.length, 160);
});

test('computeRmsLevel returns bounded 0..1 level', () => {
  assert.equal(computeRmsLevel(new Float32Array([0, 0, 0, 0])), 0);
  const mid = computeRmsLevel(new Float32Array([0.1, -0.1, 0.1, -0.1]));
  assert.ok(mid > 0.3 && mid < 0.4);
  assert.equal(computeRmsLevel(new Float32Array([1, -1, 1, -1])), 1);
});
