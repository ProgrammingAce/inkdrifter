const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const path = require('path');
const { renderQueue } = require('./mapRender.js');
const { LobbyManager } = require('./lobbyManager.js');
const { hexNeighbors, MIN_GRID, MAX_GRID, MAX_PLAYERS_PER_LOBBY } = require('./lobby.js');
const { EVENTS, ERROR_CODES, GRACE_MS, IDLE_MS } = require('./protocol.js');
const {
  HEX_SIZE, HEX_W, HEX_H,
  DEFAULT_GRID_ORIGIN_X, DEFAULT_GRID_ORIGIN_Y,
} = require('../index.js');

const HEX_CONSTANTS_JS = [
  `export const HEX_SIZE = ${HEX_SIZE};`,
  `export const HEX_W = ${HEX_W};`,
  `export const HEX_H = ${HEX_H};`,
  `export const DEFAULT_GRID_ORIGIN_X = ${DEFAULT_GRID_ORIGIN_X};`,
  `export const DEFAULT_GRID_ORIGIN_Y = ${DEFAULT_GRID_ORIGIN_Y};`,
  `export const MIN_GRID = ${MIN_GRID};`,
  `export const MAX_GRID = ${MAX_GRID};`,
].join('\n') + '\n';

const PORT = process.env.PORT || 3000;
const ORIGIN = process.env.ORIGIN || false;

const app = express();
const httpServer = createServer(app);

// ── Socket.IO (existing) ───────────────────────────────────────────────────
const io = new Server(httpServer, {
  maxHttpBufferSize: '64kb',
  cors: { origin: ORIGIN },
});

const manager = new LobbyManager(io);

// ── Raw WebSocket (Cloudflare-compatible) ───────────────────────────────────
const rawWsServer = new WebSocketServer({ noServer: true });

// Handle upgrade: let Socket.IO handle /socket.io/, we handle everything else
httpServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/socket.io/')) {
    io.engine.handleUpgrade(req, socket, head);
  } else {
    rawWsServer.handleUpgrade(req, socket, head, (ws) => {
      rawWsServer.emit('connection', ws, req);
    });
  }
});

rawWsServer.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const code = url.searchParams.get('code');

  ws.addEventListener('close', () => {
    if (!code) return;
    const auth = manager.rawWs.get(code)?.get(ws);
    if (!auth) return;
    const lobby = manager.getLobby(code);
    if (!lobby) { manager.rawWs.get(code)?.delete(ws); return; }

    if (auth.role === 'host') {
      lobby.hostConnected = false;
      manager.broadcastState(code);
      manager.startGrace(code);
    } else if (auth.playerId) {
      const player = lobby.players[auth.playerId];
      if (player) {
        player.connected = false;
        if (player.socketId) {
          const oldIo = io.sockets.sockets.get(player.socketId);
          if (oldIo) oldIo.disconnect();
          player.socketId = null;
        }
        const cancelled = lobby.cancelPlayerRequests(auth.playerId);
        for (const { requestId } of cancelled) {
          manager.broadcast(code, EVENTS.REQUEST_CANCELLED, { requestId, reason: 'player_left' });
        }
        manager.broadcast(code, EVENTS.PLAYER_LEFT, { playerId: auth.playerId });
      }
    }
    manager.rawWs.get(code)?.delete(ws);
  });

  ws.on('message', (rawData) => {
    let msg;
    try { msg = JSON.parse(rawData.toString()); } catch { return; }
    handleRawWsMessage(ws, code, msg);
  });
});

function handleRawWsMessage(ws, code, msg) {
  if (!code) return;
  const { type, data } = msg;
  const lobby = manager.getLobby(code);
  if (!lobby && type !== EVENTS.AUTH) return;

  const wsMap = manager.rawWs.get(code);

  if (type === EVENTS.AUTH) {
    handleRawAuth(ws, code, data, lobby);
    return;
  }

  const auth = wsMap?.get(ws);
  if (!auth) return;

  switch (type) {
    case EVENTS.MARKER_MOVE:
      handleRawMarkerMove(ws, code, auth, data, lobby);
      break;
    case EVENTS.MOVE_REQUEST:
      handleRawMoveRequest(ws, code, auth, data, lobby);
      break;
    case EVENTS.FOG_TOGGLE:
      handleRawFogToggle(ws, code, auth, data, lobby);
      break;
    case EVENTS.ACKNOWLEDGE_REQUEST:
      handleRawAcknowledge(ws, code, auth, data, lobby);
      break;
    case EVENTS.NEW_GAME:
      handleRawNewGame(ws, code, auth, lobby);
      break;
    case EVENTS.START_GAME:
      handleRawStartGame(ws, code, auth, lobby);
      break;
    case EVENTS.REGENERATE_MAP:
      handleRawRegenerate(ws, code, auth, lobby);
      break;
    case EVENTS.UPDATE_MAP_OPTIONS:
      handleRawUpdateMapOptions(ws, code, auth, data, lobby);
      break;
    case EVENTS.POI_CREATE:
      handleRawPoiCreate(ws, code, auth, data, lobby);
      break;
    case EVENTS.POI_UPDATE:
      handleRawPoiUpdate(ws, code, auth, data, lobby);
      break;
    case EVENTS.POI_DELETE:
      handleRawPoiDelete(ws, code, auth, data, lobby);
      break;
    case 'ping':
      // Keepalive — update activity timestamp to prevent idle eviction
      if (lobby) lobby.touchActivity();
      break;
  }
}

function handleRawAuth(ws, code, { code: reqCode, role, token }, lobby) {
  if (typeof reqCode !== 'string' || typeof role !== 'string' || typeof token !== 'string') {
    manager._wsSend(ws, EVENTS.ERROR, { code: ERROR_CODES.BAD_AUTH, message: 'Invalid auth payload' });
    return ws.close();
  }

  if (!lobby) {
    manager._wsSend(ws, EVENTS.ERROR, { code: ERROR_CODES.BAD_AUTH, message: 'Lobby not found' });
    return ws.close();
  }

  const wsMap = manager.rawWs.get(code);
  if (!wsMap) { manager.rawWs.set(code, new Map()); }
  const targetMap = manager.rawWs.get(code);

  if (role === 'host') {
    if (token !== lobby.hostToken) {
      manager._wsSend(ws, EVENTS.ERROR, { code: ERROR_CODES.BAD_AUTH, message: 'Invalid host token' });
      return ws.close();
    }
    // Displace existing host raw WS
    for (const [existing, auth] of targetMap) {
      if (auth.role === 'host' && existing !== ws) {
        manager._wsSend(existing, EVENTS.LOBBY_CLOSED, { reason: 'host_replaced' });
        existing.close();
      }
    }
    manager.clearGrace(code);
    lobby.hostConnected = true;
    targetMap.set(ws, { role: 'host' });
    manager._wsSend(ws, EVENTS.LOBBY_STATE, lobby.toWire('host', null));
  } else if (role === 'player') {
    const found = lobby.findPlayerByToken(token);
    if (!found) {
      manager._wsSend(ws, EVENTS.ERROR, { code: ERROR_CODES.BAD_AUTH, message: 'Invalid player token' });
      return ws.close();
    }
    const { playerId, player } = found;
    player.connected = true;
    targetMap.set(ws, { role: 'player', playerId });
    manager._wsSend(ws, EVENTS.LOBBY_STATE, lobby.toWire('player', playerId));
    manager.broadcast(code, EVENTS.PLAYER_JOINED, { playerId, name: player.name }, { excludeWs: ws });
  } else {
    manager._wsSend(ws, EVENTS.ERROR, { code: ERROR_CODES.BAD_AUTH, message: 'Invalid role' });
    ws.close();
  }
}

function handleRawMarkerMove(ws, code, auth, data, lobby) {
  if (auth.role !== 'host') return;
  if (!lobby || lobby.status !== 'ready') return;
  if (!lobby.canMarkerMove()) return;
  const { row, col } = data || {};
  const r = toInt(row);
  const c = toInt(col);
  if (r == null || c == null || r < 0 || r >= lobby.rows || c < 0 || c >= lobby.cols) {
    return manager._wsSend(ws, EVENTS.ERROR, { code: ERROR_CODES.OUT_OF_BOUNDS, message: 'Position out of bounds' });
  }
  const { revealedDelta, cancelled } = lobby.moveMarker(r, c);
  manager.broadcast(code, EVENTS.MARKER_MOVED, { row: r, col: c, revealedDelta });
  for (const req of cancelled) {
    manager.broadcast(code, EVENTS.REQUEST_CANCELLED, { requestId: req.requestId, reason: 'marker_moved' });
  }
  if (revealedDelta.length > 0) {
    const newKeys = new Set(revealedDelta.map(([r, c]) => `${r},${c}`));
    const newlyVisible = lobby.pois.filter(p => p.visibility === 'public' && newKeys.has(`${p.row},${p.col}`));
    if (newlyVisible.length > 0) {
      for (const poi of newlyVisible) {
        const wsMap = manager.rawWs.get(code);
        if (wsMap) {
          for (const [pws, pa] of wsMap) {
            if (pa.role === 'player') manager._wsSend(pws, EVENTS.POI_CREATED, { poi });
          }
        }
      }
    }
  }
}

function handleRawMoveRequest(ws, code, auth, data, lobby) {
  if (auth.role !== 'player') return;
  if (!lobby || lobby.status !== 'ready') return;
  const { row, col } = data || {};
  const r = toInt(row);
  const c = toInt(col);
  if (r == null || c == null || r < 0 || r >= lobby.rows || c < 0 || c >= lobby.cols) {
    return manager._wsSend(ws, EVENTS.ERROR, { code: ERROR_CODES.OUT_OF_BOUNDS, message: 'Position out of bounds' });
  }
  const result = lobby.addMoveRequest(auth.playerId, r, c);
  if (result.error) {
    manager._wsSend(ws, EVENTS.ERROR, { code: result.error, message: result.error });
    if (result.disconnect) ws.close();
    return;
  }
  const player = lobby.players[auth.playerId];
  if (result.cancelledRequestId) {
    manager.broadcast(code, EVENTS.REQUEST_CANCELLED, { requestId: result.cancelledRequestId, reason: 'replaced' });
  }
  manager.broadcast(code, EVENTS.MOVE_REQUESTED, {
    playerId: auth.playerId, name: player.name, row: r, col: c, requestId: result.requestId, at: result.at,
  }, { excludeWs: ws });
}

function handleRawFogToggle(ws, code, auth, data, lobby) {
  if (auth.role !== 'host') return;
  if (!lobby) return;
  const { target, enabled } = data || {};
  if (target !== 'host' && target !== 'players') return;
  lobby.setFog(target, !!enabled);
  manager.broadcast(code, EVENTS.FOG_CHANGED, { hostFog: lobby.fog.host, playerFog: lobby.fog.players });
}

function handleRawAcknowledge(ws, code, auth, data, lobby) {
  if (auth.role !== 'host') return;
  if (!lobby) return;
  const { requestId } = data || {};
  if (!lobby.acknowledgeRequest(requestId)) return;
  manager.broadcast(code, EVENTS.REQUEST_CANCELLED, { requestId, reason: 'acknowledged' });
}

function handleRawNewGame(ws, code, auth, lobby) {
  if (auth.role !== 'host') return;
  manager.destroyLobby(code, 'new_game');
}

function handleRawStartGame(ws, code, auth, lobby) {
  if (auth.role !== 'host') return;
  if (!lobby || lobby.status !== 'preview') return;
  lobby.startGame();
  manager.broadcastState(code);
}

function handleRawRegenerate(ws, code, auth, lobby) {
  if (auth.role !== 'host') return;
  if (!lobby || lobby.status !== 'preview') return;
  lobby.regenerate();
  manager.broadcastState(code);
  enqueueRender(lobby.code, { errorLabel: 'Regenerate' });
}

function handleRawUpdateMapOptions(ws, code, auth, data, lobby) {
  if (auth.role !== 'host') return;
  if (!lobby || lobby.status !== 'preview') return;
  const m = parseMapOptions(data || {});
  if (m.error) {
    return manager._wsSend(ws, 'ack', { ok: false, error: m.error });
  }
  lobby.mapOptions = { ...m.options, islands: lobby.islands };
  manager._wsSend(ws, 'ack', { ok: true });
  manager.broadcastState(code);
}

function handleRawPoiCreate(ws, code, auth, data, lobby) {
  if (!lobby || lobby.status !== 'ready') return;
  if (!lobby.canPoiMutate()) return manager._wsSend(ws, EVENTS.ERROR, { code: ERROR_CODES.RATE_LIMITED, message: 'Slow down' });
  const role = auth.role;
  const result = lobby.createPoi(data || {}, role, auth.playerId);
  if (result.error) return manager._wsSend(ws, EVENTS.ERROR, { code: result.error, message: result.error });
  manager.broadcastPoiChange(code, null, result.poi);
}

function handleRawPoiUpdate(ws, code, auth, data, lobby) {
  if (!lobby || lobby.status !== 'ready') return;
  if (typeof data?.id !== 'string') return manager._wsSend(ws, EVENTS.ERROR, { code: ERROR_CODES.POI_INVALID, message: 'Missing id' });
  if (!lobby.canPoiMutate()) return manager._wsSend(ws, EVENTS.ERROR, { code: ERROR_CODES.RATE_LIMITED, message: 'Slow down' });
  const { id, ...patch } = data;
  const result = lobby.updatePoi(id, patch, auth.role);
  if (result.error) return manager._wsSend(ws, EVENTS.ERROR, { code: result.error, message: result.error });
  manager.broadcastPoiChange(code, result.before, result.after);
}

function handleRawPoiDelete(ws, code, auth, data, lobby) {
  if (!lobby || lobby.status !== 'ready') return;
  if (typeof data?.id !== 'string') return manager._wsSend(ws, EVENTS.ERROR, { code: ERROR_CODES.POI_INVALID, message: 'Invalid POI data' });
  if (!lobby.canPoiMutate()) return manager._wsSend(ws, EVENTS.ERROR, { code: ERROR_CODES.RATE_LIMITED, message: 'Slow down' });
  const result = lobby.deletePoi(data.id);
  if (result.error) return manager._wsSend(ws, EVENTS.ERROR, { code: result.error, message: result.error });
  manager.broadcastPoiChange(code, result.poi, null);
}

app.use(express.json({ limit: '4kb' }));

// ── SSE transport (Cloudflare-compatible) ────────────────────────────────────
app.get('/sse', (req, res) => {
  const code = req.query.code;
  const token = req.query.token;
  const role = req.query.role;

  if (!code || !token || !role) {
    return res.status(400).send('Missing parameters: code, token, role');
  }

  const lobby = manager.getLobby(code);
  if (!lobby) {
    return res.status(404).send('Lobby not found');
  }

  let auth;
  if (role === 'host') {
    if (token !== lobby.hostToken) return res.status(403).send('Invalid host token');
    manager.clearGrace(code);
    lobby.hostConnected = true;
    auth = { role: 'host' };
  } else if (role === 'player') {
    const found = lobby.findPlayerByToken(token);
    if (!found) return res.status(403).send('Invalid player token');
    const { playerId, player } = found;
    player.connected = true;
    auth = { role: 'player', playerId };
  } else {
    return res.status(400).send('Invalid role');
  }

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const sseObj = { writer, encoder, auth };

  // Register SSE connection
  const sseMap = manager.sseConns.get(code);
  if (!sseMap) { manager.sseConns.set(code, new Map()); }
  manager.sseConns.get(code).set(sseObj, auth);

  // Send initial state
  const role2 = auth.role;
  const playerId = auth.playerId || null;
  writer.write(encoder.encode(`data: ${JSON.stringify({ type: EVENTS.LOBBY_STATE, data: lobby.toWire(role2, playerId) })}\n\n`));

  // Notify others about player join
  if (role === 'player') {
    const player = lobby.players[auth.playerId];
    if (player) {
      manager.broadcast(code, EVENTS.PLAYER_JOINED, { playerId: auth.playerId, name: player.name });
    }
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.writeHead(200);

  // Pipe readable to response
  readable.pipeTo(new WritableStream({
    write(chunk) {
      res.write(chunk);
    },
    close() { res.end(); },
    abort(err) { res.end(); },
  }));

  // Handle client disconnect
  req.on('close', () => {
    writer.close().catch(() => {});
    const sseM = manager.sseConns.get(code);
    if (sseM) {
      sseM.delete(sseObj);
      if (!sseM.size) manager.sseConns.delete(code);
    }
    handleSSEDisconnect(code, auth);
  });
});

function handleSSEDisconnect(code, auth) {
  const lobby = manager.getLobby(code);
  if (!lobby) return;
  if (auth.role === 'host') {
    lobby.hostConnected = false;
    manager.broadcastState(code);
    manager.startGrace(code);
  } else if (auth.playerId) {
    const player = lobby.players[auth.playerId];
    if (player) {
      player.connected = false;
      const cancelled = lobby.cancelPlayerRequests(auth.playerId);
      for (const { requestId } of cancelled) {
        manager.broadcast(code, EVENTS.REQUEST_CANCELLED, { requestId, reason: 'player_left' });
      }
      manager.broadcast(code, EVENTS.PLAYER_LEFT, { playerId: auth.playerId });
    }
  }
}

// ── POST-event (Cloudflare-compatible, for SSE clients) ─────────────────────
app.post('/post-event', (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const code = url.searchParams.get('code');
  const role = url.searchParams.get('role');
  const auth = req.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const token = bearer || '';

  if (!code || !token || !role) return res.status(400).json({ error: 'missing_params' });

  const lobby = manager.getLobby(code);
  if (!lobby) return res.status(404).json({ error: ERROR_CODES.NO_SUCH_LOBBY });

  let authObj;
  if (role === 'host') {
    if (token !== lobby.hostToken) return res.status(403).json({ error: ERROR_CODES.BAD_AUTH });
    authObj = { role: 'host' };
  } else if (role === 'player') {
    const found = lobby.findPlayerByToken(token);
    if (!found) return res.status(403).json({ error: ERROR_CODES.BAD_AUTH });
    authObj = { role: 'player', playerId: found.playerId };
  } else {
    return res.status(400).json({ error: ERROR_CODES.BAD_AUTH });
  }

  const body = req.body;
  const captured = { msg: null };

  // Create a fake WS that captures send calls
  const fakeWs = {
    send: (data) => { captured.msg = JSON.parse(data); },
    close: () => {},
  };

  // Temporarily register the fake WS
  const wsMap = manager.rawWs.get(code);
  if (wsMap) wsMap.set(fakeWs, authObj);

  handleRawWsMessage(fakeWs, code, body);

  // Clean up fake WS
  if (wsMap) wsMap.delete(fakeWs);

  if (captured.msg) return res.json(captured.msg);
  return res.json({ ok: true });
});

// ── Hex constants (generated) ────────────────────────────────────────────────
app.get('/js/hex-constants.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.set('Cache-Control', 'no-cache');
  res.send(HEX_CONSTANTS_JS);
});

// Serve bundled JS from dist/ (built by `npm run build`) so the browser gets
// esbuild-bundled ESM rather than the source files in web/js, which import
// CommonJS modules from src/ and can't run in the browser.
app.use('/js', express.static(path.join(__dirname, '..', 'dist')));
app.use(express.static(path.join(__dirname, '..', 'web')));

// ── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeName(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/\s+/g, ' ');
  const codePoints = [...s];
  if (codePoints.length < 1 || codePoints.length > 24) return null;
  return s;
}

function toInt(raw) {
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) ? n : null;
}

function parseGridParams(req) {
  const rows = toInt(req.body.rows);
  const cols = toInt(req.body.cols);
  if (rows == null || rows < MIN_GRID || rows > MAX_GRID) return { error: 'bad_rows' };
  if (cols == null || cols < MIN_GRID || cols > MAX_GRID) return { error: 'bad_cols' };
  return { rows, cols };
}

function parseMapOptions(body) {
  const opts = {};
  if (body.drawOcean === false) opts.drawOcean = false;
  if (body.drawRiver === false) opts.drawRiver = false;
  if (body.drawGrid === false) opts.drawGrid = false;
  if (body.placeCities === false) opts.placeCities = false;
  if (body.oceanCap != null && body.oceanCap !== '') {
    const cap = Number(body.oceanCap);
    if (!Number.isFinite(cap) || cap < 0.05 || cap > 0.80) return { error: 'bad_ocean_cap' };
    opts.oceanCap = cap;
  }
  if (body.riverCount != null && body.riverCount !== '') {
    const rc = toInt(body.riverCount);
    if (rc == null || rc < 0 || rc > 20) return { error: 'bad_river_count' };
    opts.riverCount = rc;
  }
  if (body.cityCount != null && body.cityCount !== '') {
    const cc = toInt(body.cityCount);
    if (cc == null || cc < 0 || cc > 20) return { error: 'bad_city_count' };
    opts.cityCount = cc;
    if (cc === 0) opts.placeCities = false;
  }
  if (body.coastSides != null) {
    if (!Array.isArray(body.coastSides)) return { error: 'bad_coast_sides' };
    const valid = ['N', 'S', 'E', 'W'];
    const sides = body.coastSides.filter(s => valid.includes(s));
    if (sides.length !== body.coastSides.length) return { error: 'bad_coast_sides' };
    opts.sides = sides;
  }
  if (body.elevationBias != null && body.elevationBias !== '') {
    const eb = Number(body.elevationBias);
    if (!Number.isFinite(eb) || eb < -0.4 || eb > 0.4) return { error: 'bad_elevation' };
    opts.elevationBias = eb;
  }
  if (body.humidityBias != null && body.humidityBias !== '') {
    const hb = Number(body.humidityBias);
    if (!Number.isFinite(hb) || hb < -0.4 || hb > 0.4) return { error: 'bad_humidity' };
    opts.humidityBias = hb;
  }
  return { options: opts };
}

function parseSeed(raw, { required = false } = {}) {
  if (raw == null || raw === '') {
    return required ? { error: 'bad_seed' } : { seed: crypto.randomInt(0, 2 ** 32) };
  }
  const seed = toInt(raw);
  if (seed == null || seed < 0 || seed > 0xFFFFFFFF) return { error: 'bad_seed' };
  return { seed };
}

function lobbyCreatedResponse(lobby) {
  return {
    code: lobby.code,
    seed: lobby.seed,
    rows: lobby.rows,
    cols: lobby.cols,
    status: lobby.status,
    hostToken: lobby.hostToken,
  };
}

function authorizeLobby(req, lobby) {
  const auth = req.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const token = bearer || (typeof req.query.token === 'string' ? req.query.token : null);
  if (!token) return false;
  if (token === lobby.hostToken) return true;
  return Object.values(lobby.players).some(p => p.token === token);
}

// ── HTTP Routes ───────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ ok: true, lobbies: manager.lobbies.size });
});

async function createLobbyAndRender(req, res, { onReady, errorLabel, requireSeed = false }) {
  const name = sanitizeName(req.body.hostName);
  if (!name) return res.status(400).json({ error: 'bad_host_name' });
  const grid = parseGridParams(req);
  if (grid.error) return res.status(400).json({ error: grid.error });
  const s = parseSeed(req.body.seed, { required: requireSeed });
  if (s.error) return res.status(400).json({ error: s.error });
  const islands = !!req.body.islands;
  const m = parseMapOptions(req.body);
  if (m.error) return res.status(400).json({ error: m.error });

  let lobby;
  try {
    lobby = await manager.createLobby({ rows: grid.rows, cols: grid.cols, seed: s.seed, hostName: name, islands, mapOptions: m.options });
  } catch (e) {
    if (e.code === 503) return res.status(503).json({ error: 'code_exhausted' });
    throw e;
  }

  res.status(202).json(lobbyCreatedResponse(lobby));
  enqueueRender(lobby.code, { onReady, errorLabel });
}

app.post('/api/lobbies/import', (req, res) => {
  const { status, fog, marker, revealedTiles, pois } = req.body;
  return createLobbyAndRender(req, res, {
    errorLabel: 'Import render',
    requireSeed: true,
    onReady: (l) => l.loadImportState({ status, fog, marker, revealedTiles, pois }),
  });
});

app.post('/api/lobbies', (req, res) => {
  return createLobbyAndRender(req, res, { errorLabel: 'Render' });
});

app.post('/api/lobbies/:code/join', (req, res) => {
  const { code } = req.params;
  const lobby = manager.getLobby(code);
  if (!lobby) return res.status(404).json({ error: ERROR_CODES.NO_SUCH_LOBBY });
  if (lobby.status !== 'ready') return res.status(409).json({ error: ERROR_CODES.LOBBY_NOT_READY });
  if (lobby.playerCount >= MAX_PLAYERS_PER_LOBBY) return res.status(409).json({ error: ERROR_CODES.LOBBY_FULL });

  const name = sanitizeName(req.body.playerName);
  if (!name) return res.status(400).json({ error: 'bad_player_name' });
  if (lobby.hasPlayerName(name)) return res.status(409).json({ error: ERROR_CODES.NAME_TAKEN });
  if (lobby.hostName === name) return res.status(409).json({ error: ERROR_CODES.NAME_TAKEN });

  const result = lobby.addPlayer(name);
  if (!result) return res.status(409).json({ error: ERROR_CODES.LOBBY_FULL });

  res.json({ playerToken: result.playerToken, playerId: result.playerId });
});

// Cloudflare-compatible: /create and /import (route to same logic)
app.post('/create', (req, res) => {
  return createLobbyAndRender(req, res, { errorLabel: 'Render' });
});

app.post('/import', (req, res) => {
  const { status, fog, marker, revealedTiles, pois } = req.body;
  return createLobbyAndRender(req, res, {
    errorLabel: 'Import render',
    requireSeed: true,
    onReady: (l) => l.loadImportState({ status, fog, marker, revealedTiles, pois }),
  });
});

// Cloudflare-compatible: /get
app.get('/get', (req, res) => {
  const code = req.query.code;
  const lobby = manager.getLobby(code);
  if (!lobby) return res.status(404).json({ error: ERROR_CODES.NO_SUCH_LOBBY });
  res.json({
    code: lobby.code,
    seed: lobby.seed,
    rows: lobby.rows,
    cols: lobby.cols,
    islands: lobby.islands,
    canvasWidth: lobby.canvasWidth,
    canvasHeight: lobby.canvasHeight,
    status: lobby.status,
    hostName: lobby.hostName,
    mapOptions: lobby.mapOptions,
  });
});

// Cloudflare-compatible: /join
app.post('/join', (req, res) => {
  const code = req.query.code;
  const lobby = manager.getLobby(code);
  if (!lobby) return res.status(404).json({ error: ERROR_CODES.NO_SUCH_LOBBY });
  if (lobby.status !== 'ready') return res.status(409).json({ error: ERROR_CODES.LOBBY_NOT_READY });
  if (lobby.playerCount >= MAX_PLAYERS_PER_LOBBY) return res.status(409).json({ error: ERROR_CODES.LOBBY_FULL });

  const name = sanitizeName(req.body.playerName);
  if (!name) return res.status(400).json({ error: 'bad_player_name' });
  if (lobby.hasPlayerName(name)) return res.status(409).json({ error: ERROR_CODES.NAME_TAKEN });
  if (lobby.hostName === name) return res.status(409).json({ error: ERROR_CODES.NAME_TAKEN });

  const result = lobby.addPlayer(name);
  if (!result) return res.status(409).json({ error: ERROR_CODES.LOBBY_FULL });

  res.json({ playerToken: result.playerToken, playerId: result.playerId });
});

// Cloudflare-compatible: /game-state
app.get('/game-state', (req, res) => {
  const code = req.query.code;
  const lobby = manager.getLobby(code);
  if (!lobby) return res.status(404).json({ error: ERROR_CODES.NO_SUCH_LOBBY });
  const auth = req.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!bearer || !authorizeLobby(req, lobby)) return res.status(403).json({ error: 'forbidden' });
  res.json(lobby.toJSONExport());
});

// Cloudflare-compatible: /render-complete
app.post('/render-complete', (req, res) => {
  const code = req.query.code;
  const lobby = manager.getLobby(code);
  if (!lobby) return res.status(404).json({ error: ERROR_CODES.NO_SUCH_LOBBY });
  const auth = req.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!bearer || bearer !== lobby.hostToken) return res.status(403).json({ error: 'forbidden' });

  const body = req.body || {};

  // If still rendering, mark ready (server may not have finished yet)
  if (lobby.status === 'rendering') {
    lobby.setReady(null);
  }
  // If already in preview, just update biomeTags (server finished first)

  if (lobby._pendingImport) {
    try { lobby.loadImportState(lobby._pendingImport); } catch {}
    lobby._pendingImport = null;
  }
  if (body.biomeTags) {
    lobby.biomeTags = body.biomeTags;
  }
  manager.broadcast(code, EVENTS.MAP_READY);
  manager.broadcastState(code);

  return res.json({ ok: true });
});

// Existing routes
app.get('/lobbies/:code/map.png', (req, res) => {
  const lobby = manager.getLobby(req.params.code);
  if (!lobby || !lobby.pngBuffer) return res.status(404).send('Not found');
  if (!authorizeLobby(req, lobby)) return res.status(403).send('Forbidden');
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.send(lobby.pngBuffer);
});

app.get('/lobbies/:code/game-state.json', (req, res) => {
  const lobby = manager.getLobby(req.params.code);
  if (!lobby) return res.status(404).json({ error: 'no_such_lobby' });
  if (!authorizeLobby(req, lobby)) return res.status(403).json({ error: 'forbidden' });
  res.set('Content-Type', 'application/json');
  res.json(lobby.toJSONExport());
});

app.get('/api/lobbies/:code', (req, res) => {
  const lobby = manager.getLobby(req.params.code);
  if (!lobby) return res.status(404).json({ error: 'no_such_lobby' });
  res.json({
    code: lobby.code,
    seed: lobby.seed,
    rows: lobby.rows,
    cols: lobby.cols,
    islands: lobby.islands,
    canvasWidth: lobby.canvasWidth,
    canvasHeight: lobby.canvasHeight,
    status: lobby.status,
    hostName: lobby.hostName,
    mapOptions: lobby.mapOptions,
  });
});

// Render-complete (existing route, kept for compatibility)
app.post('/api/lobbies/:code/render-complete', (req, res) => {
  const code = req.params.code;
  const lobby = manager.getLobby(code);
  if (!lobby) return res.status(404).json({ error: 'not_found' });
  const auth = req.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!bearer || bearer !== lobby.hostToken) return res.status(403).json({ error: 'forbidden' });

  const body = req.body || {};
  if (lobby.status === 'rendering') {
    lobby.setReady(null);
  }
  if (lobby._pendingImport) {
    try { lobby.loadImportState(lobby._pendingImport); } catch {}
    lobby._pendingImport = null;
  }
  if (body.biomeTags) {
    lobby.biomeTags = body.biomeTags;
  }
  manager.broadcast(code, EVENTS.MAP_READY);
  manager.broadcastState(code);

  return res.json({ ok: true });
});

// Serve lobby.html
app.get('/lobby/:code', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'lobby.html'));
});

// ── Render queue ──────────────────────────────────────────────────────────────

function enqueueRender(code, { onReady, errorLabel = 'Render' } = {}) {
  const lobby = manager.getLobby(code);
  if (!lobby) return;
  renderQueue.render(lobby.seed, lobby.rows, lobby.cols, lobby.mapOptions).then(({ pngBuffer, biomeTags }) => {
    const l = manager.getLobby(code);
    if (!l) return;
    l.setReady(pngBuffer, biomeTags);
    if (onReady) onReady(l);
    manager.broadcast(code, EVENTS.MAP_READY);
    manager.broadcastState(code);
  }).catch(err => {
    console.error(`${errorLabel} failed for lobby`, code, err);
    manager.destroyLobby(code, 'render_failed');
  });
}

// ── Socket.IO handlers (existing, use manager.broadcast) ─────────────────────

io.on('connection', (socket) => {
  socket.data.authenticated = false;
  socket.data.isHost = false;
  socket.data.playerId = null;
  socket.data.lobbyCode = null;

  socket.on(EVENTS.AUTH, async ({ code, role, token } = {}) => {
    if (socket.data.authenticated) return;
    if (typeof code !== 'string' || typeof role !== 'string' || typeof token !== 'string') {
      socket.emit(EVENTS.ERROR, { code: ERROR_CODES.BAD_AUTH, message: 'Invalid auth payload' });
      return socket.disconnect();
    }

    const lobby = manager.getLobby(code);
    if (!lobby) {
      socket.emit(EVENTS.ERROR, { code: ERROR_CODES.BAD_AUTH, message: 'Lobby not found' });
      return socket.disconnect();
    }

    if (role === 'host') {
      if (token !== lobby.hostToken) {
        socket.emit(EVENTS.ERROR, { code: ERROR_CODES.BAD_AUTH, message: 'Invalid host token' });
        return socket.disconnect();
      }
      if (lobby.hostSocketId && lobby.hostSocketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(lobby.hostSocketId);
        if (oldSocket) {
          oldSocket.emit(EVENTS.LOBBY_CLOSED, { reason: 'host_replaced' });
          oldSocket.disconnect();
        }
      }
      manager.clearGrace(code);
      lobby.hostConnected = true;
      lobby.hostSocketId = socket.id;
      socket.data.authenticated = true;
      socket.data.isHost = true;
      socket.data.lobbyCode = code;
      await socket.join(code);
      socket.emit(EVENTS.LOBBY_STATE, lobby.toWire('host', null));
    } else if (role === 'player') {
      const found = lobby.findPlayerByToken(token);
      if (!found) {
        socket.emit(EVENTS.ERROR, { code: ERROR_CODES.BAD_AUTH, message: 'Invalid player token' });
        return socket.disconnect();
      }
      const { playerId, player } = found;
      if (player.socketId && player.socketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(player.socketId);
        if (oldSocket) oldSocket.disconnect();
      }
      player.connected = true;
      player.socketId = socket.id;
      socket.data.authenticated = true;
      socket.data.isHost = false;
      socket.data.playerId = playerId;
      socket.data.lobbyCode = code;
      await socket.join(code);
      socket.emit(EVENTS.LOBBY_STATE, lobby.toWire('player', playerId));
      manager.broadcast(code, EVENTS.PLAYER_JOINED, { playerId, name: player.name });
    } else {
      socket.emit(EVENTS.ERROR, { code: ERROR_CODES.BAD_AUTH, message: 'Invalid role' });
      socket.disconnect();
    }
  });

  socket.on(EVENTS.MARKER_MOVE, ({ row, col } = {}) => {
    if (!socket.data.authenticated) return;
    if (!socket.data.isHost) return socket.emit(EVENTS.ERROR, { code: ERROR_CODES.NOT_HOST, message: 'Only host can move marker' });
    const lobby = manager.getLobby(socket.data.lobbyCode);
    if (!lobby) return;
    if (lobby.status !== 'ready') return socket.emit(EVENTS.ERROR, { code: ERROR_CODES.LOBBY_NOT_READY, message: 'Map not ready' });
    if (!lobby.canMarkerMove()) return;
    const r = toInt(row);
    const c = toInt(col);
    if (r == null || c == null || r < 0 || r >= lobby.rows || c < 0 || c >= lobby.cols) {
      return socket.emit(EVENTS.ERROR, { code: ERROR_CODES.OUT_OF_BOUNDS, message: 'Position out of bounds' });
    }
    const { revealedDelta, cancelled } = lobby.moveMarker(r, c);
    manager.broadcast(socket.data.lobbyCode, EVENTS.MARKER_MOVED, { row: r, col: c, revealedDelta });
    for (const req of cancelled) {
      manager.broadcast(socket.data.lobbyCode, EVENTS.REQUEST_CANCELLED, { requestId: req.requestId, reason: 'marker_moved' });
    }
    if (revealedDelta.length > 0) {
      const newKeys = new Set(revealedDelta.map(([r, c]) => `${r},${c}`));
      const newlyVisible = lobby.pois.filter(p => p.visibility === 'public' && newKeys.has(`${p.row},${p.col}`));
      if (newlyVisible.length > 0) {
        io.in(socket.data.lobbyCode).fetchSockets().then(sockets => {
          for (const s of sockets) {
            if (!s.data.authenticated || s.data.isHost) continue;
            for (const poi of newlyVisible) s.emit(EVENTS.POI_CREATED, { poi });
          }
        });
      }
    }
  });

  socket.on(EVENTS.MOVE_REQUEST, ({ row, col } = {}) => {
    if (!socket.data.authenticated) return;
    if (socket.data.isHost) return;
    const lobby = manager.getLobby(socket.data.lobbyCode);
    if (!lobby) return;
    if (lobby.status !== 'ready') return socket.emit(EVENTS.ERROR, { code: ERROR_CODES.LOBBY_NOT_READY, message: 'Map not ready' });
    const r = toInt(row);
    const c = toInt(col);
    if (r == null || c == null || r < 0 || r >= lobby.rows || c < 0 || c >= lobby.cols) {
      return socket.emit(EVENTS.ERROR, { code: ERROR_CODES.OUT_OF_BOUNDS, message: 'Position out of bounds' });
    }
    const result = lobby.addMoveRequest(socket.data.playerId, r, c);
    if (result.error) {
      socket.emit(EVENTS.ERROR, { code: result.error, message: result.error });
      if (result.disconnect) socket.disconnect();
      return;
    }
    const player = lobby.players[socket.data.playerId];
    if (result.cancelledRequestId) {
      manager.broadcast(socket.data.lobbyCode, EVENTS.REQUEST_CANCELLED, { requestId: result.cancelledRequestId, reason: 'replaced' });
    }
    manager.broadcast(socket.data.lobbyCode, EVENTS.MOVE_REQUESTED, {
      playerId: socket.data.playerId, name: player.name, row: r, col: c, requestId: result.requestId, at: result.at,
    });
  });

  socket.on(EVENTS.FOG_TOGGLE, ({ target, enabled } = {}) => {
    if (!socket.data.authenticated) return;
    if (!socket.data.isHost) return socket.emit(EVENTS.ERROR, { code: ERROR_CODES.NOT_HOST, message: 'Only host can toggle fog' });
    const lobby = manager.getLobby(socket.data.lobbyCode);
    if (!lobby) return;
    if (target !== 'host' && target !== 'players') return;
    lobby.setFog(target, !!enabled);
    manager.broadcast(socket.data.lobbyCode, EVENTS.FOG_CHANGED, { hostFog: lobby.fog.host, playerFog: lobby.fog.players });
  });

  socket.on(EVENTS.ACKNOWLEDGE_REQUEST, ({ requestId } = {}) => {
    if (!socket.data.authenticated) return;
    if (!socket.data.isHost) return;
    const lobby = manager.getLobby(socket.data.lobbyCode);
    if (!lobby) return;
    if (!lobby.acknowledgeRequest(requestId)) return;
    manager.broadcast(socket.data.lobbyCode, EVENTS.REQUEST_CANCELLED, { requestId, reason: 'acknowledged' });
  });

  socket.on(EVENTS.POI_CREATE, (payload = {}) => {
    if (!socket.data.authenticated) return;
    const lobby = manager.getLobby(socket.data.lobbyCode);
    if (!lobby) return;
    if (lobby.status !== 'ready') return socket.emit(EVENTS.ERROR, { code: ERROR_CODES.LOBBY_NOT_READY, message: 'Map not ready' });
    if (!lobby.canPoiMutate()) return socket.emit(EVENTS.ERROR, { code: ERROR_CODES.RATE_LIMITED, message: 'Slow down' });
    const role = socket.data.isHost ? 'host' : 'player';
    const result = lobby.createPoi(payload, role, socket.data.playerId);
    if (result.error) return socket.emit(EVENTS.ERROR, { code: result.error, message: result.error });
    manager.broadcastPoiChange(socket.data.lobbyCode, null, result.poi);
  });

  socket.on(EVENTS.POI_UPDATE, (payload = {}) => {
    if (!socket.data.authenticated) return;
    const lobby = manager.getLobby(socket.data.lobbyCode);
    if (!lobby) return;
    if (lobby.status !== 'ready') return socket.emit(EVENTS.ERROR, { code: ERROR_CODES.LOBBY_NOT_READY, message: 'Map not ready' });
    if (typeof payload.id !== 'string') return socket.emit(EVENTS.ERROR, { code: ERROR_CODES.POI_INVALID, message: 'Missing id' });
    if (!lobby.canPoiMutate()) return socket.emit(EVENTS.ERROR, { code: ERROR_CODES.RATE_LIMITED, message: 'Slow down' });
    const role = socket.data.isHost ? 'host' : 'player';
    const { id, ...patch } = payload;
    const result = lobby.updatePoi(id, patch, role);
    if (result.error) return socket.emit(EVENTS.ERROR, { code: result.error, message: result.error });
    manager.broadcastPoiChange(socket.data.lobbyCode, result.before, result.after);
  });

  socket.on(EVENTS.POI_DELETE, (payload = {}) => {
    if (!socket.data.authenticated) return;
    const lobby = manager.getLobby(socket.data.lobbyCode);
    if (!lobby) return;
    if (lobby.status !== 'ready') return socket.emit(EVENTS.ERROR, { code: ERROR_CODES.LOBBY_NOT_READY, message: 'Map not ready' });
    if (typeof payload.id !== 'string') return socket.emit(EVENTS.ERROR, { code: ERROR_CODES.POI_INVALID, message: 'Invalid POI data' });
    if (!lobby.canPoiMutate()) return socket.emit(EVENTS.ERROR, { code: ERROR_CODES.RATE_LIMITED, message: 'Slow down' });
    const result = lobby.deletePoi(payload.id);
    if (result.error) return socket.emit(EVENTS.ERROR, { code: result.error, message: result.error });
    manager.broadcastPoiChange(socket.data.lobbyCode, result.poi, null);
  });

  socket.on(EVENTS.NEW_GAME, () => {
    if (!socket.data.authenticated || !socket.data.isHost) return;
    manager.destroyLobby(socket.data.lobbyCode, 'new_game');
  });

  socket.on(EVENTS.START_GAME, () => {
    if (!socket.data.authenticated || !socket.data.isHost) return;
    const lobby = manager.getLobby(socket.data.lobbyCode);
    if (!lobby) return;
    if (lobby.status !== 'preview') return;
    lobby.startGame();
    manager.broadcastState(socket.data.lobbyCode);
  });

  socket.on(EVENTS.UPDATE_MAP_OPTIONS, (payload, ack) => {
    if (!socket.data.authenticated || !socket.data.isHost) return;
    const lobby = manager.getLobby(socket.data.lobbyCode);
    if (!lobby) return;
    if (lobby.status !== 'preview') return;
    const m = parseMapOptions(payload || {});
    if (m.error) {
      if (typeof ack === 'function') ack({ ok: false, error: m.error });
      return;
    }
    lobby.mapOptions = { ...m.options, islands: lobby.islands };
    if (typeof ack === 'function') ack({ ok: true });
    manager.broadcastState(socket.data.lobbyCode);
  });

  socket.on(EVENTS.REGENERATE_MAP, () => {
    if (!socket.data.authenticated || !socket.data.isHost) return;
    const lobby = manager.getLobby(socket.data.lobbyCode);
    if (!lobby) return;
    if (lobby.status !== 'preview') return;
    lobby.regenerate();
    manager.broadcastState(socket.data.lobbyCode);
    enqueueRender(lobby.code, { errorLabel: 'Regenerate' });
  });

  socket.on('disconnect', () => {
    const code = socket.data.lobbyCode;
    if (!code) return;
    const lobby = manager.getLobby(code);
    if (!lobby) return;

    if (socket.data.isHost && lobby.hostSocketId === socket.id) {
      lobby.hostConnected = false;
      lobby.hostSocketId = null;
      manager.broadcastState(code);
      manager.startGrace(code);
    } else if (socket.data.playerId) {
      const player = lobby.players[socket.data.playerId];
      if (player && player.socketId === socket.id) {
        player.connected = false;
        player.socketId = null;
        const cancelled = lobby.cancelPlayerRequests(socket.data.playerId);
        for (const { requestId } of cancelled) {
          manager.broadcast(code, EVENTS.REQUEST_CANCELLED, { requestId, reason: 'player_left' });
        }
        manager.broadcast(code, EVENTS.PLAYER_LEFT, { playerId: socket.data.playerId });
      }
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`inkdrifter server listening on http://localhost:${PORT}`);
});
