export const EVENTS = {
  AUTH: 'auth',
  MOVE_REQUEST: 'move_request',
  MARKER_MOVE: 'marker_move',
  FOG_TOGGLE: 'fog_toggle',
  ACKNOWLEDGE_REQUEST: 'acknowledge_request',
  NEW_GAME: 'new_game',
  START_GAME: 'start_game',
  REGENERATE_MAP: 'regenerate_map',
  UPDATE_MAP_OPTIONS: 'update_map_options',
  RENDER_COMPLETE: 'render_complete',
  POI_CREATE: 'poi_create',
  POI_UPDATE: 'poi_update',
  POI_DELETE: 'poi_delete',
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

export const ERROR_CODES = {
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
  CODE_TAKEN: 'code_taken',
  CODE_EXHAUSTED: 'code_exhausted',
};

export const POI_COLORS = ['pink', 'peach', 'cream', 'mint', 'sky', 'lavender'];
export const POI_MAX_PER_LOBBY = 50;
export const POI_NAME_MAX = 40;
export const POI_DESC_MAX = 240;
export const MAX_PLAYERS_PER_LOBBY = 8;
export const GRACE_MS = 5 * 60 * 1000;
export const IDLE_MS = 2 * 60 * 60 * 1000;
