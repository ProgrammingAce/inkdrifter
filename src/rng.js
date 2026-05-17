function createRng(seed) {
  let a = seed >>> 0;
  function uniform() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  let spare = null;
  function normal() {
    if (spare !== null) { const s = spare; spare = null; return s; }
    const u1 = Math.max(uniform(), 1e-12);
    const u2 = uniform();
    const mag = Math.sqrt(-2 * Math.log(u1));
    spare = mag * Math.sin(2 * Math.PI * u2);
    return mag * Math.cos(2 * Math.PI * u2);
  }
  function uniformRange(lo, hi) { return lo + uniform() * (hi - lo); }
  function uniformInt(lo, hi) { return lo + Math.floor(uniform() * (hi - lo)); }
  return { uniform, normal, uniformRange, uniformInt };
}

function gaussianFilter1D(arr, sigma) {
  const radius = Math.ceil(4 * sigma);
  const kernel = new Array(2 * radius + 1);
  let sum = 0;
  for (let k = -radius; k <= radius; k++) {
    const v = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel[k + radius] = v;
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const N = arr.length;
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    let v = 0;
    for (let k = -radius; k <= radius; k++) {
      const idx = Math.min(Math.max(i + k, 0), N - 1);
      v += arr[idx] * kernel[k + radius];
    }
    out[i] = v;
  }
  return out;
}

function jitter(N, amplitude, sigma, rng) {
  const raw = new Array(N);
  for (let i = 0; i < N; i++) raw[i] = rng.normal();
  const smoothed = gaussianFilter1D(raw, sigma);
  let peak = 1e-12;
  for (let i = 0; i < N; i++) {
    const a = Math.abs(smoothed[i]);
    if (a > peak) peak = a;
  }
  for (let i = 0; i < N; i++) smoothed[i] = (smoothed[i] / peak) * amplitude;
  return smoothed;
}

function blotSignal(N, rate, amp, width, rng) {
  const seedAmp = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    if (rng.uniform() < rate) seedAmp[i] = rng.uniformRange(0.4, 1.0) * amp;
  }
  return gaussianFilter1D(seedAmp, width);
}

function weightedChoice(items, weights, rng) {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng.uniform() * total;
  let acc = 0;
  for (let i = 0; i < items.length; i++) {
    acc += weights[i];
    if (acc >= r) return items[i];
  }
  return items[items.length - 1];
}

module.exports = { createRng, gaussianFilter1D, jitter, blotSignal, weightedChoice };
