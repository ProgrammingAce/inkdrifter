import { EVENTS, ERROR_CODES, createSocket } from './socket.js';
import { renderMap } from './renderMap.js';
import { startRenderLoop, BIOME_COLORS } from './render.js';
import { initInput, scrollToMarker, initZoom } from './input.js';
import { hexCenter } from './hex.js';
import { mountMapSettingsModal } from './mapSettingsModal.js';
import { initPoiModals } from './poiModal.js';
import { encodePackedSeed } from './seedCodec.js';

function packedSeedFor(s) {
  if (!s) return '';
  return encodePackedSeed({
    seed: s.seed,
    rows: s.rows,
    cols: s.cols,
    options: s.mapOptions || {},
  });
}

const code = window.location.pathname.split('/').pop();
const hostToken = localStorage.getItem(`hostToken_${code}`);
const playerToken = localStorage.getItem(`playerToken_${code}`);
const isHost = !!hostToken;
const myPlayerId = localStorage.getItem(`playerId_${code}`);
const authToken = hostToken || playerToken;
const authHeader = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};

let state = null;
let mapLoaded = false;
let mapRendered = false;
let dragPos = null;
let previousMarker = null;
let biomeOverlayOn = false;
let poiModals = null;

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
const fogControlsEl = document.getElementById('fog-controls');
const newGameBtn = document.getElementById('new-game-btn');

// Biome overlay
const biomeToggleEl = document.getElementById('biome-toggle');
const biomeLegendEl = document.getElementById('biome-legend');

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
  state = data;
  state._revealedSet = new Set(data.revealed.map(([r, c]) => `${r},${c}`));
  state.pois = Array.isArray(data.pois) ? data.pois : [];
  if (lobbyCodeEl) lobbyCodeEl.textContent = data.code;
  if (seedEl) seedEl.textContent = packedSeedFor(data);
  updatePlayerList();
  updatePendingList();
  updateFogControls();
  updateMarkerBanner();
  updateLegendVisibility();
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
      ? "Click a tile to choose the players' starting point."
      : 'Waiting for host to choose the starting point…';
  }
}

function populateLegendSwatches() {
  if (!biomeLegendEl) return;
  const tags = new Set(Object.values(state?.biomeTags || {}));
  const rows = biomeLegendEl.querySelectorAll('.legend-row[data-biome]');
  for (const row of rows) {
    const tag = row.dataset.biome;
    const info = BIOME_COLORS[tag];
    if (!info) continue;
    row.style.display = tags.has(tag) ? '' : 'none';
    let swatch = row.querySelector('.legend-swatch');
    if (!swatch) {
      swatch = document.createElement('span');
      swatch.className = 'legend-swatch';
      row.insertBefore(swatch, row.firstChild);
    }
    swatch.style.background = info.swatch;
  }
}

function updateLegendVisibility() {
  if (!biomeLegendEl || !state) return;
  const hasBiomes = state.biomeTags && Object.keys(state.biomeTags).length > 0;
  biomeLegendEl.style.display = (hasBiomes && biomeOverlayOn) ? 'block' : 'none';
  if (hasBiomes && biomeOverlayOn) populateLegendSwatches();
}

function showPreviewUI() {
  if (!isHost) return;
  if (fogControlsEl) fogControlsEl.style.display = 'none';
  const bottom = document.getElementById('host-controls-bottom');
  if (bottom) bottom.style.display = 'none';
  const preview = document.getElementById('host-controls-preview');
  if (preview) preview.style.display = '';
}

function showInGameUI() {
  if (isHost) {
    const preview = document.getElementById('host-controls-preview');
    if (preview) preview.style.display = 'none';
    if (fogControlsEl) fogControlsEl.style.display = '';
    const bottom = document.getElementById('host-controls-bottom');
    if (bottom) bottom.style.display = '';
  }
  const pending = document.querySelector('#pending-list');
  if (pending) pending.closest('.sidebar-section').style.display = '';
  const poiSection = document.getElementById('poi-section');
  if (poiSection) poiSection.style.display = '';
}

function hidePreviewUI() {
  const preview = document.getElementById('host-controls-preview');
  if (preview) preview.style.display = 'none';
}

// ── Map loading ───────────────────────────────────────────────────────────────
async function reloadMap() {
  mapRendered = false;
  try {
    const opts = {
      rows: state.rows,
      cols: state.cols,
      seed: state.seed,
      originX: state.originX,
      originY: state.originY,
      width: baseCanvas.width,
      height: baseCanvas.height,
      supersample: 4,
      drawGrid: state.mapOptions?.drawGrid ?? true,
      drawOcean: state.mapOptions?.drawOcean ?? true,
      drawRiver: state.mapOptions?.drawRiver ?? true,
      placeCities: state.mapOptions?.placeCities ?? true,
      oceanCap: state.mapOptions?.oceanCap,
      riverCount: state.mapOptions?.riverCount,
      cityCount: state.mapOptions?.cityCount,
      elevationBias: state.mapOptions?.elevationBias,
      humidityBias: state.mapOptions?.humidityBias,
      sides: state.mapOptions?.sides,
      islands: !!state.islands,
    };
    console.log('reloadMap starting...');
    const result = renderMap(opts);
    console.log('reloadMap done');
    const outCtx = baseCanvas.getContext('2d');
    outCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
    outCtx.drawImage(result.canvas, 0, 0, baseCanvas.width, baseCanvas.height);
    mapRendered = true;

    if (result.biomes && result.biomes.tags) {
      state.biomeTags = result.biomes.tags instanceof Map
        ? Object.fromEntries(result.biomes.tags)
        : result.biomes.tags;
    }

    if (isHost) {
      try {
        await fetch(`/api/lobbies/${code}/render-complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${hostToken}`,
          },
          body: JSON.stringify({ biomeTags: state.biomeTags || {} }),
        });
      } catch (e) {
        console.error('Failed to notify render-complete:', e);
      }
    }

    populateLegendSwatches();
    updateLegendVisibility();
  } catch (err) {
    console.error('Failed to reload map:', err);
    showToast('Failed to reload map: ' + (err?.message || err), true);
    return;
  }
}

async function initMap() {
  const W = state.canvasWidth;
  const H = state.canvasHeight;

  baseCanvas.width = W;
  baseCanvas.height = H;
  overlayCanvas.width = W;
  overlayCanvas.height = H;

  mapStack.style.width = W + 'px';
  mapStack.style.height = H + 'px';

  if (!mapRendered) {
    try {
      const opts = {
        rows: state.rows,
        cols: state.cols,
        seed: state.seed,
        originX: state.originX,
        originY: state.originY,
        width: W,
        height: H,
        supersample: 4,
        drawGrid: state.mapOptions?.drawGrid ?? true,
        drawOcean: state.mapOptions?.drawOcean ?? true,
        drawRiver: state.mapOptions?.drawRiver ?? true,
        placeCities: state.mapOptions?.placeCities ?? true,
        oceanCap: state.mapOptions?.oceanCap,
        riverCount: state.mapOptions?.riverCount,
        cityCount: state.mapOptions?.cityCount,
        elevationBias: state.mapOptions?.elevationBias,
        humidityBias: state.mapOptions?.humidityBias,
        sides: state.mapOptions?.sides,
        islands: !!state.islands,
      };
      console.log('renderMap starting with opts:', opts);
      const t0 = performance.now();
      const result = renderMap(opts);
      console.log('renderMap done in', (performance.now() - t0).toFixed(0), 'ms');
      const outCtx = baseCanvas.getContext('2d');
      outCtx.clearRect(0, 0, W, H);
      outCtx.drawImage(result.canvas, 0, 0, W, H);
      mapRendered = true;

      if (result.biomes && result.biomes.tags) {
        state.biomeTags = result.biomes.tags instanceof Map
          ? Object.fromEntries(result.biomes.tags)
          : result.biomes.tags;
      }

      if (isHost) {
        try {
          await fetch(`/api/lobbies/${code}/render-complete`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${hostToken}`,
            },
            body: JSON.stringify({ biomeTags: state.biomeTags || {} }),
          });
          console.log('render-complete notified');
        } catch (e) {
          console.error('Failed to notify render-complete:', e);
        }
      }

      populateLegendSwatches();
      updateLegendVisibility();
    } catch (err) {
      console.error('Failed to render map:', err);
      showToast('Map render failed: ' + (err?.message || err) + '. Check console.', true);
      return;
    }
  }

  loadingEl.style.display = 'none';
  mapStack.style.display = 'block';
  mapLoaded = true;

  startRenderLoop(
    overlayCtx,
    () => state,
    () => isHost,
    () => dragPos,
    () => biomeOverlayOn
  );

  initInput({
    overlayCanvas,
    getState: () => state,
    getIsHost: () => isHost,
    socket,
    onDragPos: (pos) => { dragPos = pos; },
    onPoiClick: (poi) => {
      if (poiModals) poiModals.openEdit({ poi });
    },
  });

  initZoom();

  updateMarkerBanner();
}

let _mapLoadPending = false;

function tryLoadMap() {
  if (!state) return;
  if (mapLoaded) return;
  if (_mapLoadPending) return;
  if (state.status !== 'preview' && state.status !== 'ready' && !(isHost && state.status === 'rendering')) return;
  _mapLoadPending = true;
  initMap()
    .then(() => {
      if (state.status === 'ready') showInGameUI();
      if (state.status === 'preview') showPreviewUI();
      clearTimeout(_mapLoadTimeout);
    })
    .catch((err) => {
      console.error('Map load failed:', err);
    })
    .finally(() => {
      _mapLoadPending = false;
    });
}

// ── Socket events ─────────────────────────────────────────────────────────────
socket.on(EVENTS.LOBBY_STATE, async (data) => {
  applyState(data);

  if (data.status === 'rendering') {
    loadingEl.style.display = '';
    mapStack.style.display = 'none';
    hidePreviewUI();
    mapLoaded = false;
    mapRendered = false;
    if (isHost) tryLoadMap();
  } else if (data.status === 'preview' || data.status === 'ready') {
    if (!mapLoaded) {
      tryLoadMap();
    } else if (data.status === 'ready') {
      showInGameUI();
    } else {
      showPreviewUI();
    }
  }
});

socket.on(EVENTS.MAP_READY, () => {
  mapRendered = false;
  tryLoadMap();
});

// Timeout to prevent stuck spinner
let _mapLoadTimeout = setTimeout(() => {
  if (!mapLoaded && state) {
    showToast('Map render timed out — rendering large map, please wait…', true);
    console.log('Map load timeout hit. status:', state.status, 'mapRendered:', mapRendered, 'mapLoaded:', mapLoaded);
  }
}, 60000);

// Fetch lobby status as a fallback if socket events don't arrive
fetch(`/api/lobbies/${code}`)
  .then(res => res.ok ? res.json() : null)
  .then(lobbyStatus => {
    if (!lobbyStatus) return;
    if ((lobbyStatus.status === 'preview' || (isHost && lobbyStatus.status === 'rendering')) && !mapLoaded && !_mapLoadPending) {
      const initialData = {
        ...lobbyStatus,
        _revealedSet: new Set(),
        revealed: [],
        players: {},
        marker: null,
        fog: { host: true, players: true },
        pendingRequests: [],
        biomeTags: lobbyStatus.biomeTags || {},
        pois: [],
      };
      state = initialData;
      _mapLoadPending = true;
      initMap().then(() => {
        if (state?.status === 'ready') showInGameUI();
        else showPreviewUI();
        clearTimeout(_mapLoadTimeout);
      }).catch(err => {
        console.error('Initial map load failed:', err);
        showToast('Failed to load map. Please refresh.', true);
      }).finally(() => {
        _mapLoadPending = false;
      });
    } else if (lobbyStatus.status === 'rendering' && !state) {
      state = { ...lobbyStatus, _revealedSet: new Set(), revealed: [], players: {}, marker: null, fog: { host: true, players: true }, pendingRequests: [], biomeTags: lobbyStatus.biomeTags || {}, pois: [] };
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
      const oldCenter = hexCenter(previousMarker.row, previousMarker.col, state.originX, state.originY);
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

socket.on(EVENTS.POI_CREATED, ({ poi }) => {
  if (!state) return;
  if (!Array.isArray(state.pois)) state.pois = [];
  if (state.pois.some(p => p.id === poi.id)) return;
  state.pois.push(poi);
  if (poiModals) poiModals.renderList();
});

socket.on(EVENTS.POI_UPDATED, ({ poi }) => {
  if (!state || !Array.isArray(state.pois)) return;
  const idx = state.pois.findIndex(p => p.id === poi.id);
  if (idx === -1) state.pois.push(poi);
  else state.pois[idx] = poi;
  if (poiModals) poiModals.renderList();
});

socket.on(EVENTS.POI_DELETED, ({ id }) => {
  if (!state || !Array.isArray(state.pois)) return;
  state.pois = state.pois.filter(p => p.id !== id);
  if (poiModals) poiModals.renderList();
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
    not_in_ring: 'You can only request visible tiles or tiles adjacent to them.',
    marker_not_placed: 'The marker has not been placed yet.',
    rate_limited: 'Too many requests. Please slow down.',
    lobby_not_ready: 'The lobby is still loading.',
    poi_not_found: 'That POI no longer exists.',
    poi_invalid: 'Invalid POI data.',
    poi_limit: 'POI limit reached for this lobby.',
    poi_in_fog: 'You can only place flags on visible tiles or tiles adjacent to them.',
  };
  showToast(friendly[errCode] || message || 'An error occurred.', true);
});

// ── Host controls ─────────────────────────────────────────────────────────────
if (isHost && fogControlsEl) {
  fogControlsEl.style.display = '';
  document.getElementById('copy-code-btn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(code).then(() => showToast('Code copied!'));
  });
  document.getElementById('copy-seed-btn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(packedSeedFor(state)).then(() => showToast('Seed copied!'));
  });
  fogHostEl?.addEventListener('change', () => {
    socket.emit(EVENTS.FOG_TOGGLE, { target: 'host', enabled: fogHostEl.checked });
  });
  fogPlayersEl?.addEventListener('change', () => {
    socket.emit(EVENTS.FOG_TOGGLE, { target: 'players', enabled: fogPlayersEl.checked });
  });
  newGameBtn?.addEventListener('click', () => {
    if (confirm('Unsaved progress will be lost, are you sure you want to exit this game and return to the main menu?')) {
      socket.emit(EVENTS.NEW_GAME);
      window.location.href = '/';
    }
  });

  document.getElementById('regenerate-btn')?.addEventListener('click', () => {
    socket.emit(EVENTS.REGENERATE_MAP);
  });

  if (isHost) {
    const mapSettings = mountMapSettingsModal({
      locked: ['rows', 'cols', 'seed', 'islands'],
      onDone: (opts) => {
        socket.emit(EVENTS.UPDATE_MAP_OPTIONS, opts, (resp) => {
          if (resp && !resp.ok) showToast('Could not save settings: ' + resp.error, true);
        });
      },
    });
    // Populate the modal once from server state; afterward the form's own
    // values are authoritative (so a fast re-open doesn't get stomped by a
    // pre-broadcast stale state).
    let modalInitialized = false;
    const initFromState = () => {
      if (!state) return;
      mapSettings.setOptions({
        ...(state.mapOptions || {}),
        rows: state.rows,
        cols: state.cols,
        seed: packedSeedFor(state),
      });
      modalInitialized = true;
    };
    document.getElementById('map-settings-btn')?.addEventListener('click', () => {
      if (!modalInitialized) initFromState();
      mapSettings.open();
    });
  }
  document.getElementById('start-game-btn')?.addEventListener('click', () => {
    socket.emit(EVENTS.START_GAME);
    if (!state?.marker) {
      showToast("Click a tile to choose the players' starting point.");
    }
  });
  document.getElementById('export-png-btn')?.addEventListener('click', () => {
    baseCanvas.toBlob((blob) => {
      if (!blob) { showToast('Failed to export map.', true); return; }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `inkdrifter-map-${code}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast('Map export started.');
    }, 'image/png');
  });
  document.getElementById('export-json-btn')?.addEventListener('click', () => {
    fetch(`/lobbies/${code}/game-state.json?t=${Date.now()}`, { headers: authHeader })
      .then(res => {
        if (!res.ok) throw new Error('Export failed');
        return res.json();
      })
      .then(data => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `inkdrifter-game-state-${code}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showToast('Game state exported.');
      })
      .catch(() => showToast('Failed to export game state.', true));
  });
}

// ── POI modal + sidebar wiring ────────────────────────────────────────────────
poiModals = initPoiModals({
  socket,
  getState: () => state,
  getIsHost: () => isHost,
  showToast,
});

const poiTrayBtn = document.getElementById('poi-tray-btn');
let trayShown = false;
if (poiTrayBtn) {
  poiTrayBtn.addEventListener('click', () => {
    trayShown = !trayShown;
    poiModals.toggleTray(trayShown);
    poiTrayBtn.innerHTML = trayShown ? '\u{1f6a9} Hide Flag Tray' : '\u{1f6a9} Show Flag Tray';
  });
}

// ── Biome overlay toggle ──────────────────────────────────────────────────────
if (biomeToggleEl) {
  biomeToggleEl.checked = biomeOverlayOn;
  biomeToggleEl.addEventListener('change', () => {
    biomeOverlayOn = biomeToggleEl.checked;
    console.log('[biome-debug] toggle changed, on=', biomeOverlayOn,
      'state.biomeTags keys=', state?.biomeTags ? Object.keys(state.biomeTags).length : 'no-state',
      'biomeTags type=', state?.biomeTags?.constructor?.name);
    window.__biomeDebugged = false;
    window.__biomeDrawLogged = false;
    updateLegendVisibility();
  });
}
populateLegendSwatches();

// ── Disconnect modal ──────────────────────────────────────────────────────────
function buildExportState() {
  if (!state) return null;
  return {
    code: state.code,
    seed: state.seed,
    gridRows: state.rows,
    gridCols: state.cols,
    canvasWidth: state.canvasWidth,
    canvasHeight: state.canvasHeight,
    status: state.status,
    fog: { ...state.fog },
    marker: state.marker ? { ...state.marker } : null,
    revealedTiles: state.revealed ? [...state.revealed] : [],
    pendingRequests: state.pendingRequests ? state.pendingRequests.map(r => ({ ...r })) : [],
    players: JSON.parse(JSON.stringify(state.players)),
    hostName: state.hostName,
    hostConnected: state.hostConnected,
    biomeTags: state.biomeTags ? { ...state.biomeTags } : {},
    islands: state.islands,
    mapOptions: state.mapOptions ? { ...state.mapOptions } : {},
    pois: Array.isArray(state.pois) ? state.pois.map(p => ({ ...p })) : [],
  };
}

function showDisconnectModal() {
  if (document.getElementById('disconnect-modal')) return;

  const overlay = document.createElement('div');
  overlay.id = 'disconnect-modal';
  overlay.innerHTML = `
    <div class="disconnect-overlay">
      <div class="disconnect-card">
        <h2>Connection Lost</h2>
        <p>The game server is unreachable. Your local progress is preserved below.</p>
        <div class="disconnect-actions">
          <button id="export-local-btn" class="btn">Export Game State</button>
          <button id="reload-reconnect-btn" class="btn">Reload &amp; Reconnect</button>
          <button id="dismiss-disconnect-btn" class="btn-outline">Keep Playing Offline</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('export-local-btn').addEventListener('click', () => {
    const data = buildExportState();
    if (!data) {
      showToast('No game state available.', true);
      return;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `inkdrifter-game-state-${code}-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Game state exported.');
  });

  document.getElementById('reload-reconnect-btn').addEventListener('click', () => {
    location.reload();
  });

  document.getElementById('dismiss-disconnect-btn').addEventListener('click', () => {
    document.getElementById('disconnect-modal').remove();
  });
}

// ── Connect ───────────────────────────────────────────────────────────────────
if (!hostToken && !playerToken) {
  showToast('No credentials found. Returning to home.', true);
  setTimeout(() => { window.location.href = '/'; }, 2000);
} else {
  const role = hostToken ? 'host' : 'player';
  const token = hostToken || playerToken;
  socket.setCode(code, role, token);
  socket.connect();
  socket.on('connect_error', (err) => {
    console.error('Socket connection error:', err);
    showToast('Connection error. Please refresh.', true);
  });

  socket.on('reconnect_failed', (attempts) => {
    console.warn('Reconnect failed after', attempts, 'attempts');
    showDisconnectModal();
  });
}
