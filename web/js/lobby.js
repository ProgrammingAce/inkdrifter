import { EVENTS, ERROR_CODES, createSocket } from './socket.js';
import { loadBaseMap, startRenderLoop } from './render.js';
import { initInput, scrollToMarker } from './input.js';

const code = window.location.pathname.split('/').pop();
const hostToken = localStorage.getItem(`hostToken_${code}`);
const playerToken = localStorage.getItem(`playerToken_${code}`);
const isHost = !!hostToken;
const myPlayerId = localStorage.getItem(`playerId_${code}`);

let state = null;
let mapLoaded = false;
let dragPos = null;
let previousMarker = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const loadingEl = document.getElementById('loading');
const mapStack = document.getElementById('map-stack');
const baseCanvas = document.getElementById('base-canvas');
const overlayCanvas = document.getElementById('overlay-canvas');
const overlayCtx = overlayCanvas.getContext('2d');

const lobbyCodeEl = document.getElementById('lobby-code');
const seedEl = document.getElementById('lobby-seed');
const playerListEl = document.getElementById('player-list');
const pendingListEl = document.getElementById('pending-list');
const noRequestsEl = document.getElementById('no-requests');
const markerBannerEl = document.getElementById('marker-banner');

// Host-only
const fogHostEl = document.getElementById('fog-host');
const fogPlayersEl = document.getElementById('fog-players');
const hostControlsEl = document.getElementById('host-controls');
const newGameBtn = document.getElementById('new-game-btn');

// Toast
const toastEl = document.getElementById('toast');
let toastTimer = null;

// ── Socket setup ──────────────────────────────────────────────────────────────
const socket = createSocket();

function showToast(msg, isError = false) {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.className = 'toast' + (isError ? ' error' : '');
  toastEl.style.opacity = '1';
  toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, 4000);
}

// ── State helpers ─────────────────────────────────────────────────────────────
function applyState(data) {
  const prevMarker = state?.marker;
  state = data;
  state._revealedSet = new Set(data.revealed.map(([r, c]) => `${r},${c}`));
  if (lobbyCodeEl) lobbyCodeEl.textContent = data.code;
  if (seedEl) seedEl.textContent = data.seed;
  updatePlayerList();
  updatePendingList();
  updateFogControls();
  updateMarkerBanner();
  return prevMarker;
}

function applyRevealDelta(revealedDelta) {
  if (!state) return;
  for (const [r, c] of revealedDelta) {
    state._revealedSet.add(`${r},${c}`);
    state.revealed.push([r, c]);
  }
}

function updatePlayerList() {
  if (!playerListEl || !state) return;
  playerListEl.innerHTML = '';
  // Host
  const hostLi = document.createElement('li');
  hostLi.className = 'player-item' + (state.hostConnected ? ' connected' : ' disconnected');
  const hostDot = document.createElement('span');
  hostDot.className = 'dot';
  hostLi.appendChild(hostDot);
  const hostName = document.createElement('span');
  hostName.className = 'player-name';
  hostName.textContent = state.hostName + ' (host)';
  hostLi.appendChild(hostName);
  playerListEl.appendChild(hostLi);
  // Players
  for (const [pid, p] of Object.entries(state.players)) {
    const li = document.createElement('li');
    li.className = 'player-item' + (p.connected ? ' connected' : ' disconnected');
    const dot = document.createElement('span');
    dot.className = 'dot';
    li.appendChild(dot);
    const nameSpan = document.createElement('span');
    nameSpan.className = 'player-name';
    nameSpan.textContent = p.name + (pid === myPlayerId ? ' (you)' : '');
    li.appendChild(nameSpan);
    playerListEl.appendChild(li);
  }
}

function updatePendingList() {
  if (!pendingListEl || !state) return;
  pendingListEl.innerHTML = '';
  const reqs = state.pendingRequests || [];
  if (noRequestsEl) noRequestsEl.style.display = reqs.length === 0 ? '' : 'none';
  for (const req of reqs) {
    const li = document.createElement('li');
    li.className = 'request-item' + (req.playerId === myPlayerId ? ' mine' : '');
    const playerName = state.players[req.playerId]?.name || '?';
    const info = document.createElement('span');
    info.className = 'request-info';
    info.textContent = `${playerName} → (${req.row}, ${req.col})`;
    li.appendChild(info);
    if (isHost) {
      const ackBtn = document.createElement('button');
      ackBtn.className = 'btn-small';
      ackBtn.textContent = 'Dismiss';
      ackBtn.addEventListener('click', () => {
        socket.emit(EVENTS.ACKNOWLEDGE_REQUEST, { requestId: req.requestId });
      });
      li.appendChild(ackBtn);
    }
    pendingListEl.appendChild(li);
  }
}

function updateFogControls() {
  if (!fogHostEl || !fogPlayersEl || !state) return;
  fogHostEl.checked = state.fog.host;
  fogPlayersEl.checked = state.fog.players;
}

function updateMarkerBanner() {
  if (!markerBannerEl || !state) return;
  const show = !state.marker && state.status === 'ready';
  markerBannerEl.style.display = show ? '' : 'none';
  if (show) {
    markerBannerEl.textContent = isHost
      ? 'Click any tile to place the marker.'
      : 'Waiting for host to place the marker…';
  }
}

// ── Map loading ───────────────────────────────────────────────────────────────
async function initMap() {
  const W = state.canvasWidth;
  const H = state.canvasHeight;
  baseCanvas.width = W;
  baseCanvas.height = H;
  overlayCanvas.width = W;
  overlayCanvas.height = H;
  mapStack.style.width = W + 'px';
  mapStack.style.height = H + 'px';
  loadingEl.style.display = 'none';
  mapStack.style.display = 'block';

  try {
    await loadBaseMap(baseCanvas, `/lobbies/${code}/map.png`);
  } catch (err) {
    console.error('Failed to load map image:', err);
    showToast('Failed to load map. Please refresh.', true);
    mapStack.style.display = 'none';
    return;
  }
  mapLoaded = true;
  startRenderLoop(
    overlayCtx,
    () => state,
    () => isHost,
    () => dragPos
  );

  initInput({
    overlayCanvas,
    getState: () => state,
    getIsHost: () => isHost,
    socket,
    onDragPos: (pos) => { dragPos = pos; },
  });

  updateMarkerBanner();
}

// ── Socket events ─────────────────────────────────────────────────────────────
socket.on(EVENTS.LOBBY_STATE, async (data) => {
  applyState(data);
  if (data.status === 'ready' && !mapLoaded) {
    await initMap();
  } else if (data.status === 'rendering') {
    loadingEl.style.display = '';
    mapStack.style.display = 'none';
  }
});

socket.on(EVENTS.MAP_READY, async () => {
  if (!mapLoaded) {
    // If a lobby_state with ready status hasn't arrived yet, load the map here.
    if (state && state.status === 'ready') {
      await initMap();
    }
  }
});

socket.on(EVENTS.PLAYER_JOINED, ({ playerId, name }) => {
  if (!state) return;
  if (!state.players[playerId]) state.players[playerId] = { name, connected: true };
  else state.players[playerId].connected = true;
  updatePlayerList();
  showToast(`${name} joined.`);
});

socket.on(EVENTS.PLAYER_LEFT, ({ playerId }) => {
  if (!state) return;
  const name = state.players[playerId]?.name;
  if (state.players[playerId]) state.players[playerId].connected = false;
  updatePlayerList();
  if (name) showToast(`${name} disconnected.`);
});

socket.on(EVENTS.MARKER_MOVED, ({ row, col, revealedDelta }) => {
  if (!state) return;
  previousMarker = state.marker;
  state.marker = { row, col };
  applyRevealDelta(revealedDelta);
  state.pendingRequests = [];
  updatePendingList();
  updateMarkerBanner();

  // Camera follow: scroll to new marker if old marker was visible
  if (!isHost && previousMarker) {
    const container = document.getElementById('map-scroll');
    if (container) {
      const oldCenter = { x: previousMarker.col * 93 + state.originX, y: previousMarker.row * 81 + state.originY };
      const scrollLeft = container.scrollLeft;
      const scrollTop = container.scrollTop;
      const right = scrollLeft + container.clientWidth;
      const bottom = scrollTop + container.clientHeight;
      const wasVisible = oldCenter.x >= scrollLeft && oldCenter.x <= right &&
                         oldCenter.y >= scrollTop && oldCenter.y <= bottom;
      if (wasVisible) scrollToMarker(state.marker, state.originX, state.originY);
    }
  }
});

socket.on(EVENTS.MOVE_REQUESTED, (req) => {
  if (!state) return;
  state.pendingRequests = state.pendingRequests || [];
  state.pendingRequests.unshift(req);
  updatePendingList();
  if (isHost) {
    const name = state.players[req.playerId]?.name || '?';
    showToast(`${name} requests (${req.row}, ${req.col})`);
  }
});

socket.on(EVENTS.REQUEST_CANCELLED, ({ requestId }) => {
  if (!state) return;
  state.pendingRequests = (state.pendingRequests || []).filter(r => r.requestId !== requestId);
  updatePendingList();
});

socket.on(EVENTS.FOG_CHANGED, ({ hostFog, playerFog }) => {
  if (!state) return;
  state.fog = { host: hostFog, players: playerFog };
  updateFogControls();
});

socket.on(EVENTS.LOBBY_CLOSED, ({ reason }) => {
  const msgs = {
    host_timeout: 'The host disconnected. Lobby closed.',
    host_replaced: 'You were replaced by another host session.',
    new_game: 'The host started a new game.',
    render_failed: 'Map rendering failed. Lobby closed.',
    idle: 'Lobby closed due to inactivity.',
  };
  showToast(msgs[reason] || 'Lobby closed.', true);
  setTimeout(() => { window.location.href = '/'; }, 3000);
});

socket.on(EVENTS.ERROR, ({ code: errCode, message }) => {
  const friendly = {
    bad_auth: 'Authentication failed.',
    not_host: 'Only the host can do that.',
    out_of_bounds: 'Target tile is out of bounds.',
    not_in_ring: 'You can only request the tiles adjacent to the marker.',
    marker_not_placed: 'The marker has not been placed yet.',
    rate_limited: 'Too many requests. Please slow down.',
    lobby_not_ready: 'The lobby is still loading.',
  };
  showToast(friendly[errCode] || message || 'An error occurred.', true);
});

// ── Host controls ─────────────────────────────────────────────────────────────
if (isHost && hostControlsEl) {
  hostControlsEl.style.display = '';
  document.getElementById('copy-code-btn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(code).then(() => showToast('Code copied!'));
  });
  document.getElementById('copy-seed-btn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(String(state?.seed ?? '')).then(() => showToast('Seed copied!'));
  });
  fogHostEl?.addEventListener('change', () => {
    socket.emit(EVENTS.FOG_TOGGLE, { target: 'host', enabled: fogHostEl.checked });
  });
  fogPlayersEl?.addEventListener('change', () => {
    socket.emit(EVENTS.FOG_TOGGLE, { target: 'players', enabled: fogPlayersEl.checked });
  });
  newGameBtn?.addEventListener('click', () => {
    if (confirm('End this lobby and return to the home page?')) {
      socket.emit(EVENTS.NEW_GAME);
      window.location.href = '/';
    }
  });
}

// ── Connect ───────────────────────────────────────────────────────────────────
if (!hostToken && !playerToken) {
  showToast('No credentials found. Returning to home.', true);
  setTimeout(() => { window.location.href = '/'; }, 2000);
} else {
  socket.connect();
  socket.on('connect', () => {
    const token = hostToken || playerToken;
    const role = hostToken ? 'host' : 'player';
    socket.emit(EVENTS.AUTH, { code, role, token });
  });
  socket.on('connect_error', (err) => {
    console.error('[lobby.js] socket connection error:', err);
    showToast('Connection error. Please refresh.', true);
  });
}
