const crypto = require('crypto');

const HEX_SIZE = 54;
const HEX_W = Math.sqrt(3) * HEX_SIZE;
const HEX_H = 2 * HEX_SIZE;
const DEFAULT_GRID_ORIGIN_X = 173;
const DEFAULT_GRID_ORIGIN_Y = 70;
const MIN_GRID = 6;
const MAX_GRID = 50;

function computeCanvasSize(rows, cols) {
  const ox = DEFAULT_GRID_ORIGIN_X;
  const oy = DEFAULT_GRID_ORIGIN_Y;
  const rightExtent = ox + (cols - 1) * HEX_W + HEX_W;
  const bottomExtent = oy + (rows - 1) * 0.75 * HEX_H + HEX_H / 2;
  return { W: Math.ceil(rightExtent + 100), H: Math.ceil(bottomExtent + 12) };
}

function hexNeighbors(row, col, rows, cols) {
  const candidates = row % 2 === 0
    ? [[row - 1, col - 1], [row - 1, col], [row, col - 1], [row, col + 1], [row + 1, col - 1], [row + 1, col]]
    : [[row - 1, col], [row - 1, col + 1], [row, col - 1], [row, col + 1], [row + 1, col], [row + 1, col + 1]];
  return candidates.filter(([r, c]) => r >= 0 && r < rows && c >= 0 && c < cols);
}

class Lobby {
  constructor({ code, seed, rows, cols, hostToken, hostName }) {
    this.code = code;
    this.seed = seed;
    this.rows = rows;
    this.cols = cols;
    const { W, H } = computeCanvasSize(rows, cols);
    this.canvasWidth = W;
    this.canvasHeight = H;
    this.originX = DEFAULT_GRID_ORIGIN_X;
    this.originY = DEFAULT_GRID_ORIGIN_Y;
    this.hexSize = HEX_SIZE;

    this.status = 'rendering';
    this.pngBuffer = null;

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

  setReady(pngBuffer) {
    this.pngBuffer = pngBuffer;
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

    const nbrs = hexNeighbors(this.marker.row, this.marker.col, this.rows, this.cols);
    if (!nbrs.some(([r, c]) => r === row && c === col)) return { error: 'not_in_ring' };

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

  get playerCount() {
    return Object.keys(this.players).length + 1; // +1 for host
  }

  toWire(role, playerId) {
    const revealed = Array.from(this.revealed).map(key => key.split(',').map(Number));
    const pendingRequests = Object.entries(this.pendingRequests)
      .map(([requestId, req]) => ({ requestId, ...req }))
      .sort((a, b) => b.at - a.at);
    const players = {};
    for (const [pid, p] of Object.entries(this.players)) {
      players[pid] = { name: p.name, connected: p.connected };
    }
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
      players,
      marker: this.marker,
      revealed,
      fog: this.fog,
      pendingRequests,
    };
    if (role === 'host') return { ...base, role: 'host' };
    return { ...base, role: 'player', playerId };
  }
}

module.exports = { Lobby, hexNeighbors, MIN_GRID, MAX_GRID };
