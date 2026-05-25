import { Lobby } from './lobby.js';
import {
  EVENTS,
  ERROR_CODES,
  GRACE_MS,
  IDLE_MS,
  POI_COLORS,
  MAX_PLAYERS_PER_LOBBY,
} from './protocol.js';
import { MIN_GRID, MAX_GRID } from './constants.js';

function bearerToken(request) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// Lazy auth attachment access for hibernated WebSockets. Real WSes survive
// hibernation via ctx attachments; the in-process `fakeWs` from /post-event
// just sets `_auth` directly.
function getAuth(ws) {
  if (ws._auth !== undefined) return ws._auth;
  let att = null;
  try {
    if (typeof ws.deserializeAttachment === 'function') {
      att = ws.deserializeAttachment() || null;
    }
  } catch {}
  ws._auth = att;
  return att;
}

function setAuth(ws, auth) {
  ws._auth = auth;
  if (typeof ws.serializeAttachment === 'function') {
    try { ws.serializeAttachment(auth); } catch {}
  }
}

export class LobbyDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sseConnections = new Map();
    this.lobby = null;
    this._initialized = false;
  }

  // Active WebSockets (hibernation-aware). Each call refreshes _auth from
  // serialized attachments so existing `ws._auth.role`/`ws._auth.playerId`
  // call sites continue to work.
  *_sockets() {
    for (const ws of this.ctx.getWebSockets()) {
      getAuth(ws);
      yield ws;
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === '/ws') {
      return this.handleWsUpgrade(request);
    } else if (pathname === '/create') {
      return this.handleCreate(request, false);
    } else if (pathname === '/import') {
      return this.handleCreate(request, true);
    } else if (pathname === '/get') {
      return this.handleGet(request);
    } else if (pathname === '/join') {
      return this.handleJoin(request);
    } else if (pathname === '/game-state') {
      return this.handleGameState(request);
    } else if (pathname === '/render-complete') {
      return this.handleRenderComplete(request);
    } else if (pathname === '/sse') {
      return this.handleSSE(request);
    } else if (pathname === '/post-event') {
      return this.handlePostEvent(request);
    }

    return new Response('Not found', { status: 404 });
  }

  async handleWsUpgrade(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Hibernation-aware accept: the DO can be evicted between messages and
    // re-instantiated when a frame arrives. Auth state is restored via
    // ws.deserializeAttachment() in getAuth().
    this.ctx.acceptWebSocket(server);
    try {
      await this.ensureLobby();
    } catch (err) {
      console.error('ensureLobby error:', err);
    }
    this._initialized = true;
    return new Response(null, { status: 101, webSocket: client });
  }

  // Hibernation callback: invoked by the runtime when a frame arrives, even
  // if the DO instance was evicted since the socket was accepted.
  async webSocketMessage(ws, message) {
    try {
      await this.ensureLobby();
    } catch (err) {
      console.error('ensureLobby error:', err);
    }
    getAuth(ws);
    try {
      await this.handleMessage(ws, message);
    } catch (err) {
      console.error('Message handler error:', err);
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    getAuth(ws);
    try { await this.ensureLobby(); } catch {}
    try { this.handleDisconnect(ws); } catch (err) {
      console.error('Disconnect handler error:', err);
    }
  }

  async webSocketError(ws, error) {
    try { ws.close(1011, 'error'); } catch {}
  }

  async ensureLobby() {
    if (this.lobby) return;
    const stored = await this.ctx.storage.get('lobby');
    if (stored) {
      this.lobby = Lobby.fromStorage(stored);
    }
  }

  async saveLobby() {
    if (!this.lobby) return;
    await this.ctx.storage.put('lobby', this.lobby.toStorage());
    this.setAlarm();
  }

  setAlarm() {
    const now = Date.now();
    const lobby = this.lobby;
    if (!lobby) return;

    const idleDeadline = lobby.lastActivityAt + IDLE_MS;
    const candidates = [idleDeadline];
    if (lobby._graceUntil) candidates.push(lobby._graceUntil);
    const nextDeadline = Math.min(...candidates);
    const delay = Math.max(0, nextDeadline - now);

    // Only schedule when the deadline is within 10m to coalesce writes;
    // saveLobby() re-evaluates on every state change so we'll catch it later.
    if (delay < 10 * 60 * 1000) {
      this.ctx.storage.setAlarm(now + delay);
    }
  }

  async alarm() {
    await this.ensureLobby();
    if (!this.lobby) {
      await this.ctx.storage.deleteAll();
      return;
    }

    const now = Date.now();

    if (this.lobby._graceUntil && now >= this.lobby._graceUntil) {
      if (!this.lobby.hostConnected) {
        this.destroyLobby('host_timeout');
        return;
      }
      this.lobby._graceUntil = null;
      await this.saveLobby();
    }

    if (now - this.lobby.lastActivityAt > IDLE_MS) {
      this.destroyLobby('idle');
      return;
    }

    this.setAlarm();
  }

  async handleCreate(request, requireSeed = false) {
    await this.ensureLobby();
    if (this.lobby) {
      return jsonResp({ error: ERROR_CODES.CODE_TAKEN }, 409);
    }

    const body = await parseJson(request);
    if (!body) return jsonResp({ error: 'bad_request' }, 400);

    const name = sanitizeName(body.hostName);
    if (!name) return jsonResp({ error: 'bad_host_name' }, 400);

    const grid = parseGridParams(body);
    if (grid.error) return jsonResp({ error: grid.error }, 400);

    const s = parseSeed(body.seed, { required: requireSeed });
    if (s.error) return jsonResp({ error: s.error }, 400);

    const m = parseMapOptions(body);
    if (m.error) return jsonResp({ error: m.error }, 400);

    const hostToken = crypto.randomUUID();
    this.lobby = new Lobby({
      code: new URL(request.url).searchParams.get('code') || '',
      seed: s.seed,
      rows: grid.rows,
      cols: grid.cols,
      hostToken,
      hostName: name,
      islands: !!body.islands,
      mapOptions: m.options,
    });

    // For imports, stash the game state and apply once the client signals
    // render-complete (so revealed tiles / marker / POIs land on the same map).
    let importState = null;
    if (requireSeed) {
      importState = {
        status: body.status,
        fog: body.fog,
        marker: body.marker,
        revealedTiles: body.revealedTiles,
        pois: body.pois,
      };
      this.lobby._pendingImport = importState;
    }

    await this.saveLobby();

    return jsonResp({
      code: this.lobby.code,
      seed: this.lobby.seed,
      rows: this.lobby.rows,
      cols: this.lobby.cols,
      status: this.lobby.status,
      hostToken,
      importState,
    }, 201);
  }

  async handleGet(request) {
    await this.ensureLobby();
    if (!this.lobby) {
      return jsonResp({ error: ERROR_CODES.NO_SUCH_LOBBY }, 404);
    }

    return jsonResp({
      code: this.lobby.code,
      seed: this.lobby.seed,
      rows: this.lobby.rows,
      cols: this.lobby.cols,
      islands: this.lobby.islands,
      canvasWidth: this.lobby.canvasWidth,
      canvasHeight: this.lobby.canvasHeight,
      status: this.lobby.status,
      hostName: this.lobby.hostName,
      mapOptions: this.lobby.mapOptions,
    });
  }

  async handleJoin(request) {
    await this.ensureLobby();
    if (!this.lobby) {
      return jsonResp({ error: ERROR_CODES.NO_SUCH_LOBBY }, 404);
    }
    if (this.lobby.status !== 'ready') {
      return jsonResp({ error: ERROR_CODES.LOBBY_NOT_READY }, 409);
    }
    if (this.lobby.playerCount >= MAX_PLAYERS_PER_LOBBY) {
      return jsonResp({ error: ERROR_CODES.LOBBY_FULL }, 409);
    }

    const body = await parseJson(request);
    if (!body) return jsonResp({ error: 'bad_request' }, 400);

    const name = sanitizeName(body.playerName);
    if (!name) return jsonResp({ error: 'bad_player_name' }, 400);
    if (this.lobby.hasPlayerName(name)) {
      return jsonResp({ error: ERROR_CODES.NAME_TAKEN }, 409);
    }
    if (this.lobby.hostName === name) {
      return jsonResp({ error: ERROR_CODES.NAME_TAKEN }, 409);
    }

    const result = this.lobby.addPlayer(name);
    if (!result) return jsonResp({ error: ERROR_CODES.LOBBY_FULL }, 409);

    await this.saveLobby();

    return jsonResp({ playerToken: result.playerToken, playerId: result.playerId });
  }

  async handleGameState(request) {
    await this.ensureLobby();
    if (!this.lobby) {
      return jsonResp({ error: ERROR_CODES.NO_SUCH_LOBBY }, 404);
    }

    const token = bearerToken(request);
    if (!this.authorizeLobby(token)) {
      return jsonResp({ error: 'forbidden' }, 403);
    }

    return jsonResp(this.lobby.toJSONExport());
  }

  async handleRenderComplete(request) {
    await this.ensureLobby();
    if (!this.lobby) {
      return jsonResp({ error: ERROR_CODES.NO_SUCH_LOBBY }, 404);
    }

    const body = await parseJson(request);
    if (!body) return jsonResp({ error: 'bad_request' }, 400);

    const token = bearerToken(request);
    if (!token || token !== this.lobby.hostToken) {
      return jsonResp({ error: 'forbidden' }, 403);
    }

    if (body.biomeTags) {
      this.lobby.setReady({ biomeTags: body.biomeTags });
    } else {
      this.lobby.setReady({});
    }

    // Apply any pending import now that the client has rendered the map.
    if (this.lobby._pendingImport) {
      try {
        this.lobby.loadImportState(this.lobby._pendingImport);
      } catch (err) {
        console.error('loadImportState failed:', err);
      }
      this.lobby._pendingImport = null;
    }

    await this.saveLobby();
    this.broadcast({ type: EVENTS.MAP_READY });
    this.broadcastState();

    return jsonResp({ ok: true });
  }

  authorizeLobby(token) {
    if (!this.lobby || !token) return false;
    if (token === this.lobby.hostToken) return true;
    return Object.values(this.lobby.players).some(p => p.token === token);
  }

  handleDisconnect(ws) {
    if (!this.lobby) return;

    const auth = ws._auth;
    if (!auth) return;

    if (auth.role === 'host') {
      this.lobby.hostConnected = false;
      this.broadcastState();
      this.startGrace();
    } else if (auth.playerId) {
      const player = this.lobby.players[auth.playerId];
      if (player) {
        player.connected = false;
        const cancelled = this.lobby.cancelPlayerRequests(auth.playerId);
        for (const { requestId } of cancelled) {
          this.broadcast({ type: EVENTS.REQUEST_CANCELLED, data: { requestId, reason: 'player_left' } });
        }
        this.broadcast({ type: EVENTS.PLAYER_LEFT, data: { playerId: auth.playerId } });
      }
    }

    this.saveLobby();
  }

  startGrace() {
    if (!this.lobby) return;
    this.lobby._graceUntil = Date.now() + GRACE_MS;
    this.saveLobby();
  }

  clearGrace() {
    if (!this.lobby) return;
    if (this.lobby._graceUntil) {
      this.lobby._graceUntil = null;
      this.saveLobby();
    }
  }

  destroyLobby(reason) {
    this.broadcast({ type: EVENTS.LOBBY_CLOSED, data: { reason } });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.close(1000, reason || 'closed'); } catch {}
    }
    for (const [id, sse] of this.sseConnections) {
      try { sse.writer.close(); } catch {}
      this.handleSSEDisconnect(id);
    }
    this.sseConnections.clear();
    if (this.lobby) this.lobby._graceUntil = null;
    this.lobby = null;
    this.ctx.storage.deleteAll();
    this.ctx.storage.deleteAlarm().catch(() => {});
  }

  async handleMessage(ws, rawData) {
    let msg;
    try {
      msg = JSON.parse(rawData);
    } catch {
      return;
    }

    await this.ensureLobby();
    if (!this.lobby) return;

    const { type, data } = msg;

    switch (type) {
      case EVENTS.AUTH:
        await this.handleAuth(ws, data);
        break;
      case EVENTS.MARKER_MOVE:
        this.handleMarkerMove(ws, data);
        break;
      case EVENTS.MOVE_REQUEST:
        this.handleMoveRequest(ws, data);
        break;
      case EVENTS.FOG_TOGGLE:
        this.handleFogToggle(ws, data);
        break;
      case EVENTS.ACKNOWLEDGE_REQUEST:
        this.handleAcknowledge(ws, data);
        break;
      case EVENTS.NEW_GAME:
        this.handleNewGame(ws);
        break;
      case EVENTS.START_GAME:
        this.handleStartGame(ws);
        break;
      case EVENTS.REGENERATE_MAP:
        this.handleRegenerate(ws);
        break;
      case EVENTS.UPDATE_MAP_OPTIONS:
        this.handleUpdateMapOptions(ws, data);
        break;
      case EVENTS.POI_CREATE:
        this.handlePoiCreate(ws, data);
        break;
      case EVENTS.POI_UPDATE:
        this.handlePoiUpdate(ws, data);
        break;
      case EVENTS.POI_DELETE:
        this.handlePoiDelete(ws, data);
        break;
      case 'ping':
        if (this.lobby) {
          this.lobby.touchActivity();
          this.sendTo(ws, { type: 'pong' });
        }
        break;
    }
  }

  async handleAuth(ws, { code, role, token } = {}) {
    if (ws._auth) return;
    if (typeof code !== 'string' || typeof role !== 'string' || typeof token !== 'string') {
      this.sendTo(ws, { type: EVENTS.ERROR, data: { code: ERROR_CODES.BAD_AUTH, message: 'Invalid auth payload' } });
      return ws.close();
    }

    if (!this.lobby) {
      this.sendTo(ws, { type: EVENTS.ERROR, data: { code: ERROR_CODES.BAD_AUTH, message: 'Lobby not found' } });
      return ws.close();
    }

    if (role === 'host') {
      if (token !== this.lobby.hostToken) {
        this.sendTo(ws, { type: EVENTS.ERROR, data: { code: ERROR_CODES.BAD_AUTH, message: 'Invalid host token' } });
        return ws.close();
      }
      this.clearGrace();
      this.lobby.hostConnected = true;
      setAuth(ws, { role: 'host' });
      this.sendTo(ws, { type: EVENTS.LOBBY_STATE, data: this.lobby.toWire('host', null) });
    } else if (role === 'player') {
      const found = this.lobby.findPlayerByToken(token);
      if (!found) {
        this.sendTo(ws, { type: EVENTS.ERROR, data: { code: ERROR_CODES.BAD_AUTH, message: 'Invalid player token' } });
        return ws.close();
      }
      const { playerId, player } = found;
      player.connected = true;
      setAuth(ws, { role: 'player', playerId });
      this.sendTo(ws, { type: EVENTS.LOBBY_STATE, data: this.lobby.toWire('player', playerId) });
      this.broadcast({
        type: EVENTS.PLAYER_JOINED,
        data: { playerId, name: player.name },
        exclude: ws,
      });
    } else {
      this.sendTo(ws, { type: EVENTS.ERROR, data: { code: ERROR_CODES.BAD_AUTH, message: 'Invalid role' } });
      ws.close();
    }

    this.saveLobby();
  }

  handleMarkerMove(ws, { row, col } = {}) {
    if (!ws._auth || ws._auth.role !== 'host') return;
    if (!this.lobby || this.lobby.status !== 'ready') return;
    if (!this.lobby.canMarkerMove()) return;

    const r = toInt(row);
    const c = toInt(col);
    if (r == null || c == null || r < 0 || r >= this.lobby.rows || c < 0 || c >= this.lobby.cols) {
      this.sendTo(ws, { type: EVENTS.ERROR, data: { code: ERROR_CODES.OUT_OF_BOUNDS, message: 'Position out of bounds' } });
      return;
    }

    const { revealedDelta, cancelled } = this.lobby.moveMarker(r, c);
    this.broadcast({ type: EVENTS.MARKER_MOVED, data: { row: r, col: c, revealedDelta } });
    for (const req of cancelled) {
      this.broadcast({ type: EVENTS.REQUEST_CANCELLED, data: { requestId: req.requestId, reason: 'marker_moved' } });
    }

    if (revealedDelta.length > 0) {
      const newKeys = new Set(revealedDelta.map(([r, c]) => `${r},${c}`));
      const newlyVisible = this.lobby.pois.filter(p =>
        p.visibility === 'public' && newKeys.has(`${p.row},${p.col}`)
      );
      if (newlyVisible.length > 0) {
        for (const pws of this._sockets()) {
          if (!pws._auth || pws._auth.role === 'host') continue;
          for (const poi of newlyVisible) {
            this.sendTo(pws, { type: EVENTS.POI_CREATED, data: { poi } });
          }
        }
      }
    }

    this.saveLobby();
  }

  handleMoveRequest(ws, { row, col } = {}) {
    if (!ws._auth || ws._auth.role !== 'player') return;
    if (!this.lobby || this.lobby.status !== 'ready') return;

    const r = toInt(row);
    const c = toInt(col);
    if (r == null || c == null || r < 0 || r >= this.lobby.rows || c < 0 || c >= this.lobby.cols) {
      this.sendTo(ws, { type: EVENTS.ERROR, data: { code: ERROR_CODES.OUT_OF_BOUNDS, message: 'Position out of bounds' } });
      return;
    }

    const result = this.lobby.addMoveRequest(ws._auth.playerId, r, c);
    if (result.error) {
      this.sendTo(ws, { type: EVENTS.ERROR, data: { code: result.error, message: result.error } });
      if (result.disconnect) ws.close();
      return;
    }

    const player = this.lobby.players[ws._auth.playerId];
    if (result.cancelledRequestId) {
      this.broadcast({ type: EVENTS.REQUEST_CANCELLED, data: { requestId: result.cancelledRequestId, reason: 'replaced' } });
    }

    this.broadcast({
      type: EVENTS.MOVE_REQUESTED,
      data: {
        playerId: ws._auth.playerId,
        name: player.name,
        row: r,
        col: c,
        requestId: result.requestId,
        at: result.at,
      },
    });

    this.saveLobby();
  }

  handleFogToggle(ws, { target, enabled } = {}) {
    if (!ws._auth || ws._auth.role !== 'host') return;
    if (!this.lobby) return;
    if (target !== 'host' && target !== 'players') return;
    this.lobby.setFog(target, !!enabled);
    this.broadcast({ type: EVENTS.FOG_CHANGED, data: { hostFog: this.lobby.fog.host, playerFog: this.lobby.fog.players } });
    this.saveLobby();
  }

  handleAcknowledge(ws, { requestId } = {}) {
    if (!ws._auth || ws._auth.role !== 'host') return;
    if (!this.lobby) return;
    if (!this.lobby.acknowledgeRequest(requestId)) return;
    this.broadcast({ type: EVENTS.REQUEST_CANCELLED, data: { requestId, reason: 'acknowledged' } });
    this.saveLobby();
  }

  handleNewGame(ws) {
    if (!ws._auth || ws._auth.role !== 'host') return;
    this.destroyLobby('new_game');
  }

  handleStartGame(ws) {
    if (!ws._auth || ws._auth.role !== 'host') return;
    if (!this.lobby || this.lobby.status !== 'preview') return;
    this.lobby.startGame();
    this.broadcastState();
    this.saveLobby();
  }

  handleRegenerate(ws) {
    if (!ws._auth || ws._auth.role !== 'host') return;
    if (!this.lobby || this.lobby.status !== 'preview') return;
    this.lobby.regenerate();
    this.broadcastState();
    this.broadcast({ type: EVENTS.MAP_READY });
    this.saveLobby();
  }

  handleUpdateMapOptions(ws, payload = {}) {
    if (!ws._auth || ws._auth.role !== 'host') return;
    if (!this.lobby || this.lobby.status !== 'preview') return;
    const m = parseMapOptions(payload);
    if (m.error) {
      this.sendTo(ws, { type: 'ack', data: { ok: false, error: m.error } });
      return;
    }
    this.lobby.mapOptions = { ...m.options, islands: this.lobby.islands };
    this.sendTo(ws, { type: 'ack', data: { ok: true } });
    this.broadcastState();
    this.saveLobby();
  }

  handlePoiCreate(ws, payload = {}) {
    if (!ws._auth) return;
    if (!this.lobby || this.lobby.status !== 'ready') return;
    if (!this.lobby.canPoiMutate()) {
      this.sendTo(ws, { type: EVENTS.ERROR, data: { code: ERROR_CODES.RATE_LIMITED, message: 'Slow down' } });
      return;
    }
    const role = ws._auth.role;
    const playerId = ws._auth.playerId;
    const result = this.lobby.createPoi(payload, role, playerId);
    if (result.error) {
      this.sendTo(ws, { type: EVENTS.ERROR, data: { code: result.error, message: result.error } });
      return;
    }
    this.broadcastPoiChange(null, result.poi);
    this.saveLobby();
  }

  handlePoiUpdate(ws, payload = {}) {
    if (!ws._auth) return;
    if (!this.lobby || this.lobby.status !== 'ready') return;
    if (typeof payload.id !== 'string') {
      this.sendTo(ws, { type: EVENTS.ERROR, data: { code: ERROR_CODES.POI_INVALID, message: 'Missing id' } });
      return;
    }
    if (!this.lobby.canPoiMutate()) {
      this.sendTo(ws, { type: EVENTS.ERROR, data: { code: ERROR_CODES.RATE_LIMITED, message: 'Slow down' } });
      return;
    }
    const role = ws._auth.role;
    const { id, ...patch } = payload;
    const result = this.lobby.updatePoi(id, patch, role);
    if (result.error) {
      this.sendTo(ws, { type: EVENTS.ERROR, data: { code: result.error, message: result.error } });
      return;
    }
    this.broadcastPoiChange(result.before, result.after);
    this.saveLobby();
  }

  handlePoiDelete(ws, payload = {}) {
    if (!ws._auth) return;
    if (!this.lobby || this.lobby.status !== 'ready') return;
    if (typeof payload.id !== 'string') {
      this.sendTo(ws, { type: EVENTS.ERROR, data: { code: ERROR_CODES.POI_INVALID, message: 'Invalid POI data' } });
      return;
    }
    if (!this.lobby.canPoiMutate()) {
      this.sendTo(ws, { type: EVENTS.ERROR, data: { code: ERROR_CODES.RATE_LIMITED, message: 'Slow down' } });
      return;
    }
    const result = this.lobby.deletePoi(payload.id);
    if (result.error) {
      this.sendTo(ws, { type: EVENTS.ERROR, data: { code: result.error, message: result.error } });
      return;
    }
    this.broadcastPoiChange(result.poi, null);
    this.saveLobby();
  }

  broadcastPoiChange(before, after) {
    for (const pws of this._sockets()) {
      if (!pws._auth) continue;
      if (pws._auth.role === 'host') {
        if (!before && after) this.sendTo(pws, { type: EVENTS.POI_CREATED, data: { poi: after } });
        else if (before && !after) this.sendTo(pws, { type: EVENTS.POI_DELETED, data: { id: before.id } });
        else if (before && after) this.sendTo(pws, { type: EVENTS.POI_UPDATED, data: { poi: after } });
        continue;
      }
      const role = 'player';
      const wasVisible = before ? this.lobby.isPoiVisible(before, role) : false;
      const nowVisible = after ? this.lobby.isPoiVisible(after, role) : false;
      if (!wasVisible && nowVisible) {
        this.sendTo(pws, { type: EVENTS.POI_CREATED, data: { poi: after } });
      } else if (wasVisible && !nowVisible) {
        this.sendTo(pws, { type: EVENTS.POI_DELETED, data: { id: before.id } });
      } else if (wasVisible && nowVisible) {
        this.sendTo(pws, { type: EVENTS.POI_UPDATED, data: { poi: after } });
      }
    }
    for (const [id, sse] of this.sseConnections) {
      if (!sse.auth) continue;
      if (sse.auth.role === 'host') {
        if (!before && after) this.sendToSSE(sse, { type: EVENTS.POI_CREATED, data: { poi: after } });
        else if (before && !after) this.sendToSSE(sse, { type: EVENTS.POI_DELETED, data: { id: before.id } });
        else if (before && after) this.sendToSSE(sse, { type: EVENTS.POI_UPDATED, data: { poi: after } });
        continue;
      }
      const role = 'player';
      const wasVisible = before ? this.lobby.isPoiVisible(before, role) : false;
      const nowVisible = after ? this.lobby.isPoiVisible(after, role) : false;
      if (!wasVisible && nowVisible) {
        this.sendToSSE(sse, { type: EVENTS.POI_CREATED, data: { poi: after } });
      } else if (wasVisible && !nowVisible) {
        this.sendToSSE(sse, { type: EVENTS.POI_DELETED, data: { id: before.id } });
      } else if (wasVisible && nowVisible) {
        this.sendToSSE(sse, { type: EVENTS.POI_UPDATED, data: { poi: after } });
      }
    }
  }

  broadcastState() {
    if (!this.lobby) return;
    for (const ws of this._sockets()) {
      if (!ws._auth) continue;
      const role = ws._auth.role;
      const playerId = ws._auth.playerId || null;
      this.sendTo(ws, { type: EVENTS.LOBBY_STATE, data: this.lobby.toWire(role, playerId) });
    }
    for (const [id, sse] of this.sseConnections) {
      if (!sse.auth) continue;
      const role = sse.auth.role;
      const playerId = sse.auth.playerId || null;
      this.sendToSSE(sse, { type: EVENTS.LOBBY_STATE, data: this.lobby.toWire(role, playerId) });
    }
  }

  broadcast(msg, { exclude } = {}) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      this.sendTo(ws, msg);
    }
    for (const [id, sse] of this.sseConnections) {
      this.sendToSSE(sse, msg);
    }
  }

  sendTo(ws, msg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // WebSocket may be closed
    }
  }

  sendToSSE(sse, msg) {
    try {
      const event = `data: ${JSON.stringify(msg)}\n\n`;
      sse.writer.write(sse.encoder.encode(event));
    } catch {
      // SSE connection may be closed
    }
  }

  handleSSEDisconnect(sseId) {
    const sse = this.sseConnections.get(sseId);
    if (!sse) return;
    this.sseConnections.delete(sseId);

    const auth = sse.auth;
    if (!auth) return;

    if (auth.role === 'host') {
      if (this.lobby) this.lobby.hostConnected = false;
      this.broadcastState();
      this.startGrace();
    } else if (auth.playerId && this.lobby) {
      const player = this.lobby.players[auth.playerId];
      if (player) {
        player.connected = false;
        const cancelled = this.lobby.cancelPlayerRequests(auth.playerId);
        for (const { requestId } of cancelled) {
          this.broadcast({ type: EVENTS.REQUEST_CANCELLED, data: { requestId, reason: 'player_left' } });
        }
        this.broadcast({ type: EVENTS.PLAYER_LEFT, data: { playerId: auth.playerId } });
      }
    }
    this.saveLobby();
  }

  async handleSSE(request) {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const token = url.searchParams.get('token');
    const role = url.searchParams.get('role');

    if (!code || !token || !role) {
      return new Response('Missing parameters: code, token, role', { status: 400 });
    }

    try {
      await this.ensureLobby();
    } catch (err) {
      console.error('ensureLobby error:', err);
    }
    this._initialized = true;

    if (!this.lobby) {
      return new Response('Lobby not found', { status: 404 });
    }

    let auth = null;

    if (role === 'host') {
      if (token !== this.lobby.hostToken) {
        return new Response('Invalid host token', { status: 403 });
      }
      this.clearGrace();
      this.lobby.hostConnected = true;
      auth = { role: 'host' };
    } else if (role === 'player') {
      const found = this.lobby.findPlayerByToken(token);
      if (!found) {
        return new Response('Invalid player token', { status: 403 });
      }
      const { playerId, player } = found;
      player.connected = true;
      auth = { role: 'player', playerId };
    } else {
      return new Response('Invalid role', { status: 400 });
    }

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Send initial lobby state
    const stateMsg = { type: EVENTS.LOBBY_STATE, data: this.lobby.toWire(auth.role, auth.playerId || null) };
    writer.write(encoder.encode(`data: ${JSON.stringify(stateMsg)}\n\n`));

    const sseId = crypto.randomUUID();
    this.sseConnections.set(sseId, { writer, encoder, auth });

    // Notify others about player join (if applicable)
    if (role === 'player') {
      const player = this.lobby.players[auth.playerId];
      if (player) {
        this.broadcast({
          type: EVENTS.PLAYER_JOINED,
          data: { playerId: auth.playerId, name: player.name },
        });
      }
    }
    this.saveLobby();

    const response = new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });

    // Handle client disconnect
    request.signal.addEventListener('abort', () => {
      writer.close().catch(() => {});
      this.handleSSEDisconnect(sseId);
    });

    return response;
  }

  async handlePostEvent(request) {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const role = url.searchParams.get('role');
    const token = bearerToken(request);

    if (!code || !token || !role) {
      return jsonResp({ error: 'missing_params' }, 400);
    }

    try {
      await this.ensureLobby();
    } catch (err) {
      console.error('ensureLobby error:', err);
    }
    this._initialized = true;

    if (!this.lobby) {
      return jsonResp({ error: ERROR_CODES.NO_SUCH_LOBBY }, 404);
    }

    let auth;
    if (role === 'host') {
      if (token !== this.lobby.hostToken) {
        return jsonResp({ error: ERROR_CODES.BAD_AUTH }, 403);
      }
      auth = { role: 'host' };
    } else if (role === 'player') {
      const found = this.lobby.findPlayerByToken(token);
      if (!found) {
        return jsonResp({ error: ERROR_CODES.BAD_AUTH }, 403);
      }
      auth = { role: 'player', playerId: found.playerId };
    } else {
      return jsonResp({ error: ERROR_CODES.BAD_AUTH }, 400);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResp({ error: 'bad_request' }, 400);
    }

    // Create a fake WebSocket that captures send calls (for error responses)
    const captured = { msg: null };
    const fakeWs = {
      _auth: auth,
      send: (data) => { captured.msg = JSON.parse(data); },
      close: () => {},
    };
    await this.handleMessage(fakeWs, JSON.stringify(body));

    if (captured.msg) {
      return jsonResp(captured.msg);
    }

    return jsonResp({ ok: true });
  }
}

// ── Helpers (mirror server/main.js) ──

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

function parseGridParams(body) {
  const rows = toInt(body.rows);
  const cols = toInt(body.cols);
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
    return required ? { error: 'bad_seed' } : { seed: crypto.getRandomValues(new Uint32Array(1))[0] };
  }
  const seed = toInt(raw);
  if (seed == null || seed < 0 || seed > 0xFFFFFFFF) return { error: 'bad_seed' };
  return { seed };
}

function jsonResp(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

async function parseJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

