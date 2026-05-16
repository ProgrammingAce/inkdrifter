import { hexCenter, hexVertices, HEX_SIZE, neighborSet } from './hex.js';

function fillHex(ctx, cx, cy, size) {
  const verts = hexVertices(cx, cy, size);
  ctx.beginPath();
  ctx.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < 6; i++) ctx.lineTo(verts[i].x, verts[i].y);
  ctx.closePath();
  ctx.fill();
}

function strokeHex(ctx, cx, cy, size) {
  const verts = hexVertices(cx, cy, size);
  ctx.beginPath();
  ctx.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < 6; i++) ctx.lineTo(verts[i].x, verts[i].y);
  ctx.closePath();
  ctx.stroke();
}

export function loadBaseMap(canvas, url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve();
    };
    img.onerror = reject;
    img.src = url;
  });
}

export function renderOverlay(ctx, state, isHost, dragPos) {
  const { rows, cols, originX, originY, hexSize, marker, fog, pendingRequests } = state;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);

  const fogEnabled = isHost ? fog.host : fog.players;

  if (fogEnabled) {
    const revealed = state._revealedSet;
    const ringSet = marker ? neighborSet(marker.row, marker.col, rows, cols) : new Set();
    const centerKey = marker ? `${marker.row},${marker.col}` : null;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const key = `${r},${c}`;
        const isCenter = key === centerKey;
        if (isCenter) continue;
        const isRing = ringSet.has(key);
        const wasSeen = revealed.has(key);
        let fillColor;
        if (isRing && !wasSeen) fillColor = 'rgba(0,0,0,0.5)';
        else if (!wasSeen) fillColor = 'rgba(0,0,0,1.0)';
        if (fillColor) {
          const { x, y } = hexCenter(r, c, originX, originY);
          ctx.fillStyle = fillColor;
          fillHex(ctx, x, y, hexSize);
        }
      }
    }
  }

  // Draw marker
  const markerPos = dragPos || (marker ? hexCenter(marker.row, marker.col, originX, originY) : null);
  if (markerPos) {
    ctx.beginPath();
    ctx.arc(markerPos.x, markerPos.y, 16, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(markerPos.x, markerPos.y, 12, 0, Math.PI * 2);
    ctx.fillStyle = '#cc2222';
    ctx.fill();
  }

  // Draw pending request indicators (host only)
  if (isHost && pendingRequests && pendingRequests.length > 0) {
    const pulse = 0.55 + 0.45 * Math.sin(Date.now() / 500);
    for (const req of pendingRequests) {
      const { x, y } = hexCenter(req.row, req.col, originX, originY);
      ctx.strokeStyle = `rgba(255,220,50,${pulse})`;
      ctx.lineWidth = 3;
      strokeHex(ctx, x, y, hexSize - 2);

      // Player name label
      const playerName = state.players[req.playerId]?.name || '?';
      ctx.font = 'bold 12px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const textW = ctx.measureText(playerName).width + 8;
      ctx.fillStyle = `rgba(30,15,5,${0.8 * pulse + 0.1})`;
      ctx.fillRect(x - textW / 2, y - 9, textW, 18);
      ctx.fillStyle = `rgba(255,220,50,${pulse})`;
      ctx.fillText(playerName, x, y);
    }
  }
}

let _rafId = null;
let _rafCtx = null;
let _rafGetState = null;
let _rafIsHost = null;
let _rafGetDragPos = null;

export function startRenderLoop(ctx, getState, isHost, getDragPos) {
  _rafCtx = ctx;
  _rafGetState = getState;
  _rafIsHost = isHost;
  _rafGetDragPos = getDragPos;
  if (_rafId) cancelAnimationFrame(_rafId);
  function loop() {
    const state = _rafGetState();
    if (state) renderOverlay(_rafCtx, state, _rafIsHost(), _rafGetDragPos());
    _rafId = requestAnimationFrame(loop);
  }
  _rafId = requestAnimationFrame(loop);
}

export function stopRenderLoop() {
  if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
}
