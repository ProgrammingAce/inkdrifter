const HEX_SIZE = 54;
const HEX_W = Math.sqrt(3) * HEX_SIZE;
const HEX_H = 2 * HEX_SIZE;
const DEFAULT_COLS = 7;
const DEFAULT_ROWS = 11;
const DEFAULT_GRID_ORIGIN_X = 173;
const DEFAULT_GRID_ORIGIN_Y = 70;
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

module.exports = {
  HEX_SIZE, HEX_W, HEX_H,
  DEFAULT_COLS, DEFAULT_ROWS,
  DEFAULT_GRID_ORIGIN_X, DEFAULT_GRID_ORIGIN_Y,
  MIN_GRID, MAX_GRID,
  gridCanvasSize,
};
