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

  // Build set of pond/lake hex keys to skip trees on water
  const waterHexSet = new Set();
  if (opts.ponds) {
    for (const p of opts.ponds) waterHexSet.add(`${p.r},${p.c}`);
  }
  if (opts.lakesInfo && opts.lakesInfo.hexes) {
    for (const l of opts.lakesInfo.hexes) waterHexSet.add(`${l.r},${l.c}`);
  }

  for (const h of forestHexes) {
    // Skip drawing trees if this hex is a pond or lake
    if (waterHexSet.has(`${h.r},${h.c}`)) continue;
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

    const nTrees = 6 + Math.floor(rng.uniform() * 2);
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

// ── Swamps ─────────────────────────────────────────────────────────────────
// Per-hex swamp tile: slim firs, broken stumps, notched lily pads, eyebrow
// puddles. Matches Swamp.png reference art. Scaled to hex size.

// Tall slim fir: single wavy-silhouette canopy + two stroked trunk lines
function drawSwampFir(ctx, cx, baseY, h, rng, lineColor, fillColor) {
  const sw = Math.max(2, h * 0.07);
  ctx.strokeStyle = lineColor;
  ctx.fillStyle = fillColor;
  ctx.lineWidth = sw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const canopyH = h * (0.52 + rng.uniform() * 0.08);
  const trunkH = h - canopyH;
  const skirtY = baseY - trunkH;
  const halfW = h * (0.18 + rng.uniform() * 0.08);
  const nLobes = 3 + Math.floor(rng.uniform() * 2);
  // Canopy: closed wavy silhouette — right side up, left side down
  const rightPts = [];
  const leftPts = [];
  for (let i = 0; i < nLobes; i++) {
    const t = (i + 0.5) / nLobes;
    const wBase = halfW * (1 - t * 0.72);
    const wOut = wBase * (1.35 + rng.uniform() * 0.40);
    const wIn = wBase * (0.25 + rng.uniform() * 0.20);
    const yOut = skirtY - canopyH * (t - 0.08);
    const yIn = skirtY - canopyH * (t + 0.08);
    rightPts.push({ ox: cx + wOut, oy: yOut, ix: cx + wIn, iy: yIn });
    const wOutL = halfW * (1 - t * 0.72) * (1.35 + rng.uniform() * 0.40);
    const wInL = halfW * (1 - t * 0.72) * (0.25 + rng.uniform() * 0.20);
    leftPts.push({ ox: cx - wOutL, oy: yOut, ix: cx - wInL, iy: yIn });
  }
  ctx.beginPath();
  ctx.moveTo(cx + halfW * 0.55, skirtY);
  for (let i = 0; i < rightPts.length; i++) {
    const p = rightPts[i];
    const prevX = i === 0 ? cx + halfW * 0.55 : rightPts[i - 1].ix;
    const prevY = i === 0 ? skirtY : rightPts[i - 1].iy;
    ctx.quadraticCurveTo(p.ox, p.oy, p.ix, p.iy);
  }
  ctx.lineTo(cx, skirtY - canopyH);
  for (let i = leftPts.length - 1; i >= 0; i--) {
    const p = leftPts[i];
    ctx.quadraticCurveTo(p.ox, p.oy, p.ix, p.iy);
  }
  const endL = { x: cx - halfW * 0.55, y: skirtY };
  ctx.quadraticCurveTo(cx - halfW * 0.85, skirtY + h * 0.008, endL.x, endL.y);
  ctx.quadraticCurveTo(cx, skirtY - h * 0.015, cx + halfW * 0.55, skirtY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Trunk: two parallel wavy lines
  ctx.lineWidth = sw * 0.55;
  const tw = halfW * 0.18;
  const wobble = trunkH * 0.03;
  ctx.beginPath();
  ctx.moveTo(cx - tw, skirtY);
  ctx.bezierCurveTo(
    cx - tw + (rng.uniform() - 0.5) * wobble, skirtY + trunkH * 0.33,
    cx - tw + (rng.uniform() - 0.5) * wobble, skirtY + trunkH * 0.66,
    cx - tw, baseY
  );
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + tw, skirtY);
  ctx.bezierCurveTo(
    cx + tw + (rng.uniform() - 0.5) * wobble, skirtY + trunkH * 0.33,
    cx + tw + (rng.uniform() - 0.5) * wobble, skirtY + trunkH * 0.66,
    cx + tw, baseY
  );
  ctx.stroke();
}

// Round bush: bumpy cloud canopy with trunk
function drawSwampRound(ctx, cx, baseY, h, rng, lineColor, fillColor) {
  const hw = h * 0.35;
  const trunkH = h * 0.14;
  const canopyBaseY = baseY - trunkH;
  const canopyH = h - trunkH;
  const cy = canopyBaseY - canopyH * 0.5;
  const rx = hw;
  const ry = canopyH * 0.55;
  const sw = treeStroke() * (0.7 + rng.uniform() * 0.4);
  ctx.strokeStyle = lineColor;
  ctx.fillStyle = fillColor;
  ctx.lineWidth = sw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const N = 16;
  const lobeN = 3 + Math.floor(rng.uniform() * 3);
  const lobePhase = rng.uniform() * Math.PI * 2;
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const lobe = Math.sin(t * lobeN + lobePhase) * 0.10;
    const wobble = 1 + lobe + (rng.uniform() - 0.5) * 0.10;
    const x = cx + Math.cos(t) * rx * wobble;
    const y = cy + Math.sin(t) * ry * wobble;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const tH = Math.max(0.5, hw * 0.15);
  ctx.beginPath();
  ctx.moveTo(cx - tH, canopyBaseY);
  ctx.lineTo(cx - tH, baseY);
  ctx.lineTo(cx + tH, baseY);
  ctx.lineTo(cx + tH, canopyBaseY);
  ctx.stroke();
}

// Broken stump: tapered body, jagged top, branch stubs
// h is the intended stump height (already scaled at call site)
function drawSwampStump(ctx, cx, baseY, h, rng, lineColor, fillColor) {
  const stumpH = h;
  const baseHW = h * (0.40 + rng.uniform() * 0.10);
  const topHW = baseHW * (0.45 + rng.uniform() * 0.15);
  const sw = treeStroke() * (0.8 + rng.uniform() * 0.4);
  ctx.strokeStyle = lineColor;
  ctx.fillStyle = fillColor;
  ctx.lineWidth = sw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const nPeaks = 3 + Math.floor(rng.uniform() * 2);
  const peakYs = [];
  for (let i = 0; i < nPeaks; i++) {
    peakYs.push(baseY - stumpH * (0.70 + rng.uniform() * 0.30));
  }
  ctx.beginPath();
  ctx.moveTo(cx - baseHW, baseY);
  ctx.quadraticCurveTo(cx - baseHW * 0.88, baseY - stumpH * 0.48, cx - topHW, peakYs[0]);
  for (let i = 1; i < nPeaks; i++) {
    const px = cx - topHW + (i / (nPeaks - 1)) * topHW * 2;
    const prevX = cx - topHW + ((i - 1) / (nPeaks - 1)) * topHW * 2;
    const midX = (prevX + px) / 2;
    const midY = (peakYs[i - 1] + peakYs[i]) / 2 + stumpH * 0.10;
    ctx.quadraticCurveTo(midX, midY, px, peakYs[i]);
  }
  ctx.quadraticCurveTo(cx + topHW * 0.88, baseY - stumpH * 0.48, cx + baseHW, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Branch stubs — originate from the body edge at that height
  ctx.lineWidth = sw * 0.65;
  const nStubs = 1 + Math.floor(rng.uniform() * 2);
  for (let i = 0; i < nStubs; i++) {
    const side = rng.uniform() < 0.5 ? -1 : 1;
    const st = 0.25 + rng.uniform() * 0.55;
    const sy = baseY - stumpH * st;
    const bodyHW = baseHW * (1 - st) + topHW * st;
    const sl = stumpH * (0.30 + rng.uniform() * 0.30);
    const sa = side * (0.5 + rng.uniform() * 0.6);
    ctx.beginPath();
    ctx.moveTo(cx + side * bodyHW, sy);
    ctx.lineTo(cx + side * bodyHW + Math.sin(sa) * sl, sy - Math.cos(sa) * sl * 0.45);
    ctx.stroke();
  }
}

// Notched lily pad: oval outline with wedge notch and small curved vein
function drawSwampLilyPad(ctx, cx, cy, rx, ry, rng, lineColor, fillColor) {
  const sw = Math.max(1.5, rx * 0.22);
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = sw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Notch params: constrained to always produce a clean shape
  const notchAngle = rng.uniform() * Math.PI * 2;
  const notchHalfSpan = 0.30 + rng.uniform() * 0.15; // 0.30-0.45
  const notchDepth = 0.45 + rng.uniform() * 0.15; // 0.45-0.60
  const N = 24;
  const tipX = cx + Math.cos(notchAngle) * rx * notchDepth;
  const tipY = cy + Math.sin(notchAngle) * ry * notchDepth;
  const edgeSX = cx + Math.cos(notchAngle - notchHalfSpan) * rx;
  const edgeSY = cy + Math.sin(notchAngle - notchHalfSpan) * ry;
  const edgeEX = cx + Math.cos(notchAngle + notchHalfSpan) * rx;
  const edgeEY = cy + Math.sin(notchAngle + notchHalfSpan) * ry;
  // Build smooth oval points (skip notch wedge region)
  const pts = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    let d = t - notchAngle;
    d = ((d + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (Math.abs(d) < notchHalfSpan + 0.08) continue; // small safety gap
    pts.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry, a: t });
  }
  // Draw the two arc segments (left of notch, right of notch)
  ctx.beginPath();
  if (pts.length >= 2) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const ma = (pts[i - 1].a + pts[i].a) / 2;
      ctx.quadraticCurveTo(cx + Math.cos(ma) * rx * 1.10, cy + Math.sin(ma) * ry * 1.10, pts[i].x, pts[i].y);
    }
    const last = pts[pts.length - 1];
    ctx.quadraticCurveTo((last.x + edgeEX) / 2, (last.y + edgeEY) / 2, edgeEX, edgeEY);
  } else if (pts.length === 1) {
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.quadraticCurveTo((pts[0].x + edgeEX) / 2, (pts[0].y + edgeEY) / 2, edgeEX, edgeEY);
  } else {
    ctx.moveTo(edgeSX, edgeSY);
  }
  // V-notch: straight lines from both arc ends to tip
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(edgeSX, edgeSY);
  if (pts.length >= 2) {
    ctx.quadraticCurveTo((edgeSX + pts[0].x) / 2, (edgeSY + pts[0].y) / 2, pts[0].x, pts[0].y);
  }
  ctx.stroke();
  // Vein mark inside — a small S-curve from notch tip toward center
  ctx.lineWidth = sw * 0.35;
  const veinLen = rx * (0.25 + rng.uniform() * 0.20);
  const veinDir = notchAngle + Math.PI + (rng.uniform() - 0.5) * 0.3;
  const vx1 = cx + Math.cos(notchAngle) * rx * (notchDepth - 0.15);
  const vy1 = cy + Math.sin(notchAngle) * ry * (notchDepth - 0.15);
  const vx2 = cx + Math.cos(veinDir) * veinLen;
  const vy2 = cy + Math.sin(veinDir) * veinLen * (ry / rx);
  const vmx = (vx1 + vx2) / 2 + (rng.uniform() - 0.5) * rx * 0.15;
  const vmy = (vy1 + vy2) / 2 + (rng.uniform() - 0.5) * ry * 0.15;
  ctx.beginPath();
  ctx.moveTo(vx1, vy1);
  ctx.quadraticCurveTo(vmx, vmy, vx2, vy2);
  ctx.stroke();
}
function drawEyebrow(ctx, cx, cy, w, rng) {
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy);
  ctx.quadraticCurveTo(cx + (rng.uniform() - 0.5) * 2, cy - w * 0.5, cx + w / 2, cy);
  ctx.stroke();
}

// Marsh grass: single M-shaped wavy outline stroke (not individual blades)
function drawSwampGrassFan(ctx, cx, baseY, size, rng) {
  const w = size * (1.3 + rng.uniform() * 0.4);
  const h = size * (0.6 + rng.uniform() * 0.25);
  const j = (rng.uniform() - 0.5) * size * 0.12;
  ctx.beginPath();
  ctx.moveTo(cx - w, baseY);
  ctx.quadraticCurveTo(cx - w * 0.75 + j, baseY - h * 1.1, cx - w * 0.5, baseY - h);
  ctx.quadraticCurveTo(cx - w * 0.25 + j, baseY - h * 0.2, cx - w * 0.1, baseY - h * 0.15);
  ctx.quadraticCurveTo(cx + w * 0.2 + j, baseY - h * 1.0, cx + w * 0.4, baseY - h * 0.9);
  ctx.quadraticCurveTo(cx + w * 0.7 + j, baseY - h * 0.2, cx + w, baseY);
  ctx.stroke();
}

// Small reed: compact oval head (outline), thin stem, root tufts at base
// Matches the far-bottom-right plant in Swamp.png — smaller than cattail.
function drawSwampReed(ctx, cx, baseY, h, rng, lineColor, fillColor) {
  const sw = Math.max(1.5, h * 0.16);
  const swThin = sw * 0.65;
  ctx.strokeStyle = lineColor;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Oval head — compact, taller than wide
  const headH = h * (0.35 + rng.uniform() * 0.08);
  const headW = headH * (0.50 + rng.uniform() * 0.12);
  const headCy = baseY - h + headH * 0.5;
  ctx.lineWidth = sw;
  const N = 12;
  const headPts = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const wob = 1 + (rng.uniform() - 0.5) * 0.08;
    headPts.push({ x: cx + Math.cos(t) * headW * 0.5 * wob, y: headCy + Math.sin(t) * headH * 0.5 * wob });
  }
  ctx.beginPath();
  for (let i = 0; i < headPts.length; i++) {
    const p = headPts[i], q = headPts[(i + headPts.length - 1) % headPts.length];
    const mx = (p.x + q.x) / 2 + (rng.uniform() - 0.5) * sw * 0.25;
    const my = (p.y + q.y) / 2 + (rng.uniform() - 0.5) * sw * 0.25;
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.quadraticCurveTo(mx, my, p.x, p.y);
  }
  ctx.closePath();
  ctx.stroke();
  // Stem
  ctx.lineWidth = swThin;
  const stemTop = baseY - h + headH;
  const stemBot = baseY - h * 0.10;
  const lean = (rng.uniform() - 0.5) * h * 0.04;
  ctx.beginPath();
  ctx.moveTo(cx, stemTop);
  ctx.quadraticCurveTo(cx + lean * 0.3, (stemTop + stemBot) / 2, cx + lean, stemBot);
  ctx.stroke();
  // Root tufts — a few short strokes spreading outward/downward
  const nRoots = 2 + Math.floor(rng.uniform() * 2);
  const rootSpread = (35 + rng.uniform() * 20) * Math.PI / 180;
  for (let i = 0; i < nRoots; i++) {
    const t = nRoots === 1 ? 0.5 : i / (nRoots - 1);
    const a = -rootSpread / 2 + t * rootSpread + (rng.uniform() - 0.5) * 0.12;
    const rootLen = h * (0.07 + rng.uniform() * 0.05);
    const sx = cx + lean;
    const sy = stemBot;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.sin(a) * rootLen, sy + Math.cos(a) * rootLen * 0.4);
    ctx.stroke();
  }
}

// Cattail: vertical oval head (outline), thin stem, root tuft at base
function drawSwampCattail(ctx, cx, baseY, h, rng, lineColor, fillColor) {
  const sw = Math.max(1.8, h * 0.14);
  const swThin = sw * 0.68;
  ctx.strokeStyle = lineColor;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const headH = h * (0.30 + rng.uniform() * 0.10);
  const headW = headH * (0.55 + rng.uniform() * 0.15);
  const headCy = baseY - h + headH * 0.5;
  // Oval head (outline only, wobbly)
  ctx.lineWidth = sw;
  const N = 14;
  const headPts = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const wob = 1 + (rng.uniform() - 0.5) * 0.10;
    headPts.push({ x: cx + Math.cos(t) * headW * 0.5 * wob, y: headCy + Math.sin(t) * headH * 0.5 * wob });
  }
  ctx.beginPath();
  for (let i = 0; i < headPts.length; i++) {
    const p = headPts[i], q = headPts[(i + headPts.length - 1) % headPts.length];
    const mx = (p.x + q.x) / 2 + (rng.uniform() - 0.5) * sw * 0.3;
    const my = (p.y + q.y) / 2 + (rng.uniform() - 0.5) * sw * 0.3;
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.quadraticCurveTo(mx, my, p.x, p.y);
  }
  ctx.closePath();
  ctx.stroke();
  // Stem
  ctx.lineWidth = swThin;
  const stemTop = baseY - h + headH;
  const stemBot = baseY - h * 0.12;
  const lean = (rng.uniform() - 0.5) * h * 0.06;
  ctx.beginPath();
  ctx.moveTo(cx, stemTop);
  ctx.quadraticCurveTo(cx + lean * 0.4, (stemTop + stemBot) / 2, cx + lean, stemBot);
  ctx.stroke();
  // Root tuft
  const nRoots = 2 + Math.floor(rng.uniform() * 2);
  const rootSpread = (40 + rng.uniform() * 25) * Math.PI / 180;
  for (let i = 0; i < nRoots; i++) {
    const t = nRoots === 1 ? 0.5 : i / (nRoots - 1);
    const a = -rootSpread / 2 + t * rootSpread + (rng.uniform() - 0.5) * 0.15;
    const rootLen = h * (0.08 + rng.uniform() * 0.07);
    const sx = cx + lean;
    const sy = stemBot;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.sin(a) * rootLen, sy - Math.cos(a) * rootLen * 0.35);
    ctx.stroke();
  }
}

function drawSwamps(canvas, swampHexes, opts = {}) {
  if (!swampHexes || swampHexes.length === 0) return;
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

 ctx.strokeStyle = lineColor;
  ctx.fillStyle = lineColor;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Collision tracking: each hex maintains a list of placed bounding boxes.
  // New objects are skipped if their estimated bbox overlaps any existing one.
  const bboxPad = HEX_SIZE * 0.06;
  const overlaps = (boxes, x, y, w, h2) => {
    const x1 = x - w / 2, y1 = y - h2, x2 = x + w / 2, y2 = y + bboxPad;
    for (const b of boxes) {
      if (x1 < b.x + b.w / 2 + bboxPad && x2 > b.x - b.w / 2 - bboxPad &&
          y1 < b.y + bboxPad && y2 > b.y - b.h - bboxPad) return true;
    }
    return false;
  };

  // Shuffle array in-place (Fisher-Yates)
  const shuffle = (arr, r) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(r.uniform() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };

  for (const h of swampHexes) {
    const center = hexCenter(h.r, h.c, opts);
    const rng = createRng((((seed + h.r * 1737192737) ^ (h.c * 193496639)) ^ 0x5A7A4B2C) >>> 0);
    const placed = [];

    // Build random object manifest: decide how many of each type to place
    const manifest = [];
    // 1-2 firs
    for (let i = 0; i < (1 + Math.floor(rng.uniform() * 2)); i++) {
      manifest.push({ type: 'fir', idx: i });
    }
    // 0-2 stumps
    for (let i = 0; i < Math.floor(rng.uniform() * 3); i++) {
      manifest.push({ type: 'stump', idx: i });
    }
    // 1-3 lily pads
    for (let i = 0; i < (1 + Math.floor(rng.uniform() * 3)); i++) {
      manifest.push({ type: 'lily_pad', idx: i });
    }
    // 0-2 puddles
    for (let i = 0; i < Math.floor(rng.uniform() * 3); i++) {
      manifest.push({ type: 'puddle', idx: i });
    }
    // 0-2 grass
    for (let i = 0; i < Math.floor(rng.uniform() * 3); i++) {
      manifest.push({ type: 'grass', idx: i });
    }
    // 0-2 reeds
    for (let i = 0; i < Math.floor(rng.uniform() * 3); i++) {
      manifest.push({ type: 'reed', idx: i });
    }
    // 0-2 cattails
    for (let i = 0; i < Math.floor(rng.uniform() * 3); i++) {
      manifest.push({ type: 'cattail', idx: i });
    }

    // Shuffle so types interleave randomly
    shuffle(manifest, rng);

    // Try placing each object: compute size once, retry position on collision
    const halfHex = HEX_SIZE * 0.55;
    for (const item of manifest) {
      const objRng = createRng((((seed + h.r * 73856093) ^ (h.c * 19349663)) ^ (item.idx * 2654435761) ^ (item.type.charCodeAt(0) * 16807)) >>> 0);
      let placedThis = false;

      // Compute deterministic size from objRng
      let size, bw, bh;
      if (item.type === 'fir') {
        size = HEX_SIZE * (0.80 + objRng.uniform() * 0.20);
        bw = size * 0.55; bh = size;
      } else if (item.type === 'stump') {
        size = HEX_SIZE * (0.30 + objRng.uniform() * 0.12);
        bw = size * 0.8; bh = size;
      } else if (item.type === 'lily_pad') {
        bw = HEX_SIZE * (0.14 + objRng.uniform() * 0.04);
        bh = HEX_SIZE * (0.07 + objRng.uniform() * 0.03);
        bw *= 2; bh *= 2;
      } else if (item.type === 'puddle') {
        size = HEX_SIZE * (0.18 + objRng.uniform() * 0.15);
        bw = size; bh = size * 0.5;
      } else if (item.type === 'grass') {
        size = HEX_SIZE * (0.12 + objRng.uniform() * 0.06);
        bw = size * 2.6; bh = size;
      } else if (item.type === 'reed') {
        size = HEX_SIZE * (0.16 + objRng.uniform() * 0.06);
        bw = size * 0.3; bh = size;
      } else if (item.type === 'cattail') {
        size = HEX_SIZE * (0.18 + objRng.uniform() * 0.06);
        bw = size * 0.35; bh = size;
      }

      for (let attempt = 0; attempt < 12; attempt++) {
        const x = center.x + (rng.uniform() - 0.5) * halfHex * 2;
        const y = center.y + (rng.uniform() - 0.5) * halfHex * 2;

        if (nearRiver(x, y) || overlaps(placed, x, y, bw, bh)) continue;

        if (item.type === 'fir') {
          drawSwampFir(ctx, x, y, size, objRng, lineColor, fillColor);
        } else if (item.type === 'stump') {
          drawSwampStump(ctx, x, y, size, objRng, lineColor, fillColor);
        } else if (item.type === 'lily_pad') {
          ctx.strokeStyle = lineColor;
          ctx.lineWidth = Math.max(1.5, (bw / 2) * 0.22);
          ctx.fillStyle = fillColor;
          drawSwampLilyPad(ctx, x, y, bw / 2, bh / 2, objRng, lineColor, fillColor);
        } else if (item.type === 'puddle') {
          ctx.strokeStyle = lineColor;
          ctx.lineWidth = Math.max(2.5, HEX_SIZE * 0.06);
          drawEyebrow(ctx, x, y, size, objRng);
        } else if (item.type === 'grass') {
          ctx.strokeStyle = lineColor;
          ctx.lineWidth = Math.max(2, HEX_SIZE * 0.05);
          drawSwampGrassFan(ctx, x, y, size, objRng);
        } else if (item.type === 'reed') {
          drawSwampReed(ctx, x, y, size, objRng, lineColor, fillColor);
        } else if (item.type === 'cattail') {
          drawSwampCattail(ctx, x, y, size, objRng, lineColor, fillColor);
        }
        placed.push({ x, y, w: bw, h: bh });
        placedThis = true; break;
      }
    }
  }
}

module.exports = { drawPonds, drawMountains, drawHills, drawGrass, drawForests, drawSwamps };
