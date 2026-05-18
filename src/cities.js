const { HEX_SIZE } = require('./constants.js');
const { createRng } = require('./rng.js');
const { hexCenter } = require('./hex.js');

function cityStroke() {
  return Math.max(2.1, Math.min(4.3, HEX_SIZE * 0.078));
}

function inkSeg(ctx, x1, y1, x2, y2, rng, amount) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len;
  const off = (rng.uniform() - 0.5) * amount;
  const mx = (x1 + x2) / 2 + px * off;
  const my = (y1 + y2) / 2 + py * off;
  ctx.quadraticCurveTo(mx, my, x2, y2);
}

function drawCrenelSection(ctx, cx, baseY, w, h, nMerlons, stroke, lineColor, fillColor, rng) {
  const halfW = w / 2;
  const bulge = w * 0.10;
  const flare = w * 0.07;
  const merlonH = Math.min(w * 0.42, h * 0.50);
  const wallTopY = baseY - h + merlonH;
  const merlonTopY = baseY - h;
  const midY = (baseY + wallTopY) / 2;

  ctx.strokeStyle = lineColor;
  ctx.fillStyle = fillColor;
  ctx.lineWidth = stroke;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(cx - halfW - flare, baseY);
  ctx.quadraticCurveTo(cx - halfW - bulge, midY, cx - halfW, wallTopY);
  ctx.quadraticCurveTo(cx, wallTopY - stroke * 0.5, cx + halfW, wallTopY);
  ctx.quadraticCurveTo(cx + halfW + bulge, midY, cx + halfW + flare, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const totalMerlonSpace = w * 1.0;
  const slotW = totalMerlonSpace / (nMerlons * 2 - 1);
  const startX = cx - totalMerlonSpace / 2;
  const cap = Math.min(slotW * 0.42, merlonH * 0.55);
  for (let k = 0; k < nMerlons; k++) {
    const x0 = startX + slotW * 2 * k;
    const x1 = x0 + slotW;
    ctx.beginPath();
    ctx.moveTo(x0, wallTopY);
    ctx.lineTo(x0, merlonTopY + cap);
    ctx.quadraticCurveTo(x0, merlonTopY, x0 + cap, merlonTopY);
    ctx.lineTo(x1 - cap, merlonTopY);
    ctx.quadraticCurveTo(x1, merlonTopY, x1, merlonTopY + cap);
    ctx.lineTo(x1, wallTopY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawTwoTierKeep(ctx, cx, baseY, w, h, stroke, lineColor, fillColor, rng) {
  const lowerH = h * 0.62;
  const upperH = h * 0.42;
  const upperW = w * 0.62;

  drawCrenelSection(ctx, cx, baseY, w, lowerH, 3, stroke, lineColor, fillColor, rng);
  const upperBaseY = baseY - lowerH + stroke * 0.5;
  drawCrenelSection(ctx, cx, upperBaseY, upperW, upperH, 2, stroke, lineColor, fillColor, rng);

  const winW = Math.max(stroke * 1.2, w * 0.18);
  const winH = Math.max(stroke * 1.8, winW * 1.4);
  const winBottom = baseY - lowerH * 0.32;
  const winTop = winBottom - winH;
  ctx.fillStyle = lineColor;
  ctx.beginPath();
  ctx.moveTo(cx - winW / 2, winBottom);
  ctx.lineTo(cx - winW / 2, winTop + winW * 0.5);
  ctx.quadraticCurveTo(cx - winW / 2, winTop, cx, winTop);
  ctx.quadraticCurveTo(cx + winW / 2, winTop, cx + winW / 2, winTop + winW * 0.5);
  ctx.lineTo(cx + winW / 2, winBottom);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = fillColor;
}

function drawCastleSpire(ctx, cx, baseY, w, h, stroke, lineColor, fillColor, rng) {
  const towerH = h * 0.48;
  const coneH = h * 0.55;
  const halfW = w / 2;

  drawCrenelSection(ctx, cx, baseY, w, towerH, 3, stroke, lineColor, fillColor, rng);

  const coneBaseY = baseY - towerH;
  const coneApexY = coneBaseY - coneH;
  const eaveOver = w * 0.08;

  ctx.strokeStyle = lineColor;
  ctx.fillStyle = fillColor;
  ctx.lineWidth = stroke;
  ctx.beginPath();
  ctx.moveTo(cx - halfW - eaveOver, coneBaseY);
  ctx.bezierCurveTo(
    cx - halfW * 0.55, coneBaseY - coneH * 0.30,
    cx - halfW * 0.08, coneApexY + coneH * 0.18,
    cx, coneApexY
  );
  ctx.bezierCurveTo(
    cx + halfW * 0.08, coneApexY + coneH * 0.18,
    cx + halfW * 0.55, coneBaseY - coneH * 0.30,
    cx + halfW + eaveOver, coneBaseY
  );
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawGatehouse(ctx, cx, baseY, w, h, stroke, lineColor, fillColor, rng) {
  drawCrenelSection(ctx, cx, baseY, w, h, 2, stroke, lineColor, fillColor, rng);

  const doorW = w * 0.55;
  const doorH = h * 0.62;
  const dL = cx - doorW / 2, dR = cx + doorW / 2, dT = baseY - doorH;
  ctx.fillStyle = lineColor;
  ctx.beginPath();
  ctx.moveTo(dL, baseY);
  ctx.lineTo(dL, dT + doorW * 0.42);
  ctx.quadraticCurveTo(dL, dT, cx, dT);
  ctx.quadraticCurveTo(dR, dT, dR, dT + doorW * 0.42);
  ctx.lineTo(dR, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = fillColor;
}

function drawFlag(ctx, cx, apexY, size, flip, stroke, lineColor, fillColor, rng) {
  const poleH = size * 0.85;
  const poleTopY = apexY - poleH;
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = Math.max(1.6, stroke * 0.7);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, apexY);
  inkSeg(ctx, cx, apexY, cx, poleTopY, rng, stroke * 0.3);
  ctx.stroke();

  const flagLen = size * 0.70 * flip;
  const flagH = size * 0.36;
  ctx.lineWidth = stroke;
  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.moveTo(cx, poleTopY);
  ctx.lineTo(cx + flagLen, poleTopY + flagH * 0.28);
  ctx.lineTo(cx + flagLen * 0.55, poleTopY + flagH * 0.55);
  ctx.lineTo(cx + flagLen, poleTopY + flagH * 0.82);
  ctx.lineTo(cx, poleTopY + flagH);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawCastle(ctx, cx, baseY, size, rng, lineColor, fillColor, opts = {}) {
  const flip = opts.flip ?? (rng.uniform() < 0.5 ? -1 : 1);
  const towerCount = Math.min(4, opts.towerCount ?? (2 + Math.floor(rng.uniform() * 3)));
  const hasGate = opts.hasGate ?? (rng.uniform() < 0.80);
  const hasFlag = !!opts.hasFlag;
  const hasSpire = hasFlag || (opts.hasSpire ?? rng.uniform() < 0.55);

  const stroke = cityStroke();

  const spireW = size * 0.32;
  const spireH = size * 1.65;
  const spireConeH = spireH * 0.55;

  if (hasSpire) {
    drawCastleSpire(ctx, cx, baseY, spireW, spireH, stroke, lineColor, fillColor, rng);
  }

  const keepW = size * 0.50;
  const keepHbase = size * 1.05;
  const overlap = 0.22;
  const pitch = keepW * (1 - overlap);
  const totalSpan = pitch * (towerCount - 1);

  const keeps = [];
  for (let i = 0; i < towerCount; i++) {
    if (hasSpire && towerCount % 2 === 1 && i === (towerCount - 1) / 2) continue;
    const x = cx - totalSpan / 2 + pitch * i;
    const w = keepW * (0.92 + rng.uniform() * 0.12);
    const h = keepHbase * (0.90 + rng.uniform() * 0.18);
    keeps.push({ x, w, h });
  }

  const idx = keeps.map((_, i) => i);
  const mid = (keeps.length - 1) / 2;
  idx.sort((a, b) => {
    const da = Math.abs(a - mid), db = Math.abs(b - mid);
    if (da !== db) return db - da;
    return flip > 0 ? a - b : b - a;
  });
  for (const i of idx) {
    const k = keeps[i];
    drawTwoTierKeep(ctx, k.x, baseY, k.w, k.h, stroke, lineColor, fillColor, rng);
  }

  if (hasGate) {
    const gateW = size * 0.44;
    const gateH = size * 0.55;
    const gateY = baseY + size * 0.08;
    drawGatehouse(ctx, cx, gateY, gateW, gateH, stroke, lineColor, fillColor, rng);
  }

  if (hasFlag) {
    const coneApexY = baseY - spireH * 0.48 - spireConeH;
    drawFlag(ctx, cx, coneApexY, size * 0.45, flip, stroke, lineColor, fillColor, rng);
  }
}

function drawCities(canvas, cityHexes, opts = {}) {
  if (!cityHexes || cityHexes.length === 0) return;
  const ctx = canvas.getContext('2d');
  const seed = opts.seed ?? 0;
  const lineColor = opts.lineColor ?? '#2a2015';
  const fillColor = opts.fillColor ?? '#e8d5b7';
  const capital = opts.capital;

  for (const h of cityHexes) {
    const center = hexCenter(h.r, h.c, opts);
    const rng = createRng((((seed + h.r * 2654435761) ^ (h.c * 40503)) ^ 0xC17C9999) >>> 0);
    const isCapital = !!capital && capital.r === h.r && capital.c === h.c;
    const size = HEX_SIZE * 1.14;
    const baseY = center.y + HEX_SIZE * 0.46;
    drawCastle(ctx, center.x, baseY, size, rng, lineColor, fillColor, { hasFlag: isCapital });
  }
}

module.exports = { drawCities };
