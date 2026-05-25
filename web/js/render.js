import { hexCenter, hexVertices, HEX_SIZE, neighborSet, neighborsOfSet } from './hex.js';
import { POI_COLOR_HEX } from './socket.js';

export const BIOME_COLORS = {
  mountains: { overlay: 'rgba(140,140,170,0.32)', swatch: 'rgba(140,140,170,0.70)' },
  hills:     { overlay: 'rgba(190,140,90,0.30)', swatch: 'rgba(190,140,90,0.70)' },
  swamp:     { overlay: 'rgba(150,80,160,0.32)', swatch: 'rgba(150,80,160,0.75)' },
  forest:    { overlay: 'rgba(40,130,50,0.30)', swatch: 'rgba(40,130,50,0.70)' },
  plains:    { overlay: 'rgba(220,200,80,0.28)', swatch: 'rgba(220,200,80,0.60)' },
  city:      { overlay: 'rgba(220,140,50,0.35)', swatch: 'rgba(220,140,50,0.75)' },
};

function fillHex(ctx, cx, cy, size) {
  const verts = hexVertices(cx, cy, size);
  ctx.beginPath();
  ctx.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < 6; i++) ctx.lineTo(verts[i].x, verts[i].y);
  ctx.closePath();
  ctx.fill();
}

function drawFlag(ctx, cx, cy, color, { dim = false } = {}) {
  // Pole rooted just below center, banner waving right. Anchor point is the
  // pole's base at (cx, cy).
  const fill = POI_COLOR_HEX[color] || '#ddd';
  const poleH = 36;
  const bannerW = 26;
  const bannerH = 18;
  const poleX = cx;
  const poleBaseY = cy + 12;
  const poleTopY = poleBaseY - poleH;
  const alpha = dim ? 0.6 : 1;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Shadow ellipse at base
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(poleX, poleBaseY + 2, 8, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Pole
  ctx.strokeStyle = '#1a0e05';
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(poleX, poleBaseY);
  ctx.lineTo(poleX, poleTopY);
  ctx.stroke();

  // Pole knob at top
  ctx.fillStyle = '#1a0e05';
  ctx.beginPath();
  ctx.arc(poleX, poleTopY, 2.6, 0, Math.PI * 2);
  ctx.fill();

  // Banner (triangle pennant), thick outline for legibility
  ctx.beginPath();
  ctx.moveTo(poleX, poleTopY);
  ctx.lineTo(poleX + bannerW, poleTopY + bannerH / 2);
  ctx.lineTo(poleX, poleTopY + bannerH);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = '#1a0e05';
  ctx.lineWidth = 2.4;
  ctx.stroke();
  ctx.restore();
}

export function poiAnchorOffset(index) {
  // Fan multiple POIs on the same hex: each subsequent flag shifts right.
  return { dx: index * 18, dy: 0 };
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
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Image load timeout'));
    }, 15000);
    img.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve();
    };
    img.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

export function renderOverlay(ctx, state, isHost, dragPos, biomeOn) {
  const { rows, cols, originX, originY, hexSize, marker, fog, pendingRequests, biomeTags } = state;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Preview mode: no fog at all. Game mode: apply fog based on settings.
  const inPreview = state.status === 'preview';

  const hostFogEnabled = isHost && !inPreview && fog.host;
  const playerFogEnabled = !isHost && fog.players;

  const revealed = state._revealedSet;
  const ringSet = revealed.size > 0 ? neighborsOfSet(revealed, rows, cols) : new Set();

  if (hostFogEnabled || playerFogEnabled) {
    const isHostFog = isHost && fog.host;

    const fullFogAlpha = isHostFog ? 0.85 : 1.0;
    const ringFogAlpha = isHostFog ? 0.6 : 0.8;

    // Draw base fog
    ctx.fillStyle = `rgba(0,0,0,${fullFogAlpha})`;
    ctx.fillRect(0, 0, W, H);

    // Clear revealed hexes and ring hexes (fully transparent)
    ctx.globalCompositeOperation = 'destination-out';
    for (const key of revealed) {
      const [r, c] = key.split(',').map(Number);
      const { x, y } = hexCenter(r, c, originX, originY);
      fillHex(ctx, x, y, hexSize + 2);
    }
    if (marker) {
      for (const key of ringSet) {
        const [r, c] = key.split(',').map(Number);
        const { x, y } = hexCenter(r, c, originX, originY);
        fillHex(ctx, x, y, hexSize + 2);
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // Redraw ring fog at target alpha on top of cleared ring area
    if (marker && ringFogAlpha > 0) {
      ctx.fillStyle = `rgba(0,0,0,${ringFogAlpha})`;
      for (const key of ringSet) {
        if (!revealed.has(key)) {
          const [r, c] = key.split(',').map(Number);
          const { x, y } = hexCenter(r, c, originX, originY);
          fillHex(ctx, x, y, hexSize + 2);
        }
      }
    }
  }

  // Draw biome overlay on revealed/ring hexes (or all hexes in preview/no-fog)
  if (biomeOn && biomeTags && Object.keys(biomeTags).length > 0) {
    const hasFog = hostFogEnabled || playerFogEnabled;
    const visibleHexes = (inPreview || !hasFog) ? null : new Set([...revealed, ...ringSet]);
    for (const [key, tag] of Object.entries(biomeTags)) {
      if (visibleHexes && !visibleHexes.has(key)) continue;
      const [r, c] = key.split(',').map(Number);
      const { x, y } = hexCenter(r, c, originX, originY);
      const color = BIOME_COLORS[tag]?.overlay;
      if (color) {
        ctx.fillStyle = color;
        fillHex(ctx, x, y, hexSize);
      }
    }
  }

  // Draw "waiting for marker" message (players only, no marker yet)
  if (!isHost && !marker && state.status === 'ready') {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '18px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Waiting for the host to place a marker…', W / 2, H / 2);
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

  // Draw POI flags. Group by hex so we can fan duplicates.
  if (state.pois && state.pois.length > 0) {
    const byHex = new Map();
    for (const poi of state.pois) {
      const k = `${poi.row},${poi.col}`;
      if (!byHex.has(k)) byHex.set(k, []);
      byHex.get(k).push(poi);
    }
    for (const [k, list] of byHex.entries()) {
      const [r, c] = k.split(',').map(Number);
      const { x, y } = hexCenter(r, c, originX, originY);
      list.forEach((poi, i) => {
        const { dx, dy } = poiAnchorOffset(i);
        // GM-only POIs render dimmer for the host so they're visually distinct.
        const dim = isHost && poi.visibility === 'gm';
        drawFlag(ctx, x + dx - (list.length - 1) * 9, y + dy, poi.color, { dim });
      });
    }
  }

 // Draw pending request indicators
  if (pendingRequests && pendingRequests.length > 0) {
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

let _activeRafId = null;

export function startRenderLoop(ctx, getState, isHost, getDragPos, getBiomeOn) {
  if (_activeRafId) cancelAnimationFrame(_activeRafId);
  let rafId = null;
  function loop() {
    const st = getState();
    if (st) renderOverlay(ctx, st, isHost(), getDragPos(), getBiomeOn());
    rafId = requestAnimationFrame(loop);
    _activeRafId = rafId;
  }
  rafId = requestAnimationFrame(loop);
  _activeRafId = rafId;
}

export function stopRenderLoop() {
  if (_activeRafId) { cancelAnimationFrame(_activeRafId); _activeRafId = null; }
}
