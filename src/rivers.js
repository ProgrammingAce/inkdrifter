const { HEX_W, DEFAULT_COLS, DEFAULT_ROWS } = require('./constants.js');
const { createRng, gaussianFilter1D, jitter, blotSignal, weightedChoice } = require('./rng.js');
const { buildVertexGraph, parseKey } = require('./hex.js');

function randomRiverPath(seed, opts = {}) {
  const cols = opts.cols ?? DEFAULT_COLS;
  const startSide = opts.startSide ?? 'left';
  const targetSide = opts.targetSide ?? 'right';
  // Scale path budgets with grid width so rivers can traverse large maps.
  const maxSteps = opts.maxSteps ?? Math.max(120, cols * 12);
  const maxAttempts = opts.maxAttempts ?? 40;
  const minLength = opts.minLength ?? Math.max(40, cols * 6);
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
    if (reached) return { points: pts, keys: path.slice(), reached: true, attempts: attempt + 1 };
    if (best === null || pts.length > best.length) { best = { pts, keys: path.slice() }; bestReached = false; }
  }
  return { points: best ? best.pts : [], keys: best ? best.keys : [], reached: bestReached, attempts: maxAttempts };
}

function densifyAndSmooth(raw, opts = {}) {
  const densifySteps = opts.densifySteps ?? 8;
  const smoothSigma = opts.densifySmoothSigma ?? 0.8;
  if (raw.length < 2) return [];
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
  return dense.map((_, i) => ({ x: dx[i], y: dy[i] }));
}

function hexEdgeCenterline(seed, opts = {}) {
  const result = randomRiverPath(seed, opts);
  const points = densifyAndSmooth(result.points, opts);
  return { points, reached: result.reached, keys: result.keys ?? [] };
}

function tributaryPath(seed, existingKeys, opts = {}) {
  const cols = opts.cols ?? DEFAULT_COLS;
  const rows = opts.rows ?? DEFAULT_ROWS;
  const maxSteps = opts.maxSteps ?? Math.max(100, (cols + rows) * 6);
  const maxAttempts = opts.maxAttempts ?? 40;
  const minLength = opts.minLength ?? Math.max(8, Math.floor((cols + rows) / 3));
  const adj = opts.adj ?? buildVertexGraph(opts);

  const rng = createRng(seed);
  const allKeys = Array.from(adj.keys());
  if (existingKeys.size === 0) return { points: [], keys: [], reached: false };

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const k of allKeys) {
    const p = parseKey(k);
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const onEdge = (p) =>
    Math.abs(p.x - minX) < 1 || Math.abs(p.x - maxX) < 1 ||
    Math.abs(p.y - minY) < 1 || Math.abs(p.y - maxY) < 1;

  const existingPts = [];
  for (const k of existingKeys) existingPts.push(parseKey(k));
  const distToExisting = (p) => {
    let best = Infinity;
    for (const q of existingPts) {
      const dx = q.x - p.x, dy = q.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  };

  const minStartDist = HEX_W * 1.5;
  const startCandidates = allKeys.filter(k => {
    if (existingKeys.has(k)) return false;
    const p = parseKey(k);
    if (!onEdge(p)) return false;
    return distToExisting(p) >= minStartDist;
  });
  if (startCandidates.length === 0) return { points: [], keys: [], reached: false };

  let best = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const start = startCandidates[rng.uniformInt(0, startCandidates.length)];
    const path = [start];
    const visited = new Set([start]);
    let prev = null;
    let reached = false;

    for (let step = 0; step < maxSteps; step++) {
      const cur = path[path.length - 1];
      const curP = parseKey(cur);
      const nbrsAll = Array.from(adj.get(cur));

      if (path.length >= minLength) {
        const termNbrs = nbrsAll.filter(n => existingKeys.has(n));
        if (termNbrs.length > 0) {
          const pick = termNbrs[rng.uniformInt(0, termNbrs.length)];
          path.push(pick);
          reached = true;
          break;
        }
      }

      const nbrs = nbrsAll.filter(n => !visited.has(n) && n !== prev && !existingKeys.has(n));
      if (nbrs.length === 0) break;

      const curDist = distToExisting(curP);
      const weights = nbrs.map(n => {
        const d = distToExisting(parseKey(n));
        const adv = curDist - d;
        if (adv > 0.01) return 2.4;
        if (adv < -0.01) return 0.4;
        return 1.2;
      });
      const choice = weightedChoice(nbrs, weights, rng);
      path.push(choice);
      visited.add(choice);
      prev = cur;
    }

    const pts = path.map(parseKey);
    if (reached) return { points: pts, keys: path.slice(), reached: true, attempts: attempt + 1 };
    if (best === null || pts.length > best.pts.length) best = { pts, keys: path.slice() };
  }
  return { points: best ? best.pts : [], keys: best ? best.keys : [], reached: false };
}

function tributaryCenterline(seed, existingKeys, opts = {}) {
  const result = tributaryPath(seed, existingKeys, opts);
  const points = densifyAndSmooth(result.points, opts);
  return { points, reached: result.reached, keys: result.keys };
}

function defaultRiverCount(rows, cols) {
  return Math.max(1, Math.floor((rows + cols - 12) / 14));
}

function generateRivers(seed, opts = {}) {
  const rows = opts.rows ?? DEFAULT_ROWS;
  const cols = opts.cols ?? DEFAULT_COLS;
  const count = opts.riverCount ?? defaultRiverCount(rows, cols);
  const adj = opts.adj ?? buildVertexGraph(opts);
  const sharedOpts = { ...opts, adj };

  const rivers = [];
  const allKeys = new Set();
  const keyToRiver = new Map();
  const claim = (riverIdx, keys) => {
    for (const k of keys) {
      allKeys.add(k);
      if (!keyToRiver.has(k)) keyToRiver.set(k, riverIdx);
    }
  };

  const trunk = hexEdgeCenterline(seed, sharedOpts);
  trunk.parentIndex = null;
  rivers.push(trunk);
  claim(0, trunk.keys);

  for (let i = 1; i < count; i++) {
    const trib = tributaryCenterline((seed * 0x27d4eb2d + i * 0x9e3779b1) >>> 0, allKeys, sharedOpts);
    if (trib.points.length < 2) continue;
    let parentIndex = null;
    if (trib.reached && trib.keys.length > 0) {
      const last = trib.keys[trib.keys.length - 1];
      if (keyToRiver.has(last)) parentIndex = keyToRiver.get(last);
    }
    trib.parentIndex = parentIndex;
    const idx = rivers.length;
    rivers.push(trib);
    const ownKeys = parentIndex !== null ? trib.keys.slice(0, -1) : trib.keys;
    claim(idx, ownKeys);
  }
  return rivers;
}

// ── River geometry & rendering ───────────────────────────────────────────────

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

function computeRiverGeometry(centerline, params, rng) {
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
    smoothSigma = 3.0,
  } = params;
  if (centerline.length < 2) return null;
  let pts = resampleByArcLength(centerline, 1.0);
  const M = pts.length;
  if (M < 2) return null;
  const smX = gaussianFilter1D(pts.map(p => p.x), smoothSigma);
  const smY = gaussianFilter1D(pts.map(p => p.y), smoothSigma);
  pts = pts.map((_, i) => ({ x: smX[i], y: smY[i] }));
  const tx = centralDiff(pts.map(p => p.x));
  const ty = centralDiff(pts.map(p => p.y));
  const nx = new Array(M), ny = new Array(M);
  for (let i = 0; i < M; i++) {
    const len = Math.max(Math.hypot(tx[i], ty[i]), 1e-12);
    tx[i] /= len; ty[i] /= len;
    nx[i] = -ty[i]; ny[i] = tx[i];
  }
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
  const upperInner = new Array(M);
  const lowerInner = new Array(M);
  for (let i = 0; i < M; i++) {
    upperInner[i] = { x: pts[i].x + nx[i] * halfW_eff[i], y: pts[i].y + ny[i] * halfW_eff[i] };
    lowerInner[i] = { x: pts[i].x - nx[i] * halfW_eff[i], y: pts[i].y - ny[i] * halfW_eff[i] };
  }
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
  const upperOuter = new Array(M);
  const lowerOuter = new Array(M);
  for (let i = 0; i < M; i++) {
    upperOuter[i] = { x: upperInner[i].x + nx[i] * thk_u[i], y: upperInner[i].y + ny[i] * thk_u[i] };
    lowerOuter[i] = { x: lowerInner[i].x - nx[i] * thk_l[i], y: lowerInner[i].y - ny[i] * thk_l[i] };
  }
  return { pts, M, nx, ny, halfW, halfW_eff, widthMod, upperInner, lowerInner, upperOuter, lowerOuter };
}

function riverBankPolygon(geom) {
  if (!geom) return null;
  const poly = new Array(geom.M * 2);
  for (let i = 0; i < geom.M; i++) poly[i] = geom.upperOuter[i];
  for (let i = 0; i < geom.M; i++) poly[geom.M + i] = geom.lowerOuter[geom.M - 1 - i];
  return poly;
}

function riverWaterPolygon(geom) {
  if (!geom) return null;
  const poly = new Array(geom.M * 2);
  for (let i = 0; i < geom.M; i++) poly[i] = geom.upperInner[i];
  for (let i = 0; i < geom.M; i++) poly[geom.M + i] = geom.lowerInner[geom.M - 1 - i];
  return poly;
}

function drawRiver(canvas, centerline, params = {}) {
  const {
    rippleOffsetFrac = 0.15,
    rippleJitterAmp = 0.8,
    rippleJitterSmooth = 12,
    rippleThickness = 1.5,
    bankColor = [20, 16, 12],
    waveColor = [135, 122, 100],
    seed = 0,
    scale = 1,
  } = params;

  if (centerline.length < 2) return;

  const rng = createRng(seed);
  const geom = computeRiverGeometry(centerline, params, rng);
  if (!geom) return;
  const { pts, M, nx, ny, halfW, halfW_eff, widthMod, upperInner, lowerInner, upperOuter, lowerOuter } = geom;

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

module.exports = {
  randomRiverPath, densifyAndSmooth, hexEdgeCenterline,
  tributaryPath, tributaryCenterline, defaultRiverCount, generateRivers,
  resampleByArcLength,
  computeRiverGeometry, riverBankPolygon, riverWaterPolygon,
  drawRiver,
};
