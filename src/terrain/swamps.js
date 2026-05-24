const { HEX_SIZE } = require('../constants.js');
const { createRng } = require('../rng.js');
const { hexCenter } = require('../hex.js');
const { treeStroke } = require('./forests.js');

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

module.exports = { drawSwamps };
