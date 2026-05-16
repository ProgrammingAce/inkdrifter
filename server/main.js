const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');
const { renderQueue } = require('./mapRender.js');
const { LobbyManager } = require('./lobbyManager.js');
const { hexNeighbors, MIN_GRID, MAX_GRID } = require('./lobby.js');
const { EVENTS, ERROR_CODES } = require('./protocol.js');

const PORT = process.env.PORT || 3000;
const ORIGIN = process.env.ORIGIN || false;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  maxHttpBufferSize: 1024,
  cors: { origin: ORIGIN },
});

const manager = new LobbyManager(io);

app.use(express.json({ limit: '4kb' }));
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

// ── HTTP Routes ───────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ ok: true, lobbies: manager.lobbies.size });
});

app.post('/api/lobbies/import', async (req, res) => {
  const { hostName, status, fog, marker, revealedTiles } = req.body;
  let rows = parseInt(req.body.rows, 10);
  let cols = parseInt(req.body.cols, 10);
  let seed = parseInt(req.body.seed, 10);
  const name = sanitizeName(hostName);
  if (!name) return res.status(400).json({ error: 'bad_host_name' });
  if (isNaN(rows) || rows < MIN_GRID || rows > MAX_GRID) return res.status(400).json({ error: 'bad_rows' });
  if (isNaN(cols) || cols < MIN_GRID || cols > MAX_GRID) return res.status(400).json({ error: 'bad_cols' });
  if (isNaN(seed) || seed < 0 || seed > 0xFFFFFFFF) return res.status(400).json({ error: 'bad_seed' });

  let lobby;
  try {
    lobby = await manager.createLobby({ rows, cols, seed, hostName: name });
  } catch (e) {
    if (e.code === 503) return res.status(503).json({ error: 'code_exhausted' });
    throw e;
  }

  res.status(202).json({
    code: lobby.code,
    seed: lobby.seed,
    rows: lobby.rows,
    cols: lobby.cols,
    status: lobby.status,
    hostToken: lobby.hostToken,
  });

  renderQueue.render(seed, rows, cols).then(pngBuffer => {
    const l = manager.getLobby(lobby.code);
    if (!l) return;
    l.setReady(pngBuffer);
    l.loadImportState({ status, fog, marker, revealedTiles });
    io.to(lobby.code).emit(EVENTS.MAP_READY, {});
    broadcastLobbyState(lobby.code);
  }).catch(err => {
    console.error('Import render failed for lobby', lobby.code, err);
    manager.destroyLobby(lobby.code, 'render_failed');
  });
});

app.post('/api/lobbies', async (req, res) => {
  const { hostName, seed: seedRaw } = req.body;
  let { rows, cols } = req.body;

  const name = sanitizeName(hostName);
  if (!name) return res.status(400).json({ error: 'bad_host_name' });

  rows = parseInt(rows, 10);
  cols = parseInt(cols, 10);
  if (isNaN(rows) || rows < MIN_GRID || rows > MAX_GRID) return res.status(400).json({ error: 'bad_rows' });
  if (isNaN(cols) || cols < MIN_GRID || cols > MAX_GRID) return res.status(400).json({ error: 'bad_cols' });

  let seed;
  if (seedRaw == null || seedRaw === '') {
    seed = crypto.randomInt(0, 2 ** 32);
  } else {
    seed = parseInt(seedRaw, 10);
    if (isNaN(seed) || seed < 0 || seed > 0xFFFFFFFF) return res.status(400).json({ error: 'bad_seed' });
  }

  let lobby;
  try {
    lobby = await manager.createLobby({ rows, cols, seed, hostName: name });
  } catch (e) {
    if (e.code === 503) return res.status(503).json({ error: 'code_exhausted' });
    throw e;
  }

  res.status(202).json({
    code: lobby.code,
    seed: lobby.seed,
    rows: lobby.rows,
    cols: lobby.cols,
    status: lobby.status,
    hostToken: lobby.hostToken,
  });

  // Kick off render in worker
  renderQueue.render(seed, rows, cols).then(pngBuffer => {
    const l = manager.getLobby(lobby.code);
    if (!l) return;
    l.setReady(pngBuffer);
    io.to(lobby.code).emit(EVENTS.MAP_READY, {});
    broadcastLobbyState(lobby.code);
  }).catch(err => {
    console.error('Render failed for lobby', lobby.code, err);
    manager.destroyLobby(lobby.code, 'render_failed');
  });
});

app.post('/api/lobbies/:code/join', (req, res) => {
  const { code } = req.params;
  const lobby = manager.getLobby(code);
  if (!lobby) return res.status(404).json({ error: ERROR_CODES.NO_SUCH_LOBBY });
  if (lobby.status !== 'ready') return res.status(409).json({ error: ERROR_CODES.LOBBY_NOT_READY });
  if (lobby.playerCount >= 8) return res.status(409).json({ error: ERROR_CODES.LOBBY_FULL });

  const name = sanitizeName(req.body.playerName);
  if (!name) return res.status(400).json({ error: 'bad_player_name' });
  if (lobby.hasPlayerName(name)) return res.status(409).json({ error: ERROR_CODES.NAME_TAKEN });
  if (lobby.hostName === name) return res.status(409).json({ error: ERROR_CODES.NAME_TAKEN });

  const result = lobby.addPlayer(name);
  if (!result) return res.status(409).json({ error: ERROR_CODES.LOBBY_FULL });

  res.json({ playerToken: result.playerToken, playerId: result.playerId });
});

app.get('/lobbies/:code/map.png', (req, res) => {
  const lobby = manager.getLobby(req.params.code);
  if (!lobby || !lobby.pngBuffer) return res.status(404).send('Not found');
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(lobby.pngBuffer);
});

app.get('/lobbies/:code/game-state.json', (req, res) => {
  const lobby = manager.getLobby(req.params.code);
  if (!lobby) return res.status(404).json({ error: 'no_such_lobby' });
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
  });
});

app.post('/api/lobbies/:code/regenerate', async (req, res) => {
  const { code } = req.params;
  const lobby = manager.getLobby(code);
  if (!lobby) return res.status(404).json({ error: 'no_such_lobby' });
  if (lobby.status !== 'preview') return res.status(409).json({ error: 'not_preview' });
  lobby.regenerate();
  renderQueue.render(lobby.seed, lobby.rows, lobby.cols).then(pngBuffer => {
    lobby.pngBuffer = pngBuffer;
    lobby.status = 'preview';
    io.to(code).emit(EVENTS.MAP_READY, {});
    broadcastLobbyState(code);
  }).catch(err => {
    console.error('Regenerate failed for lobby', code, err);
    manager.destroyLobby(code, 'render_failed');
  });
  res.json({ ok: true });
});

app.post('/api/lobbies/:code/start', (req, res) => {
  const { code } = req.params;
  const lobby = manager.getLobby(code);
  if (!lobby) return res.status(404).json({ error: 'no_such_lobby' });
  if (lobby.status !== 'preview') return res.status(409).json({ error: 'lobby_not_preview' });
  lobby.startGame();
  broadcastLobbyState(code);
  res.json({ ok: true });
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
    row = parseInt(row, 10);
    col = parseInt(col, 10);
    if (isNaN(row) || isNaN(col) || row < 0 || row >= lobby.rows || col < 0 || col >= lobby.cols) {
      return emitError(socket, ERROR_CODES.OUT_OF_BOUNDS, 'Position out of bounds');
    }
    const { revealedDelta, cancelled } = lobby.moveMarker(row, col);
    io.to(lobby.code).emit(EVENTS.MARKER_MOVED, { row, col, revealedDelta });
    for (const req of cancelled) {
      io.to(lobby.code).emit(EVENTS.REQUEST_CANCELLED, { requestId: req.requestId, reason: 'marker_moved' });
    }
  });

  socket.on(EVENTS.MOVE_REQUEST, ({ row, col } = {}) => {
    if (!socket.data.authenticated) return;
    if (socket.data.isHost) return;
    const lobby = manager.getLobby(socket.data.lobbyCode);
    if (!lobby) return;
    if (lobby.status !== 'ready') return emitError(socket, ERROR_CODES.LOBBY_NOT_READY, 'Map not ready');
    row = parseInt(row, 10);
    col = parseInt(col, 10);
    if (isNaN(row) || isNaN(col) || row < 0 || row >= lobby.rows || col < 0 || col >= lobby.cols) {
      return emitError(socket, ERROR_CODES.OUT_OF_BOUNDS, 'Position out of bounds');
    }
    const result = lobby.addMoveRequest(socket.data.playerId, row, col);
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
      row,
      col,
      requestId: result.requestId,
      at: lobby.pendingRequests[result.requestId].at,
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

socket.on(EVENTS.REGENERATE_MAP, () => {
    if (!socket.data.authenticated || !socket.data.isHost) return;
    const lobby = manager.getLobby(socket.data.lobbyCode);
    if (!lobby) return;
    if (lobby.status !== 'preview') return;
    lobby.regenerate();
    io.to(lobby.code).emit(EVENTS.LOBBY_STATE, lobby.toWire('host', null));
    renderQueue.render(lobby.seed, lobby.rows, lobby.cols).then(pngBuffer => {
      lobby.pngBuffer = pngBuffer;
      lobby.status = 'preview';
      io.to(lobby.code).emit(EVENTS.MAP_READY, {});
      broadcastLobbyState(lobby.code);
    }).catch(err => {
      console.error('Regenerate failed for lobby', lobby.code, err);
      manager.destroyLobby(lobby.code, 'render_failed');
    });
  });

  socket.on('disconnect', () => {
    const code = socket.data.lobbyCode;
    if (!code) return;
    const lobby = manager.getLobby(code);
    if (!lobby) return;

    if (socket.data.isHost && lobby.hostSocketId === socket.id) {
      lobby.hostConnected = false;
      lobby.hostSocketId = null;
      io.to(code).emit(EVENTS.LOBBY_STATE, lobby.toWire('player', null)); // notify players
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
