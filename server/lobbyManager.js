const crypto = require('crypto');
const { Lobby } = require('./lobby.js');

const GRACE_MS = 5 * 60 * 1000;
const IDLE_MS = 2 * 60 * 60 * 1000;

class LobbyManager {
  constructor(io) {
    this.io = io;
    this.lobbies = new Map(); // code -> Lobby
    this._idleInterval = setInterval(() => this._checkIdle(), 60 * 1000);
  }

  async createLobby({ rows, cols, seed, hostName, islands = false }) {
    let code;
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = crypto.randomInt(0, 100000).toString().padStart(5, '0');
      if (!this.lobbies.has(candidate)) { code = candidate; break; }
    }
    if (!code) { const e = new Error('CODE_EXHAUSTED'); e.code = 503; throw e; }

    const hostToken = crypto.randomUUID();
    const lobby = new Lobby({ code, seed, rows, cols, hostToken, hostName, islands });
    this.lobbies.set(code, lobby);
    return lobby;
  }

  getLobby(code) {
    return this.lobbies.get(code) || null;
  }

  destroyLobby(code, reason) {
    const lobby = this.lobbies.get(code);
    if (!lobby) return;
    if (lobby._gracePauseTimer) { clearTimeout(lobby._gracePauseTimer); lobby._gracePauseTimer = null; }
    this.io.to(code).emit('lobby_closed', { reason });
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
}

module.exports = { LobbyManager };
