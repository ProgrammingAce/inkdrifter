const {
  hexAtPoint, hexNeighbors, hexCubeDistance,
  smoothHexField, rankNormalize,
} = require('./hex.js');

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

  let E = new Map();
  for (const key of landSet) E.set(key, biomeRng.normal());
  E = smoothHexField(E, landSet, 2);
  const Ebias = new Map();
  for (const [key, v] of E) {
    const [r, c] = key.split(',').map(Number);
    Ebias.set(key, isCoastAdj(r, c) ? v - 0.6 : v);
  }
  E = smoothHexField(Ebias, landSet, 1);
  E = rankNormalize(E);

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

function classifyBiomes(biomeRng, landSet, E, M, isCoastAdj, isRiverAdj, opts = {}) {
  const placeCities = opts.placeCities ?? true;
  const eBias = opts.elevationBias ?? 0;
  const mBias = opts.humidityBias ?? 0;
  const tMountain = 0.85 - eBias;
  const tHills = 0.65 - eBias;
  const tSwamp = 0.80 - mBias;
  const tForest = 0.55 - mBias;
  const baseTags = new Map();
  for (const key of landSet) {
    const [r, c] = key.split(',').map(Number);
    const e = E.get(key);
    const m = M.get(key);
    let tag;
    if (e >= tMountain) tag = 'mountains';
    else if (e >= tHills) tag = 'hills';
    else if (m >= tSwamp && (isRiverAdj(r, c) || isCoastAdj(r, c))) tag = 'swamp';
    else if (m >= tForest) tag = 'forest';
    else tag = 'plains';
    baseTags.set(key, tag);
  }
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

  if (!placeCities) {
    return { tags: new Map(baseTags), baseTags, cities: [] };
  }

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
  const autoTarget = Math.max(1, Math.min(5, Math.round(landSet.size / 18)));
  const Ntarget = opts.cityCount != null
    ? Math.max(0, Math.min(eligible.length, opts.cityCount))
    : autoTarget;
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

function placeLakes(lakeRng, landSet, oceanWater, E, M, rows, cols) {
  const isOffGrid = (r, c) => r < 0 || r >= rows || c < 0 || c >= cols;
  const lakeEligible = (key) => {
    if (!landSet.has(key)) return false;
    const [r, c] = key.split(',').map(Number);
    for (const n of hexNeighbors(r, c)) {
      if (isOffGrid(n.r, n.c)) return false;
      if (oceanWater.has(`${n.r},${n.c}`)) return false;
    }
    return true;
  };

  const candidates = [];
  for (const key of landSet) {
    if (!lakeEligible(key)) continue;
    const e = E.get(key), m = M.get(key);
    if (e > 0.45) continue;
    if (m < 0.55) continue;
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

  const top = candidates[0];
  const formProb = Math.min(0.85, 0.35 + top.score * 0.25);
  if (lakeRng.uniform() > formProb) return new Set();

  const lake = new Set([top.key]);
  const targetSize = 1 + Math.floor(lakeRng.uniform() * 3);
  let frontier = [top];
  while (lake.size < targetSize && frontier.length > 0) {
    const idx = Math.floor(lakeRng.uniform() * frontier.length);
    const cur = frontier[idx];
    frontier.splice(idx, 1);
    const ncands = [];
    for (const n of hexNeighbors(cur.r, cur.c)) {
      const nk = `${n.r},${n.c}`;
      if (lake.has(nk)) continue;
      if (!lakeEligible(nk)) continue;
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
  const placed = [];
  for (const cand of candidates) {
    if (placed.length >= Nmax) break;
    let ok = true;
    for (const p of placed) {
      if (hexCubeDistance(cand.r, cand.c, p.r, p.c) < 3) { ok = false; break; }
    }
    if (!ok) continue;
    const accept = 0.55 - placed.length * 0.12;
    if (pondRng.uniform() > accept) continue;
    placed.push(cand);
  }
  return placed.map(p => ({ r: p.r, c: p.c }));
}

module.exports = {
  riverHexSet, computeScalarFields, classifyBiomes,
  placeLakes, findRiverTerminusEndpoints, placeTerminusLakes,
  placePonds,
};
