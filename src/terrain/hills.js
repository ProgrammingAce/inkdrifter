const { HEX_SIZE } = require('../constants.js');
const { createRng } = require('../rng.js');
const { hexCenter, hexAtPoint } = require('../hex.js');

function drawHillBump(ctx, hill, lineColor) {
  const { leftBaseX, rightBaseX, points, rng } = hill;

  const strokeWidth = Math.max(3.5, Math.min(6, HEX_SIZE * 0.10));
  const tickWidth = Math.max(2, Math.min(3.5, HEX_SIZE * 0.055));
  const width = rightBaseX - leftBaseX;

  ctx.strokeStyle = lineColor;
  ctx.fillStyle = hill.fillColor;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const padded = [points[0], ...points, points[points.length - 1]];
  const traceCurve = (yOffset) => {
    ctx.moveTo(padded[1].x, padded[1].y + yOffset);
    for (let i = 1; i < padded.length - 2; i++) {
      const p0 = padded[i - 1], p1 = padded[i], p2 = padded[i + 1], p3 = padded[i + 2];
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6 + yOffset;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6 + yOffset;
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y + yOffset);
    }
  };

  const samples = [];
  {
    const pad = padded;
    samples.push({ x: pad[1].x, y: pad[1].y });
    for (let i = 1; i < pad.length - 2; i++) {
      const p0 = pad[i - 1], p1 = pad[i], p2 = pad[i + 1], p3 = pad[i + 2];
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      const STEPS = 10;
      for (let s = 1; s <= STEPS; s++) {
        const t = s / STEPS, u = 1 - t;
        const x = u*u*u*p1.x + 3*u*u*t*c1x + 3*u*t*t*c2x + t*t*t*p2.x;
        const y = u*u*u*p1.y + 3*u*u*t*c1y + 3*u*t*t*c2y + t*t*t*p2.y;
        samples.push({ x, y });
      }
    }
  }

  const upperOffset = strokeWidth * 0.65;
  const lowerOffset = strokeWidth * 0.65 + width * 0.20;
  ctx.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (i === 0) ctx.moveTo(s.x, s.y - upperOffset);
    else ctx.lineTo(s.x, s.y - upperOffset);
  }
  const last = samples[samples.length - 1];
  const first = samples[0];
  ctx.lineTo(last.x, last.y + lowerOffset);
  ctx.lineTo(first.x, first.y + lowerOffset);
  ctx.closePath();
  ctx.fill();

  ctx.lineWidth = strokeWidth;
  ctx.beginPath();
  traceCurve(0);
  ctx.stroke();

  ctx.lineCap = 'round';
  ctx.lineWidth = tickWidth;
  const tickCount = 3 + Math.floor(rng.uniform() * 2);
  for (let ti = 0; ti < tickCount; ti++) {
    const frac = 0.10 + (ti / (tickCount - 1 || 1)) * 0.32;
    const idx = Math.min(samples.length - 1, Math.floor(frac * (samples.length - 1)));
    const p = samples[idx];
    const tickLen = width * (0.09 + rng.uniform() * 0.04);
    const startGap = strokeWidth * 0.55;
    const angle = (15 + rng.uniform() * 20) * Math.PI / 180;
    const sx = p.x - tickLen * 0.15;
    const sy = p.y + startGap;
    const ex = sx + Math.cos(angle) * tickLen;
    const ey = sy + Math.sin(angle) * tickLen;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
}

function drawHills(canvas, hillHexes, opts = {}) {
  if (!hillHexes || hillHexes.length === 0) return;
  const ctx = canvas.getContext('2d');
  const seed = opts.seed ?? 0;
  const lineColor = opts.lineColor ?? '#2a2015';
  const fillColor = opts.fillColor ?? '#e8d5b7';

  const riverPts = [];
  if (opts.rivers) {
    for (const r of opts.rivers) {
      if (!r || !r.points) continue;
      for (const p of r.points) riverPts.push(p);
    }
  }
  const RIVER_CLEAR = HEX_SIZE * 0.18;
  const crossesRiver = (cx, cy, halfW, hillHeight) => {
    if (riverPts.length === 0) return false;
    const xMin = cx - halfW - RIVER_CLEAR;
    const xMax = cx + halfW + RIVER_CLEAR;
    const yMin = cy - hillHeight - RIVER_CLEAR;
    const yMax = cy + RIVER_CLEAR;
    for (let i = 0; i < riverPts.length; i++) {
      const p = riverPts[i];
      if (p.x >= xMin && p.x <= xMax && p.y >= yMin && p.y <= yMax) return true;
    }
    return false;
  };

  // Hills are placed up to ~1.5 hexes from their owning land hex's center, so
  // a hill anchored near a coast can drift over a neighboring water hex. Reject
  // any candidate whose base or apex sits inside a water hex.
  const water = opts.water ?? null;
  const overWater = (cx, baseY, hillHeight) => {
    if (!water) return false;
    const probes = [
      { x: cx, y: baseY },
      { x: cx, y: baseY - hillHeight },
    ];
    for (const p of probes) {
      const h = hexAtPoint(p.x, p.y, opts);
      if (h && water.has(`${h.r},${h.c}`)) return true;
    }
    return false;
  };

  function makeHill(rng, px, baseY, hillWidth, hillHeight) {
    const leftBaseX = px - hillWidth * 0.5;
    const rightBaseX = px + hillWidth * 0.5;
    const tipDipL = hillHeight * (0.05 + rng.uniform() * 0.12);
    const tipDipR = hillHeight * (0.05 + rng.uniform() * 0.12);
    const apexBias = (rng.uniform() - 0.5) * 0.5;
    const innerCount = 2;

    const points = [];
    points.push({ x: leftBaseX, y: baseY + tipDipL });
    for (let k = 0; k < innerCount; k++) {
      const tFrac = (k + 1) / (innerCount + 1);
      const x = leftBaseX + (tFrac + apexBias * (1 - Math.abs(2*tFrac - 1)) * 0.6) * hillWidth;
      let yFrac = Math.sin(tFrac * Math.PI);
      yFrac *= 0.92 + rng.uniform() * 0.16;
      const y = baseY - hillHeight * yFrac;
      points.push({ x, y });
    }
    points.push({ x: rightBaseX, y: baseY + tipDipR });
    return { leftBaseX, rightBaseX, points, rng, fillColor, sortKey: baseY };
  }

  const hills = [];
  for (const h of hillHexes) {
    const center = hexCenter(h.r, h.c, opts);
    const rng = createRng((((seed + h.r * 73856093) ^ (h.c * 19349663)) ^ 0x4117C0DE) >>> 0);
    const roll = rng.uniform();
    const count = roll < 0.15 ? 1 : roll < 0.60 ? 2 : roll < 0.90 ? 3 : 4;

    for (let i = 0; i < count; i++) {
      const widthSkew = Math.pow(rng.uniform(), 1.3);
      const hillWidth = HEX_SIZE * (0.55 + widthSkew * 0.55);
      const hillHeight = HEX_SIZE * 0.10 + hillWidth * 0.20;

      let px = 0, baseY = 0, placed = false;
      for (let attempt = 0; attempt < 6; attempt++) {
        px = center.x + (rng.uniform() - 0.5) * HEX_SIZE * 3.0;
        baseY = center.y + (rng.uniform() - 0.5) * HEX_SIZE * 2.4;
        if (!crossesRiver(px, baseY, hillWidth * 0.5, hillHeight) && !overWater(px, baseY, hillHeight)) {
          placed = true;
          break;
        }
      }
      if (!placed) continue;

      const primary = makeHill(rng, px, baseY, hillWidth, hillHeight);
      hills.push(primary);

      if (rng.uniform() < 0.18) {
        const buddyWidth = hillWidth * (0.85 + rng.uniform() * 0.40);
        const buddyHeight = HEX_SIZE * 0.10 + buddyWidth * 0.20;
        const overlapFrac = 0.30 + rng.uniform() * 0.25;
        const buddyLeftBase = primary.leftBaseX + hillWidth * overlapFrac;
        const buddyPx = buddyLeftBase + buddyWidth * 0.5;
        const buddyBaseY = baseY + (rng.uniform() - 0.3) * hillHeight * 0.35;
        if (!crossesRiver(buddyPx, buddyBaseY, buddyWidth * 0.5, buddyHeight) && !overWater(buddyPx, buddyBaseY, buddyHeight)) {
          const buddy = makeHill(rng, buddyPx, buddyBaseY, buddyWidth, buddyHeight);
          buddy.sortKey = primary.sortKey + 0.5;
          hills.push(buddy);
        }
      }
    }
  }

  hills.sort((a, b) => a.sortKey - b.sortKey);
  for (const h of hills) {
    drawHillBump(ctx, h, lineColor);
  }
}

module.exports = { drawHills };
