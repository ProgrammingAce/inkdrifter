// Pack/unpack a map seed + settings into a single base36 string.
// Layout (LSB first, 84 bits total):
//   seed(32) rows-6(6) cols-6(6) oceanCapPct(7) cityCount(5)
//   riverPlus1(5, 0=auto) elevation(7) humidity(7)
//   drawOcean(1) drawRiver(1) drawGrid(1) islands(1) coastAuto(1)
//   coastSides(4) [N=8,S=4,E=2,W=1]

const PACKED_LEN = 17; // base36 chars; 36^17 > 2^84

const SIDE_BIT = { N: 8, S: 4, E: 2, W: 1 };

function clampInt(n, lo, hi) {
  n = Math.round(Number(n));
  if (!Number.isFinite(n)) n = lo;
  return Math.max(lo, Math.min(hi, n));
}

function biasToPct(bias) {
  // Inverse of (pct-50)/100*0.6 → pct = 50 + bias/0.6*100
  return clampInt(50 + (Number(bias) || 0) / 0.6 * 100, 0, 100);
}

function pctToBias(pct) {
  return (pct - 50) / 100 * 0.6;
}

export function encodePackedSeed({ seed, rows, cols, options = {} }) {
  const o = options;
  const oceanCapPct = clampInt(((o.oceanCap ?? 0.40) * 100), 5, 80);
  const cityCount = clampInt(o.cityCount ?? 5, 0, 20);
  const riverPlus1 = (o.riverCount == null) ? 0 : clampInt(o.riverCount, 0, 20) + 1;
  const elevation = biasToPct(o.elevationBias);
  const humidity = biasToPct(o.humidityBias);
  const drawOcean = o.drawOcean === false ? 0 : 1;
  const drawRiver = o.drawRiver === false ? 0 : 1;
  const drawGrid = o.drawGrid === false ? 0 : 1;
  const islands = o.islands ? 1 : 0;
  const sides = o.coastSides ?? o.sides;
  const coastAuto = Array.isArray(sides) ? 0 : 1;
  let sideMask = 0;
  if (Array.isArray(sides)) {
    for (const s of sides) sideMask |= SIDE_BIT[s] || 0;
  }

  let bits = 0n;
  let off = 0n;
  const push = (val, width) => {
    const w = BigInt(width);
    const mask = (1n << w) - 1n;
    bits |= (BigInt(val) & mask) << off;
    off += w;
  };

  push(clampInt(seed, 0, 0xFFFFFFFF) >>> 0, 32);
  push(clampInt(rows, 6, 50) - 6, 6);
  push(clampInt(cols, 6, 50) - 6, 6);
  push(oceanCapPct, 7);
  push(cityCount, 5);
  push(riverPlus1, 5);
  push(elevation, 7);
  push(humidity, 7);
  push(drawOcean, 1);
  push(drawRiver, 1);
  push(drawGrid, 1);
  push(islands, 1);
  push(coastAuto, 1);
  push(sideMask, 4);

  return bits.toString(36).padStart(PACKED_LEN, '0').toUpperCase();
}

export function decodePackedSeed(str) {
  if (typeof str !== 'string') return null;
  const s = str.trim().toLowerCase();
  if (!/^[0-9a-z]+$/.test(s)) return null;
  if (s.length < 11 || s.length > PACKED_LEN) return null;
  let bits = 0n;
  for (const ch of s) {
    const d = parseInt(ch, 36);
    if (Number.isNaN(d)) return null;
    bits = bits * 36n + BigInt(d);
  }
  if (bits >> 84n !== 0n) return null;

  let off = 0n;
  const pop = (width) => {
    const w = BigInt(width);
    const mask = (1n << w) - 1n;
    const v = Number((bits >> off) & mask);
    off += w;
    return v;
  };

  const seed = pop(32) >>> 0;
  const rows = pop(6) + 6;
  const cols = pop(6) + 6;
  const oceanCapPct = pop(7);
  const cityCount = pop(5);
  const riverPlus1 = pop(5);
  const elevation = pop(7);
  const humidity = pop(7);
  const drawOcean = !!pop(1);
  const drawRiver = !!pop(1);
  const drawGrid = !!pop(1);
  const islands = !!pop(1);
  const coastAuto = !!pop(1);
  const sideMask = pop(4);

  const options = {
    drawOcean, drawRiver, drawGrid, islands,
    oceanCap: oceanCapPct / 100,
    cityCount,
    elevationBias: pctToBias(elevation),
    humidityBias: pctToBias(humidity),
  };
  if (riverPlus1 > 0) options.riverCount = riverPlus1 - 1;
  if (!coastAuto) {
    const sides = [];
    if (sideMask & SIDE_BIT.N) sides.push('N');
    if (sideMask & SIDE_BIT.S) sides.push('S');
    if (sideMask & SIDE_BIT.E) sides.push('E');
    if (sideMask & SIDE_BIT.W) sides.push('W');
    options.coastSides = sides;
  }
  return { seed, rows, cols, options };
}

// Heuristic: a "packed" seed is anything non-numeric (contains letters) or
// long enough to be the packed form. Pure short numeric input is treated as
// a legacy raw uint32 seed.
export function looksPacked(str) {
  if (typeof str !== 'string') return false;
  const s = str.trim();
  if (s === '') return false;
  if (/^\d+$/.test(s) && s.length <= 10) return false;
  return /^[0-9a-zA-Z]+$/.test(s) && s.length >= 11 && s.length <= PACKED_LEN;
}
