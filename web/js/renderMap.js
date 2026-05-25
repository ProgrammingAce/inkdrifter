import {
  HEX_SIZE,
  DEFAULT_COLS, DEFAULT_ROWS,
  DEFAULT_GRID_ORIGIN_X, DEFAULT_GRID_ORIGIN_Y,
  MIN_GRID, MAX_GRID,
  gridCanvasSize,
} from './hex-constants.js';

import {
  createRng,
  gaussianFilter1D,
  jitter,
  blotSignal,
  weightedChoice,
} from '../../src/rng.js';

import {
  hexCenter, hexVertices, hexAtPoint, hexNeighbors,
} from '../../src/hex.js';

import {
  generateRivers, computeRiverGeometry, riverBankPolygon, riverWaterPolygon,
} from '../../src/rivers.js';

import {
  pickSides, selectWaterHexes, selectIslands,
  buildCoastlineSegments, stitchSegments, buildCoastPolylines,
} from '../../src/ocean.js';

import {
  riverHexSet, computeScalarFields, classifyBiomes,
  placeLakes, findRiverTerminusEndpoints, placeTerminusLakes,
  placePonds,
} from '../../src/biomes.js';

import {
  drawOcean,
} from '../../src/ocean.js';

import { drawRiver } from '../../src/rivers.js';
import { drawHexGrid, paintParchment } from '../../src/grid.js';
import { drawPonds, drawMountains, drawHills, drawGrass, drawForests, drawSwamps } from '../../src/terrain/index.js';
import { drawCities } from '../../src/cities.js';

export function renderMap(opts = {}) {
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
  const placeCities = opts.placeCities ?? true;
  const riverParams = opts.riverParams ?? {};
  const gridParams = opts.gridParams ?? {};
  const riverPathOpts = { ...(opts.riverPathOpts ?? {}) };
  if (opts.riverCount != null) riverPathOpts.riverCount = opts.riverCount;
  const oceanParams = { ...(opts.oceanParams ?? {}) };
  if (opts.oceanCap != null) oceanParams.cap = opts.oceanCap;
  const sidesOverride = opts.sides;
  const oceanGridOpacity = opts.oceanGridOpacity ?? 0.25;

  // Create browser canvases
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;

  paintParchment(out, { seed });

  const hi = document.createElement('canvas');
  hi.width = W * S;
  hi.height = H * S;
  const hiCtx = hi.getContext('2d');
  hiCtx.fillStyle = '#e8d5b7';
  hiCtx.fillRect(0, 0, W * S, H * S);

  let sel;
  let oceanInfo = null;
  let rivers = [];
  if (drawOceanFlag) {
    const oceanRng = createRng((seed * 0x85ebca6b) >>> 0 ^ 0xc2b2ae35);
    if (opts.islands) {
      sel = selectIslands(oceanRng, { ...oceanParams, ...gridOpts });
      oceanInfo = { sides: [], waterCount: sel.water.size, waterFraction: sel.water.size / (rows * cols), islands: true };
    } else {
      const sides = pickSides(oceanRng, sidesOverride);
      sel = selectWaterHexes(oceanRng, sides, { ...oceanParams, ...gridOpts });
      oceanInfo = { sides, waterCount: sel.water.size, waterFraction: sel.water.size / (rows * cols) };
    }
  }
  const oceanWater = sel ? new Set(sel.water) : new Set();

  let riverInfo = null;
  if (drawRiverFlag) {
    rivers = generateRivers(seed, { ...riverPathOpts, ...gridOpts });
    riverInfo = {
      count: rivers.length,
      reached: rivers[0]?.reached ?? false,
      lengths: rivers.map(r => r.points.length),
    };
  }

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

  const landSetPre = new Set();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = `${r},${c}`;
      if (!oceanWater.has(k)) landSetPre.add(k);
    }
  }
  const riverHexes = riverHexSet(rivers, oceanWater, gridOpts);
  const biomeRng = createRng(((seed * 0xB5297A4D) >>> 0) ^ 0x68E31DA4);
  const preFields = computeScalarFields(biomeRng, landSetPre, oceanWater, riverHexes, rows, cols);
  const { E, M } = preFields;

  const lakeRng = createRng(((seed * 0x4A39E9B1) >>> 0) ^ 0x1A4E7777);
  const scenicLake = (landSetPre.size > 0)
    ? placeLakes(lakeRng, landSetPre, oceanWater, E, M, rows, cols)
    : new Set();
  const terminusRng = createRng(((seed * 0x73E2C1A1) >>> 0) ^ 0x5E114AC0);
  const termEndpoints = drawRiverFlag
    ? findRiverTerminusEndpoints(rivers, oceanWater, rows, cols, gridOpts)
    : [];
  const terminusLake = placeTerminusLakes(terminusRng, termEndpoints, oceanWater, scenicLake, rows, cols);
  const lakeWater = new Set([...scenicLake, ...terminusLake]);

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

  const allWater = new Set([...oceanWater, ...lakeWater]);
  if (sel) sel.water = allWater;

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

  if (lakeWater.size > 0 && drawRiverFlag && rivers.length > 0) {
    for (const river of rivers) {
      if (!river || !river.points || river.points.length < 2) continue;
      const pts = river.points;
      let prevInLake = null;
      for (let i = 0; i < pts.length; i++) {
        const h = hexAtPoint(pts[i].x, pts[i].y, gridOpts);
        const inLake = h ? lakeWater.has(`${h.r},${h.c}`) : false;
        if (prevInLake !== null && prevInLake !== inLake) {
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
  const Efinal = new Map();
  const Mfinal = new Map();
  for (const k of landSetFinal) {
    Efinal.set(k, E.get(k));
    Mfinal.set(k, M.get(k));
  }
  const biomesOut = classifyBiomes(biomeRng, landSetFinal, Efinal, Mfinal, isCoastAdjAll, isRiverAdjAll, {
    placeCities,
    cityCount: opts.cityCount,
    elevationBias: opts.elevationBias ?? 0,
    humidityBias: opts.humidityBias ?? 0,
  });

  const pondRng = createRng(((seed * 0x6B5F2391) >>> 0) ^ 0x504E4242);
  const ponds = placePonds(pondRng, landSetFinal, lakeWater, biomesOut.tags, riverHexes, isCoastAdjAll, Efinal, Mfinal);

  const biomesInfo = {
    tags: biomesOut.tags,
    baseTags: biomesOut.baseTags,
    cities: biomesOut.cities,
    fields: { elevation: Efinal, moisture: Mfinal },
  };

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

  if (ponds.length > 0) {
    drawPonds(hi, ponds, { ...gridOpts, scale: S, seed });
  }

  const mountainHexes = [];
  const hillHexes = [];
  const plainsHexes = [];
  const forestHexes = [];
  const cityHexes = [];
  const swampHexes = [];
  for (const [key, tag] of biomesOut.tags) {
    const [r, c] = key.split(',').map(Number);
    if (tag === 'mountains') mountainHexes.push({ r, c });
    else if (tag === 'hills') hillHexes.push({ r, c });
    else if (tag === 'plains') plainsHexes.push({ r, c });
    else if (tag === 'forest') forestHexes.push({ r, c });
    else if (tag === 'city') cityHexes.push({ r, c });
    else if (tag === 'swamp') swampHexes.push({ r, c });
  }

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

  const outCtx = out.getContext('2d');
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = 'high';
  outCtx.drawImage(hi, 0, 0, W * S, H * S, 0, 0, W, H);

  if (plainsHexes.length > 0) {
    drawGrass(out, plainsHexes, { ...gridOpts, seed, rivers });
  }
  if (hillHexes.length > 0) {
    drawHills(out, hillHexes, { ...gridOpts, seed, rivers, water: sel ? sel.water : null });
  }
  if (forestHexes.length > 0) {
    drawForests(out, forestHexes, { ...gridOpts, seed, rivers, ponds, lakesInfo: { hexes: [], scenic: [], terminus: [] } });
  }
  if (mountainHexes.length > 0) {
    drawMountains(out, mountainHexes, { ...gridOpts, seed });
  }
  if (cityHexes.length > 0) {
    drawCities(out, cityHexes, { ...gridOpts, seed, rivers, capital: biomesOut.cities[0] });
  }
  if (swampHexes.length > 0) {
    drawSwamps(out, swampHexes, { ...gridOpts, seed, rivers });
  }

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
  };
}
