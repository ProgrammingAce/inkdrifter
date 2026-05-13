const { createCanvas } = require('canvas');

// ============================================================
// HEX GRID CONSTANTS
// ============================================================
const HEX_SIZE = 54;
const HEX_W = Math.sqrt(3) * HEX_SIZE;
const HEX_H = 2 * HEX_SIZE;
const DEFAULT_COLS = 7;
const DEFAULT_ROWS = 11;
const DEFAULT_GRID_ORIGIN_X = 173;
const DEFAULT_GRID_ORIGIN_Y = 70;

// ============================================================
// SEEDABLE RNG
// ============================================================
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

// ============================================================
// NUMERIC HELPERS
// ============================================================
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

// ============================================================
// HEX GRID
// ============================================================
function hexCenter(row, col, opts = {}) {
  const ox = opts.originX ?? DEFAULT_GRID_ORIGIN_X;
  const oy = opts.originY ?? DEFAULT_GRID_ORIGIN_Y;
  const xOff = (row % 2 === 1) ? HEX_W / 2 : 0;
  return { x: ox + HEX_W * col + xOff, y: oy + HEX_H * 0.75 * row };
}

function hexVertices(cx, cy, size) {
  const verts = new Array(6);
  for (let i = 0; i < 6; i++) {
    const angle = (60 * i - 30) * Math.PI / 180;
    verts[i] = { x: cx + size * Math.cos(angle), y: cy + size * Math.sin(angle) };
  }
  return verts;
}

function vertexKeyStr(p) {
  return (Math.round(p.x * 100) / 100).toFixed(2) + ',' + (Math.round(p.y * 100) / 100).toFixed(2);
}

function parseKey(k) {
  const i = k.indexOf(',');
  return { x: parseFloat(k.slice(0, i)), y: parseFloat(k.slice(i + 1)) };
}

function buildVertexGraph(opts = {}) {
  const rows = opts.rows ?? DEFAULT_ROWS;
  const cols = opts.cols ?? DEFAULT_COLS;
  const adj = new Map();
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const c = hexCenter(row, col, opts);
      const verts = hexVertices(c.x, c.y, HEX_SIZE);
      for (let i = 0; i < 6; i++) {
        const ka = vertexKeyStr(verts[i]);
        const kb = vertexKeyStr(verts[(i + 1) % 6]);
        if (!adj.has(ka)) adj.set(ka, new Set());
        if (!adj.has(kb)) adj.set(kb, new Set());
        adj.get(ka).add(kb);
        adj.get(kb).add(ka);
      }
    }
  }
  return adj;
}

// ============================================================
// RIVER PATH
// ============================================================
function randomRiverPath(seed, opts = {}) {
  const startSide = opts.startSide ?? 'left';
  const targetSide = opts.targetSide ?? 'right';
  const maxSteps = opts.maxSteps ?? 120;
  const maxAttempts = opts.maxAttempts ?? 40;
  const minLength = opts.minLength ?? 40;
  const adj = opts.adj ?? buildVertexGraph(opts);

  const rng = createRng(seed);
  const keys = Array.from(adj.keys());

  let minX = Infinity, maxX = -Infinity;
  for (const k of keys) {
    const p = parseKey(k);
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }

  const direction = targetSide === 'right' ? 1 : -1;
  const edgeX = startSide === 'left' ? minX : maxX;
  const targetX = targetSide === 'right' ? maxX : minX;

  const startCandidates = keys
    .filter(k => Math.abs(parseKey(k).x - edgeX) < 1.0)
    .sort((a, b) => parseKey(a).y - parseKey(b).y);

  let best = null;
  let bestReached = false;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const start = startCandidates[rng.uniformInt(0, startCandidates.length)];
    const path = [start];
    const visited = new Set([start]);
    let prev = null;
    let reached = false;

    for (let step = 0; step < maxSteps; step++) {
      const cur = path[path.length - 1];
      const nbrs = [];
      for (const n of adj.get(cur)) {
        if (!visited.has(n) && n !== prev) nbrs.push(n);
      }
      if (nbrs.length === 0) break;

      const curP = parseKey(cur);
      const weights = nbrs.map(n => {
        const advance = direction * (parseKey(n).x - curP.x);
        if (advance > 0.01) return 2.2;
        if (advance < -0.01) return 0.4;
        return 1.6;
      });
      const choice = weightedChoice(nbrs, weights, rng);
      path.push(choice);
      visited.add(choice);
      prev = cur;

      const choiceP = parseKey(choice);
      if (direction * (choiceP.x - targetX) >= -HEX_W * 0.5 && path.length >= minLength) {
        reached = true;
        break;
      }
    }

    const pts = path.map(parseKey);
    if (reached) return { points: pts, reached: true, attempts: attempt + 1 };
    if (best === null || pts.length > best.length) { best = pts; bestReached = false; }
  }
  return { points: best || [], reached: bestReached, attempts: maxAttempts };
}

function hexEdgeCenterline(seed, opts = {}) {
  const densifySteps = opts.densifySteps ?? 8;
  const smoothSigma = opts.densifySmoothSigma ?? 0.8;
  const result = randomRiverPath(seed, opts);
  const raw = result.points;
  if (raw.length < 2) return { points: [], reached: false };

  const dense = [];
  for (let i = 0; i < raw.length - 1; i++) {
    const a = raw[i], b = raw[i + 1];
    for (let t = 0; t < densifySteps; t++) {
      const u = t / densifySteps;
      dense.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
    }
  }
  dense.push(raw[raw.length - 1]);
  const dx = gaussianFilter1D(dense.map(p => p.x), smoothSigma);
  const dy = gaussianFilter1D(dense.map(p => p.y), smoothSigma);
  const points = dense.map((_, i) => ({ x: dx[i], y: dy[i] }));
  return { points, reached: result.reached };
}

// ============================================================
// RIVER RENDERER
// ============================================================
function resampleByArcLength(pts, step = 1.0) {
  const N = pts.length;
  const s = new Array(N);
  s[0] = 0;
  for (let i = 1; i < N; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    s[i] = s[i - 1] + Math.sqrt(dx * dx + dy * dy);
  }
  const total = s[N - 1];
  const out = [];
  let lo = 0;
  for (let t = 0; t < total; t += step) {
    while (lo < N - 2 && s[lo + 1] <= t) lo++;
    const segLen = s[lo + 1] - s[lo];
    const u = segLen > 0 ? (t - s[lo]) / segLen : 0;
    out.push({
      x: pts[lo].x + u * (pts[lo + 1].x - pts[lo].x),
      y: pts[lo].y + u * (pts[lo + 1].y - pts[lo].y),
    });
  }
  return out;
}

function centralDiff(arr) {
  const N = arr.length;
  const out = new Array(N);
  out[0] = arr[1] - arr[0];
  out[N - 1] = arr[N - 1] - arr[N - 2];
  for (let i = 1; i < N - 1; i++) out[i] = (arr[i + 1] - arr[i - 1]) / 2;
  return out;
}

function secondDiff(arr) {
  const N = arr.length;
  const out = new Array(N);
  for (let i = 1; i < N - 1; i++) out[i] = arr[i - 1] - 2 * arr[i] + arr[i + 1];
  out[0] = N >= 3 ? arr[2] - 2 * arr[1] + arr[0] : 0;
  out[N - 1] = N >= 3 ? arr[N - 1] - 2 * arr[N - 2] + arr[N - 3] : 0;
  return out;
}

function drawRiver(canvas, centerline, params = {}) {
  const {
    riverWidth = 20,
    bankThickness = 8,
    bankThicknessJitter = 5,
    bankThicknessSmooth = 2.5,
    blotRate = 0.06,
    blotAmp = 10,
    blotWidth = 3.5,
    widthJitterAmp = 14,
    widthJitterSmooth = 25,
    rippleOffsetFrac = 0.15,
    rippleJitterAmp = 0.8,
    rippleJitterSmooth = 12,
    rippleThickness = 1.5,
    bankColor = [20, 16, 12],
    waveColor = [135, 122, 100],
    smoothSigma = 3.0,
    seed = 0,
    scale = 1,
  } = params;

  if (centerline.length < 2) return;

  const rng = createRng(seed);

  // Steps 1-2: resample + pre-smooth
  let pts = resampleByArcLength(centerline, 1.0);
  const M = pts.length;
  if (M < 2) return;
  const smX = gaussianFilter1D(pts.map(p => p.x), smoothSigma);
  const smY = gaussianFilter1D(pts.map(p => p.y), smoothSigma);
  pts = pts.map((_, i) => ({ x: smX[i], y: smY[i] }));

  // Step 3: tangents + left-hand normals
  const tx = centralDiff(pts.map(p => p.x));
  const ty = centralDiff(pts.map(p => p.y));
  const nx = new Array(M);
  const ny = new Array(M);
  for (let i = 0; i < M; i++) {
    const len = Math.max(Math.hypot(tx[i], ty[i]), 1e-12);
    tx[i] /= len; ty[i] /= len;
    nx[i] = -ty[i]; ny[i] = tx[i];
  }

  // Step 4: half-width + curvature clamp
  const halfW = riverWidth / 2;
  const widthMod = jitter(M, widthJitterAmp, widthJitterSmooth, rng);
  const halfW_eff = new Array(M);
  for (let i = 0; i < M; i++) halfW_eff[i] = Math.max(3.0, halfW + widthMod[i]);

  const d2x = secondDiff(pts.map(p => p.x));
  const d2y = secondDiff(pts.map(p => p.y));
  const kappa = new Array(M);
  for (let i = 0; i < M; i++) kappa[i] = Math.hypot(d2x[i], d2y[i]);
  const kappaSmooth = gaussianFilter1D(kappa, 4.0);
  for (let i = 0; i < M; i++) {
    const radius = 1.0 / Math.max(kappaSmooth[i], 1e-4);
    halfW_eff[i] = Math.min(halfW_eff[i], 0.85 * radius);
  }

  // Step 5: inner banks
  const upperInner = new Array(M);
  const lowerInner = new Array(M);
  for (let i = 0; i < M; i++) {
    upperInner[i] = { x: pts[i].x + nx[i] * halfW_eff[i], y: pts[i].y + ny[i] * halfW_eff[i] };
    lowerInner[i] = { x: pts[i].x - nx[i] * halfW_eff[i], y: pts[i].y - ny[i] * halfW_eff[i] };
  }

  // Step 6: outward thickness — single smoothed jitter array per bank
  const thkJitU = jitter(M, bankThicknessJitter, bankThicknessSmooth, rng);
  const thkJitL = jitter(M, bankThicknessJitter, bankThicknessSmooth, rng);
  const blotU = blotSignal(M, blotRate, blotAmp, blotWidth, rng);
  const blotL = blotSignal(M, blotRate, blotAmp, blotWidth, rng);
  const thk_u = new Array(M);
  const thk_l = new Array(M);
  for (let i = 0; i < M; i++) {
    thk_u[i] = Math.max(1.0, bankThickness + thkJitU[i] + blotU[i]);
    thk_l[i] = Math.max(1.0, bankThickness + thkJitL[i] + blotL[i]);
  }

  // Step 7: outer banks
  const upperOuter = new Array(M);
  const lowerOuter = new Array(M);
  for (let i = 0; i < M; i++) {
    upperOuter[i] = { x: upperInner[i].x + nx[i] * thk_u[i], y: upperInner[i].y + ny[i] * thk_u[i] };
    lowerOuter[i] = { x: lowerInner[i].x - nx[i] * thk_l[i], y: lowerInner[i].y - ny[i] * thk_l[i] };
  }

  // Step 8: ripple line
  const rippleJit = jitter(M, rippleJitterAmp, rippleJitterSmooth, rng);
  const rippleOff = new Array(M);
  for (let i = 0; i < M; i++) {
    const fullW = halfW + widthMod[i];
    rippleOff[i] = rippleOffsetFrac * fullW * 2.0 + rippleJit[i];
  }
  const narrow = new Array(M);
  for (let i = 0; i < M; i++) narrow[i] = halfW_eff[i] < 0.8 * halfW ? 1.0 : 0.0;
  const narrowMask = gaussianFilter1D(narrow, 20.0);
  for (let i = 0; i < M; i++) {
    const m = Math.min(1, Math.max(0, narrowMask[i]));
    rippleOff[i] *= (1 - m);
  }
  const wave = new Array(M);
  for (let i = 0; i < M; i++) {
    wave[i] = { x: pts[i].x + nx[i] * rippleOff[i], y: pts[i].y + ny[i] * rippleOff[i] };
  }

  // Render onto target canvas
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = `rgb(${bankColor.join(',')})`;
  function drawRibbon(outer, inner) {
    for (let i = 0; i < M - 1; i++) {
      ctx.beginPath();
      ctx.moveTo(outer[i].x * scale, outer[i].y * scale);
      ctx.lineTo(outer[i + 1].x * scale, outer[i + 1].y * scale);
      ctx.lineTo(inner[i + 1].x * scale, inner[i + 1].y * scale);
      ctx.lineTo(inner[i].x * scale, inner[i].y * scale);
      ctx.closePath();
      ctx.fill();
    }
  }
  drawRibbon(upperOuter, upperInner);
  drawRibbon(lowerOuter, lowerInner);

  ctx.strokeStyle = `rgb(${waveColor.join(',')})`;
  ctx.lineWidth = Math.max(1, Math.round(rippleThickness * scale));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(wave[0].x * scale, wave[0].y * scale);
  for (let i = 1; i < M; i++) ctx.lineTo(wave[i].x * scale, wave[i].y * scale);
  ctx.stroke();
}

// ============================================================
// HEX GRID RENDERER
// ============================================================
function hexStrokeAlpha(fade, cx, cy, canvasW, canvasH) {
  // Distance from canvas center, normalized to [0, ~0.71]
  const dx = (cx - canvasW / 2) / (canvasW / 2);
  const dy = (cy - canvasH / 2) / (canvasH / 2);
  const dist = Math.sqrt(dx * dx + dy * dy);
  // Fade: 1.0 at center, drops to fade at edges
  // Quadratic fade for smooth vignette effect
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

  const ctx = canvas.getContext('2d');
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 10;

  // Parse stroke color into RGB components
  const hex = strokeColor.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  const canvasW = canvas.width;
  const canvasH = canvas.height;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const c = hexCenter(row, col, opts);
      const verts = hexVertices(c.x, c.y, drawSize);
      // Scale hex coords to hi-res canvas space for fade calculation
      const alpha = hexStrokeAlpha(fadeEdge, c.x * scale, c.y * scale, canvasW, canvasH);
      const strokeStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;

      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = edgeWidth;
      for (let i = 0; i < 6; i++) {
        const p1 = verts[i];
        const p2 = verts[(i + 1) % 6];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        const ux = dx / len;
        const uy = dy / len;
        const gap = HEX_SIZE * edgeGapRatio;
        ctx.beginPath();
        ctx.moveTo((p1.x + ux * gap) * scale, (p1.y + uy * gap) * scale);
        ctx.lineTo((p2.x - ux * gap) * scale, (p2.y - uy * gap) * scale);
        ctx.stroke();
      }

      ctx.lineWidth = tickWidth;
      for (let i = 0; i < 6; i++) {
        const p = verts[i];
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        const len = Math.hypot(dx, dy);
        const ux = dx / len;
        const uy = dy / len;
        ctx.beginPath();
        ctx.moveTo(p.x * scale, p.y * scale);
        ctx.lineTo((p.x + ux * tickLen) * scale, (p.y + uy * tickLen) * scale);
        ctx.stroke();
      }
    }
  }
}

// ============================================================
// PARCHMENT BACKGROUND
// ============================================================
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

  const vig = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
  vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vig.addColorStop(1, 'rgba(25, 15, 8, 0.35)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

// ============================================================
// COMPOSITED MAP RENDERER
//
// Strategy: paint parchment on low-res target. Render hex+river onto a
// transparent hi-res buffer, threshold to a binary mask, then composite
// over the parchment so the texture survives.
// ============================================================
function renderMap(opts = {}) {
  const W = opts.width ?? 928;
  const H = opts.height ?? 946;
  const S = opts.supersample ?? 8;
  const seed = opts.seed ?? 42;
  const drawGrid = opts.drawGrid ?? true;
  const drawRiverFlag = opts.drawRiver ?? true;
  const riverParams = opts.riverParams ?? {};
  const gridParams = opts.gridParams ?? {};
  const riverPathOpts = opts.riverPathOpts ?? {};

  const out = createCanvas(W, H);
  paintParchment(out, { seed });

  const hi = createCanvas(W * S, H * S);
  const hiCtx = hi.getContext('2d');
  // Pre-fill with parchment color so alpha-blended strokes threshold correctly.
  hiCtx.fillStyle = '#e8d5b7';
  hiCtx.fillRect(0, 0, W * S, H * S);

  if (drawGrid) drawHexGrid(hi, { ...gridParams, scale: S });

  let riverInfo = null;
  if (drawRiverFlag) {
    const cl = hexEdgeCenterline(seed, riverPathOpts);
    riverInfo = { reached: cl.reached, length: cl.points.length };
    if (cl.points.length >= 2) {
      drawRiver(hi, cl.points, { ...riverParams, seed, scale: S });
    }
  }

  // Threshold hi-res to binary mask: dark pixels stay opaque dark, rest → transparent.
  const himg = hiCtx.getImageData(0, 0, W * S, H * S);
  const px = himg.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const brightness = (px[i] + px[i + 1] + px[i + 2]) / 3;
    if (brightness < 128) {
      px[i] = 42; px[i + 1] = 32; px[i + 2] = 21; px[i + 3] = 255;
    } else {
      px[i + 3] = 0;
    }
  }
  hiCtx.putImageData(himg, 0, 0);

  // Composite hi-res mask onto parchment. Smoothing on → proper AA downscale.
  const outCtx = out.getContext('2d');
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = 'high';
  outCtx.drawImage(hi, 0, 0, W * S, H * S, 0, 0, W, H);

  return { canvas: out, river: riverInfo };
}

// ============================================================
// DEMO ENTRY POINT
// ============================================================
function main() {
  const fs = require('fs');
  const seed = 42;
  const { canvas, river } = renderMap({ seed });
  const filename = `/Users/ace/code/inkdrifter/output_map_1.png`;
  fs.writeFileSync(filename, canvas.toBuffer('image/png'));
  if (river && !river.reached) {
    console.warn(`seed=${seed}: river did not reach far side after retries (length=${river.length})`);
  }
  console.log(`Saved ${filename} (seed=${seed})`);
  console.log('Done — 1 map rendered.');
}

if (require.main === module) main();

module.exports = {
  // hex
  HEX_SIZE, HEX_W, HEX_H,
  hexCenter, hexVertices, buildVertexGraph,
  // rng / math
  createRng, gaussianFilter1D, jitter, blotSignal, weightedChoice,
  // paths
  randomRiverPath, hexEdgeCenterline, resampleByArcLength,
  // rendering
  drawRiver, drawHexGrid, paintParchment, renderMap,
};
