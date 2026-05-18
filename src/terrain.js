const { HEX_SIZE } = require('./constants.js');
const { createRng, gaussianFilter1D } = require('./rng.js');
const { hexCenter, hexNeighbors } = require('./hex.js');

// ── Ponds ────────────────────────────────────────────────────────────────────
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

// ── Mountains ────────────────────────────────────────────────────────────────
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

// ── Hills ────────────────────────────────────────────────────────────────────
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
        if (!crossesRiver(px, baseY, hillWidth * 0.5, hillHeight)) {
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
        if (!crossesRiver(buddyPx, buddyBaseY, buddyWidth * 0.5, buddyHeight)) {
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

// ── Grass ────────────────────────────────────────────────────────────────────
function drawGrassTuft(ctx, cx, baseY, size, rng) {
  const leafCount = 3 + Math.floor(rng.uniform() * 3);
  const fanSpread = 70 + rng.uniform() * 30;
  for (let i = 0; i < leafCount; i++) {
    const t = leafCount === 1 ? 0.5 : i / (leafCount - 1);
    const angleDeg = -fanSpread / 2 + t * fanSpread + (rng.uniform() - 0.5) * 8;
    const angle = angleDeg * Math.PI / 180;
    const len = size * (0.85 + rng.uniform() * 0.30);
    const halfBase = size * (0.10 + rng.uniform() * 0.05);
    const tipX = cx + Math.sin(angle) * len;
    const tipY = baseY - Math.cos(angle) * len;
    const perpX = Math.cos(angle);
    const perpY = Math.sin(angle);
    const blX = cx - perpX * halfBase;
    const blY = baseY - perpY * halfBase;
    const brX = cx + perpX * halfBase;
    const brY = baseY + perpY * halfBase;
    const bellyOut = halfBase * 1.4;
    const midX = (cx + tipX) / 2;
    const midY = (baseY + tipY) / 2;
    const cpLx = midX - perpX * bellyOut;
    const cpLy = midY - perpY * bellyOut;
    const cpRx = midX + perpX * bellyOut;
    const cpRy = midY + perpY * bellyOut;
    ctx.beginPath();
    ctx.moveTo(blX, blY);
    ctx.quadraticCurveTo(cpLx, cpLy, tipX, tipY);
    ctx.quadraticCurveTo(cpRx, cpRy, brX, brY);
    ctx.closePath();
    ctx.fill();
  }
}

function drawGrass(canvas, plainsHexes, opts = {}) {
  if (!plainsHexes || plainsHexes.length === 0) return;
  const ctx = canvas.getContext('2d');
  const seed = opts.seed ?? 0;
  const lineColor = opts.lineColor ?? '#2a2015';

  const riverPts = [];
  if (opts.rivers) {
    for (const r of opts.rivers) {
      if (!r || !r.points) continue;
      for (const p of r.points) riverPts.push(p);
    }
  }
  const RIVER_CLEAR = HEX_SIZE * 0.22;
  const nearRiver = (x, y) => {
    if (riverPts.length === 0) return false;
    for (let i = 0; i < riverPts.length; i++) {
      const p = riverPts[i];
      const dx = p.x - x, dy = p.y - y;
      if (dx * dx + dy * dy < RIVER_CLEAR * RIVER_CLEAR) return true;
    }
    return false;
  };

  ctx.fillStyle = lineColor;

  for (const h of plainsHexes) {
    const center = hexCenter(h.r, h.c, opts);
    const rng = createRng((((seed + h.r * 374761393) ^ (h.c * 668265263)) ^ 0x6757A55F) >>> 0);
    const tuftCount = 2 + Math.floor(rng.uniform() * 2);
    for (let i = 0; i < tuftCount; i++) {
      const rRadius = HEX_SIZE * 0.70 * Math.sqrt(rng.uniform());
      const rTheta = rng.uniform() * Math.PI * 2;
      const x = center.x + Math.cos(rTheta) * rRadius;
      const y = center.y + Math.sin(rTheta) * rRadius;
      if (nearRiver(x, y)) continue;
      const size = HEX_SIZE * (0.15 + rng.uniform() * 0.08);
      drawGrassTuft(ctx, x, y, size, rng);
    }
  }
}

// ── Forests ──────────────────────────────────────────────────────────────────
function treeStroke() {
  return Math.max(2.6, Math.min(4.4, HEX_SIZE * 0.078));
}

// Build one side of a fir silhouette (bottom -> apex shoulder) with the
// given parameters. Each side can use independent params for asymmetry.
function _firSidePoints(cx, baseY, h, side, p) {
  const sgn = side; // -1 left, +1 right
  const pts = [];
  pts.push({ x: cx + sgn * p.skirtW, y: baseY - p.trunkH });
  for (let i = 0; i < p.nLobes; i++) {
    const valleyFrac = (p.trunkH / h) + i * p.lobeStep + p.lobeStep * 0.05;
    const tipFrac    = (p.trunkH / h) + i * p.lobeStep + p.lobeStep * (0.50 + p.tipBias);
    const valleyW = p.skirtW * (1 - i * (0.22 + p.valleyJitter[i]));
    const tipW    = p.skirtW * (1 - (i + 1) * (0.18 + p.tipJitter[i]));
    // shallower valleys → fuller "belly" silhouette like the example
    pts.push({ x: cx + sgn * valleyW * (0.72 + p.valleyInset[i]), y: baseY - h * valleyFrac });
    pts.push({ x: cx + sgn * tipW, y: baseY - h * tipFrac });
  }
  pts.push({ x: cx + sgn * p.halfW * 0.18, y: baseY - h + h * p.apexFrac * 0.55 });
  return pts;
}

function _firParams(rng, halfW, h, lobesOverride) {
  const nLobes = lobesOverride ?? (2 + (rng.uniform() < 0.55 ? 1 : 0) + (rng.uniform() < 0.18 ? 1 : 0));
  const apexFrac = 0.16 + rng.uniform() * 0.08;
  const trunkH = h * (0.06 + rng.uniform() * 0.05);
  const lobeSpan = 1 - apexFrac - (trunkH / h);
  const valleyJitter = [], tipJitter = [], valleyInset = [];
  for (let i = 0; i < nLobes; i++) {
    valleyJitter.push(rng.uniform() * 0.10);
    tipJitter.push(rng.uniform() * 0.08);
    valleyInset.push(rng.uniform() * 0.18);
  }
  return {
    halfW,
    skirtW: halfW * (0.90 + rng.uniform() * 0.16),
    trunkH,
    nLobes,
    apexFrac,
    lobeSpan,
    lobeStep: lobeSpan / nLobes,
    tipBias: (rng.uniform() - 0.5) * 0.08,
    valleyJitter, tipJitter, valleyInset,
  };
}

function _strokeSidePath(ctx, side, startsAt, endsAt) {
  // start is already moved to; emit quadraticCurveTo's through side points
  for (let i = 0; i < side.length; i++) {
    const p = side[i];
    const prev = i === 0 ? startsAt : side[i - 1];
    const mx = (prev.x + p.x) / 2;
    const my = (prev.y + p.y) / 2;
    ctx.quadraticCurveTo(mx, my, p.x, p.y);
  }
  // last segment to endsAt
  if (endsAt) {
    const prev = side[side.length - 1];
    ctx.quadraticCurveTo((prev.x + endsAt.x) / 2, (prev.y + endsAt.y) / 2, endsAt.x, endsAt.y);
  }
}

// Stylized fir with independent left/right silhouettes for asymmetry.
function drawFirTree(ctx, cx, baseY, w, h, rng, lobesOverride) {
  const halfW = w / 2;
  const apexY = baseY - h;
  const pL = _firParams(rng, halfW, h, lobesOverride);
  const pR = _firParams(rng, halfW, h, lobesOverride);
  // share apex / trunk so both sides meet cleanly
  pR.apexFrac = pL.apexFrac;
  pR.trunkH = pL.trunkH;
  pR.nLobes = pL.nLobes;
  pR.lobeSpan = pL.lobeSpan;
  pR.lobeStep = pL.lobeStep;
  const skirtY = baseY - pL.trunkH;

  const leftPts = _firSidePoints(cx, baseY, h, -1, pL);
  const rightPts = _firSidePoints(cx, baseY, h, +1, pR);

  ctx.beginPath();
  const startL = { x: cx - pL.skirtW * 0.62, y: skirtY + h * 0.012 };
  ctx.moveTo(startL.x, startL.y);
  _strokeSidePath(ctx, leftPts, startL, null);
  // apex bridge
  ctx.quadraticCurveTo(cx - halfW * 0.04, apexY + h * 0.02, cx, apexY);
  ctx.quadraticCurveTo(cx + halfW * 0.04, apexY + h * 0.02, rightPts[rightPts.length - 1].x, rightPts[rightPts.length - 1].y);
  // descend the right side (top -> bottom)
  for (let i = rightPts.length - 2; i >= 0; i--) {
    const p = rightPts[i];
    const prev = rightPts[i + 1];
    const mx = (prev.x + p.x) / 2;
    const my = (prev.y + p.y) / 2;
    ctx.quadraticCurveTo(mx, my, p.x, p.y);
  }
  const endR = { x: cx + pR.skirtW * 0.62, y: skirtY + h * 0.012 };
  ctx.quadraticCurveTo(cx + pR.skirtW, skirtY + h * 0.02, endR.x, endR.y);
  ctx.quadraticCurveTo(cx, skirtY - h * 0.02, startL.x, startL.y);
  ctx.fill();
  ctx.stroke();

  // trunk stub (slightly varied)
  ctx.beginPath();
  const trunkHalf = Math.max(0.6, halfW * (0.08 + rng.uniform() * 0.05));
  ctx.moveTo(cx - trunkHalf, skirtY + h * 0.012);
  ctx.lineTo(cx - trunkHalf, baseY);
  ctx.lineTo(cx + trunkHalf, baseY);
  ctx.lineTo(cx + trunkHalf, skirtY + h * 0.012);
  ctx.stroke();
}

// Slimmer cypress variant — same proportions, not stretched taller.
function drawCypressTree(ctx, cx, baseY, w, h, rng) {
  drawFirTree(ctx, cx, baseY, w * (0.80 + rng.uniform() * 0.10), h * (0.96 + rng.uniform() * 0.08), rng, 3);
}

// Short stubby fir: low and wide, fewer lobes.
function drawStubbyTree(ctx, cx, baseY, w, h, rng) {
  drawFirTree(ctx, cx, baseY, w * (1.15 + rng.uniform() * 0.18), h * (0.72 + rng.uniform() * 0.10), rng, 2);
}

// Round / oak-like tree: bushy round canopy with small trunk underneath.
function drawRoundTree(ctx, cx, baseY, w, h, rng) {
  const halfW = w / 2;
  const trunkH = h * (0.12 + rng.uniform() * 0.08);
  const canopyBaseY = baseY - trunkH;
  const canopyH = h - trunkH;
  const cy = canopyBaseY - canopyH * (0.46 + rng.uniform() * 0.10);
  const rx = halfW * (0.88 + rng.uniform() * 0.16);
  const ry = canopyH * (0.48 + rng.uniform() * 0.14);
  const skew = (rng.uniform() - 0.5) * 0.18;

  ctx.beginPath();
  const N = 18;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    const wobble = 1 + (rng.uniform() - 0.5) * 0.14;
    const x = cx + Math.cos(t) * rx * wobble + Math.sin(t) * skew * rx;
    const y = cy + Math.sin(t) * ry * wobble;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const trunkHalf = Math.max(0.6, halfW * (0.10 + rng.uniform() * 0.05));
  ctx.beginPath();
  ctx.moveTo(cx - trunkHalf, canopyBaseY);
  ctx.lineTo(cx - trunkHalf, baseY);
  ctx.lineTo(cx + trunkHalf, baseY);
  ctx.lineTo(cx + trunkHalf, canopyBaseY);
  ctx.stroke();
}

// Cluster of 2-3 round puffs stacked into a bushy oak/broadleaf shape.
function drawBushyTree(ctx, cx, baseY, w, h, rng) {
  const halfW = w / 2;
  const trunkH = h * (0.10 + rng.uniform() * 0.05);
  const canopyBaseY = baseY - trunkH;
  const canopyH = h - trunkH;
  const nPuffs = 2 + Math.floor(rng.uniform() * 2); // 2 or 3 puffs

  // canopy as union of N overlapping ellipses sampled by angle around each
  ctx.beginPath();
  const puffs = [];
  for (let i = 0; i < nPuffs; i++) {
    const u = nPuffs === 1 ? 0 : i / (nPuffs - 1);
    const cxp = cx + (u - 0.5) * halfW * 1.2 + (rng.uniform() - 0.5) * halfW * 0.20;
    const cyp = canopyBaseY - canopyH * (0.40 + rng.uniform() * 0.18) - (i === Math.floor(nPuffs / 2) ? canopyH * 0.10 : 0);
    const rxp = halfW * (0.50 + rng.uniform() * 0.18);
    const ryp = canopyH * (0.36 + rng.uniform() * 0.12);
    puffs.push({ cx: cxp, cy: cyp, rx: rxp, ry: ryp });
  }

  // sample the outer hull by tracing around each puff and keeping the points
  // farthest from the canopy centroid — gives a "cloud" silhouette.
  const cxAll = puffs.reduce((s, p) => s + p.cx, 0) / puffs.length;
  const cyAll = puffs.reduce((s, p) => s + p.cy, 0) / puffs.length;
  const ANG = 36;
  const outer = [];
  for (let k = 0; k < ANG; k++) {
    const t = (k / ANG) * Math.PI * 2;
    let bestX = 0, bestY = 0, bestD = -1;
    for (const p of puffs) {
      const wobble = 1 + (rng.uniform() - 0.5) * 0.10;
      const x = p.cx + Math.cos(t) * p.rx * wobble;
      const y = p.cy + Math.sin(t) * p.ry * wobble;
      const dx = x - cxAll, dy = y - cyAll;
      const d = dx * dx + dy * dy;
      if (d > bestD) { bestD = d; bestX = x; bestY = y; }
    }
    outer.push({ x: bestX, y: bestY });
  }
  for (let i = 0; i < outer.length; i++) {
    if (i === 0) ctx.moveTo(outer[i].x, outer[i].y);
    else ctx.lineTo(outer[i].x, outer[i].y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const trunkHalf = Math.max(0.6, halfW * (0.09 + rng.uniform() * 0.04));
  ctx.beginPath();
  ctx.moveTo(cx - trunkHalf, canopyBaseY);
  ctx.lineTo(cx - trunkHalf, baseY);
  ctx.lineTo(cx + trunkHalf, baseY);
  ctx.lineTo(cx + trunkHalf, canopyBaseY);
  ctx.stroke();
}

function drawPineTree(ctx, cx, baseY, w, h, rng, lineColor, fillColor) {
  ctx.strokeStyle = lineColor;
  ctx.fillStyle = fillColor;
  ctx.lineWidth = treeStroke() * (0.85 + rng.uniform() * 0.30);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // slight random lean for hand-drawn feel
  const lean = (rng.uniform() - 0.5) * 0.10; // radians, ±~3°
  let transformed = false;
  if (Math.abs(lean) > 0.015) {
    ctx.save();
    ctx.translate(cx, baseY);
    ctx.rotate(lean);
    ctx.translate(-cx, -baseY);
    transformed = true;
  }

  const r = rng.uniform();
  if (r < 0.40) {
    drawFirTree(ctx, cx, baseY, w, h, rng);
  } else if (r < 0.62) {
    drawCypressTree(ctx, cx, baseY, w, h, rng);
  } else if (r < 0.76) {
    drawStubbyTree(ctx, cx, baseY, w, h, rng);
  } else if (r < 0.90) {
    drawRoundTree(ctx, cx, baseY, w * 1.05, h * 0.78, rng);
  } else {
    drawBushyTree(ctx, cx, baseY, w * 1.15, h * 0.82, rng);
  }

  if (transformed) ctx.restore();
}

function drawForests(canvas, forestHexes, opts = {}) {
  if (!forestHexes || forestHexes.length === 0) return;
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
  const RIVER_CLEAR = HEX_SIZE * 0.30;
  const treeHitsRiver = (cx, baseY, tw, th) => {
    if (riverPts.length === 0) return false;
    const xMin = cx - tw / 2 - RIVER_CLEAR;
    const xMax = cx + tw / 2 + RIVER_CLEAR;
    const yMin = baseY - th - RIVER_CLEAR;
    const yMax = baseY + RIVER_CLEAR;
    for (let i = 0; i < riverPts.length; i++) {
      const p = riverPts[i];
      if (p.x >= xMin && p.x <= xMax && p.y >= yMin && p.y <= yMax) return true;
    }
    return false;
  };

  for (const h of forestHexes) {
    const center = hexCenter(h.r, h.c, opts);
    const rng = createRng((((seed + h.r * 2246822519) ^ (h.c * 3266489917)) ^ 0x4F07E575) >>> 0);

    const baseTreeH = HEX_SIZE * 0.60;
    const baseTreeW = HEX_SIZE * 0.42;
    const trees = [];
    const MIN_SPACING = HEX_SIZE * 0.48;

    const heroH = baseTreeH * (1.20 + rng.uniform() * 0.14);
    const heroW = baseTreeW * (0.78 + rng.uniform() * 0.30);
    const heroX = center.x + (rng.uniform() - 0.5) * HEX_SIZE * 0.20;
    const heroBaseY = center.y + (rng.uniform() - 0.5) * HEX_SIZE * 0.10 + HEX_SIZE * 0.05;
    if (!treeHitsRiver(heroX, heroBaseY, heroW, heroH)) {
      trees.push({ x: heroX, baseY: heroBaseY, w: heroW, h: heroH });
    }

    const nTrees = 5 + Math.floor(rng.uniform() * 2);
    let attempts = 0;
    while (trees.length < nTrees + 1 && attempts < nTrees * 14) {
      attempts++;
      const ang = rng.uniform() * Math.PI * 2;
      const rad = (0.35 + 0.70 * Math.sqrt(rng.uniform())) * HEX_SIZE * 1.08;
      const x = center.x + Math.cos(ang) * rad;
      const baseY = center.y + Math.sin(ang) * rad * 0.82 + HEX_SIZE * 0.05;
      // mix of slim, normal, and chubby — but keep all trees stout overall
      const widthRoll = rng.uniform();
      const widthMult = widthRoll < 0.40 ? (0.70 + rng.uniform() * 0.15)
                      : widthRoll < 0.90 ? (0.82 + rng.uniform() * 0.18)
                      :                    (0.98 + rng.uniform() * 0.15);
      const tw = baseTreeW * widthMult;
      const th = baseTreeH * (0.85 + rng.uniform() * 0.30);
      if (treeHitsRiver(x, baseY, tw, th)) continue;
      let tooClose = false;
      for (const t of trees) {
        const dx = t.x - x, dy = t.baseY - baseY;
        if (dx * dx + dy * dy < MIN_SPACING * MIN_SPACING) { tooClose = true; break; }
      }
      if (tooClose) continue;
      trees.push({ x, baseY, w: tw, h: th });
    }

    trees.sort((a, b) => a.baseY - b.baseY);
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const treeRng = createRng((((seed + h.r * 73856093) ^ (h.c * 19349663) ^ (i * 2654435761)) ^ 0x7EA12345) >>> 0);
      drawPineTree(ctx, t.x, t.baseY, t.w, t.h, treeRng, lineColor, fillColor);
    }
  }
}

module.exports = { drawPonds, drawMountains, drawHills, drawGrass, drawForests };
