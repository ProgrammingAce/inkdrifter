const { HEX_SIZE } = require('../constants.js');
const { createRng, gaussianFilter1D } = require('../rng.js');
const { hexCenter } = require('../hex.js');

function drawPonds(canvas, ponds, opts = {}) {
  if (!ponds || ponds.length === 0) return;
  const ctx = canvas.getContext('2d');
  const scale = opts.scale ?? 1;
  const seed = opts.seed ?? 0;
  const lineColor = opts.lineColor ?? '#2a2015';
  ctx.strokeStyle = lineColor;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let pi = 0; pi < ponds.length; pi++) {
    const p = ponds[pi];
    const center = hexCenter(p.r, p.c, opts);
    const rng = createRng(((seed + pi * 0x9e3779b1) ^ 0x70AD0001) >>> 0);
    const offAng = rng.uniform() * Math.PI * 2;
    const offDist = rng.uniform() * HEX_SIZE * 0.35;
    const ox = center.x + Math.cos(offAng) * offDist;
    const oy = center.y + Math.sin(offAng) * offDist;
    const baseR = HEX_SIZE * (0.30 + rng.uniform() * 0.15);
    const N = 12 + Math.floor(rng.uniform() * 8);
    const radii = new Array(N);
    for (let i = 0; i < N; i++) radii[i] = rng.normal();
    const sm = gaussianFilter1D(radii, 1.0);
    const wrapped = sm.slice();
    for (let i = 0; i < N; i++) {
      wrapped[i] = (sm[i] + sm[(i + N - 1) % N] + sm[(i + 1) % N]) / 3;
    }
    const pts = [];
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2;
      const r = baseR * (1.0 + wrapped[i] * 1.2);
      pts.push({
        x: ox + Math.cos(ang) * r,
        y: oy + Math.sin(ang) * r,
      });
    }
    ctx.lineWidth = Math.max(1, 6.0 * scale);
    ctx.beginPath();
    ctx.moveTo(pts[0].x * scale, pts[0].y * scale);
    for (let i = 1; i < N; i++) ctx.lineTo(pts[i].x * scale, pts[i].y * scale);
    ctx.closePath();
    ctx.stroke();

    const rings = 1 + (rng.uniform() < 0.55 ? 1 : 0);
    for (let k = 0; k < rings; k++) {
      const shrink = 0.55 - k * 0.22;
      ctx.lineWidth = Math.max(0.5, 1.1 * scale);
      ctx.beginPath();
      const dashLen = 6, gapLen = 4;
      let drawing = false, acc = 0;
      let mode = 'dash';
      for (let i = 0; i <= N; i++) {
        const idx = i % N;
        const px = ox + (pts[idx].x - ox) * shrink;
        const py = oy + (pts[idx].y - oy) * shrink;
        if (mode === 'dash') {
          if (!drawing) { ctx.moveTo(px * scale, py * scale); drawing = true; }
          else ctx.lineTo(px * scale, py * scale);
          acc++;
          if (acc >= dashLen) { acc = 0; mode = 'gap'; }
        } else {
          drawing = false;
          acc++;
          if (acc >= gapLen) { acc = 0; mode = 'dash'; }
        }
      }
      ctx.stroke();
    }
  }
}

module.exports = { drawPonds };
