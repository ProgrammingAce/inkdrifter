import { pixelToHex, hexCenter, neighborSet, HEX_SIZE } from './hex.js';
import { EVENTS } from './socket.js';

export function initInput({ overlayCanvas, getState, getIsHost, socket, onDragPos }) {
  let dragging = false;

  function canvasPos(e) {
    const rect = overlayCanvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    return { px: touch.clientX - rect.left, py: touch.clientY - rect.top };
  }

  function getScrollContainer() {
    return document.getElementById('map-scroll');
  }

  overlayCanvas.addEventListener('mousedown', (e) => {
    if (!getIsHost()) return;
    const state = getState();
    if (!state || !state.marker) return;
    const { px, py } = canvasPos(e);
    const mc = hexCenter(state.marker.row, state.marker.col, state.originX, state.originY);
    const dx = px - mc.x;
    const dy = py - mc.y;
    if (Math.sqrt(dx * dx + dy * dy) <= HEX_SIZE) {
      dragging = true;
      onDragPos({ x: px, y: py });
      e.preventDefault();
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) {
      // Update cursor for ring tiles (player only)
      if (!getIsHost()) {
        const state = getState();
        if (!state || !state.marker) return;
        const { px, py } = canvasPos(e);
        const hex = pixelToHex(px, py, state.originX, state.originY, state.rows, state.cols);
        if (hex) {
          const ring = neighborSet(state.marker.row, state.marker.col, state.rows, state.cols);
          overlayCanvas.style.cursor = ring.has(`${hex.row},${hex.col}`) ? 'pointer' : 'default';
        } else {
          overlayCanvas.style.cursor = 'default';
        }
      }
      return;
    }
    const state = getState();
    if (!state) return;
    const { px, py } = canvasPos(e);
    onDragPos({ x: px, y: py });
  });

  window.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;
    const state = getState();
    if (state) {
      const { px, py } = canvasPos(e);
      const hex = pixelToHex(px, py, state.originX, state.originY, state.rows, state.cols);
      if (hex) socket.emit(EVENTS.MARKER_MOVE, { row: hex.row, col: hex.col });
    }
    onDragPos(null);
  });

  overlayCanvas.addEventListener('click', (e) => {
    if (getIsHost()) {
      const state = getState();
      if (!state) return;
      if (!state.marker) {
        // First placement — click any tile
        const { px, py } = canvasPos(e);
        const hex = pixelToHex(px, py, state.originX, state.originY, state.rows, state.cols);
        if (hex) socket.emit(EVENTS.MARKER_MOVE, { row: hex.row, col: hex.col });
      }
      return;
    }
    // Player
    const state = getState();
    if (!state || !state.marker) return;
    const { px, py } = canvasPos(e);
    const hex = pixelToHex(px, py, state.originX, state.originY, state.rows, state.cols);
    if (!hex) return;
    const ring = neighborSet(state.marker.row, state.marker.col, state.rows, state.cols);
    if (ring.has(`${hex.row},${hex.col}`)) {
      socket.emit(EVENTS.MOVE_REQUEST, { row: hex.row, col: hex.col });
    }
  });
}

export function scrollToMarker(marker, originX, originY) {
  if (!marker) return;
  const container = document.getElementById('map-scroll');
  if (!container) return;
  const { x, y } = hexCenter(marker.row, marker.col, originX, originY);
  const cx = container.clientWidth / 2;
  const cy = container.clientHeight / 2;
  container.scrollTo({ left: x - cx, top: y - cy, behavior: 'smooth' });
}
