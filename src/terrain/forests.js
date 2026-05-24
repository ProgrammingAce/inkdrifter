const { HEX_SIZE } = require('../constants.js');
const { createRng } = require('../rng.js');
const { hexCenter } = require('../hex.js');

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

module.exports = { drawForests, treeStroke };
