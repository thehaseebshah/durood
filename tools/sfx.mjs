// Sound design for the promos, synthesised from a scene's cue list (window.CUES): no music and no samples, only
// soft effects — wind under the night sky, whooshes between scenes, a bead click per tap, warm impacts on big moments,
// dry thumps for panels that slam in.
//   writeSfx(cues, seconds, 'out.wav')
import fs from 'node:fs';

const SR = 44100;
let seed = 99; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

// a band-pass (RBJ biquad, stable at any frequency) whose centre frequency can move; coefficients refresh every 32 samples
function bandpass(input, fAt, q = 1.2) {
  const out = new Float32Array(input.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0 = 0, a1 = 0, a2 = 0, a0 = 1;
  for (let i = 0; i < input.length; i++) {
    if (i % 32 === 0) { const w = 2 * Math.PI * Math.min(Math.max(fAt(i / SR), 20), SR * 0.45) / SR, al = Math.sin(w) / (2 * q); b0 = al; a0 = 1 + al; a1 = -2 * Math.cos(w); a2 = 1 - al; }
    const x = input[i], y = (b0 * x - b0 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y; out[i] = y;
  }
  return out;
}
const noise = (n) => Float32Array.from({ length: n }, rnd);
const env = (x, a, d) => (x < a ? x / a : Math.exp(-(x - a) / d));       // quick attack, exponential decay

const VOICES = {
  whoosh(len = 0.9) {
    const n = Math.round(len * SR), b = bandpass(noise(n), (s) => 250 * Math.pow(18, s / len), 0.9);
    return b.map((v, i) => v * Math.pow(Math.sin(Math.PI * i / n), 2) * 0.75);
  },
  rise(len = 3.8) {
    const n = Math.round(len * SR), b = bandpass(noise(n), (s) => 180 * Math.pow(30, s / len), 1.5);
    return b.map((v, i) => v * Math.pow(i / n, 2.2) * (i > n - 0.05 * SR ? (n - i) / (0.05 * SR) : 1) * 0.5);
  },
  swell(len = 5) {
    const n = Math.round(len * SR), b = bandpass(noise(n), (s) => 650 + 350 * Math.sin(s * 0.9), 0.7);
    return b.map((v, i) => { const s = i / SR; return v * (s < 2.2 ? s / 2.2 : Math.exp(-(s - 2.2) / 1.2)) * 0.6 + Math.sin(2 * Math.PI * 55 * s) * 0.2 * env(s, 1.5, 1.3); });
  },
  bloom(len = 3.2) {  // a soft, deep impact with a bright airy tail
    const n = Math.round(len * SR), air = bandpass(noise(n), () => 6500, 0.8);
    const out = new Float32Array(n); let ph = 0;
    for (let i = 0; i < n; i++) { const s = i / SR; ph += 2 * Math.PI * (40 + 70 * Math.exp(-s * 5)) / SR; out[i] = Math.sin(ph) * env(s, 0.01, 0.55) * 0.9 + air[i] * env(s, 0.02, 0.9) * 0.45; }
    return out;
  },
  tap(len = 0.12, k = 0) {  // a wooden bead: a short pitched knock and a tick of noise
    const n = Math.round(len * SR), f = 1250 + (k % 5) * 40, out = new Float32Array(n);
    for (let i = 0; i < n; i++) { const s = i / SR; out[i] = Math.sin(2 * Math.PI * f * s) * env(s, 0.001, 0.018) * 0.22 + Math.sin(2 * Math.PI * f * 2.7 * s) * env(s, 0.0005, 0.006) * 0.1 + rnd() * env(s, 0.0003, 0.002) * 0.15; }
    return out;
  },
  thump(len = 0.45) {  // a short, dry low hit with a click on top, for panels that slam in
    const n = Math.round(len * SR), out = new Float32Array(n); let ph = 0;
    for (let i = 0; i < n; i++) { const s = i / SR; ph += 2 * Math.PI * (48 + 110 * Math.exp(-s * 28)) / SR; out[i] = Math.sin(ph) * env(s, 0.002, 0.09) * 0.95 + rnd() * env(s, 0.0005, 0.004) * 0.35; }
    return out;
  },
  tick(len = 0.08) { const n = Math.round(len * SR); return Float32Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * 2200 * i / SR) * env(i / SR, 0.001, 0.01) * 0.4); },
};

export function writeSfx(cues, seconds, file) {
  const n = Math.round(seconds * SR), L = new Float32Array(n), R = new Float32Array(n);
  // a bed of night wind so the silences are never dead
  const wl = bandpass(noise(n), (s) => 300 + 120 * Math.sin(s * 0.21), 0.6), wr = bandpass(noise(n), (s) => 320 + 120 * Math.sin(s * 0.17 + 1), 0.6);
  for (let i = 0; i < n; i++) { L[i] = wl[i] * 0.05; R[i] = wr[i] * 0.05; }
  cues.forEach(({ t, k }, j) => {
    const v = VOICES[k](undefined, j), at = Math.round(t * SR), pan = k === 'tap' ? (j % 2 ? 0.35 : -0.35) : 0;
    for (let i = 0; i < v.length && at + i < n; i++) { L[at + i] += v[i] * (1 - pan); R[at + i] += v[i] * (1 + pan); }
  });
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  if (!Number.isFinite(peak) || peak === 0) throw new Error('sfx: the mix came out silent or unstable'); // a silent track would otherwise pass unnoticed
  const g = 0.7 / (peak || 1), fade = 1.5 * SR;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const f = Math.min(1, (n - i) / fade) * Math.min(1, i / (0.3 * SR));
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * g * f)) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * g * f)) * 32767), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}
