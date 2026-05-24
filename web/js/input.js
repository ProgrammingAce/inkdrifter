import { pixelToHex, hexCenter, neighborSet, neighborsOfSet, HEX_SIZE } from './hex.js';
import { EVENTS } from './socket.js';

// Guard against double-binding: initMap can be called multiple times per
// session (regenerate, fallback load), and window-level mousemove/mouseup
// listeners would otherwise accumulate. All inputs (overlayCanvas, getState,
// socket, onDragPos) are stable references in the caller, so reusing the
// first closure is correct.
let _bound = false;

export function initInput({ overlayCanvas, getState, getIsHost, socket, onDragPos }) {
  if (_bound) return;
  _bound = true;
  let dragging = false;

  function canvasPos(e) {
    const rect = overlayCanvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    // Convert from rendered pixels to canvas-pixel coordinates. With CSS zoom
    // applied to #map-stack, rect.width !== canvas.width, so we scale back.
    const sx = overlayCanvas.width / rect.width;
    const sy = overlayCanvas.height / rect.height;
    return { px: (touch.clientX - rect.left) * sx, py: (touch.clientY - rect.top) * sy };
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
      // Update cursor for visible tiles (player only)
      if (!getIsHost()) {
        const state = getState();
        if (!state || !state.marker) return;
        const { px, py } = canvasPos(e);
        const hex = pixelToHex(px, py, state.originX, state.originY, state.rows, state.cols);
        if (hex) {
          const key = `${hex.row},${hex.col}`;
          const revealed = state._revealedSet;
          const inRing = revealed.has(key) || neighborsOfSet(revealed, state.rows, state.cols).has(key);
          overlayCanvas.style.cursor = inRing ? 'pointer' : 'default';
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
    const key = `${hex.row},${hex.col}`;
    const revealed = state._revealedSet;
    if (revealed.has(key)) {
      socket.emit(EVENTS.MOVE_REQUEST, { row: hex.row, col: hex.col });
    } else {
      const ring = neighborsOfSet(revealed, state.rows, state.cols);
      if (ring.has(key)) {
        socket.emit(EVENTS.MOVE_REQUEST, { row: hex.row, col: hex.col });
      }
    }
  });
}

export function scrollToMarker(marker, originX, originY) {
  if (!marker) return;
  const container = document.getElementById('map-scroll');
  if (!container) return;
  const overlay = document.getElementById('overlay-canvas');
  const zoom = (overlay && overlay.width)
    ? overlay.getBoundingClientRect().width / overlay.width
    : 1;
  const { x, y } = hexCenter(marker.row, marker.col, originX, originY);
  const cx = container.clientWidth / 2;
  const cy = container.clientHeight / 2;
  container.scrollTo({ left: x * zoom - cx, top: y * zoom - cy, behavior: 'smooth' });
}

// Ctrl/Cmd + wheel zooms the map (anchored at the cursor). Plain wheel keeps
// native scroll behavior. Default zoom is 1.0 (no change to the existing view);
// the user can zoom out to MIN_ZOOM to see more of the map at once.
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.0;
let _zoomBound = false;

export function initZoom() {
  if (_zoomBound) return;
  const mapScroll = document.getElementById('map-scroll');
  const mapStack = document.getElementById('map-stack');
  if (!mapScroll || !mapStack) return;
  _zoomBound = true;

  let zoom = 1.0;
  mapStack.style.transformOrigin = '0 0';

  mapScroll.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const old = zoom;
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
    if (zoom === old) return;

    const rect = mapScroll.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const mapX = mapScroll.scrollLeft + localX;
    const mapY = mapScroll.scrollTop + localY;

    mapStack.style.transform = `scale(${zoom})`;
    const ratio = zoom / old;
    mapScroll.scrollLeft = mapX * ratio - localX;
    mapScroll.scrollTop = mapY * ratio - localY;
  }, { passive: false });
}
