const { HEX_SIZE } = require('../constants.js');
const { createRng } = require('../rng.js');
const { hexCenter, hexNeighbors } = require('../hex.js');

function drawMountainPeak(ctx, peak, lineColor) {
  const { px, apexY, baseY, leftBaseX, rightBaseX, rng } = peak;

  const outlineWidth = Math.max(3.5, Math.min(6, HEX_SIZE * 0.10));
  const tickWidth = Math.max(2, Math.min(3.5, HEX_SIZE * 0.055));

  ctx.strokeStyle = lineColor;
  ctx.fillStyle = peak.fillColor;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const leftCtrlX = leftBaseX + (px - leftBaseX) * 0.55 + (rng.uniform() - 0.5) * HEX_SIZE * 0.04;
  const leftCtrlY = baseY + (apexY - baseY) * 0.35;
  const rightCtrlX = rightBaseX + (px - rightBaseX) * 0.55 + (rng.uniform() - 0.5) * HEX_SIZE * 0.04;
  const rightCtrlY = baseY + (apexY - baseY) * 0.35;

  ctx.beginPath();
  ctx.moveTo(leftBaseX, baseY);
  ctx.quadraticCurveTo(leftCtrlX, leftCtrlY, px, apexY);
  ctx.quadraticCurveTo(rightCtrlX, rightCtrlY, rightBaseX, baseY);
  ctx.closePath();
  ctx.fill();

  ctx.lineWidth = outlineWidth;
  ctx.beginPath();
  ctx.moveTo(leftBaseX, baseY);
  ctx.quadraticCurveTo(leftCtrlX, leftCtrlY, px, apexY);
  ctx.quadraticCurveTo(rightCtrlX, rightCtrlY, rightBaseX, baseY);
  ctx.stroke();

  ctx.lineWidth = tickWidth;
  const baseX = leftBaseX;
  const ctrlX = leftCtrlX;
  const ctrlY = leftCtrlY;
  const peakHeight = baseY - apexY;
  const heightTicks = Math.round(peakHeight / (HEX_SIZE * 0.11));
  const tickCount = Math.max(3, Math.min(11, heightTicks + Math.floor(rng.uniform() * 2)));
  for (let t = 0; t < tickCount; t++) {
    const frac = 0.18 + (t / (tickCount - 1 || 1)) * 0.68;
    const u = 1 - frac;
    const bx = u * u * baseX + 2 * u * frac * ctrlX + frac * frac * px;
    const by = u * u * baseY + 2 * u * frac * ctrlY + frac * frac * apexY;
    const tx = 2 * u * (ctrlX - baseX) + 2 * frac * (px - ctrlX);
    const ty = 2 * u * (ctrlY - baseY) + 2 * frac * (apexY - ctrlY);
    const tlen = Math.hypot(tx, ty) || 1;
    const nx = -ty / tlen;
    const ny = tx / tlen;
    const droopX = nx * 0.85;
    const droopY = ny * 0.85 + 0.45;
    const dlen = Math.hypot(droopX, droopY) || 1;
    const dx = droopX / dlen;
    const dy = droopY / dlen;
    const slopeLen = Math.hypot(px - baseX, apexY - baseY);
    const tickLen = slopeLen * (0.22 - frac * 0.10) * (0.8 + rng.uniform() * 0.5);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + dx * tickLen, by + dy * tickLen);
    ctx.stroke();
  }
}

function drawMountains(canvas, mountainHexes, opts = {}) {
  if (!mountainHexes || mountainHexes.length === 0) return;
  const ctx = canvas.getContext('2d');
  const seed = opts.seed ?? 0;
  const lineColor = opts.lineColor ?? '#2a2015';
  const fillColor = opts.fillColor ?? '#e8d5b7';

  const visited = new Set();
  const chains = [];

  for (const h of mountainHexes) {
    const key = `${h.r},${h.c}`;
    if (visited.has(key)) continue;

    const chain = [];
    const queue = [h];
    visited.add(key);

    while (queue.length > 0) {
      const cur = queue.shift();
      const curCenter = hexCenter(cur.r, cur.c, opts);
      chain.push({
        r: cur.r,
        c: cur.c,
        center: curCenter,
        rng: createRng((((seed + cur.r * 73856093) ^ (cur.c * 19349663)) ^ 0x4E54C0DE) >>> 0),
      });

      for (const n of hexNeighbors(cur.r, cur.c)) {
        const nk = `${n.r},${n.c}`;
        if (visited.has(nk)) continue;
        const nHex = mountainHexes.find(m => `${m.r},${m.c}` === nk);
        if (nHex) {
          visited.add(nk);
          queue.push(nHex);
        }
      }
    }

    chains.push(chain);
  }

  const peaks = [];
  for (const chain of chains) {
    for (const h of chain) {
      const peakCount = 1 + Math.floor(h.rng.uniform() * 3);
      const spread = HEX_SIZE * (0.95 + peakCount * 0.18);
      for (let i = 0; i < peakCount; i++) {
        const hu = h.rng.uniform();
        const heightSkew = hu < 0.5
          ? Math.pow(hu * 2, 1.8) * 0.5
          : 1 - Math.pow((1 - hu) * 2, 1.8) * 0.5;
        const peakHeight = HEX_SIZE * 0.35 + heightSkew * 81;
        const widthJitter = 0.85 + h.rng.uniform() * 0.45;
        const peakWidth = (HEX_SIZE * 0.45 + peakHeight * 0.85) * widthJitter;
        const t = peakCount === 1 ? 0 : (i / (peakCount - 1)) - 0.5;
        const jitterX = t * spread + (h.rng.uniform() - 0.5) * HEX_SIZE * 0.15;
        const jitterY = (h.rng.uniform() - 0.5) * HEX_SIZE * 0.30;
        const px = h.center.x + jitterX;
        const baseY = h.center.y + jitterY + HEX_SIZE * 0.25;
        const apexY = baseY - peakHeight;
        peaks.push({
          px,
          apexY,
          baseY,
          leftBaseX: px - peakWidth * 0.5,
          rightBaseX: px + peakWidth * 0.5,
          rng: h.rng,
          fillColor,
          sortKey: baseY,
        });
      }
    }
  }

  peaks.sort((a, b) => a.sortKey - b.sortKey);

  for (const p of peaks) {
    drawMountainPeak(ctx, p, lineColor);
  }
}

module.exports = { drawMountains };
