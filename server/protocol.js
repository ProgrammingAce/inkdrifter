const EVENTS = {
  // Client → Server
  AUTH: 'auth',
  MOVE_REQUEST: 'move_request',
  MARKER_MOVE: 'marker_move',
  FOG_TOGGLE: 'fog_toggle',
  ACKNOWLEDGE_REQUEST: 'acknowledge_request',
  NEW_GAME: 'new_game',
  START_GAME: 'start_game',
  REGENERATE_MAP: 'regenerate_map',
  UPDATE_MAP_OPTIONS: 'update_map_options',
  POI_CREATE: 'poi_create',
  POI_UPDATE: 'poi_update',
  POI_DELETE: 'poi_delete',

  // Server → Client
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
  POI_CREATED: 'poi_created',
  POI_UPDATED: 'poi_updated',
  POI_DELETED: 'poi_deleted',
};

const ERROR_CODES = {
  BAD_AUTH: 'bad_auth',
  NOT_HOST: 'not_host',
  OUT_OF_BOUNDS: 'out_of_bounds',
  NOT_IN_RING: 'not_in_ring',
  MARKER_NOT_PLACED: 'marker_not_placed',
  RATE_LIMITED: 'rate_limited',
  LOBBY_NOT_READY: 'lobby_not_ready',
  LOBBY_CLOSED: 'lobby_closed',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  LOBBY_FULL: 'lobby_full',
  NO_SUCH_LOBBY: 'no_such_lobby',
  NAME_TAKEN: 'name_taken',
  POI_NOT_FOUND: 'poi_not_found',
  POI_INVALID: 'poi_invalid',
  POI_LIMIT: 'poi_limit',
};

const POI_COLORS = ['pink', 'peach', 'cream', 'mint', 'sky', 'lavender'];
const POI_MAX_PER_LOBBY = 50;
const POI_NAME_MAX = 40;
const POI_DESC_MAX = 240;

// Max players in a lobby, host included. Mirror in web/js/socket.js.
const MAX_PLAYERS_PER_LOBBY = 8;

module.exports = {
  EVENTS,
  ERROR_CODES,
  MAX_PLAYERS_PER_LOBBY,
  POI_COLORS,
  POI_MAX_PER_LOBBY,
  POI_NAME_MAX,
  POI_DESC_MAX,
};
