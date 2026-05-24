const crypto = require('crypto');
const {
  HEX_SIZE,
  DEFAULT_GRID_ORIGIN_X,
  DEFAULT_GRID_ORIGIN_Y,
  MIN_GRID,
  MAX_GRID,
  gridCanvasSize,
  hexNeighborsBounded: hexNeighbors,
} = require('../index.js');

class Lobby {
  constructor({ code, seed, rows, cols, hostToken, hostName }) {
    this.code = code;
    this.seed = seed;
    this.rows = rows;
    this.cols = cols;
    const { W, H } = gridCanvasSize(rows, cols, DEFAULT_GRID_ORIGIN_X, DEFAULT_GRID_ORIGIN_Y);
    this.canvasWidth = W;
    this.canvasHeight = H;
    this.originX = DEFAULT_GRID_ORIGIN_X;
    this.originY = DEFAULT_GRID_ORIGIN_Y;
    this.hexSize = HEX_SIZE;

    this.status = 'rendering';
    this.pngBuffer = null;
    this.biomeTags = {};

    this.hostToken = hostToken;
    this.hostName = hostName;
    this.hostConnected = false;
    this.hostSocketId = null;

    this.players = {}; // playerId -> { name, token, connected, socketId }
    this.marker = null; // { row, col } | null
    this.revealed = new Set(); // Set of "r,c" strings
    this.fog = { host: true, players: true };
    this.pendingRequests = {}; // requestId -> { playerId, row, col, at }

    this.createdAt = Date.now();
    this.lastActivityAt = Date.now();

    this._gracePauseTimer = null;

    // Rate limiting state per player
    this._moveReqLast = {}; // playerId -> timestamp
    this._moveReqViolations = {}; // playerId -> { count, windowStart }

    // Marker move rate limiting per host socket
    this._markerMoveCount = 0;
    this._markerMoveWindowStart = Date.now();
  }

  addPlayer(playerName) {
    if (Object.keys(this.players).length >= 7) return null;
    const playerId = 'p_' + crypto.randomBytes(3).toString('hex');
    const playerToken = crypto.randomUUID();
    this.players[playerId] = { name: playerName, token: playerToken, connected: false, socketId: null };
    return { playerId, playerToken };
  }

  hasPlayerName(name) {
    return Object.values(this.players).some(p => p.name === name);
  }

  findPlayerByToken(token) {
    for (const [playerId, player] of Object.entries(this.players)) {
      if (player.token === token) return { playerId, player };
    }
    return null;
  }

  setReady(pngBuffer, biomeTags) {
    this.pngBuffer = pngBuffer;
    this.biomeTags = biomeTags || {};
    this.status = 'preview';
  }

  startGame() {
    if (this.status !== 'preview') return false;
    this.status = 'ready';
    this.fog = { host: true, players: true };
    return true;
  }

  regenerate() {
    this.status = 'rendering';
    this.pngBuffer = null;
    this.biomeTags = {};
    // Generate a new seed for the regenerated map
    this.seed = crypto.randomInt(0, 2 ** 32);
    // Clear all game state from preview
    this.revealed = new Set();
    this.marker = null;
    this.pendingRequests = {};
    return true;
  }

  moveMarker(row, col) {
    const prevRevealed = new Set(this.revealed);
    this.marker = { row, col };
    this.revealed.add(`${row},${col}`);
    const revealedDelta = [];
    for (const key of this.revealed) {
      if (!prevRevealed.has(key)) {
        const [r, c] = key.split(',').map(Number);
        revealedDelta.push([r, c]);
      }
    }
    const cancelled = Object.entries(this.pendingRequests).map(([requestId, req]) => ({ requestId, ...req }));
    this.pendingRequests = {};
    this.lastActivityAt = Date.now();
    return { revealedDelta, cancelled };
  }

  canMarkerMove() {
    const now = Date.now();
    if (now - this._markerMoveWindowStart > 1000) {
      this._markerMoveCount = 0;
      this._markerMoveWindowStart = now;
    }
    if (this._markerMoveCount >= 10) return false;
    this._markerMoveCount++;
    return true;
  }

  addMoveRequest(playerId, row, col) {
    const now = Date.now();
    const lastTime = this._moveReqLast[playerId] || 0;
    if (now - lastTime < 500) {
      const v = this._moveReqViolations[playerId] || { count: 0, windowStart: now };
      if (now - v.windowStart > 10000) { v.count = 0; v.windowStart = now; }
      v.count++;
      this._moveReqViolations[playerId] = v;
      return { error: 'rate_limited', disconnect: v.count > 10 };
    }
    this._moveReqLast[playerId] = now;
    const v = this._moveReqViolations[playerId];
    if (v && now - v.windowStart > 10000) delete this._moveReqViolations[playerId];

    if (!this.marker) return { error: 'marker_not_placed' };

    const target = `${row},${col}`;
    if (!this.revealed.has(target)) {
      let adjToRevealed = false;
      for (const [nr, nc] of hexNeighbors(row, col, this.rows, this.cols)) {
        if (this.revealed.has(`${nr},${nc}`)) { adjToRevealed = true; break; }
      }
      if (!adjToRevealed) return { error: 'not_in_ring' };
    }

    // Cancel any existing request from this player
    let cancelledRequestId = null;
    for (const [requestId, req] of Object.entries(this.pendingRequests)) {
      if (req.playerId === playerId) {
        cancelledRequestId = requestId;
        delete this.pendingRequests[requestId];
        break;
      }
    }

    const newRequestId = 'req_' + crypto.randomBytes(4).toString('hex');
    this.pendingRequests[newRequestId] = { playerId, row, col, at: now };
    this.lastActivityAt = Date.now();
    return { requestId: newRequestId, cancelledRequestId };
  }

  cancelPlayerRequests(playerId) {
    const cancelled = [];
    for (const [requestId, req] of Object.entries(this.pendingRequests)) {
      if (req.playerId === playerId) {
        cancelled.push({ requestId, reason: 'player_left' });
        delete this.pendingRequests[requestId];
      }
    }
    return cancelled;
  }

  acknowledgeRequest(requestId) {
    if (!this.pendingRequests[requestId]) return false;
    delete this.pendingRequests[requestId];
    return true;
  }

  setFog(target, enabled) {
    if (target === 'host') this.fog.host = enabled;
    else if (target === 'players') this.fog.players = enabled;
    this.lastActivityAt = Date.now();
  }

  loadImportState({ status, fog, marker, revealedTiles }) {
    this.fog = fog || { host: true, players: true };
    this.revealed = new Set(revealedTiles.map(([r, c]) => `${r},${c}`));
    if (marker) {
      this.marker = { row: marker.row, col: marker.col };
    }
    if (status === 'ready') {
      this.status = 'ready';
    }
  }

  _revealedTiles() {
    return Array.from(this.revealed).map(key => key.split(',').map(Number));
  }

  _playersWire() {
    const players = {};
    for (const [pid, p] of Object.entries(this.players)) {
      players[pid] = { name: p.name, connected: p.connected };
    }
    return players;
  }

  _pendingRequestsWire({ sort = false } = {}) {
    const list = Object.entries(this.pendingRequests)
      .map(([requestId, req]) => ({ requestId, ...req }));
    if (sort) list.sort((a, b) => b.at - a.at);
    return list;
  }

  toJSONExport() {
    return {
      code: this.code,
      seed: this.seed,
      gridRows: this.rows,
      gridCols: this.cols,
      canvasWidth: this.canvasWidth,
      canvasHeight: this.canvasHeight,
      status: this.status,
      fog: { ...this.fog },
      marker: this.marker ? { ...this.marker } : null,
      revealedTiles: this._revealedTiles(),
      pendingRequests: this._pendingRequestsWire(),
      players: this._playersWire(),
      hostName: this.hostName,
      hostConnected: this.hostConnected,
      biomeTags: this.biomeTags,
      createdAt: this.createdAt,
    };
  }

  get playerCount() {
    return Object.keys(this.players).length + 1; // +1 for host
  }

  toWire(role, playerId) {
    const base = {
      code: this.code,
      seed: this.seed,
      rows: this.rows,
      cols: this.cols,
      canvasWidth: this.canvasWidth,
      canvasHeight: this.canvasHeight,
      originX: this.originX,
      originY: this.originY,
      hexSize: this.hexSize,
      status: this.status,
      hostConnected: this.hostConnected,
      hostName: this.hostName,
      players: this._playersWire(),
      marker: this.marker,
      revealed: this._revealedTiles(),
      fog: this.fog,
      pendingRequests: this._pendingRequestsWire({ sort: true }),
      biomeTags: this.biomeTags,
    };
    if (role === 'host') return { ...base, role: 'host' };
    return { ...base, role: 'player', playerId };
  }
}

module.exports = { Lobby, hexNeighbors, MIN_GRID, MAX_GRID };
