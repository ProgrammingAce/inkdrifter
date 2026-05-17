const { HEX_SIZE, DEFAULT_COLS, DEFAULT_ROWS } = require('./constants.js');
const { createRng } = require('./rng.js');
const { hexCenter, hexVertices } = require('./hex.js');

function hexStrokeAlpha(fade, cx, cy, canvasW, canvasH) {
  const dx = (cx - canvasW / 2) / (canvasW / 2);
  const dy = (cy - canvasH / 2) / (canvasH / 2);
  const dist = Math.sqrt(dx * dx + dy * dy);
  const t = Math.min(dist / 0.85, 1.0);
  return 1.0 - t * t * (1.0 - fade);
}

function drawHexGrid(canvas, opts = {}) {
  const rows = opts.rows ?? DEFAULT_ROWS;
  const cols = opts.cols ?? DEFAULT_COLS;
  const scale = opts.scale ?? 1;
  const edgeGapRatio = opts.edgeGapRatio ?? 0.35;
  const tickLen = opts.tickLen ?? 6;
  const drawSize = opts.drawSize ?? HEX_SIZE - 1;
  const strokeColor = opts.strokeColor ?? '#2a2015';
  const edgeWidth = opts.edgeWidth ?? 28;
  const tickWidth = opts.tickWidth ?? 24;
  const fadeEdge = opts.fadeEdge ?? 0.35;
  const water = opts.water ?? null;
  const oceanAlpha = opts.oceanAlpha ?? 1.0;
  const oceanCanvas = opts.oceanCanvas ?? null;
  const oceanScale = opts.oceanScale ?? scale;

  const ctx = canvas.getContext('2d');
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 10;

  const hex = strokeColor.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  const oceanCtx = oceanCanvas ? oceanCanvas.getContext('2d') : null;
  if (oceanCtx) {
    oceanCtx.lineJoin = 'miter';
    oceanCtx.miterLimit = 10;
  }

  const canvasW = canvas.width;
  const canvasH = canvas.height;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const c = hexCenter(row, col, opts);
      const verts = hexVertices(c.x, c.y, drawSize);
      const isWater = water ? water.has(`${row},${col}`) : false;
      if (isWater) {
        if (!oceanCtx || oceanAlpha <= 0) continue;
      }
      const targetCtx = isWater ? oceanCtx : ctx;
      const targetScale = isWater ? oceanScale : scale;
      const targetW = isWater ? oceanCanvas.width : canvasW;
      const targetH = isWater ? oceanCanvas.height : canvasH;
      const fadeA = hexStrokeAlpha(fadeEdge, c.x * targetScale, c.y * targetScale, targetW, targetH);
      const alpha = isWater ? fadeA * oceanAlpha : fadeA;
      const strokeStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;

      targetCtx.strokeStyle = strokeStyle;
      targetCtx.lineWidth = edgeWidth * (targetScale / scale);
      for (let i = 0; i < 6; i++) {
        const p1 = verts[i];
        const p2 = verts[(i + 1) % 6];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        const ux = dx / len;
        const uy = dy / len;
        const gap = HEX_SIZE * edgeGapRatio;
        targetCtx.beginPath();
        targetCtx.moveTo((p1.x + ux * gap) * targetScale, (p1.y + uy * gap) * targetScale);
        targetCtx.lineTo((p2.x - ux * gap) * targetScale, (p2.y - uy * gap) * targetScale);
        targetCtx.stroke();
      }

      targetCtx.lineWidth = tickWidth * (targetScale / scale);
      for (let i = 0; i < 6; i++) {
        const p = verts[i];
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        const len = Math.hypot(dx, dy);
        const ux = dx / len;
        const uy = dy / len;
        targetCtx.beginPath();
        targetCtx.moveTo(p.x * targetScale, p.y * targetScale);
        targetCtx.lineTo((p.x + ux * tickLen) * targetScale, (p.y + uy * tickLen) * targetScale);
        targetCtx.stroke();
      }
    }
  }
}

function paintParchment(canvas, opts = {}) {
  const baseColor = opts.baseColor ?? '#e8d5b7';
  const stainCount = opts.stainCount ?? 15;
  const seed = opts.seed;
  const rng = seed !== undefined ? createRng(seed) : { uniform: Math.random };

  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, W, H);

  const img = ctx.getImageData(0, 0, W, H);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (rng.uniform() - 0.5) * 20;
    data[i] = Math.max(0, Math.min(255, data[i] + noise));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
  }
  ctx.putImageData(img, 0, 0);

  for (let s = 0; s < stainCount; s++) {
    const x = rng.uniform() * W;
    const y = rng.uniform() * H;
    const r = 30 + rng.uniform() * 100;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(139, 119, 90, 0.08)');
    grad.addColorStop(1, 'rgba(139, 119, 90, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

module.exports = { drawHexGrid, paintParchment };
