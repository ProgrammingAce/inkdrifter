const {
  HEX_SIZE, HEX_W, HEX_H,
  DEFAULT_COLS, DEFAULT_ROWS,
  DEFAULT_GRID_ORIGIN_X, DEFAULT_GRID_ORIGIN_Y,
} = require('./constants.js');

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

function hexCubeDistance(r1, c1, r2, c2) {
  const x1 = c1 - (r1 - (r1 & 1)) / 2;
  const z1 = r1;
  const y1 = -x1 - z1;
  const x2 = c2 - (r2 - (r2 & 1)) / 2;
  const z2 = r2;
  const y2 = -x2 - z2;
  return (Math.abs(x1 - x2) + Math.abs(y1 - y2) + Math.abs(z1 - z2)) / 2;
}

function hexNeighbors(r, c) {
  const out = new Array(6);
  for (let d = 0; d < 6; d++) out[d] = neighborOf(r, c, d);
  return out;
}

function hexNeighborsBounded(row, col, rows, cols) {
  const candidates = row % 2 === 0
    ? [[row - 1, col - 1], [row - 1, col], [row, col - 1], [row, col + 1], [row + 1, col - 1], [row + 1, col]]
    : [[row - 1, col], [row - 1, col + 1], [row, col - 1], [row, col + 1], [row + 1, col], [row + 1, col + 1]];
  return candidates.filter(([r, c]) => r >= 0 && r < rows && c >= 0 && c < cols);
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

module.exports = {
  hexCenter, hexVertices, vertexKeyStr, parseKey, buildVertexGraph,
  hexAtPoint, neighborOf,
  hexCubeDistance, hexNeighbors, hexNeighborsBounded,
  smoothHexField, rankNormalize,
  pointInPolygon,
};
