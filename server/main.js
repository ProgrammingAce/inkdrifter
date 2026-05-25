const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');
const { renderQueue } = require('./mapRender.js');
const { LobbyManager } = require('./lobbyManager.js');
const { hexNeighbors, MIN_GRID, MAX_GRID, MAX_PLAYERS_PER_LOBBY } = require('./lobby.js');
const { EVENTS, ERROR_CODES } = require('./protocol.js');
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
const io = new Server(httpServer, {
  maxHttpBufferSize: '64kb',
  cors: { origin: ORIGIN },
});

const manager = new LobbyManager(io);

app.use(express.json({ limit: '4kb' }));

// Single-source hex constants for the client (generated from index.js).
// Must be registered before express.static so it wins over any stale file.
app.get('/js/hex-constants.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.set('Cache-Control', 'no-cache');
  res.send(HEX_CONSTANTS_JS);
});

app.use(express.static(path.join(__dirname, '..', 'web')));

// ── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeName(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/\s+/g, ' ');
  const codePoints = [...s];
  if (codePoints.length < 1 || codePoints.length > 24) return null;
  return s;
}

async function broadcastLobbyState(code) {
  const lobby = manager.getLobby(code);
  if (!lobby) return;
  const sockets = await io.in(code).fetchSockets();
  for (const s of sockets) {
    if (s.data.isHost) {
      s.emit(EVENTS.LOBBY_STATE, lobby.toWire('host', null));
    } else if (s.data.playerId) {
      s.emit(EVENTS.LOBBY_STATE, lobby.toWire('player', s.data.playerId));
    }
  }
}

function emitError(socket, code, message) {
  socket.emit(EVENTS.ERROR, { code, message });
}

// Kick off a render, then update the lobby and notify clients. onReady runs
// after pngBuffer is attached, before broadcastLobbyState — use it for
// import state loading or other per-call hooks.
function enqueueRender(code, { onReady, errorLabel = 'Render' } = {}) {
  const lobby = manager.getLobby(code);
  if (!lobby) return;
  renderQueue.render(lobby.seed, lobby.rows, lobby.cols, lobby.mapOptions).then(({ pngBuffer, biomeTags }) => {
    const l = manager.getLobby(code);
    if (!l) return;
    l.setReady(pngBuffer, biomeTags);
    if (onReady) onReady(l);
    io.to(code).emit(EVENTS.MAP_READY, {});
    broadcastLobbyState(code);
  }).catch(err => {
    console.error(`${errorLabel} failed for lobby`, code, err);
    manager.destroyLobby(code, 'render_failed');
  });
}

// Strict integer parse: rejects "5abc", "5.5", booleans, NaN, etc.
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

// Token gate: lobby contents (map image, game state) are private to the host
// and joined players. Accepts ?token= or Authorization: Bearer <token>.
function authorizeLobby(req, lobby) {
  const auth = req.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const token = bearer || (typeof req.query.token === 'string' ? req.query.token : null);
  if (!token) return false;
  if (token === lobby.hostToken) return true;
  return Object.values(lobby.players).some(p => p.token === token);
}

app.get('/lobbies/:code/map.png', (req, res) => {
  const lobby = manager.getLobby(req.params.code);
  if (!lobby || !lobby.pngBuffer) return res.status(404).send('Not found');
  if (!authorizeLobby(req, lobby)) return res.status(403).send('Forbidden');
  res.set('Content-Type', 'image/png');
  // Private: each lobby's map is tied to a per-user token, so don't allow
  // shared caches to keep it.
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
    canvasWidth: lobby.canvasWidth,
    canvasHeight: lobby.canvasHeight,
    status: lobby.status,
    hostName: lobby.hostName,
    mapOptions: lobby.mapOptions,
  });
});

// Serve lobby.html for /lobby/:code routes
app.get('/lobby/:code', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'lobby.html'));
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  socket.data.authenticated = false;
  socket.data.isHost = false;
  socket.data.playerId = null;
  socket.data.lobbyCode = null;

  socket.on(EVENTS.AUTH, async ({ code, role, token } = {}) => {
    if (socket.data.authenticated) return;
    if (typeof code !== 'string' || typeof role !== 'string' || typeof token !== 'string') {
      emitError(socket, ERROR_CODES.BAD_AUTH, 'Invalid auth payload');
      return socket.disconnect();
    }

    const lobby = manager.getLobby(code);
    if (!lobby) {
      emitError(socket, ERROR_CODES.BAD_AUTH, 'Lobby not found');
      return socket.disconnect();
    }

    if (role === 'host') {
      if (token !== lobby.hostToken) {
        emitError(socket, ERROR_CODES.BAD_AUTH, 'Invalid host token');
        return socket.disconnect();
      }
      // Displace existing host socket if any
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
        emitError(socket, ERROR_CODES.BAD_AUTH, 'Invalid player token');
        return socket.disconnect();
      }
      const { playerId, player } = found;
      // Displace existing player socket if reconnecting
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
      socket.to(code).emit(EVENTS.PLAYER_JOINED, { playerId, name: player.name });
    } else {
      emitError(socket, ERROR_CODES.BAD_AUTH, 'Invalid role');
      socket.disconnect();
    }
  });

  socket.on(EVENTS.MARKER_MOVE, ({ row, col } = {}) => {
    if (!socket.data.authenticated) return;
    if (!socket.data.isHost) return emitError(socket, ERROR_CODES.NOT_HOST, 'Only host can move marker');
    const lobby = manager.getLobby(socket.data.lobbyCode);
    if (!lobby) return;
    if (lobby.status !== 'ready') return emitError(socket, ERROR_CODES.LOBBY_NOT_READY, 'Map not ready');
    if (!lobby.canMarkerMove()) return; // silently drop
    const r = toInt(row);
    const c = toInt(col);
    if (r == null || c == null || r < 0 || r >= lobby.rows || c < 0 || c >= lobby.cols) {
      return emitError(socket, ERROR_CODES.OUT_OF_BOUNDS, 'Position out of bounds');
    }
    const { revealedDelta, cancelled } = lobby.moveMarker(r, c);
    io.to(lobby.code).emit(EVENTS.MARKER_MOVED, { row: r, col: c, revealedDelta });
    for (const req of cancelled) {
      io.to(lobby.code).emit(EVENTS.REQUEST_CANCELLED, { requestId: req.requestId, reason: 'marker_moved' });
    }
    // Reveal any public POIs whose hex just became revealed.
    if (revealedDelta.length > 0) {
      const newKeys = new Set(revealedDelta.map(([r, c]) => `${r},${c}`));
      const newlyVisible = lobby.pois.filter(p =>
        p.visibility === 'public' && newKeys.has(`${p.row},${p.col}`)
      );
      if (newlyVisible.length > 0) {
        io.in(lobby.code).fetchSockets().then(sockets => {
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
    if (lobby.status !== 'ready') return emitError(socket, ERROR_CODES.LOBBY_NOT_READY, 'Map not ready');
    const r = toInt(row);
    const c = toInt(col);
    if (r == null || c == null || r < 0 || r >= lobby.rows || c < 0 || c >= lobby.cols) {
      return emitError(socket, ERROR_CODES.OUT_OF_BOUNDS, 'Position out of bounds');
    }
    const result = lobby.addMoveRequest(socket.data.playerId, r, c);
    if (result.error) {
      emitError(socket, result.error, result.error);
      if (result.disconnect) socket.disconnect();
      return;
    }
    const player = lobby.players[socket.data.playerId];
    // Emit cancel for any replaced request from this player
    if (result.cancelledRequestId) {
      io.to(lobby.code).emit(EVENTS.REQUEST_CANCELLED, {
        requestId: result.cancelledRequestId,
        reason: 'replaced',
      });
    }
    io.to(lobby.code).emit(EVENTS.MOVE_REQUESTED, {
      playerId: socket.data.playerId,
      name: player.name,
      row: r,
      col: c,
      requestId: result.requestId,
      at: result.at,
    });
  });

  socket.on(EVENTS.FOG_TOGGLE, ({ target, enabled } = {}) => {
    if (!socket.data.authenticated) return;
    if (!socket.data.isHost) return emitError(socket, ERROR_CODES.NOT_HOST, 'Only host can toggle fog');
    const lobby = manager.getLobby(socket.data.lobbyCode);
    if (!lobby) return;
    if (target !== 'host' && target !== 'players') return;
    lobby.setFog(target, !!enabled);
    io.to(lobby.code).emit(EVENTS.FOG_CHANGED, { hostFog: lobby.fog.host, playerFog: lobby.fog.players });
  });

  socket.on(EVENTS.ACKNOWLEDGE_REQUEST, ({ requestId } = {}) => {
    if (!socket.data.authenticated) return;
    if (!socket.data.isHost) return;
    const lobby = manager.getLobby(socket.data.lobbyCode);
    if (!lobby) return;
    if (!lobby.acknowledgeRequest(requestId)) return;
    io.to(lobby.code).emit(EVENTS.REQUEST_CANCELLED, { requestId, reason: 'acknowledged' });
  });

  async function broadcastPoiChange(lobby, before, after) {
    // before: prior POI (or null on create). after: new POI (or null on delete).
    // Host always receives the full change. Players see public+revealed POIs only;
    // a visibility/reveal transition emits CREATE/DELETE rather than UPDATE.
    const sockets = await io.in(lobby.code).fetchSockets();
    for (const s of sockets) {
      if (!s.data.authenticated) continue;
      if (s.data.isHost) {
        if (!before && after) s.emit(EVENTS.POI_CREATED, { poi: after });
        else if (before && !after) s.emit(EVENTS.POI_DELETED, { id: before.id });
        else if (before && after) s.emit(EVENTS.POI_UPDATED, { poi: after });
        continue;
      }
      const role = 'player';
      const wasVisible = before ? lobby.isPoiVisible(before, role) : false;
      const nowVisible = after ? lobby.isPoiVisible(after, role) : false;
      if (!wasVisible && nowVisible) {
        s.emit(EVENTS.POI_CREATED, { poi: after });
      } else if (wasVisible && !nowVisible) {
        s.emit(EVENTS.POI_DELETED, { id: before.id });
      } else if (wasVisible && nowVisible) {
        s.emit(EVENTS.POI_UPDATED, { poi: after });
      }
    }
  }

  socket.on(EVENTS.POI_CREATE, (payload = {}) => {
    if (!socket.data.authenticated) return;
    const lobby = manager.getLobby(socket.data.lobbyCode);
    if (!lobby) return;
    if (lobby.status !== 'ready') return emitError(socket, ERROR_CODES.LOBBY_NOT_READY, 'Map not ready');
    if (!lobby.canPoiMutate()) return emitError(socket, ERROR_CODES.RATE_LIMITED, 'Slow down');
    const role = socket.data.isHost ? 'host' : 'player';
    const result = lobby.createPoi(payload, role, socket.data.playerId);
    if (result.error) return emitError(socket, result.error, result.error);
    broadcastPoiChange(lobby, null, result.poi);
  });

  socket.on(EVENTS.POI_UPDATE, (payload = {}) => {
    if (!socket.data.authenticated) return;
    const lobby = manager.getLobby(socket.data.lobbyCode);
    if (!lobby) return;
    if (lobby.status !== 'ready') return emitError(socket, ERROR_CODES.LOBBY_NOT_READY, 'Map not ready');
    if (typeof payload.id !== 'string') return emitError(socket, ERROR_CODES.POI_INVALID, 'Missing id');
    if (!lobby.canPoiMutate()) return emitError(socket, ERROR_CODES.RATE_LIMITED, 'Slow down');
    const role = socket.data.isHost ? 'host' : 'player';
    const { id, ...patch } = payload;
    const result = lobby.updatePoi(id, patch, role);
    if (result.error) return emitError(socket, result.error, result.error);
    broadcastPoiChange(lobby, result.before, result.after);
  });

  socket.on(EVENTS.POI_DELETE, (payload = {}) => {
    if (!socket.data.authenticated) return;
    const lobby = manager.getLobby(socket.data.lobbyCode);
    if (!lobby) return;
    if (lobby.status !== 'ready') return emitError(socket, ERROR_CODES.LOBBY_NOT_READY, 'Map not ready');
    if (typeof payload.id !== 'string') return emitError(socket, ERROR_CODES.POI_INVALID, 'Missing id');
    if (!lobby.canPoiMutate()) return emitError(socket, ERROR_CODES.RATE_LIMITED, 'Slow down');
    const result = lobby.deletePoi(payload.id);
    if (result.error) return emitError(socket, result.error, result.error);
    broadcastPoiChange(lobby, result.poi, null);
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
    broadcastLobbyState(socket.data.lobbyCode);
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
    broadcastLobbyState(socket.data.lobbyCode);
  });

  socket.on(EVENTS.REGENERATE_MAP, () => {
    if (!socket.data.authenticated || !socket.data.isHost) return;
    const lobby = manager.getLobby(socket.data.lobbyCode);
    if (!lobby) return;
    if (lobby.status !== 'preview') return;
    lobby.regenerate();
    io.to(lobby.code).emit(EVENTS.LOBBY_STATE, lobby.toWire('host', null));
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
      broadcastLobbyState(code);
      manager.startGrace(code);
    } else if (socket.data.playerId) {
      const player = lobby.players[socket.data.playerId];
      if (player && player.socketId === socket.id) {
        player.connected = false;
        player.socketId = null;
        const cancelled = lobby.cancelPlayerRequests(socket.data.playerId);
        for (const { requestId } of cancelled) {
          io.to(code).emit(EVENTS.REQUEST_CANCELLED, { requestId, reason: 'player_left' });
        }
        io.to(code).emit(EVENTS.PLAYER_LEFT, { playerId: socket.data.playerId });
      }
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`inkdrifter server listening on http://localhost:${PORT}`);
});
