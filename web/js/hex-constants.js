export const HEX_SIZE = 54;
export const HEX_W = 93.5307436087;
export const HEX_H = 108;
export const DEFAULT_COLS = 7;
export const DEFAULT_ROWS = 11;
export const DEFAULT_GRID_ORIGIN_X = 173;
export const DEFAULT_GRID_ORIGIN_Y = 70;
export const MIN_GRID = 6;
export const MAX_GRID = 50;
export function gridCanvasSize(rows, cols, originX, originY) {
  const HEX_W = Math.sqrt(3) * 54;
  const HEX_H = 2 * 54;
  const rightExtent = originX + (cols - 1) * HEX_W + HEX_W;
  const bottomExtent = originY + (rows - 1) * 0.75 * HEX_H + HEX_H / 2;
  return { W: Math.ceil(rightExtent + 100), H: Math.ceil(bottomExtent + 12) };
}
