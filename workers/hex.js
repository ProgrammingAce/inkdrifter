import {
  HEX_SIZE, HEX_W, HEX_H,
  DEFAULT_GRID_ORIGIN_X, DEFAULT_GRID_ORIGIN_Y,
} from './constants.js';

function hexNeighborsBounded(row, col, rows, cols) {
  return hexNeighbors(row, col).filter(([r, c]) => r >= 0 && r < rows && c >= 0 && c < cols);
}

function hexNeighbors(row, col) {
  return row % 2 === 0
    ? [[row - 1, col - 1], [row - 1, col], [row, col - 1], [row, col + 1], [row + 1, col - 1], [row + 1, col]]
    : [[row - 1, col], [row - 1, col + 1], [row, col - 1], [row, col + 1], [row + 1, col], [row + 1, col + 1]];
}

export { hexNeighborsBounded, hexNeighbors };
