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
const {
  MAX_PLAYERS_PER_LOBBY,
  POI_COLORS,
  POI_MAX_PER_LOBBY,
  POI_NAME_MAX,
  POI_DESC_MAX,
} = require('./protocol.js');

class Lobby {
  constructor({ code, seed, rows, cols, hostToken, hostName, islands = false, mapOptions = {} }) {
    this.code = code;
    this.seed = seed;
    this.rows = rows;
    this.cols = cols;
    this.islands = !!islands;
    this.mapOptions = { ...mapOptions, islands: !!islands };
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
    this.pois = []; // [{ id, row, col, name, description, color, visibility, createdBy }]
    this._poiMutCount = 0;
    this._poiMutWindowStart = Date.now();

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

  touchActivity() {
    this.lastActivityAt = Date.now();
  }

  addPlayer(playerName) {
    if (Object.keys(this.players).length >= MAX_PLAYERS_PER_LOBBY - 1) return null;
    this.lastActivityAt = Date.now();
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
    this.pois = [];
    // Reset per-player rate-limit counters (new game = fresh slate)
    this._moveReqLast = {};
    this._moveReqViolations = {};
    this._markerMoveCount = 0;
    this._markerMoveWindowStart = Date.now();
    return true;
  }

  moveMarker(row, col) {
    const key = `${row},${col}`;
    const revealedDelta = this.revealed.has(key) ? [] : [[row, col]];
    this.revealed.add(key);
    this.marker = { row, col };
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
    this.lastActivityAt = now;
    return { requestId: newRequestId, cancelledRequestId, at: now };
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

  canPoiMutate() {
    const now = Date.now();
    if (now - this._poiMutWindowStart > 1000) {
      this._poiMutCount = 0;
      this._poiMutWindowStart = now;
    }
    if (this._poiMutCount >= 5) return false;
    this._poiMutCount++;
    return true;
  }

  _sanitizePoiInput(input, { partial = false } = {}) {
    if (!input || typeof input !== 'object') return { error: 'poi_invalid' };
    const out = {};

    if (input.row != null || input.col != null || !partial) {
      const r = Number.isInteger(input.row) ? input.row : null;
      const c = Number.isInteger(input.col) ? input.col : null;
      if (r == null || c == null) return { error: 'poi_invalid' };
      if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return { error: 'poi_invalid' };
      out.row = r;
      out.col = c;
    }

    if (input.name != null || !partial) {
      if (typeof input.name !== 'string') return { error: 'poi_invalid' };
      const name = input.name.trim().replace(/\s+/g, ' ');
      if (name.length < 1 || [...name].length > POI_NAME_MAX) return { error: 'poi_invalid' };
      out.name = name;
    }

    if (input.description != null) {
      if (typeof input.description !== 'string') return { error: 'poi_invalid' };
      const desc = input.description.replace(/\s+$/g, '');
      if ([...desc].length > POI_DESC_MAX) return { error: 'poi_invalid' };
      out.description = desc;
    } else if (!partial) {
      out.description = '';
    }

    if (input.color != null || !partial) {
      if (!POI_COLORS.includes(input.color)) return { error: 'poi_invalid' };
      out.color = input.color;
    }

if (input.visibility != null || !partial) {
       const v = input.visibility ?? 'public';
       if (v !== 'public' && v !== 'gm') return { error: 'poi_invalid' };
       out.visibility = v;
     }

     if (input.editableByPlayers != null || !partial) {
       out.editableByPlayers = !!input.editableByPlayers;
     }

     return { data: out };
  }

  createPoi(input, byRole, byPlayerId) {
    if (this.pois.length >= POI_MAX_PER_LOBBY) return { error: 'poi_limit' };
    const s = this._sanitizePoiInput(input, { partial: false });
    if (s.error) return s;
    if (byRole !== 'host' && !this._isInPlayerSight(s.data.row, s.data.col)) {
      return { error: 'poi_in_fog' };
    }
    if (s.data.visibility === 'gm' && byRole !== 'host') {
      s.data.visibility = 'public';
    }
    if (byRole !== 'host') {
      delete s.data.editableByPlayers;
    }
    const poi = {
      id: 'poi_' + crypto.randomBytes(4).toString('hex'),
      ...s.data,
      createdBy: byRole === 'host' ? 'host' : byPlayerId,
    };
    this.pois.push(poi);
    this.lastActivityAt = Date.now();
    return { poi };
  }

  updatePoi(id, patch, byRole) {
    const idx = this.pois.findIndex(p => p.id === id);
    if (idx === -1) return { error: 'poi_not_found' };
    const s = this._sanitizePoiInput(patch, { partial: true });
    if (s.error) return s;
    const existing = this.pois[idx];
    if (byRole !== 'host' && !existing.editableByPlayers) {
      delete s.data.name;
      delete s.data.description;
    }
    if (s.data.visibility === 'gm' && byRole !== 'host') {
      delete s.data.visibility;
    }
    if (byRole !== 'host') {
      delete s.data.editableByPlayers;
    }
    const before = { ...this.pois[idx] };
    const after = { ...before, ...s.data };
    this.pois[idx] = after;
    this.lastActivityAt = Date.now();
    return { before, after };
  }

  deletePoi(id) {
    const idx = this.pois.findIndex(p => p.id === id);
    if (idx === -1) return { error: 'poi_not_found' };
    const removed = this.pois[idx];
    this.pois.splice(idx, 1);
    this.lastActivityAt = Date.now();
    return { poi: removed };
  }

  isPoiVisible(poi, role) {
    if (role === 'host') return true;
    if (poi.visibility !== 'public') return false;
    return this._isInPlayerSight(poi.row, poi.col);
  }

  _isInPlayerSight(row, col) {
    const key = `${row},${col}`;
    if (this.revealed.has(key)) return true;
    if (!this.marker) return false;
    for (const [nr, nc] of hexNeighbors(row, col, this.rows, this.cols)) {
      if (this.revealed.has(`${nr},${nc}`)) return true;
    }
    return false;
  }

  getVisiblePois(role) {
    if (role === 'host') return this.pois.slice();
    return this.pois.filter(p => this.isPoiVisible(p, role));
  }

  loadImportState({ status, fog, marker, revealedTiles, pois }) {
    const validFog = fog
      && typeof fog.host === 'boolean'
      && typeof fog.players === 'boolean'
      ? { host: fog.host, players: fog.players }
      : { host: true, players: true };
    this.fog = validFog;

    const inBounds = (r, c) =>
      Number.isInteger(r) && Number.isInteger(c) &&
      r >= 0 && r < this.rows && c >= 0 && c < this.cols;

    const revealed = new Set();
    if (Array.isArray(revealedTiles)) {
      for (const tile of revealedTiles) {
        if (!Array.isArray(tile) || tile.length !== 2) continue;
        const [r, c] = tile;
        if (inBounds(r, c)) revealed.add(`${r},${c}`);
      }
    }
    this.revealed = revealed;

    if (marker && inBounds(marker.row, marker.col)) {
      this.marker = { row: marker.row, col: marker.col };
    }

    if (Array.isArray(pois)) {
      const loaded = [];
      for (const p of pois) {
        if (loaded.length >= POI_MAX_PER_LOBBY) break;
        if (!p || typeof p !== 'object') continue;
        if (!inBounds(p.row, p.col)) continue;
        if (typeof p.name !== 'string') continue;
        const name = p.name.trim().replace(/\s+/g, ' ');
        if (name.length < 1 || [...name].length > POI_NAME_MAX) continue;
        const description = typeof p.description === 'string'
          ? p.description.slice(0, POI_DESC_MAX * 4)
          : '';
        if ([...description].length > POI_DESC_MAX) continue;
        if (!POI_COLORS.includes(p.color)) continue;
        const visibility = p.visibility === 'gm' ? 'gm' : 'public';
        const id = (typeof p.id === 'string' && /^poi_[a-f0-9]{4,16}$/.test(p.id))
          ? p.id
          : 'poi_' + crypto.randomBytes(4).toString('hex');
        loaded.push({
          id,
          row: p.row,
          col: p.col,
          name,
          description,
          color: p.color,
          visibility,
          createdBy: typeof p.createdBy === 'string' ? p.createdBy : 'host',
        });
      }
      this.pois = loaded;
    }
    // Imports always resume in-game (skip the host's preview/setup step).
    this.status = 'ready';
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
      pois: this.pois.map(p => ({ ...p })),
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
      islands: this.islands,
      mapOptions: this.mapOptions,
      pois: this.getVisiblePois(role),
    };
    if (role === 'host') return { ...base, role: 'host' };
    return { ...base, role: 'player', playerId };
  }
}

module.exports = { Lobby, hexNeighbors, MIN_GRID, MAX_GRID, MAX_PLAYERS_PER_LOBBY };
