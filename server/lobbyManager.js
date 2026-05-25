const crypto = require('crypto');
const { Lobby } = require('./lobby.js');

const GRACE_MS = 5 * 60 * 1000;
const IDLE_MS = 2 * 60 * 60 * 1000;

class LobbyManager {
  constructor(io) {
    this.io = io;
    this.lobbies = new Map(); // code -> Lobby
    // Raw WebSocket connections per lobby: code -> Map<ws, auth>
    this.rawWs = new Map();
    // SSE connections per lobby: code -> Map<sseObj, auth>
    this.sseConns = new Map();
    this._idleInterval = setInterval(() => this._checkIdle(), 60 * 1000);
  }

  async createLobby({ rows, cols, seed, hostName, islands = false, mapOptions = {} }) {
    let code;
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = crypto.randomInt(0, 100000).toString().padStart(5, '0');
      if (!this.lobbies.has(candidate)) { code = candidate; break; }
    }
    if (!code) { const e = new Error('CODE_EXHAUSTED'); e.code = 503; throw e; }

    const hostToken = crypto.randomUUID();
    const lobby = new Lobby({ code, seed, rows, cols, hostToken, hostName, islands, mapOptions });
    this.lobbies.set(code, lobby);
    return lobby;
  }

  getLobby(code) {
    return this.lobbies.get(code) || null;
  }

  // Broadcast to ALL connections (Socket.IO rooms + raw WS + SSE)
  broadcast(code, event, data, { excludeWs = null } = {}) {
    // Socket.IO room
    this.io.to(code).emit(event, data);
    // Raw WebSockets
    const wsMap = this.rawWs.get(code);
    if (wsMap) {
      for (const [ws, auth] of wsMap) {
        if (ws === excludeWs) continue;
        try { ws.send(JSON.stringify({ type: event, data })); } catch {}
      }
    }
    // SSE connections
    const sseMap = this.sseConns.get(code);
    if (sseMap) {
      const payload = `data: ${JSON.stringify({ type: event, data })}\n\n`;
      for (const [sse, auth] of sseMap) {
        try { sse.writer.write(sse.encoder.encode(payload)); } catch {}
      }
    }
  }

  // Broadcast lobby state to all connections (role-aware)
  broadcastState(code) {
    const lobby = this.lobbies.get(code);
    if (!lobby) return;
    // Socket.IO
    this.io.in(code).fetchSockets().then(sockets => {
      for (const s of sockets) {
        if (s.data.isHost) {
          s.emit('lobby_state', lobby.toWire('host', null));
        } else if (s.data.playerId) {
          s.emit('lobby_state', lobby.toWire('player', s.data.playerId));
        }
      }
    });
    // Raw WS
    const wsMap = this.rawWs.get(code);
    if (wsMap) {
      for (const [ws, auth] of wsMap) {
        const role = auth?.role || 'player';
        const playerId = auth?.playerId || null;
        try { ws.send(JSON.stringify({ type: 'lobby_state', data: lobby.toWire(role, playerId) })); } catch {}
      }
    }
    // SSE
    const sseMap = this.sseConns.get(code);
    if (sseMap) {
      for (const [sse, auth] of sseMap) {
        const role = auth?.role || 'player';
        const playerId = auth?.playerId || null;
        const payload = `data: ${JSON.stringify({ type: 'lobby_state', data: lobby.toWire(role, playerId) })}\n\n`;
        try { sse.writer.write(sse.encoder.encode(payload)); } catch {}
      }
    }
  }

  destroyLobby(code, reason) {
    const lobby = this.lobbies.get(code);
    if (!lobby) return;
    if (lobby._gracePauseTimer) { clearTimeout(lobby._gracePauseTimer); lobby._gracePauseTimer = null; }

    // Notify all connections
    this.broadcast(code, 'lobby_closed', { reason });

    // Close raw WS connections
    const wsMap = this.rawWs.get(code);
    if (wsMap) {
      for (const [ws] of wsMap) {
        try { ws.close(1000, reason || 'closed'); } catch {}
      }
      this.rawWs.delete(code);
    }
    // Close SSE connections
    const sseMap = this.sseConns.get(code);
    if (sseMap) {
      for (const [sse] of sseMap) {
        try { sse.writer.close(); } catch {}
      }
      this.sseConns.delete(code);
    }

    this.io.in(code).socketsLeave(code);
    this.lobbies.delete(code);
  }

  startGrace(code) {
    const lobby = this.lobbies.get(code);
    if (!lobby) return;
    if (lobby._gracePauseTimer) clearTimeout(lobby._gracePauseTimer);
    lobby._gracePauseTimer = setTimeout(() => {
      this.destroyLobby(code, 'host_timeout');
    }, GRACE_MS);
  }

  clearGrace(code) {
    const lobby = this.lobbies.get(code);
    if (!lobby) return;
    if (lobby._gracePauseTimer) { clearTimeout(lobby._gracePauseTimer); lobby._gracePauseTimer = null; }
  }

  _checkIdle() {
    const now = Date.now();
    for (const [code, lobby] of this.lobbies) {
      if (now - lobby.lastActivityAt > IDLE_MS) this.destroyLobby(code, 'idle');
    }
  }

  // POI broadcast (role-aware visibility)
  async broadcastPoiChange(code, before, after) {
    const lobby = this.lobbies.get(code);
    if (!lobby) return;

    // Socket.IO
    const sockets = await this.io.in(code).fetchSockets();
    for (const s of sockets) {
      if (!s.data.authenticated) continue;
      if (s.data.isHost) {
        if (!before && after) s.emit('poi_created', { poi: after });
        else if (before && !after) s.emit('poi_deleted', { id: before.id });
        else if (before && after) s.emit('poi_updated', { poi: after });
      } else {
        const wasVisible = before ? lobby.isPoiVisible(before, 'player') : false;
        const nowVisible = after ? lobby.isPoiVisible(after, 'player') : false;
        if (!wasVisible && nowVisible) s.emit('poi_created', { poi: after });
        else if (wasVisible && !nowVisible) s.emit('poi_deleted', { id: before.id });
        else if (wasVisible && nowVisible) s.emit('poi_updated', { poi: after });
      }
    }

    // Raw WS
    const wsMap = this.rawWs.get(code);
    if (wsMap) {
      for (const [ws, auth] of wsMap) {
        const role = auth?.role || 'player';
        if (role === 'host') {
          if (!before && after) this._wsSend(ws, 'poi_created', { poi: after });
          else if (before && !after) this._wsSend(ws, 'poi_deleted', { id: before.id });
          else if (before && after) this._wsSend(ws, 'poi_updated', { poi: after });
        } else {
          const wasVisible = before ? lobby.isPoiVisible(before, 'player') : false;
          const nowVisible = after ? lobby.isPoiVisible(after, 'player') : false;
          if (!wasVisible && nowVisible) this._wsSend(ws, 'poi_created', { poi: after });
          else if (wasVisible && !nowVisible) this._wsSend(ws, 'poi_deleted', { id: before.id });
          else if (wasVisible && nowVisible) this._wsSend(ws, 'poi_updated', { poi: after });
        }
      }
    }

    // SSE
    const sseMap = this.sseConns.get(code);
    if (sseMap) {
      for (const [sse, auth] of sseMap) {
        const role = auth?.role || 'player';
        let evt = null;
        if (role === 'host') {
          if (!before && after) evt = { type: 'poi_created', data: { poi: after } };
          else if (before && !after) evt = { type: 'poi_deleted', data: { id: before.id } };
          else if (before && after) evt = { type: 'poi_updated', data: { poi: after } };
        } else {
          const wasVisible = before ? lobby.isPoiVisible(before, 'player') : false;
          const nowVisible = after ? lobby.isPoiVisible(after, 'player') : false;
          if (!wasVisible && nowVisible) evt = { type: 'poi_created', data: { poi: after } };
          else if (wasVisible && !nowVisible) evt = { type: 'poi_deleted', data: { id: before.id } };
          else if (wasVisible && nowVisible) evt = { type: 'poi_updated', data: { poi: after } };
        }
        if (evt) {
          try { sse.writer.write(sse.encoder.encode(`data: ${JSON.stringify(evt)}\n\n`)); } catch {}
        }
      }
    }
  }

  _wsSend(ws, type, data) {
    try { ws.send(JSON.stringify({ type, data })); } catch {}
  }
}

module.exports = { LobbyManager };
