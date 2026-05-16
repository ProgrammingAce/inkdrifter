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

// Walks from a random edge vertex toward the nearest vertex in `existingKeys`,
// terminating the moment a neighbor lies on an existing river. Produces a
// tributary whose terminus forms a T-junction with the trunk.
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

  // Start from an edge vertex that isn't part of an existing river and is
  // at least a few cells away from one (so the tributary has room to grow).
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

      // T-junction: once long enough, snap onto any neighbor already on a
      // trunk river. That neighbor becomes the final point of this path.
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

// Decide how many rivers a map of this size should have.
function defaultRiverCount(rows, cols) {
  return Math.max(1, Math.floor((rows + cols - 12) / 14));
}

// Generate one trunk plus zero or more tributaries. Each subsequent path
// avoids re-using prior vertices and is allowed to terminate on one of them,
// creating a T-junction in the rendered output.
function generateRivers(seed, opts = {}) {
  const rows = opts.rows ?? DEFAULT_ROWS;
  const cols = opts.cols ?? DEFAULT_COLS;
  const count = opts.riverCount ?? defaultRiverCount(rows, cols);
  const adj = opts.adj ?? buildVertexGraph(opts);
  const sharedOpts = { ...opts, adj };

  const rivers = [];
  const allKeys = new Set();
  // Vertex key → index of the river that first claimed it. Used to find which
  // river a tributary terminates on so the child can be clipped by the parent.
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
    // If the tributary reached an existing vertex, the last key is that
    // terminator and identifies the parent. Otherwise it's standalone.
    let parentIndex = null;
    if (trib.reached && trib.keys.length > 0) {
      const last = trib.keys[trib.keys.length - 1];
      if (keyToRiver.has(last)) parentIndex = keyToRiver.get(last);
    }
    trib.parentIndex = parentIndex;
    const idx = rivers.length;
    rivers.push(trib);
    // The terminator belongs to the parent — don't reassign it.
    const ownKeys = parentIndex !== null ? trib.keys.slice(0, -1) : trib.keys;
    claim(idx, ownKeys);
  }
  return rivers;
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

// Build river bank geometry deterministically from the centerline + params.
// The rng is consumed in a fixed order (widthMod, thkJitU, thkJitL, blotU,
// blotL) so callers that pass the same seed get identical banks. The caller
// owns the rng so it can be reused for downstream draws (e.g. ripple).
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

// Closed polygon (upper bank forward, lower bank reversed) suitable for
// point-in-polygon clipping against the coastline at river mouths.
function riverBankPolygon(geom) {
  if (!geom) return null;
  const poly = new Array(geom.M * 2);
  for (let i = 0; i < geom.M; i++) poly[i] = geom.upperOuter[i];
  for (let i = 0; i < geom.M; i++) poly[geom.M + i] = geom.lowerOuter[geom.M - 1 - i];
  return poly;
}

// Inner (water) polygon, bounded by upperInner / lowerInner. Used when a
// child river's notch is cut from its parent's bank — the gap should match
// the child's water width, not its full bank-to-bank width.
function riverWaterPolygon(geom) {
  if (!geom) return null;
  const poly = new Array(geom.M * 2);
  for (let i = 0; i < geom.M; i++) poly[i] = geom.upperInner[i];
  for (let i = 0; i < geom.M; i++) poly[geom.M + i] = geom.lowerInner[geom.M - 1 - i];
  return poly;
}

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
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
// OCEAN / COASTLINE
// ============================================================
const SIDES = ['N', 'E', 'S', 'W'];
const SIDE_COUNT_WEIGHTS = [10, 30, 30, 20, 10]; // for 0,1,2,3,4 sides

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.uniform() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickSides(rng, override) {
  const counts = [0, 1, 2, 3, 4];
  const n = (override !== undefined && override !== null)
    ? Math.max(0, Math.min(4, override))
    : weightedChoice(counts, SIDE_COUNT_WEIGHTS, rng);
  return shuffleInPlace([...SIDES], rng).slice(0, n);
}

function smoothNoiseArray(length, sigma, rng) {
  const raw = new Array(length);
  for (let i = 0; i < length; i++) raw[i] = rng.normal();
  const sm = gaussianFilter1D(raw, sigma);
  let peak = 1e-12;
  for (let i = 0; i < length; i++) {
    const a = Math.abs(sm[i]);
    if (a > peak) peak = a;
  }
  for (let i = 0; i < length; i++) sm[i] /= peak;
  return sm;
}

function buildDepthProfile(side, rows, cols, baseDepth, noiseAmp, rng) {
  const len = (side === 'N' || side === 'S') ? cols : rows;
  const noise = smoothNoiseArray(len, 1.5, rng);
  const depths = new Array(len);
  for (let i = 0; i < len; i++) {
    const d = Math.round(baseDepth + noise[i] * noiseAmp);
    depths[i] = Math.max(0, Math.min(5, d));
  }
  return depths;
}

function selectWaterHexes(rng, sides, opts = {}) {
  const rows = opts.rows ?? DEFAULT_ROWS;
  const cols = opts.cols ?? DEFAULT_COLS;
  const baseRange = opts.baseDepthRange ?? [2, 4];
  const noiseAmp = opts.noiseAmp ?? 2;
  const cap = opts.cap ?? 0.40;

  const profiles = {};
  for (const side of sides) {
    const base = baseRange[0] + rng.uniformInt(0, baseRange[1] - baseRange[0] + 1);
    profiles[side] = { depths: buildDepthProfile(side, rows, cols, base, noiseAmp, rng) };
  }

  function distFor(side, r, c) {
    if (side === 'N') return { dist: r, idx: c };
    if (side === 'S') return { dist: rows - 1 - r, idx: c };
    if (side === 'W') return { dist: c, idx: r };
    return { dist: cols - 1 - c, idx: r };
  }

  function compute() {
    const water = new Set();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        for (const side of sides) {
          const { dist, idx } = distFor(side, r, c);
          if (dist < profiles[side].depths[idx]) { water.add(`${r},${c}`); break; }
        }
      }
    }
    return water;
  }

  const total = rows * cols;
  let water = compute();
  let iter = 0;
  while (water.size / total > cap && iter < 200) {
    let bestSide = null, bestMax = 0;
    for (const side of sides) {
      const m = Math.max(...profiles[side].depths);
      if (m > bestMax) { bestMax = m; bestSide = side; }
    }
    if (!bestSide) break;
    profiles[bestSide].depths = profiles[bestSide].depths.map(d => Math.max(0, d - 1));
    water = compute();
    iter++;
  }
  return { water, profiles, sides };
}

// Returns the hex (row, col) containing point (x, y), or null if outside the grid.
// Uses nearest-center lookup (exact for regular hex tessellation).
function hexAtPoint(x, y, opts = {}) {
  const rows = opts.rows ?? DEFAULT_ROWS;
  const cols = opts.cols ?? DEFAULT_COLS;
  const ox = opts.originX ?? DEFAULT_GRID_ORIGIN_X;
  const oy = opts.originY ?? DEFAULT_GRID_ORIGIN_Y;
  const approxRow = Math.round((y - oy) / (HEX_H * 0.75));
  let best = null, bestD2 = Infinity;
  for (let dr = -1; dr <= 1; dr++) {
    const r = approxRow + dr;
    if (r < 0 || r >= rows) continue;
    const xOff = (r % 2 === 1) ? HEX_W / 2 : 0;
    const approxCol = Math.round((x - ox - xOff) / HEX_W);
    for (let dc = -1; dc <= 1; dc++) {
      const c = approxCol + dc;
      if (c < 0 || c >= cols) continue;
      const cx = ox + HEX_W * c + xOff;
      const cy = oy + HEX_H * 0.75 * r;
      const d2 = (cx - x) * (cx - x) + (cy - y) * (cy - y);
      if (d2 < bestD2) { bestD2 = d2; best = { r, c }; }
    }
  }
  return best;
}

// True if point is in ocean (water hex, or outside the grid).
function pointIsOcean(x, y, water, opts = {}) {
  const h = hexAtPoint(x, y, opts);
  if (h === null) return true; // outside grid → ocean
  return water.has(`${h.r},${h.c}`);
}

// Hex neighbor by edge direction (0=E, 1=SE, 2=SW, 3=W, 4=NW, 5=NE), pointy-top, odd rows shifted right.
function neighborOf(r, c, dir) {
  const odd = r % 2 === 1;
  switch (dir) {
    case 0: return { r, c: c + 1 };
    case 1: return odd ? { r: r + 1, c: c + 1 } : { r: r + 1, c };
    case 2: return odd ? { r: r + 1, c } : { r: r + 1, c: c - 1 };
    case 3: return { r, c: c - 1 };
    case 4: return odd ? { r: r - 1, c } : { r: r - 1, c: c - 1 };
    case 5: return odd ? { r: r - 1, c: c + 1 } : { r: r - 1, c };
  }
}

// First intersection (smallest t along p1→p2) of segment p1→p2 with any
// coast-polyline segment. Returns { x, y, t } or null.
function segIntersectPolylines(p1, p2, polylines) {
  const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
  let bestT = Infinity, bestX = 0, bestY = 0, found = false;
  for (const poly of polylines) {
    for (let i = 1; i < poly.length; i++) {
      const x3 = poly[i - 1].x, y3 = poly[i - 1].y;
      const x4 = poly[i].x,     y4 = poly[i].y;
      const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      if (Math.abs(denom) < 1e-9) continue;
      const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
      const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      if (t < bestT) {
        bestT = t;
        bestX = x1 + t * (x2 - x1);
        bestY = y1 + t * (y2 - y1);
        found = true;
      }
    }
  }
  return found ? { x: bestX, y: bestY, t: bestT } : null;
}

function buildCoastlineSegments(water, opts = {}) {
  const rows = opts.rows ?? DEFAULT_ROWS;
  const cols = opts.cols ?? DEFAULT_COLS;
  const segments = [];
  for (const key of water) {
    const [r, c] = key.split(',').map(Number);
    const center = hexCenter(r, c, opts);
    const verts = hexVertices(center.x, center.y, HEX_SIZE);
    for (let i = 0; i < 6; i++) {
      const n = neighborOf(r, c, i);
      const outOfBounds = n.r < 0 || n.r >= rows || n.c < 0 || n.c >= cols;
      if (outOfBounds) continue;          // ocean continues offscreen, no coastline
      if (water.has(`${n.r},${n.c}`)) continue; // water-water: not coastline
      segments.push({
        p1: verts[i],
        p2: verts[(i + 1) % 6],
        waterCenter: { x: center.x, y: center.y },
      });
    }
  }
  return segments;
}

function stitchSegments(segments) {
  const vertSegs = new Map();
  function addRef(key, idx) {
    if (!vertSegs.has(key)) vertSegs.set(key, []);
    vertSegs.get(key).push(idx);
  }
  for (let i = 0; i < segments.length; i++) {
    addRef(vertexKeyStr(segments[i].p1), i);
    addRef(vertexKeyStr(segments[i].p2), i);
  }
  const used = new Array(segments.length).fill(false);
  const chains = [];
  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    used[start] = true;
    const s0 = segments[start];
    const points = [s0.p1, s0.p2];
    const waterCenters = [s0.waterCenter];

    let curKey = vertexKeyStr(points[points.length - 1]);
    while (true) {
      const cands = vertSegs.get(curKey) || [];
      const next = cands.find(idx => !used[idx]);
      if (next === undefined) break;
      used[next] = true;
      const ns = segments[next];
      const k1 = vertexKeyStr(ns.p1);
      const np = (k1 === curKey) ? ns.p2 : ns.p1;
      points.push(np);
      waterCenters.push(ns.waterCenter);
      curKey = vertexKeyStr(np);
    }
    curKey = vertexKeyStr(points[0]);
    while (true) {
      const cands = vertSegs.get(curKey) || [];
      const next = cands.find(idx => !used[idx]);
      if (next === undefined) break;
      used[next] = true;
      const ns = segments[next];
      const k1 = vertexKeyStr(ns.p1);
      const np = (k1 === curKey) ? ns.p2 : ns.p1;
      points.unshift(np);
      waterCenters.unshift(ns.waterCenter);
      curKey = vertexKeyStr(np);
    }
    chains.push({ points, waterCenters });
  }
  return chains;
}

function wigglyEdge(p1, p2, waterCenter, rng, opts = {}) {
  const amp = opts.amp ?? 5.5;
  const samples = opts.samples ?? 6;
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  const tx = dx / len, ty = dy / len;
  let nx = -ty, ny = tx;
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const towardWaterX = waterCenter.x - mid.x;
  const towardWaterY = waterCenter.y - mid.y;
  if (nx * towardWaterX + ny * towardWaterY < 0) { nx = -nx; ny = -ny; }

  const phase = rng.uniform() * Math.PI * 2;
  const phase2 = rng.uniform() * Math.PI * 2;
  const freq = 2 + rng.uniform() * 2;
  const sign = rng.uniform() < 0.5 ? -1 : 1;

  const out = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const env = Math.sin(Math.PI * t); // 0 at endpoints
    const w = Math.sin(phase + t * freq * Math.PI) + 0.45 * Math.sin(phase2 + t * freq * 2.0 * Math.PI);
    const offset = sign * env * amp * w * 0.55;
    out.push({
      x: p1.x + tx * len * t + nx * offset,
      y: p1.y + ty * len * t + ny * offset,
      wnx: nx, wny: ny,  // segment normal toward ocean
    });
  }
  return out;
}

function buildCoastPolylines(chains, rng, opts = {}) {
  const polylines = [];
  for (const chain of chains) {
    const poly = [];
    for (let i = 0; i < chain.points.length - 1; i++) {
      const pts = wigglyEdge(chain.points[i], chain.points[i + 1], chain.waterCenters[i], rng, opts);
      const startIdx = i === 0 ? 0 : 1;
      for (let j = startIdx; j < pts.length; j++) poly.push(pts[j]);
    }
    // Smooth a copy of the polyline so wave-line normals don't whip at concave corners.
    const smX = gaussianFilter1D(poly.map(p => p.x), 4.0);
    const smY = gaussianFilter1D(poly.map(p => p.y), 4.0);
    for (let i = 0; i < poly.length; i++) {
      const pi = Math.max(0, i - 2);
      const ni = Math.min(poly.length - 1, i + 2);
      const tx = smX[ni] - smX[pi], ty = smY[ni] - smY[pi];
      const tlen = Math.max(Math.hypot(tx, ty), 1e-9);
      let onx = -ty / tlen, ony = tx / tlen;
      if (onx * poly[i].wnx + ony * poly[i].wny < 0) { onx = -onx; ony = -ony; }
      poly[i].onx = onx;
      poly[i].ony = ony;
      poly[i].sx = smX[i];
      poly[i].sy = smY[i];
    }
    polylines.push(poly);
  }
  return polylines;
}

function drawOcean(canvas, water, sides, opts = {}) {
  const ctx = canvas.getContext('2d');
  // Optional separate target for the thin wave lines, rendered at native
  // resolution to bypass the hi-res threshold pipeline (which kills hairlines).
  const waveCanvas = opts.waveCanvas ?? canvas;
  const waveCtx = waveCanvas.getContext('2d');
  const waveScale = opts.waveScale ?? opts.scale ?? 1;
  const rows = opts.rows ?? DEFAULT_ROWS;
  const cols = opts.cols ?? DEFAULT_COLS;
  const scale = opts.scale ?? 1;
  const seed = opts.seed ?? 0;
  const rng = createRng((seed * 0x9E3779B1) >>> 0 ^ 0x517cc1b7);
  const lineColor = opts.lineColor ?? '#2a2015';
  const coastWidth = opts.coastWidth ?? 8.0;
  const W = canvas.width;
  const H = canvas.height;

  let chains, polylines;
  if (opts.prebuiltPolylines) {
    polylines = opts.prebuiltPolylines;
    chains = null;
  } else {
    const segments = buildCoastlineSegments(water, opts);
    if (segments.length === 0) return { chains: [], polylines: [] };
    chains = stitchSegments(segments);
    polylines = buildCoastPolylines(chains, rng, { amp: opts.wiggleAmp ?? 5.5, samples: opts.samples ?? 6 });
  }

  ctx.strokeStyle = lineColor;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (!opts.skipCoast) {
    drawCoastline(ctx, polylines, opts, { scale, coastWidth, lineColor });
  }

  // Wave rings (coastline-2.png style): just a handful of tight, scalloped
  // rings hugging each coast. Each ring is a continuous wavy offset of the
  // coast polyline. Open ocean past the outermost ring is left blank.
  if (opts.skipWaves) return { chains, polylines };
  return drawCoastWaveRings(waveCtx, polylines, water, opts, {
    waveScale, lineColor,
    Wmax: W / scale, Hmax: H / scale,
  });
}

// Stroke the wavy coast polylines, opening a gap at each river mouth so the
// river banks merge into the coastline. Clipping is geometric: a coast
// sample is dropped iff it lies inside the river's bank polygon (the strip
// bounded by the outer-upper and outer-lower bank polylines). The gap is
// therefore sized exactly by where the banks cross the coast.
// Falls back to the legacy radius-around-mouth-points clip when no polygon
// is supplied.
function drawCoastline(ctx, polylines, opts, env) {
  const { scale, coastWidth, lineColor } = env;
  const bankPolys = opts.riverBankPolygons
    ?? (opts.riverBankPolygon ? [opts.riverBankPolygon] : null);
  const riverPoints = opts.riverPoints ?? null;
  const coastClipRadius = opts.riverClipRadius ?? 14;
  const ccr2 = coastClipRadius * coastClipRadius;
  ctx.strokeStyle = lineColor;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, coastWidth * scale);
  for (const poly of polylines) {
    if (poly.length < 2) continue;
    let drawing = false;
    for (let i = 0; i < poly.length; i++) {
      let ok = true;
      if (bankPolys) {
        for (const bp of bankPolys) {
          if (pointInPolygon(poly[i].x, poly[i].y, bp)) { ok = false; break; }
        }
      } else if (riverPoints) {
        for (let m = 0; m < riverPoints.length; m++) {
          const dx = riverPoints[m].x - poly[i].x;
          const dy = riverPoints[m].y - poly[i].y;
          if (dx * dx + dy * dy < ccr2) { ok = false; break; }
        }
      }
      if (ok) {
        if (!drawing) {
          ctx.beginPath();
          ctx.moveTo(poly[i].x * scale, poly[i].y * scale);
          drawing = true;
        } else {
          ctx.lineTo(poly[i].x * scale, poly[i].y * scale);
        }
      } else if (drawing) {
        ctx.stroke();
        drawing = false;
      }
    }
    if (drawing) ctx.stroke();
  }
}

// Draws coastline-hugging wave rings in the style of coastline-2.png:
//   - 4 tight rings starting close to the coast
//   - each ring is the coast offset outward + a small sine scallop
//   - all rings similar weight, slightly thinning outward
//   - rings stop after the outermost — open ocean stays clear
function drawCoastWaveRings(ctx, polylines, water, opts, env) {
  const { waveScale, lineColor, Wmax, Hmax } = env;
  const seed = opts.seed ?? 0;
  const rng = createRng((seed * 0x9E3779B1) >>> 0 ^ 0xA1B2C3D4);

  ctx.strokeStyle = lineColor;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Tiers — distance from coast, line width, sine scallop, and break-up.
  // Inner rings hug coast detail tightly. Outer rings break up into dashes.
  const tiers = opts.waveTiers ?? [
    { dist: 12, width: 1.7, amp: 2.0, wavelen: 22, breakProb: 0.00, dashMean: 999, gapMean: 0  },
    { dist: 28, width: 1.4, amp: 2.4, wavelen: 26, breakProb: 0.05, dashMean: 12,  gapMean: 18 },
  ];

  // River-mouth clip: skip wave samples near any river mouth point so the
  // rings open up where the river crosses the coast (notch fans outward).
  const riverMouths = opts.riverPoints ?? null;
  const riverClipRadius = opts.riverClipRadius ?? 14;

  // Per-tier base. Use the RAW coast points (poly[i].x/y) so rings follow
  // every coast bump and zigzag closely. Normals come from the lightly
  // smoothed coast so they don't whip at sharp concave corners. σ for the
  // normals grows slightly outward for slightly rounder outer rings.
  const tierBase = tiers.map((_, k) => {
    const sigmaN = 0.5 + k * 0.4;
    return polylines.map(poly => {
      if (poly.length < 4) return null;
      return {
        // Position = raw coast (preserves bumps & coves)
        sx: poly.map(p => p.x),
        sy: poly.map(p => p.y),
        // Normals = mildly smoothed so they're stable around tight corners
        nx: gaussianFilter1D(poly.map(p => p.onx), sigmaN),
        ny: gaussianFilter1D(poly.map(p => p.ony), sigmaN),
      };
    });
  });

  for (let k = 0; k < tiers.length; k++) {
    const t = tiers[k];
    ctx.lineWidth = Math.max(0.5, t.width * waveScale);
    const phaseStart = rng.uniform() * Math.PI * 2;

    for (let p = 0; p < polylines.length; p++) {
      const poly = polylines[p];
      const sm = tierBase[k][p];
      if (!sm) continue;
      const N = poly.length;

      // Build the offset polyline at distance t.dist along outward normal.
      const offX = new Array(N), offY = new Array(N);
      const tanX = new Array(N), tanY = new Array(N);
      for (let i = 0; i < N; i++) {
        const nl = Math.max(Math.hypot(sm.nx[i], sm.ny[i]), 1e-9);
        const ux = sm.nx[i] / nl, uy = sm.ny[i] / nl;
        offX[i] = sm.sx[i] + ux * t.dist;
        offY[i] = sm.sy[i] + uy * t.dist;
      }
      for (let i = 0; i < N; i++) {
        const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
        const dx = offX[b] - offX[a], dy = offY[b] - offY[a];
        const tl = Math.max(Math.hypot(dx, dy), 1e-9);
        tanX[i] = dx / tl; tanY[i] = dy / tl;
      }

      // Compute the wavy-offset point + ocean validity per sample.
      // Mouth clip fans outward with tier distance so the notch widens
      // for the further-out rings (matches how the river flows out into
      // a delta-shaped opening).
      const mouthClip = riverClipRadius + t.dist * 0.7;
      const mouthClip2 = mouthClip * mouthClip;
      const wx = new Array(N), wy = new Array(N), valid = new Array(N);
      let arcLen = 0;
      for (let i = 0; i < N; i++) {
        if (i > 0) arcLen += Math.hypot(offX[i] - offX[i - 1], offY[i] - offY[i - 1]);
        const perpX = -tanY[i], perpY = tanX[i];
        const phase = phaseStart + (arcLen / t.wavelen) * Math.PI * 2;
        const wig = t.amp * Math.sin(phase);
        wx[i] = offX[i] + perpX * wig;
        wy[i] = offY[i] + perpY * wig;
        const onCanvas = wx[i] >= -4 && wx[i] <= Wmax + 4 && wy[i] >= -4 && wy[i] <= Hmax + 4;
        let ok = onCanvas && pointIsOcean(wx[i], wy[i], water, opts);
        if (ok && riverMouths) {
          for (let m = 0; m < riverMouths.length; m++) {
            const dxm = riverMouths[m].x - wx[i];
            const dym = riverMouths[m].y - wy[i];
            if (dxm * dxm + dym * dym < mouthClip2) { ok = false; break; }
          }
        }
        valid[i] = ok;
      }

      // Stroke each ocean run. Inner tiers stroke continuously; outer tiers
      // dash up with random gaps so rings break apart further from coast.
      let i = 0;
      while (i < N) {
        while (i < N && !valid[i]) i++;
        let j = i;
        while (j < N && valid[j]) j++;
        const runStart = i, runEnd = j;
        if (runEnd - runStart >= 2) {
          if (t.breakProb === 0) {
            ctx.beginPath();
            ctx.moveTo(wx[runStart] * waveScale, wy[runStart] * waveScale);
            for (let q = runStart + 1; q < runEnd; q++) {
              ctx.lineTo(wx[q] * waveScale, wy[q] * waveScale);
            }
            ctx.stroke();
          } else {
            let cur = runStart;
            while (cur < runEnd) {
              const dash = Math.max(2, t.dashMean + rng.uniformInt(-Math.round(t.dashMean * 0.4), Math.round(t.dashMean * 0.4) + 1));
              const end = Math.min(cur + dash, runEnd);
              if (rng.uniform() >= t.breakProb * 0.5 && end - cur >= 2) {
                ctx.beginPath();
                ctx.moveTo(wx[cur] * waveScale, wy[cur] * waveScale);
                for (let q = cur + 1; q < end; q++) {
                  ctx.lineTo(wx[q] * waveScale, wy[q] * waveScale);
                }
                ctx.stroke();
              }
              const gap = Math.max(1, t.gapMean + rng.uniformInt(-Math.round(t.gapMean * 0.6), Math.round(t.gapMean * 0.6) + 1));
              cur = end + gap;
            }
          }
        }
        i = runEnd + 1;
      }
    }
  }

  return { chains: null, polylines };
}

// ============================================================
// BIOMES, LAKES, PONDS
// ============================================================

// Axial cube distance between two offset-rows (odd-r) hexes, per BIOMES.md §2.
function hexCubeDistance(r1, c1, r2, c2) {
  const x1 = c1 - (r1 - (r1 & 1)) / 2;
  const z1 = r1;
  const y1 = -x1 - z1;
  const x2 = c2 - (r2 - (r2 & 1)) / 2;
  const z2 = r2;
  const y2 = -x2 - z2;
  return (Math.abs(x1 - x2) + Math.abs(y1 - y2) + Math.abs(z1 - z2)) / 2;
}

// Six neighbors as (r,c) pairs, for biome / lake adjacency work.
function hexNeighbors(r, c) {
  const out = new Array(6);
  for (let d = 0; d < 6; d++) out[d] = neighborOf(r, c, d);
  return out;
}

// Smooth a Map<"r,c", number> by averaging each hex with its in-set neighbors
// (weights: center 1.0, neighbors 0.5). Hexes outside `inSet` are ignored.
function smoothHexField(field, inSet, passes) {
  let cur = field;
  for (let p = 0; p < passes; p++) {
    const next = new Map();
    for (const [key, v] of cur) {
      const [r, c] = key.split(',').map(Number);
      let sum = v * 1.0;
      let wsum = 1.0;
      for (const n of hexNeighbors(r, c)) {
        const nk = `${n.r},${n.c}`;
        if (!inSet.has(nk)) continue;
        sum += cur.get(nk) * 0.5;
        wsum += 0.5;
      }
      next.set(key, sum / wsum);
    }
    cur = next;
  }
  return cur;
}

// Rank-normalize a Map<key, number> to [0, 1] by percentile.
function rankNormalize(field) {
  const entries = [...field.entries()];
  entries.sort((a, b) => a[1] - b[1]);
  const N = entries.length;
  const out = new Map();
  if (N === 0) return out;
  if (N === 1) { out.set(entries[0][0], 0.5); return out; }
  for (let i = 0; i < N; i++) out.set(entries[i][0], i / (N - 1));
  return out;
}

// Collect the set of land hexes the river passes through (any river).
function riverHexSet(rivers, water, gridOpts) {
  const set = new Set();
  if (!rivers) return set;
  for (const river of rivers) {
    if (!river || !river.points) continue;
    for (const p of river.points) {
      const h = hexAtPoint(p.x, p.y, gridOpts);
      if (!h) continue;
      const k = `${h.r},${h.c}`;
      if (water && water.has(k)) continue;
      set.add(k);
    }
  }
  return set;
}

// Compute elevation + moisture fields for every hex in landSet, per BIOMES.md §4.
// `coastWater` is the water set that defines coast adjacency (ocean only for the
// lake-placement pass; ocean+lakes for the final biome pass).
function computeScalarFields(biomeRng, landSet, coastWater, riverHexes, rows, cols) {
  const isOffGrid = (r, c) => r < 0 || r >= rows || c < 0 || c >= cols;
  const isCoastAdj = (r, c) => {
    for (const n of hexNeighbors(r, c)) {
      if (isOffGrid(n.r, n.c)) return true;
      if (coastWater && coastWater.has(`${n.r},${n.c}`)) return true;
    }
    return false;
  };
  const isRiverAdj = (r, c) => {
    const k = `${r},${c}`;
    if (riverHexes.has(k)) return true;
    for (const n of hexNeighbors(r, c)) {
      if (riverHexes.has(`${n.r},${n.c}`)) return true;
    }
    return false;
  };
  const isNearWater2 = (r, c) => {
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const nr = r + dr, nc = c + dc;
        if (isOffGrid(nr, nc)) continue;
        if (hexCubeDistance(r, c, nr, nc) > 2) continue;
        if (riverHexes.has(`${nr},${nc}`)) return true;
        if (coastWater && coastWater.has(`${nr},${nc}`)) return true;
      }
    }
    return false;
  };

  // Elevation
  let E = new Map();
  for (const key of landSet) E.set(key, biomeRng.normal());
  E = smoothHexField(E, landSet, 2);
  // Coast bias: subtract 0.6 from coast-adjacent, re-smooth one pass.
  const Ebias = new Map();
  for (const [key, v] of E) {
    const [r, c] = key.split(',').map(Number);
    Ebias.set(key, isCoastAdj(r, c) ? v - 0.6 : v);
  }
  E = smoothHexField(Ebias, landSet, 1);
  E = rankNormalize(E);

  // Moisture
  let M = new Map();
  for (const key of landSet) M.set(key, biomeRng.normal());
  M = smoothHexField(M, landSet, 2);
  const Mbias = new Map();
  for (const [key, v] of M) {
    const [r, c] = key.split(',').map(Number);
    let bonus = 0;
    const riverA = isRiverAdj(r, c);
    const coastA = isCoastAdj(r, c);
    if (riverA) bonus += 1.0;
    else if (coastA) bonus += 0.5;
    if (!riverA && !coastA && isNearWater2(r, c)) bonus += 0.25;
    Mbias.set(key, v + bonus);
  }
  M = rankNormalize(Mbias);

  return { E, M, isCoastAdj, isRiverAdj };
}

// Per BIOMES.md §5–6. Classify each land hex, clean up isolated mountains,
// place cities greedily under a 6-tile minimum spacing.
function classifyBiomes(biomeRng, landSet, E, M, isCoastAdj, isRiverAdj) {
  const baseTags = new Map();
  for (const key of landSet) {
    const [r, c] = key.split(',').map(Number);
    const e = E.get(key);
    const m = M.get(key);
    let tag;
    if (e >= 0.85) tag = 'mountains';
    else if (e >= 0.65) tag = 'hills';
    else if (m >= 0.80 && (isRiverAdj(r, c) || isCoastAdj(r, c))) tag = 'swamp';
    else if (m >= 0.55) tag = 'forest';
    else tag = 'plains';
    baseTags.set(key, tag);
  }
  // Mountain isolation pass: a mountains hex with no mountains/hills neighbor
  // becomes hills.
  for (const [key, tag] of baseTags) {
    if (tag !== 'mountains') continue;
    const [r, c] = key.split(',').map(Number);
    let touchesRange = false;
    for (const n of hexNeighbors(r, c)) {
      const t = baseTags.get(`${n.r},${n.c}`);
      if (t === 'mountains' || t === 'hills') { touchesRange = true; break; }
    }
    if (!touchesRange) baseTags.set(key, 'hills');
  }

  // City scoring + greedy placement
  const eligible = [];
  for (const [key, tag] of baseTags) {
    if (tag !== 'plains' && tag !== 'forest' && tag !== 'hills') continue;
    const [r, c] = key.split(',').map(Number);
    let score = 0;
    if (isRiverAdj(r, c)) score += 3;
    if (isCoastAdj(r, c)) score += 2;
    if (tag === 'plains') score += 2;
    else if (tag === 'hills') score += 1;
    score += biomeRng.uniform() * 0.5;
    eligible.push({ key, r, c, score });
  }
  eligible.sort((a, b) => b.score - a.score);
  const Ntarget = Math.max(1, Math.min(5, Math.round(landSet.size / 18)));
  const placed = [];
  for (const cand of eligible) {
    let ok = true;
    for (const p of placed) {
      if (hexCubeDistance(cand.r, cand.c, p.r, p.c) < 6) { ok = false; break; }
    }
    if (ok) {
      placed.push(cand);
      if (placed.length >= Ntarget) break;
    }
  }
  const tags = new Map(baseTags);
  const cities = placed.map(p => ({ r: p.r, c: p.c }));
  for (const p of placed) tags.set(p.key, 'city');
  return { tags, baseTags, cities };
}

// Pick 0–1 inland lakes of 1–3 hexes each. Inland = no neighbor is ocean and
// no neighbor is off-grid (lake hexes can be adjacent to lake hexes only, in
// addition to land). Seeded by low elevation + high moisture (basin-like).
function placeLakes(lakeRng, landSet, oceanWater, E, M, rows, cols) {
  const isOffGrid = (r, c) => r < 0 || r >= rows || c < 0 || c >= cols;
  // Eligibility for a single lake hex: must be land, no neighbor is ocean or
  // off-grid. This is the "fully inland" rule.
  const lakeEligible = (key) => {
    if (!landSet.has(key)) return false;
    const [r, c] = key.split(',').map(Number);
    for (const n of hexNeighbors(r, c)) {
      if (isOffGrid(n.r, n.c)) return false;
      if (oceanWater.has(`${n.r},${n.c}`)) return false;
    }
    return true;
  };

  // Score: prefer low E and high M. Also prefer being a local basin (E lower
  // than at least one neighbor that's also land — i.e. there's higher ground
  // nearby).
  const candidates = [];
  for (const key of landSet) {
    if (!lakeEligible(key)) continue;
    const e = E.get(key), m = M.get(key);
    if (e > 0.45) continue; // must be lowland
    if (m < 0.55) continue; // must be wet
    const [r, c] = key.split(',').map(Number);
    let basin = 0;
    for (const n of hexNeighbors(r, c)) {
      const nk = `${n.r},${n.c}`;
      if (landSet.has(nk) && E.get(nk) > e) basin++;
    }
    const score = (1 - e) * 1.2 + m * 1.0 + basin * 0.15 + lakeRng.uniform() * 0.2;
    candidates.push({ key, r, c, score, e });
  }
  if (candidates.length === 0) return new Set();
  candidates.sort((a, b) => b.score - a.score);

  // Occasionally produce no lake at all even when a candidate exists, so the
  // 0–1 count truly varies. Bias toward producing when there is a strong
  // candidate (high score).
  const top = candidates[0];
  const formProb = Math.min(0.85, 0.35 + top.score * 0.25);
  if (lakeRng.uniform() > formProb) return new Set();

  // Grow the lake from the seed by adding 0–2 more hexes from neighbors that
  // are also lake-eligible and basin-like.
  const lake = new Set([top.key]);
  const targetSize = 1 + Math.floor(lakeRng.uniform() * 3); // 1..3
  let frontier = [top];
  while (lake.size < targetSize && frontier.length > 0) {
    // Expand from a random frontier hex.
    const idx = Math.floor(lakeRng.uniform() * frontier.length);
    const cur = frontier[idx];
    frontier.splice(idx, 1);
    const ncands = [];
    for (const n of hexNeighbors(cur.r, cur.c)) {
      const nk = `${n.r},${n.c}`;
      if (lake.has(nk)) continue;
      if (!lakeEligible(nk)) continue;
      // Also forbid: any of n's neighbors is ocean (already enforced by
      // lakeEligible) — and the resulting lake's perimeter must still be
      // inland after adding n. lakeEligible(nk) covers that for n itself.
      const e = E.get(nk), m = M.get(nk);
      if (e > 0.50 || m < 0.45) continue;
      ncands.push({ key: nk, r: n.r, c: n.c, e, m });
    }
    if (ncands.length === 0) continue;
    ncands.sort((a, b) => (a.e - b.e) + (b.m - a.m));
    const pick = ncands[0];
    lake.add(pick.key);
    frontier.push(pick);
  }
  return lake;
}

// Find each river endpoint that lands in an inland hex (not ocean, not
// coast-adjacent, not off-grid). For tributaries that join a parent river,
// the join end (last point) is skipped — only the source end is a candidate.
function findRiverTerminusEndpoints(rivers, oceanWater, rows, cols, gridOpts) {
  const isOffGrid = (r, c) => r < 0 || r >= rows || c < 0 || c >= cols;
  const out = [];
  for (let ri = 0; ri < rivers.length; ri++) {
    const river = rivers[ri];
    if (!river || !river.points || river.points.length < 2) continue;
    const pts = river.points;
    const ends = [{ side: 'start', p: pts[0] }];
    if (river.parentIndex == null) ends.push({ side: 'end', p: pts[pts.length - 1] });
    for (const e of ends) {
      const h = hexAtPoint(e.p.x, e.p.y, gridOpts);
      if (!h) continue;
      const k = `${h.r},${h.c}`;
      if (oceanWater.has(k)) continue;
      let coastAdj = false;
      for (const n of hexNeighbors(h.r, h.c)) {
        if (isOffGrid(n.r, n.c)) { coastAdj = true; break; }
        if (oceanWater.has(`${n.r},${n.c}`)) { coastAdj = true; break; }
      }
      if (coastAdj) continue;
      out.push({ r: h.r, c: h.c, riverIdx: ri, side: e.side });
    }
  }
  return out;
}

// Grow a 1–2 hex lake at each inland river endpoint. Hexes already in
// `existingLake` (scenic lake) or in another terminus lake are skipped.
function placeTerminusLakes(terminusRng, endpoints, oceanWater, existingLake, rows, cols) {
  const isOffGrid = (r, c) => r < 0 || r >= rows || c < 0 || c >= cols;
  const inlandEligible = (r, c) => {
    for (const n of hexNeighbors(r, c)) {
      if (isOffGrid(n.r, n.c)) return false;
      if (oceanWater.has(`${n.r},${n.c}`)) return false;
    }
    return true;
  };
  const lakes = new Set();
  for (const ep of endpoints) {
    const k = `${ep.r},${ep.c}`;
    if (oceanWater.has(k)) continue;
    if (existingLake.has(k)) continue;
    if (lakes.has(k)) continue;
    if (!inlandEligible(ep.r, ep.c)) continue;
    lakes.add(k);
    // 50% chance to grow to 2 hexes, if a neighbor is also fully inland.
    if (terminusRng.uniform() < 0.5) {
      const ncands = [];
      for (const n of hexNeighbors(ep.r, ep.c)) {
        const nk = `${n.r},${n.c}`;
        if (oceanWater.has(nk)) continue;
        if (existingLake.has(nk)) continue;
        if (lakes.has(nk)) continue;
        if (!inlandEligible(n.r, n.c)) continue;
        ncands.push(nk);
      }
      if (ncands.length > 0) {
        const pick = ncands[Math.floor(terminusRng.uniform() * ncands.length)];
        lakes.add(pick);
      }
    }
  }
  return lakes;
}

// Pick up to 3 ponds: single sub-hex water features inside land hexes. Don't
// remove their hex from the land set — they are decorative. Avoid hexes that
// already have river, lake, city, or are at the coast, and keep them apart.
function placePonds(pondRng, landSet, lakeWater, tags, riverHexes, isCoastAdj, E, M) {
  const candidates = [];
  for (const key of landSet) {
    if (lakeWater.has(key)) continue;
    const t = tags.get(key);
    if (t === 'city' || t === 'mountains' || t === 'hills') continue;
    if (riverHexes.has(key)) continue;
    const [r, c] = key.split(',').map(Number);
    if (isCoastAdj(r, c)) continue;
    const e = E.get(key), m = M.get(key);
    if (m < 0.45) continue;
    if (e > 0.55) continue;
    const score = m * 1.2 + (1 - e) * 0.6 + pondRng.uniform() * 0.4;
    candidates.push({ key, r, c, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const Nmax = 3;
  // Probability per available slot — typically 0–3 ponds.
  const placed = [];
  for (const cand of candidates) {
    if (placed.length >= Nmax) break;
    let ok = true;
    for (const p of placed) {
      if (hexCubeDistance(cand.r, cand.c, p.r, p.c) < 3) { ok = false; break; }
    }
    if (!ok) continue;
    // Each candidate has ~55% chance of becoming a pond (decaying so we don't
    // always max out).
    const accept = 0.55 - placed.length * 0.12;
    if (pondRng.uniform() > accept) continue;
    placed.push(cand);
  }
  return placed.map(p => ({ r: p.r, c: p.c }));
}

// Draw a small irregular pond inside a hex: a wobbly closed outline plus 1–2
// concentric wave rings inside. Stroke only (no fill) to match the parchment
// ink aesthetic.
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
    // Offset the pond from hex center so it can spill into adjacent tiles.
    const offAng = rng.uniform() * Math.PI * 2;
    const offDist = rng.uniform() * HEX_SIZE * 0.35;
    const ox = center.x + Math.cos(offAng) * offDist;
    const oy = center.y + Math.sin(offAng) * offDist;
    // Pond outline: small, very blobby irregular shape.
    const baseR = HEX_SIZE * (0.30 + rng.uniform() * 0.15);
    const N = 12 + Math.floor(rng.uniform() * 8); // 12–19 samples
    const radii = new Array(N);
    for (let i = 0; i < N; i++) radii[i] = rng.normal();
    const sm = gaussianFilter1D(radii, 1.0);
    // Wrap-around smoothing pass so the loop closes seamlessly.
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
    // Outline
    ctx.lineWidth = Math.max(1, 6.0 * scale);
    ctx.beginPath();
    ctx.moveTo(pts[0].x * scale, pts[0].y * scale);
    for (let i = 1; i < N; i++) ctx.lineTo(pts[i].x * scale, pts[i].y * scale);
    ctx.closePath();
    ctx.stroke();

    // 1–2 interior wave rings, shrunk toward the centroid.
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

// ============================================================
// MOUNTAINS
// ============================================================
// Draw a single triangular peak with slightly curved slopes and fir-tick
// hash marks on both sides — matches the hand-drawn reference style.
function drawMountainPeak(ctx, peak, lineColor) {
  const { px, apexY, baseY, leftBaseX, rightBaseX, rng } = peak;

  const outlineWidth = Math.max(3.5, Math.min(6, HEX_SIZE * 0.10));
  const tickWidth = Math.max(2, Math.min(3.5, HEX_SIZE * 0.055));

  ctx.strokeStyle = lineColor;
  ctx.fillStyle = peak.fillColor; // parchment color; occludes peaks behind
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Slight inward curve on each slope: control point pulled toward the
  // peak's vertical axis to give a hand-drawn concave feel.
  const leftCtrlX = leftBaseX + (px - leftBaseX) * 0.55 + (rng.uniform() - 0.5) * HEX_SIZE * 0.04;
  const leftCtrlY = baseY + (apexY - baseY) * 0.35;
  const rightCtrlX = rightBaseX + (px - rightBaseX) * 0.55 + (rng.uniform() - 0.5) * HEX_SIZE * 0.04;
  const rightCtrlY = baseY + (apexY - baseY) * 0.35;

  // Fill first so the peak occludes anything drawn behind it.
  ctx.beginPath();
  ctx.moveTo(leftBaseX, baseY);
  ctx.quadraticCurveTo(leftCtrlX, leftCtrlY, px, apexY);
  ctx.quadraticCurveTo(rightCtrlX, rightCtrlY, rightBaseX, baseY);
  ctx.closePath();
  ctx.fill();

  // Stroke the two slopes (leave the base open — reference has no baseline).
  ctx.lineWidth = outlineWidth;
  ctx.beginPath();
  ctx.moveTo(leftBaseX, baseY);
  ctx.quadraticCurveTo(leftCtrlX, leftCtrlY, px, apexY);
  ctx.quadraticCurveTo(rightCtrlX, rightCtrlY, rightBaseX, baseY);
  ctx.stroke();

  // Fir-tick hash marks on the LEFT slope only, pointing outward & slightly
  // down, shorter near the apex and longer near the base.
  ctx.lineWidth = tickWidth;
  const baseX = leftBaseX;
  const ctrlX = leftCtrlX;
  const ctrlY = leftCtrlY;
  // Tick count scales with peak height: ~3 for short peaks, ~10 for tallest.
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
    // Outward (left of travel) for the left slope.
    const nx = -ty / tlen;
    const ny = tx / tlen;
    // Bias slightly downward so ticks droop like fir needles.
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

// Draw mountain chains across all mountain-biome hexes. Adjacent mountain
// hexes are grouped into connected chains, and each chain is drawn as a
// single continuous outline with hash marks on the left-facing slopes.
// Drawn AFTER the ink threshold pass.
function drawMountains(canvas, mountainHexes, opts = {}) {
  if (!mountainHexes || mountainHexes.length === 0) return;
  const ctx = canvas.getContext('2d');
  const seed = opts.seed ?? 0;
  const lineColor = opts.lineColor ?? '#2a2015';
  const fillColor = opts.fillColor ?? '#e8d5b7';

  // Group adjacent mountain hexes into connected chains using flood fill.
  const visited = new Set();
  const chains = [];

  for (const h of mountainHexes) {
    const key = `${h.r},${h.c}`;
    if (visited.has(key)) continue;

    // BFS to find connected component.
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

  // Build peaks for every hex, then draw back-to-front so closer peaks
  // visually occlude the ones behind them (the parchment fill in
  // drawMountainPeak handles the masking).
  const peaks = [];
  for (const chain of chains) {
    for (const h of chain) {
      // Each hex gets a cluster of 1-3 overlapping peaks.
      const peakCount = 1 + Math.floor(h.rng.uniform() * 3);
      // Spread peaks horizontally; scales with cluster size so larger groups
      // fan out beyond the hex footprint rather than piling on top of each other.
      const spread = HEX_SIZE * (0.95 + peakCount * 0.18);
      for (let i = 0; i < peakCount; i++) {
        // Bias height toward extremes (cubic skew) so each cluster mixes
        // squat foothills with tall spires instead of uniform mid-sized peaks.
        const hu = h.rng.uniform();
        const heightSkew = hu < 0.5
          ? Math.pow(hu * 2, 1.8) * 0.5            // 0 .. 0.5 (short half)
          : 1 - Math.pow((1 - hu) * 2, 1.8) * 0.5; // 0.5 .. 1 (tall half)
        const peakHeight = HEX_SIZE * 0.35 + heightSkew * 81; // ~19-100px
        // Width scales with height so taller peaks have proportionally wider
        // bases (no skinny spires); still independent jitter for variation.
        const widthJitter = 0.85 + h.rng.uniform() * 0.45; // 0.85x-1.30x
        const peakWidth = (HEX_SIZE * 0.45 + peakHeight * 0.85) * widthJitter;
        // Distribute peaks horizontally across the hex with jitter.
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

  // Back-to-front: peaks with higher apex (smaller baseY) drawn first
  // so peaks in front of them occlude properly.
  peaks.sort((a, b) => a.sortKey - b.sortKey);

  for (const p of peaks) {
    drawMountainPeak(ctx, p, lineColor);
  }
}

// ============================================================
// HILLS
// ============================================================
// Draw a single hill as a wavy multi-point curve (Catmull-Rom through key
// points so the line can have 1-2 humps and natural sinuous variation, like
// the reference). Rounded blob ends, horizontal hash marks beneath the left
// slope tucked INTO the hill body.
function drawHillBump(ctx, hill, lineColor) {
  const { leftBaseX, rightBaseX, points, rng } = hill;

  // Match mountain stroke weights so hills read at the same line thickness.
  const strokeWidth = Math.max(3.5, Math.min(6, HEX_SIZE * 0.10));
  const tickWidth = Math.max(2, Math.min(3.5, HEX_SIZE * 0.055));
  const width = rightBaseX - leftBaseX;

  ctx.strokeStyle = lineColor;
  ctx.fillStyle = hill.fillColor;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Catmull-Rom → cubic bezier segments through key points. Pads ends with
  // duplicates so the curve starts/ends exactly on the first/last point.
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

  // Sample curve densely for the occlusion mask (so it follows actual shape).
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

  // Parchment occlusion mask: curve offset upward, then back across below.
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

  // Main stroke.
  ctx.lineWidth = strokeWidth;
  ctx.beginPath();
  traceCurve(0);
  ctx.stroke();

  // Short angled hash marks beneath the LEFT slope, slanting down-right
  // (like the reference — small diagonal ticks tucked under the brush body).
  ctx.lineCap = 'round';
  ctx.lineWidth = tickWidth;
  const tickCount = 3 + Math.floor(rng.uniform() * 2); // 3-4 ticks per hill
  for (let ti = 0; ti < tickCount; ti++) {
    const frac = 0.10 + (ti / (tickCount - 1 || 1)) * 0.32;
    const idx = Math.min(samples.length - 1, Math.floor(frac * (samples.length - 1)));
    const p = samples[idx];
    const tickLen = width * (0.09 + rng.uniform() * 0.04);
    // Start just below the brush body, slant down-right ~25°.
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

// Draw hill clusters across all hill-biome hexes. Each hex gets a small
// cluster of 3-5 scattered hill bumps. Drawn AFTER the ink threshold pass.
function drawHills(canvas, hillHexes, opts = {}) {
  if (!hillHexes || hillHexes.length === 0) return;
  const ctx = canvas.getContext('2d');
  const seed = opts.seed ?? 0;
  const lineColor = opts.lineColor ?? '#2a2015';
  const fillColor = opts.fillColor ?? '#e8d5b7';

  // Flatten river centerlines into a point list for collision checks. Hills
  // try not to cross rivers — proposed positions whose arch bbox contains a
  // river point are rejected and re-sampled.
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

  // Build one single-hump arch hill at a given center+size.
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

      // Retry placement up to 6 times to find a spot that doesn't cross a
      // river. Hills with no clear spot are dropped (river runs through the
      // hex with no room on either side).
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

      // ~18% chance: spawn an overlapping companion hill. Its left tail
      // tucks under/behind the primary's right slope so the pair reads as
      // two overlapping arches — matches hills-double.png reference.
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

  // Back-to-front so nearer hills occlude farther ones.
  hills.sort((a, b) => a.sortKey - b.sortKey);
  for (const h of hills) {
    drawHillBump(ctx, h, lineColor);
  }
}

// ============================================================
// GRASS (plains biome)
// ============================================================
// One grass tuft: 3-5 tapered leaves splaying upward from a base point.
// Each leaf is a filled lens shape — base-left → tip → base-right via two
// quadratic curves, matching the brushy silhouette in Grass.png.
function drawGrassTuft(ctx, cx, baseY, size, rng) {
  const leafCount = 3 + Math.floor(rng.uniform() * 3); // 3-5 leaves
  const fanSpread = 70 + rng.uniform() * 30; // total fan arc in degrees
  for (let i = 0; i < leafCount; i++) {
    const t = leafCount === 1 ? 0.5 : i / (leafCount - 1);
    const angleDeg = -fanSpread / 2 + t * fanSpread + (rng.uniform() - 0.5) * 8;
    const angle = angleDeg * Math.PI / 180;
    const len = size * (0.85 + rng.uniform() * 0.30);
    const halfBase = size * (0.10 + rng.uniform() * 0.05);
    // Tip points along angle (0° = straight up).
    const tipX = cx + Math.sin(angle) * len;
    const tipY = baseY - Math.cos(angle) * len;
    // Perpendicular to leaf axis, for base width.
    const perpX = Math.cos(angle);
    const perpY = Math.sin(angle);
    const blX = cx - perpX * halfBase;
    const blY = baseY - perpY * halfBase;
    const brX = cx + perpX * halfBase;
    const brY = baseY + perpY * halfBase;
    // Control points push out at mid-leaf to give a slight belly.
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

// Sprinkle grass tufts across all plains-biome hexes. Drawn AFTER the ink
// threshold pass so tufts sit on top of grid lines like hills do.
function drawGrass(canvas, plainsHexes, opts = {}) {
  if (!plainsHexes || plainsHexes.length === 0) return;
  const ctx = canvas.getContext('2d');
  const seed = opts.seed ?? 0;
  const lineColor = opts.lineColor ?? '#2a2015';

  // River avoidance — tufts inside a river's swept area get dropped.
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
    const tuftCount = 2 + Math.floor(rng.uniform() * 2); // 2-3 tufts/hex
    for (let i = 0; i < tuftCount; i++) {
      // Sample inside an inscribed-circle radius so tufts stay clear of edges.
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
  // Ocean dimming. Hex grid for water hexes is rendered on a separate
  // (non-thresholded) canvas at native res so alpha actually shows up.
  // `oceanAlpha` is the multiplier (0..1) applied to ocean-hex strokes.
  // If `oceanAlpha == 0`, water hexes aren't drawn at all.
  const water = opts.water ?? null;
  const oceanAlpha = opts.oceanAlpha ?? 1.0;
  const oceanCanvas = opts.oceanCanvas ?? null;
  const oceanScale = opts.oceanScale ?? scale;

  const ctx = canvas.getContext('2d');
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 10;

  // Parse stroke color into RGB components
  const hex = strokeColor.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  // Optional secondary target (e.g. parchment canvas) for ocean hexes.
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
      // Render water hexes to the ocean canvas at native res with dimmed
      // alpha. Skip entirely when oceanAlpha is 0.
      if (isWater) {
        if (!oceanCtx || oceanAlpha <= 0) continue;
      }
      // Vignette fade is computed in the same coordinate space as the
      // target canvas it's drawn to.
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
}

// ============================================================
// COMPOSITED MAP RENDERER
//
// Strategy: paint parchment on low-res target. Render hex+river onto a
// transparent hi-res buffer, threshold to a binary mask, then composite
// over the parchment so the texture survives.
// ============================================================
const MIN_GRID = 6;
const MAX_GRID = 50;

function gridCanvasSize(rows, cols, originX, originY) {
  // Match the default 7x11 layout's margins: left=originX, top=originY,
  // right=100, bottom=12. Rightmost hex extent assumes at least one odd row
  // (true for rows >= 2), which is guaranteed since MIN_GRID is 6.
  const rightExtent = originX + (cols - 1) * HEX_W + HEX_W;
  const bottomExtent = originY + (rows - 1) * 0.75 * HEX_H + HEX_H / 2;
  return { W: Math.ceil(rightExtent + 100), H: Math.ceil(bottomExtent + 12) };
}

function renderMap(opts = {}) {
  const rows = opts.rows ?? DEFAULT_ROWS;
  const cols = opts.cols ?? DEFAULT_COLS;
  if (rows < MIN_GRID || rows > MAX_GRID || cols < MIN_GRID || cols > MAX_GRID) {
    throw new Error(`rows/cols must be in [${MIN_GRID}, ${MAX_GRID}] (got rows=${rows}, cols=${cols})`);
  }
  const originX = opts.originX ?? DEFAULT_GRID_ORIGIN_X;
  const originY = opts.originY ?? DEFAULT_GRID_ORIGIN_Y;
  const auto = gridCanvasSize(rows, cols, originX, originY);
  const W = opts.width ?? auto.W;
  const H = opts.height ?? auto.H;
  const gridOpts = { rows, cols, originX, originY };
  // node-canvas caps any dimension at 32767 px, and getImageData uses a
  // Buffer whose length must fit in a signed 32-bit int (<2^31 bytes).
  // Scale supersample down so the hi-res buffer fits both limits.
  const CANVAS_DIM_MAX = 32767;
  const BUFFER_MAX = 2147483647;
  const maxByDim = Math.floor(CANVAS_DIM_MAX / Math.max(W, H));
  const maxByBuf = Math.floor(Math.sqrt(BUFFER_MAX / (W * H * 4)));
  const maxS = Math.max(1, Math.min(maxByDim, maxByBuf));
  const S = Math.min(opts.supersample ?? 8, maxS);
  const seed = opts.seed ?? 42;
  const drawGrid = opts.drawGrid ?? true;
  const drawOceanFlag = opts.drawOcean ?? true;
  const drawRiverFlag = opts.drawRiver ?? true;
  const riverParams = opts.riverParams ?? {};
  const gridParams = opts.gridParams ?? {};
  const riverPathOpts = opts.riverPathOpts ?? {};
  const oceanParams = opts.oceanParams ?? {};
  const sidesOverride = opts.sides;
  // Hex grid dimming for ocean tiles. 0 = no grid in ocean, 1 = same as land.
  const oceanGridOpacity = opts.oceanGridOpacity ?? 0.25;

  const out = createCanvas(W, H);
  paintParchment(out, { seed });

  const hi = createCanvas(W * S, H * S);
  const hiCtx = hi.getContext('2d');
  hiCtx.fillStyle = '#e8d5b7';
  hiCtx.fillRect(0, 0, W * S, H * S);

  let sel;
  let oceanInfo = null;
  let rivers = [];
  if (drawOceanFlag) {
    const oceanRng = createRng((seed * 0x85ebca6b) >>> 0 ^ 0xc2b2ae35);
    const sides = pickSides(oceanRng, sidesOverride);
    sel = selectWaterHexes(oceanRng, sides, { ...oceanParams, ...gridOpts });
    oceanInfo = { sides, waterCount: sel.water.size, waterFraction: sel.water.size / (rows * cols) };
  }
  // Ocean-only water set. `sel.water` is later expanded to ocean+lakes for
  // downstream coast/grid/river-clip drawing, but river trim and lake
  // placement need the pre-lake (ocean-only) snapshot.
  const oceanWater = sel ? new Set(sel.water) : new Set();

  // Generate rivers first so we can clip the coastline where they meet the river
  let riverInfo = null;
  if (drawRiverFlag) {
    rivers = generateRivers(seed, { ...riverPathOpts, ...gridOpts });
    riverInfo = {
      count: rivers.length,
      reached: rivers[0]?.reached ?? false,
      lengths: rivers.map(r => r.points.length),
    };
  }

  // Pre-build the OCEAN coast polylines so river trimming uses the ocean
  // outline for "near coast" mouth detection. After lakes are placed below
  // we rebuild a combined ocean+lake coast for the actual draw.
  let oceanCoastPolylines = null;
  if (drawOceanFlag && sel) {
    const segs = buildCoastlineSegments(oceanWater, { ...oceanParams, ...gridOpts });
    if (segs.length > 0) {
      const chs = stitchSegments(segs);
      const polyRng = createRng((seed * 0x9E3779B1) >>> 0 ^ 0x517cc1b7);
      oceanCoastPolylines = buildCoastPolylines(chs, polyRng, {
        amp: oceanParams.wiggleAmp ?? 5.5,
        samples: oceanParams.samples ?? 6,
      });
    }
  }
  let coastPolylines = oceanCoastPolylines;

  // Per-river: trim to land run, collect mouth points, build bank polygon.
  // Tributaries that never touch the ocean trim into a no-op and produce no
  // mouth points, which is exactly what we want. Bank polygons are computed
  // for every river — they're used both for coast clipping (ocean) and for
  // clipping child tributaries at the junction with their parent.
  const allMouthPoints = [];
  if (drawRiverFlag && rivers.length > 0) {
    const isOceanXY = (drawOceanFlag && sel)
      ? (x, y) => {
          const h = hexAtPoint(x, y, { ...oceanParams, ...gridOpts });
          if (h === null) return true;
          return sel.water.has(`${h.r},${h.c}`);
        }
      : null;
    const bandRadius = 5;
    const nearCoast = 22;
    const near2 = nearCoast * nearCoast;
    const isNearCoast = (p) => {
      if (!coastPolylines) return true;
      for (const poly of coastPolylines) {
        for (let j = 0; j < poly.length; j++) {
          const dx = poly[j].x - p.x, dy = poly[j].y - p.y;
          if (dx * dx + dy * dy < near2) return true;
        }
      }
      return false;
    };

    for (let ri = 0; ri < rivers.length; ri++) {
      let river = rivers[ri];
      if (!river || river.points.length === 0) continue;

      if (isOceanXY) {
        const pts = river.points;
        let bestStart = -1, bestEnd = -1, bestLen = 0;
        let curStart = -1;
        for (let i = 0; i < pts.length; i++) {
          const land = !isOceanXY(pts[i].x, pts[i].y);
          if (land) {
            if (curStart === -1) curStart = i;
            const len = i - curStart + 1;
            if (len > bestLen) { bestLen = len; bestStart = curStart; bestEnd = i; }
          } else {
            curStart = -1;
          }
        }
        if (bestStart < 0) { rivers[ri] = { ...river, points: [] }; continue; }
        const startIdx = Math.max(0, bestStart - 1);
        const endIdx = Math.min(pts.length - 1, bestEnd + 1);
        let trimmed = pts.slice(startIdx, endIdx + 1);
        const OCEAN_OVERSHOOT = 24;
        if (startIdx < bestStart && trimmed.length >= 2) {
          const a = trimmed[0], b = trimmed[1];
          const dx = a.x - b.x, dy = a.y - b.y;
          const L = Math.max(Math.hypot(dx, dy), 1e-6);
          trimmed.unshift({ x: a.x + dx / L * OCEAN_OVERSHOOT, y: a.y + dy / L * OCEAN_OVERSHOOT });
        }
        if (endIdx > bestEnd && trimmed.length >= 2) {
          const a = trimmed[trimmed.length - 1], b = trimmed[trimmed.length - 2];
          const dx = a.x - b.x, dy = a.y - b.y;
          const L = Math.max(Math.hypot(dx, dy), 1e-6);
          trimmed.push({ x: a.x + dx / L * OCEAN_OVERSHOOT, y: a.y + dy / L * OCEAN_OVERSHOOT });
        }
        river = { ...river, points: trimmed };
        rivers[ri] = river;

        const addBand = (centerIdx) => {
          const lo = Math.max(0, centerIdx - bandRadius);
          const hi = Math.min(pts.length - 1, centerIdx + bandRadius);
          for (let i = lo; i <= hi; i++) {
            if (isNearCoast(pts[i])) allMouthPoints.push({ x: pts[i].x, y: pts[i].y });
          }
        };
        if (startIdx < bestStart) addBand(bestStart);
        if (endIdx > bestEnd) addBand(bestEnd);
      }

    }
  }
  // Bank / water polygons are built later, after terminus lakes are placed
  // (so the river can be overshoot-extended into them like it is into ocean).

  // ------------------------------------------------------------
  // Biomes, lakes, ponds
  // ------------------------------------------------------------
  // Land set as seen *before* lake placement (ocean removed only).
  const landSetPre = new Set();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = `${r},${c}`;
      if (!oceanWater.has(k)) landSetPre.add(k);
    }
  }
  // Hexes the river passes through, computed from the *trimmed* river points.
  const riverHexes = riverHexSet(rivers, oceanWater, gridOpts);
  // Biome RNG — distinct stream from ocean/river/poly, per BIOMES.md §1.
  const biomeRng = createRng(((seed * 0xB5297A4D) >>> 0) ^ 0x68E31DA4);
  const preFields = computeScalarFields(biomeRng, landSetPre, oceanWater, riverHexes, rows, cols);
  const { E, M } = preFields;

  // Lake placement uses its own RNG so it doesn't perturb biomeRng state used
  // for city tie-breaking below.
  const lakeRng = createRng(((seed * 0x4A39E9B1) >>> 0) ^ 0x1A4E7777);
  const scenicLake = (landSetPre.size > 0)
    ? placeLakes(lakeRng, landSetPre, oceanWater, E, M, rows, cols)
    : new Set();
  // Terminus lakes: any inland river endpoint (not joined to a parent, not
  // ocean/coast-adjacent) gets a 1–2 hex lake. Separate budget from scenic.
  const terminusRng = createRng(((seed * 0x73E2C1A1) >>> 0) ^ 0x5E114AC0);
  const termEndpoints = drawRiverFlag
    ? findRiverTerminusEndpoints(rivers, oceanWater, rows, cols, gridOpts)
    : [];
  const terminusLake = placeTerminusLakes(terminusRng, termEndpoints, oceanWater, scenicLake, rows, cols);
  const lakeWater = new Set([...scenicLake, ...terminusLake]);

  // For each river endpoint that actually became a terminus lake hex, extend
  // the river's centerline by a short overshoot *into* the lake. This mirrors
  // the OCEAN_OVERSHOOT logic and ensures the river's bank polygon reaches the
  // lake's wavy coastline (otherwise the bank caps short of the hex boundary
  // and a small gap appears between the river and the lake coast).
  if (drawRiverFlag && terminusLake.size > 0) {
    const LAKE_OVERSHOOT = 24;
    for (const ep of termEndpoints) {
      const k = `${ep.r},${ep.c}`;
      if (!terminusLake.has(k)) continue;
      const river = rivers[ep.riverIdx];
      if (!river || !river.points || river.points.length < 2) continue;
      const pts = river.points;
      if (ep.side === 'start') {
        const a = pts[0], b = pts[1];
        const dx = a.x - b.x, dy = a.y - b.y;
        const L = Math.max(Math.hypot(dx, dy), 1e-6);
        pts.unshift({ x: a.x + dx / L * LAKE_OVERSHOOT, y: a.y + dy / L * LAKE_OVERSHOOT });
      } else {
        const a = pts[pts.length - 1], b = pts[pts.length - 2];
        const dx = a.x - b.x, dy = a.y - b.y;
        const L = Math.max(Math.hypot(dx, dy), 1e-6);
        pts.push({ x: a.x + dx / L * LAKE_OVERSHOOT, y: a.y + dy / L * LAKE_OVERSHOOT });
      }
    }
  }

  // Build bank/water polygons for every river now that all overshoots are in.
  const bankByIndex = new Array(rivers.length).fill(null);
  const waterByIndex = new Array(rivers.length).fill(null);
  if (drawRiverFlag) {
    for (let ri = 0; ri < rivers.length; ri++) {
      const river = rivers[ri];
      if (!river || !river.points || river.points.length < 2) continue;
      const geom = computeRiverGeometry(
        river.points,
        { ...riverParams },
        createRng((seed + ri * 0x9e3779b1) >>> 0),
      );
      bankByIndex[ri] = riverBankPolygon(geom);
      waterByIndex[ri] = riverWaterPolygon(geom);
    }
  }
  const allBankPolygons = bankByIndex.filter(b => b !== null);

  // Merge ocean + lake water for downstream coast/grid/river-clip drawing.
  const allWater = new Set([...oceanWater, ...lakeWater]);
  if (sel) sel.water = allWater;

  // Rebuild coast polylines from the combined water set so lakes get the same
  // coastline + wave-ring treatment as the ocean.
  if (lakeWater.size > 0 && drawOceanFlag) {
    const segs = buildCoastlineSegments(allWater, { ...oceanParams, ...gridOpts });
    if (segs.length > 0) {
      const chs = stitchSegments(segs);
      const polyRng = createRng((seed * 0x9E3779B1) >>> 0 ^ 0x517cc1b7);
      coastPolylines = buildCoastPolylines(chs, polyRng, {
        amp: oceanParams.wiggleAmp ?? 5.5,
        samples: oceanParams.samples ?? 6,
      });
    }
  }

  // For each lake-hex transition along a river, add mouth points so the wave
  // rings around the lake open up where the river enters/exits.
  if (lakeWater.size > 0 && drawRiverFlag && rivers.length > 0) {
    for (const river of rivers) {
      if (!river || !river.points || river.points.length < 2) continue;
      const pts = river.points;
      let prevInLake = null;
      for (let i = 0; i < pts.length; i++) {
        const h = hexAtPoint(pts[i].x, pts[i].y, gridOpts);
        const inLake = h ? lakeWater.has(`${h.r},${h.c}`) : false;
        if (prevInLake !== null && prevInLake !== inLake) {
          // Boundary crossing — add a short band of mouth points around it.
          const lo = Math.max(0, i - 3);
          const hi = Math.min(pts.length - 1, i + 3);
          for (let j = lo; j <= hi; j++) {
            allMouthPoints.push({ x: pts[j].x, y: pts[j].y });
          }
        }
        prevInLake = inLake;
      }
    }
  }

  // Final biome classification on land-minus-lakes, using E/M restricted to
  // the final land set. Adjacency now considers lakes as coast (so swamps
  // can form next to lakes and cities get the river/coast desirability bump).
  const landSetFinal = new Set();
  for (const k of landSetPre) if (!lakeWater.has(k)) landSetFinal.add(k);
  const isOffGrid = (r, c) => r < 0 || r >= rows || c < 0 || c >= cols;
  const isCoastAdjAll = (r, c) => {
    for (const n of hexNeighbors(r, c)) {
      if (isOffGrid(n.r, n.c)) return true;
      if (allWater.has(`${n.r},${n.c}`)) return true;
    }
    return false;
  };
  const isRiverAdjAll = (r, c) => {
    if (riverHexes.has(`${r},${c}`)) return true;
    for (const n of hexNeighbors(r, c)) {
      if (riverHexes.has(`${n.r},${n.c}`)) return true;
    }
    return false;
  };
  // Restrict E/M to the final land set.
  const Efinal = new Map();
  const Mfinal = new Map();
  for (const k of landSetFinal) {
    Efinal.set(k, E.get(k));
    Mfinal.set(k, M.get(k));
  }
  const biomesOut = classifyBiomes(biomeRng, landSetFinal, Efinal, Mfinal, isCoastAdjAll, isRiverAdjAll);

  // Pond placement.
  const pondRng = createRng(((seed * 0x6B5F2391) >>> 0) ^ 0x504E4242);
  const ponds = placePonds(pondRng, landSetFinal, lakeWater, biomesOut.tags, riverHexes, isCoastAdjAll, Efinal, Mfinal);

  const biomesInfo = {
    tags: biomesOut.tags,
    baseTags: biomesOut.baseTags,
    cities: biomesOut.cities,
    fields: { elevation: Efinal, moisture: Mfinal },
  };
  const lakesInfo = {
    hexes: [...lakeWater].map(k => {
      const [r, c] = k.split(',').map(Number);
      return { r, c };
    }),
    scenic: [...scenicLake].map(k => {
      const [r, c] = k.split(',').map(Number);
      return { r, c };
    }),
    terminus: [...terminusLake].map(k => {
      const [r, c] = k.split(',').map(Number);
      return { r, c };
    }),
  };
  const pondsInfo = { hexes: ponds };

  // Draw ocean (coast + waves) — coast and waves both rendered now;
  // rivers are drawn after and clipped to land hex polygons.
  if (drawOceanFlag && sel) {
    drawOcean(hi, sel.water, oceanInfo.sides, {
      ...oceanParams, ...gridOpts, seed, scale: S,
      waveCanvas: out, waveScale: 1,
      riverPoints: allMouthPoints.length ? allMouthPoints : null,
      riverBankPolygons: allBankPolygons.length ? allBankPolygons : null,
      prebuiltPolylines: coastPolylines,
    });
  } else if (drawOceanFlag) {
    drawOcean(hi, sel.water, oceanInfo.sides, {
      ...oceanParams, ...gridOpts, seed, scale: S,
      waveCanvas: out, waveScale: 1,
    });
  }

  if (drawGrid) {
    drawHexGrid(hi, {
      ...gridParams, ...gridOpts, scale: S,
      water: sel ? sel.water : null,
      oceanAlpha: oceanGridOpacity,
      oceanCanvas: out,
      oceanScale: 1,
    });
  }

  // Draw rivers. Each river's clip = land-hex region (with coast wiggle) MINUS
  // its parent's bank polygon. The minus is done by adding the parent polygon
  // to the same path and clipping with 'evenodd' — overlap flips out of the
  // clip. On landlocked maps we substitute the canvas rect as the base region.
  const addLandClipPath = () => {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!sel.water.has(`${r},${c}`)) {
          const center = hexCenter(r, c, gridOpts);
          const verts = hexVertices(center.x, center.y, HEX_SIZE);
          hiCtx.moveTo(verts[0].x * S, verts[0].y * S);
          for (let v = 1; v < 6; v++) hiCtx.lineTo(verts[v].x * S, verts[v].y * S);
          hiCtx.closePath();
        }
      }
    }
    if (coastPolylines) {
      const samples = (oceanParams.samples ?? 6);
      for (const poly of coastPolylines) {
        for (let i = 0; i + samples < poly.length; i += samples) {
          hiCtx.moveTo(poly[i].x * S, poly[i].y * S);
          for (let j = i + 1; j <= i + samples; j++) {
            hiCtx.lineTo(poly[j].x * S, poly[j].y * S);
          }
          hiCtx.closePath();
        }
      }
    }
  };

  // Per-river: children of this river (anyone who T-junctioned into it).
  // A child's bank polygon is subtracted from its parent's draw region so the
  // child's water punches a notch through the parent's bank at the mouth.
  const childrenByIndex = new Array(rivers.length).fill(null).map(() => []);
  for (let ri = 0; ri < rivers.length; ri++) {
    const p = rivers[ri]?.parentIndex;
    if (p != null) childrenByIndex[p].push(ri);
  }

  const addPolygonToPath = (poly) => {
    hiCtx.moveTo(poly[0].x * S, poly[0].y * S);
    for (let j = 1; j < poly.length; j++) {
      hiCtx.lineTo(poly[j].x * S, poly[j].y * S);
    }
    hiCtx.closePath();
  };

  if (drawRiverFlag) {
    for (let ri = 0; ri < rivers.length; ri++) {
      const river = rivers[ri];
      if (!river || !river.points || river.points.length < 2) continue;
      const parentIdx = river.parentIndex;
      const parentBank = parentIdx != null ? bankByIndex[parentIdx] : null;
      // Use each child's water polygon (inner edges) rather than its bank
      // polygon (outer edges) so the notch in the parent's bank matches the
      // child's water width — banks meet flush at the junction.
      const childBanks = childrenByIndex[ri]
        .map(ci => waterByIndex[ci])
        .filter(b => b !== null);
      const needsClip = (drawOceanFlag && sel) || parentBank || childBanks.length > 0;

      if (needsClip) {
        hiCtx.save();
        hiCtx.beginPath();
        if (drawOceanFlag && sel) {
          addLandClipPath();
        } else {
          hiCtx.rect(0, 0, W * S, H * S);
        }
        if (parentBank) addPolygonToPath(parentBank);
        for (const cb of childBanks) addPolygonToPath(cb);
        hiCtx.clip('evenodd');
      }

      drawRiver(hi, river.points,
        { ...riverParams, seed: (seed + ri * 0x9e3779b1) >>> 0, scale: S });

      if (needsClip) hiCtx.restore();
    }
  }

  // Draw ponds onto the hi-res mask buffer so they go through the same ink
  // threshold + parchment composite as rivers and coastlines.
  if (ponds.length > 0) {
    drawPonds(hi, ponds, { ...gridOpts, scale: S, seed });
  }

  // Collect mountain hexes — peaks themselves are drawn later onto the
  // parchment output (post-threshold) so they can fill with parchment color
  // and properly occlude rivers, grid, and each other.
  const mountainHexes = [];
  const hillHexes = [];
  const plainsHexes = [];
  for (const [key, tag] of biomesOut.tags) {
    const [r, c] = key.split(',').map(Number);
    if (tag === 'mountains') mountainHexes.push({ r, c });
    else if (tag === 'hills') hillHexes.push({ r, c });
    else if (tag === 'plains') plainsHexes.push({ r, c });
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

  // Mountains: drawn directly on parchment after the composite so their fill
  // (parchment-colored) occludes rivers, grid lines, and earlier peaks.
  if (plainsHexes.length > 0) {
    drawGrass(out, plainsHexes, { ...gridOpts, seed, rivers });
  }
  if (hillHexes.length > 0) {
    drawHills(out, hillHexes, { ...gridOpts, seed, rivers });
  }
  if (mountainHexes.length > 0) {
    drawMountains(out, mountainHexes, { ...gridOpts, seed });
  }

  // Vignette drawn last so it darkens everything at the edges.
  const vigCtx = out.getContext('2d');
  const vig = vigCtx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.75);
  vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vig.addColorStop(0.5, 'rgba(25, 15, 8, 0.15)');
  vig.addColorStop(1, 'rgba(25, 15, 8, 0.55)');
  vigCtx.fillStyle = vig;
  vigCtx.fillRect(0, 0, W, H);

  return {
    canvas: out,
    river: riverInfo,
    ocean: oceanInfo,
    biomes: biomesInfo,
    lakes: lakesInfo,
    ponds: pondsInfo,
  };
}

// ============================================================
// DEMO ENTRY POINT
// ============================================================
function parseCliArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eat = () => argv[++i];
    const m = /^--([a-zA-Z-]+)(?:=(.*))?$/.exec(a);
    if (!m) continue;
    const key = m[1];
    const val = m[2] !== undefined ? m[2] : eat();
    switch (key) {
      case 'size': {
        const n = parseInt(val, 10);
        out.rows = n; out.cols = n;
        break;
      }
      case 'rows': out.rows = parseInt(val, 10); break;
      case 'cols': out.cols = parseInt(val, 10); break;
      case 'seed': out.seed = parseInt(val, 10); break;
      case 'seeds': out.seeds = val.split(',').map(s => parseInt(s, 10)); break;
      case 'out': out.outPath = val; break;
      default: throw new Error(`Unknown flag: --${key}`);
    }
  }
  return out;
}

const DEMO_VARIANTS = [
  { rows: 6,  cols: 6,  seed: 42 },
  { rows: 8,  cols: 12, seed: 7 },
  { rows: 11, cols: 7,  seed: 1337 },
  { rows: 20, cols: 20, seed: 2024 },
  { rows: 14, cols: 36, seed: 88 },
  { rows: 36, cols: 14, seed: 256 },
  { rows: 50, cols: 50, seed: 512 },
];

function main() {
  const fs = require('fs');
  const cli = parseCliArgs(process.argv.slice(2));
  const explicit = cli.rows !== undefined || cli.cols !== undefined
    || cli.seed !== undefined || cli.seeds !== undefined || cli.outPath !== undefined;

  let runs;
  if (explicit) {
    const seeds = cli.seeds ?? (cli.seed !== undefined ? [cli.seed] : [42]);
    runs = seeds.map(seed => ({ seed, rows: cli.rows, cols: cli.cols, outPath: cli.outPath }));
  } else {
    runs = DEMO_VARIANTS.map(v => ({ ...v }));
  }

  for (const r of runs) {
    const { canvas, ocean } = renderMap({ seed: r.seed, rows: r.rows, cols: r.cols });
    const tag = (r.rows && r.cols) ? `${r.rows}x${r.cols}_` : '';
    const filename = r.outPath
      ?? `/Users/ace/code/inkdrifter/output_ocean_${tag}${r.seed}.png`;
    fs.writeFileSync(filename, canvas.toBuffer('image/png'));
    const sidesStr = ocean ? ocean.sides.join('') || 'none' : 'n/a';
    const pct = ocean ? (ocean.waterFraction * 100).toFixed(1) : 'n/a';
    console.log(`Saved ${filename} (seed=${r.seed}, ${canvas.width}x${canvas.height}, sides=[${sidesStr}], water=${pct}%)`);
  }
}

if (require.main === module) main();

module.exports = {
  // hex
  HEX_SIZE, HEX_W, HEX_H,
  hexCenter, hexVertices, buildVertexGraph,
  // rng / math
  createRng, gaussianFilter1D, jitter, blotSignal, weightedChoice,
  // paths
  randomRiverPath, hexEdgeCenterline, tributaryPath, tributaryCenterline,
  generateRivers, defaultRiverCount, densifyAndSmooth, resampleByArcLength,
  // ocean
  pickSides, selectWaterHexes, buildCoastlineSegments, stitchSegments, drawOcean,
  // rendering
  drawRiver, drawHexGrid, paintParchment, renderMap, drawMountains, drawHills,
};
