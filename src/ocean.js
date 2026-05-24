const {
  HEX_SIZE, DEFAULT_COLS, DEFAULT_ROWS,
} = require('./constants.js');
const { createRng, gaussianFilter1D, weightedChoice } = require('./rng.js');
const {
  hexCenter, hexVertices, vertexKeyStr, neighborOf, hexAtPoint, pointInPolygon,
} = require('./hex.js');

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

// Islands-only generation: water everywhere except a few small interior
// land clusters. Returns the same shape as selectWaterHexes so downstream
// code (coastline, biomes, lakes, rivers) doesn't need to branch.
function selectIslands(rng, opts = {}) {
  const rows = opts.rows ?? DEFAULT_ROWS;
  const cols = opts.cols ?? DEFAULT_COLS;
  const total = rows * cols;
  // Keep at least 2 hexes of water between any land and the map edge so islands
  // visually sit in open ocean rather than crowding the canvas border.
  const margin = 2;

  // Several substantial islands sitting in open sea: ~1 island per 30 hexes
  // (no upper cap — bigger maps get proportionally more islands), total land
  // ~18-30% of the map, ~6-14 hexes per island.
  const islandCount = Math.max(2, Math.floor(total / 30));
  const targetLand = Math.floor(total * (0.18 + rng.uniform() * 0.12));
  const sizePer = Math.max(6, Math.min(14, Math.floor(targetLand / islandCount)));

  const land = new Set();
  const interiorRows = rows - margin * 2;
  const interiorCols = cols - margin * 2;
  if (interiorRows <= 0 || interiorCols <= 0) {
    return { water: new Set(), profiles: {}, sides: [] };
  }

  // `buffer` = land hexes + 1-hex ring around them. New hexes (seed or growth)
  // can't enter another island's buffer, which keeps islands edge-separated AND
  // vertex-separated. Without this, two islands could share a vertex, and the
  // coastline stitcher would walk from one island's perimeter into the other's,
  // breaking the closed outline.
  const buffer = new Set();
  const addToBuffer = (r, c) => {
    buffer.add(`${r},${c}`);
    for (let i = 0; i < 6; i++) {
      const n = neighborOf(r, c, i);
      buffer.add(`${n.r},${n.c}`);
    }
  };

  let placed = 0;
  for (let attempt = 0; placed < islandCount && attempt < islandCount * 20; attempt++) {
    const r = margin + Math.floor(rng.uniform() * interiorRows);
    const c = margin + Math.floor(rng.uniform() * interiorCols);
    const seedKey = `${r},${c}`;
    if (buffer.has(seedKey)) continue;

    const targetSize = Math.max(2, Math.round(sizePer * (0.6 + rng.uniform() * 0.8)));
    const island = new Set([seedKey]);
    const frontier = [{ r, c }];
    while (island.size < targetSize && frontier.length > 0) {
      const fi = Math.floor(rng.uniform() * frontier.length);
      const cur = frontier.splice(fi, 1)[0];
      for (let i = 0; i < 6; i++) {
        const n = neighborOf(cur.r, cur.c, i);
        if (n.r < margin || n.r >= rows - margin || n.c < margin || n.c >= cols - margin) continue;
        const nk = `${n.r},${n.c}`;
        if (island.has(nk) || buffer.has(nk)) continue;
        if (rng.uniform() < 0.7) {
          island.add(nk);
          frontier.push({ r: n.r, c: n.c });
          if (island.size >= targetSize) break;
        }
      }
    }
    for (const k of island) {
      land.add(k);
      const [ir, ic] = k.split(',').map(Number);
      addToBuffer(ir, ic);
    }
    placed++;
  }

  const water = new Set();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = `${r},${c}`;
      if (!land.has(k)) water.add(k);
    }
  }
  return { water, profiles: {}, sides: [] };
}

function pointIsOcean(x, y, water, opts = {}) {
  const h = hexAtPoint(x, y, opts);
  if (h === null) return true;
  return water.has(`${h.r},${h.c}`);
}

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
      if (outOfBounds) continue;
      if (water.has(`${n.r},${n.c}`)) continue;
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
    const env = Math.sin(Math.PI * t);
    const w = Math.sin(phase + t * freq * Math.PI) + 0.45 * Math.sin(phase2 + t * freq * 2.0 * Math.PI);
    const offset = sign * env * amp * w * 0.55;
    out.push({
      x: p1.x + tx * len * t + nx * offset,
      y: p1.y + ty * len * t + ny * offset,
      wnx: nx, wny: ny,
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
  const waveCanvas = opts.waveCanvas ?? canvas;
  const waveCtx = waveCanvas.getContext('2d');
  const waveScale = opts.waveScale ?? opts.scale ?? 1;
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

  if (opts.skipWaves) return { chains, polylines };
  return drawCoastWaveRings(waveCtx, polylines, water, opts, {
    waveScale, lineColor,
    Wmax: W / scale, Hmax: H / scale,
  });
}

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

function drawCoastWaveRings(ctx, polylines, water, opts, env) {
  const { waveScale, lineColor, Wmax, Hmax } = env;
  const seed = opts.seed ?? 0;
  const rng = createRng((seed * 0x9E3779B1) >>> 0 ^ 0xA1B2C3D4);

  ctx.strokeStyle = lineColor;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const tiers = opts.waveTiers ?? [
    { dist: 12, width: 1.7, amp: 2.0, wavelen: 22, breakProb: 0.00, dashMean: 999, gapMean: 0  },
    { dist: 28, width: 1.4, amp: 2.4, wavelen: 26, breakProb: 0.05, dashMean: 12,  gapMean: 18 },
  ];

  const riverMouths = opts.riverPoints ?? null;
  const riverClipRadius = opts.riverClipRadius ?? 14;

  const tierBase = tiers.map((_, k) => {
    const sigmaN = 0.5 + k * 0.4;
    return polylines.map(poly => {
      if (poly.length < 4) return null;
      return {
        sx: poly.map(p => p.x),
        sy: poly.map(p => p.y),
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

module.exports = {
  pickSides, selectWaterHexes, selectIslands, pointIsOcean,
  buildCoastlineSegments, stitchSegments, buildCoastPolylines,
  drawOcean,
};
