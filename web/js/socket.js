export const EVENTS = {
  AUTH: 'auth',
  MOVE_REQUEST: 'move_request',
  MARKER_MOVE: 'marker_move',
  FOG_TOGGLE: 'fog_toggle',
  ACKNOWLEDGE_REQUEST: 'acknowledge_request',
  NEW_GAME: 'new_game',
  START_GAME: 'start_game',
  REGENERATE_MAP: 'regenerate_map',
  UPDATE_MAP_OPTIONS: 'update_map_options',
  LOBBY_STATE: 'lobby_state',
  PLAYER_JOINED: 'player_joined',
  PLAYER_LEFT: 'player_left',
  MARKER_MOVED: 'marker_moved',
  MOVE_REQUESTED: 'move_requested',
  FOG_CHANGED: 'fog_changed',
  ERROR: 'error',
  LOBBY_CLOSED: 'lobby_closed',
  MAP_READY: 'map_ready',
  REQUEST_CANCELLED: 'request_cancelled',
  POI_CREATE: 'poi_create',
  POI_UPDATE: 'poi_update',
  POI_DELETE: 'poi_delete',
  POI_CREATED: 'poi_created',
  POI_UPDATED: 'poi_updated',
  POI_DELETED: 'poi_deleted',
};

export const POI_COLORS = ['pink', 'peach', 'cream', 'mint', 'sky', 'lavender'];
export const POI_COLOR_HEX = {
  pink:     '#f4b6c2',
  peach:    '#fcc8a1',
  cream:    '#f5e6a8',
  mint:     '#b8e2c8',
  sky:      '#b6d4f0',
  lavender: '#d4c5e8',
};
export const POI_NAME_MAX = 40;
export const POI_DESC_MAX = 240;

export const MAX_PLAYERS_PER_LOBBY = 8;

export const ERROR_CODES = {
  BAD_AUTH: 'bad_auth',
  NOT_HOST: 'not_host',
  OUT_OF_BOUNDS: 'out_of_bounds',
  NOT_IN_RING: 'not_in_ring',
  MARKER_NOT_PLACED: 'marker_not_placed',
  RATE_LIMITED: 'rate_limited',
  LOBBY_NOT_READY: 'lobby_not_ready',
  LOBBY_CLOSED: 'lobby_closed',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  POI_NOT_FOUND: 'poi_not_found',
  POI_INVALID: 'poi_invalid',
  POI_LIMIT: 'poi_limit',
};

export function createSocket() {
  const listeners = new Map();
  let code = null;
  let authRole = null;
  let authToken = null;
  let transport = null; // 'ws' | 'sse' | null
  let reconnectDelay = 1000;
  let reconnectTimer = null;
  let connectResolve = null;

  // ── WebSocket transport ──────────────────────────────────────────────
  let ws = null;
  let wsError = null;
  let wsTimeout = null;

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}?code=${code}`;
  }

  function openWs() {
    if (ws) { try { ws.close(); } catch {} ws = null; }
    wsError = null;
    ws = new WebSocket(wsUrl());

    // Timeout: if WS doesn't open within 5s, fall back to SSE
    wsTimeout = setTimeout(() => {
      if (ws && ws.readyState !== WebSocket.OPEN) {
        wsError = 'timeout';
        try { ws.close(); } catch {}
        ws = null;
        console.warn('WebSocket timed out, falling back to SSE');
        startSse();
      }
    }, 5000);

    ws.addEventListener('open', () => {
      clearTimeout(wsTimeout);
      wsTimeout = null;
      transport = 'ws';
      reconnectDelay = 1000;
      if (authRole && authToken) {
        ws.send(JSON.stringify({ type: EVENTS.AUTH, data: { code, role: authRole, token: authToken } }));
      }
      for (const fn of (listeners.get('connect') || [])) fn();
      if (connectResolve) { connectResolve(); connectResolve = null; }
    });

    ws.addEventListener('close', (e) => {
      clearTimeout(wsTimeout);
      wsTimeout = null;
      transport = null;
      for (const fn of (listeners.get('disconnect') || [])) fn(e);
      scheduleReconnect();
    });

    ws.addEventListener('error', (e) => {
      if (!wsError) {
        wsError = true;
        console.warn('WebSocket error, falling back to SSE');
        try { ws.close(); } catch {}
        ws = null;
        clearTimeout(wsTimeout);
        wsTimeout = null;
        startSse();
      }
      for (const fn of (listeners.get('connect_error') || [])) fn(e);
    });

    ws.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      for (const fn of (listeners.get(msg.type) || [])) {
        try { fn(msg.data, msg); } catch (err) { console.error('Socket handler error:', err); }
      }
    });
  }

  function closeWs() {
    clearTimeout(wsTimeout);
    wsTimeout = null;
    if (ws) { try { ws.close(); } catch {} ws = null; }
    transport = null;
  }

  function emitWs(type, data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type, data }));
    return true;
  }

  // ── SSE transport ────────────────────────────────────────────────────
  let sse = null;

  function sseUrl() {
    return `/sse?code=${encodeURIComponent(code)}&token=${encodeURIComponent(authToken)}&role=${encodeURIComponent(authRole)}`;
  }

  function postUrl() {
    return `/post-event?code=${encodeURIComponent(code)}&role=${encodeURIComponent(authRole)}`;
  }

  function startSse() {
    if (sse) { try { sse.close(); } catch {} sse = null; }

    try {
      sse = new EventSource(sseUrl());
    } catch (e) {
      console.error('Failed to create SSE connection:', e);
      return;
    }

    transport = 'sse';

    sse.addEventListener('open', () => {
      reconnectDelay = 1000;
      for (const fn of (listeners.get('connect') || [])) fn();
      if (connectResolve) { connectResolve(); connectResolve = null; }
    });

    sse.addEventListener('error', (e) => {
      for (const fn of (listeners.get('disconnect') || [])) fn(e);
      if (sse) { sse.close(); sse = null; }
      transport = null;
      scheduleReconnect();
    });

    sse.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      for (const fn of (listeners.get(msg.type) || [])) {
        try { fn(msg.data, msg); } catch (err) { console.error('Socket handler error:', err); }
      }
    };
  }

  function closeSse() {
    if (sse) { try { sse.close(); } catch {} sse = null; }
    transport = null;
  }

  async function emitSse(type, data, ackFn) {
    if (transport !== 'sse') return false;
    try {
      const res = await fetch(postUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ type, data }),
      });
      const result = await res.json().catch(() => ({}));
      if (ackFn) ackFn(result);
      return true;
    } catch (e) {
      console.error('POST event failed:', e);
      return false;
    }
  }

  // ── Reconnection ─────────────────────────────────────────────────────
  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      tryConnect();
      reconnectDelay = Math.min(reconnectDelay * 2, 5000);
    }, reconnectDelay);
  }

  function tryConnect() {
    if (code && authRole && authToken) {
      // Try WebSocket first, fall back to SSE on failure
      openWs();
    }
  }

  // ── Public API ───────────────────────────────────────────────────────
  return {
    connect() {
      return new Promise((resolve) => {
        if (transport === 'ws' && ws && ws.readyState === WebSocket.OPEN) { resolve(); return; }
        if (transport === 'sse' && sse && sse.readyState === EventSource.OPEN) { resolve(); return; }
        if (reconnectTimer) { connectResolve = resolve; return; }
        connectResolve = resolve;
        reconnectDelay = 1000;
        tryConnect();
      });
    },

    setCode(c, role, token) {
      code = c;
      authRole = role;
      authToken = token;
    },

    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },

    off(event, fn) {
      const list = listeners.get(event);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
    },

    async emit(type, data, ackFn) {
      if (transport === 'ws') {
        if (!emitWs(type, data)) return;
        if (ackFn) {
          const handler = (resp) => {
            this.off('ack', handler);
            ackFn(resp);
          };
          this.on('ack', handler);
        }
      } else if (transport === 'sse') {
        await emitSse(type, data, ackFn);
      }
    },

    async send(data) {
      if (transport === 'ws') {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify(data));
      } else if (transport === 'sse') {
        await emitSse(data.type, data.data);
      }
    },

    disconnect() {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      closeWs();
      closeSse();
    },

    getTransport() {
      return transport;
    },
  };
}
