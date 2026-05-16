export const HEX_SIZE = 54;
export const HEX_W = Math.sqrt(3) * HEX_SIZE;
export const HEX_H = 2 * HEX_SIZE;
export const DEFAULT_GRID_ORIGIN_X = 173;
export const DEFAULT_GRID_ORIGIN_Y = 70;

export function hexCenter(row, col, originX, originY) {
  const ox = originX ?? DEFAULT_GRID_ORIGIN_X;
  const oy = originY ?? DEFAULT_GRID_ORIGIN_Y;
  const xOff = (row % 2 === 1) ? HEX_W / 2 : 0;
  return { x: ox + HEX_W * col + xOff, y: oy + HEX_H * 0.75 * row };
}

export function hexVertices(cx, cy, size) {
  const verts = new Array(6);
  for (let i = 0; i < 6; i++) {
    const angle = (60 * i - 30) * Math.PI / 180;
    verts[i] = { x: cx + size * Math.cos(angle), y: cy + size * Math.sin(angle) };
  }
  return verts;
}

export function pixelToHex(px, py, originX, originY, rows, cols) {
  const ox = originX ?? DEFAULT_GRID_ORIGIN_X;
  const oy = originY ?? DEFAULT_GRID_ORIGIN_Y;
  const rowApprox = (py - oy) / (HEX_H * 0.75);
  const candidates = [];
  for (const r of [Math.floor(rowApprox), Math.ceil(rowApprox)]) {
    if (r < 0 || r >= rows) continue;
    const xOff = (r % 2 === 1) ? HEX_W / 2 : 0;
    const colApprox = (px - ox - xOff) / HEX_W;
    for (const c of [Math.floor(colApprox), Math.ceil(colApprox)]) {
      if (c < 0 || c >= cols) continue;
      candidates.push({ r, c });
    }
  }
  let best = null;
  let bestDist = Infinity;
  for (const { r, c } of candidates) {
    const center = hexCenter(r, c, ox, oy);
    const dx = px - center.x;
    const dy = py - center.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < HEX_SIZE && dist < bestDist) {
      bestDist = dist;
      best = { row: r, col: c };
    }
  }
  return best;
}

export function neighbors(row, col, rows, cols) {
  const candidates = row % 2 === 0
    ? [[row - 1, col - 1], [row - 1, col], [row, col - 1], [row, col + 1], [row + 1, col - 1], [row + 1, col]]
    : [[row - 1, col], [row - 1, col + 1], [row, col - 1], [row, col + 1], [row + 1, col], [row + 1, col + 1]];
  return candidates.filter(([r, c]) => r >= 0 && r < rows && c >= 0 && c < cols);
}

export function neighborSet(row, col, rows, cols) {
  const s = new Set();
  for (const [r, c] of neighbors(row, col, rows, cols)) s.add(`${r},${c}`);
  return s;
}

export function neighborsOfSet(keys, rows, cols) {
  const neighbors = new Set();
  for (const key of keys) {
    const [r, c] = key.split(',').map(Number);
    const candidates = r % 2 === 0
      ? [[r - 1, c - 1], [r - 1, c], [r, c - 1], [r, c + 1], [r + 1, c - 1], [r + 1, c]]
      : [[r - 1, c], [r - 1, c + 1], [r, c - 1], [r, c + 1], [r + 1, c], [r + 1, c + 1]];
    for (const [nr, nc] of candidates) {
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        const nkey = `${nr},${nc}`;
        if (!keys.has(nkey)) {
          neighbors.add(nkey);
        }
      }
    }
  }
  return neighbors;
}
