import { LobbyDO } from './durableObject.js';
import { ERROR_CODES } from './protocol.js';
import { MIN_GRID, MAX_GRID } from './constants.js';

export { LobbyDO };

// Origins permitted to call the API / open WS / open SSE.
// Same-origin requests have no Origin header and are always allowed.
const ALLOWED_ORIGINS = new Set([
  'https://drifter.ink',
  'https://www.drifter.ink',
]);

function isOriginAllowed(origin) {
  if (!origin) return true; // same-origin (no Origin), curl, server-to-server
  if (ALLOWED_ORIGINS.has(origin)) return true;
  // Permit localhost dev (any port, http or https)
  try {
    const u = new URL(origin);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
  } catch {}
  return false;
}

function corsHeaders(origin) {
  const h = { 'Vary': 'Origin' };
  if (origin && isOriginAllowed(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Credentials'] = 'true';
  }
  return h;
}

function bearerToken(request) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function handlePreflight(request) {
  const origin = request.headers.get('Origin');
  if (!isOriginAllowed(origin)) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// Embedded static assets (inlined by build script)
const STATIC_FILES = {
  '/':               __INDEX_HTML__,
  '/index.html':     __INDEX_HTML__,
  '/lobby.html':     __LOBBY_HTML__,
  '/css/styles.css': __STYLES_CSS__,
  '/js/home.js':     __HOME_JS__,
  '/js/lobby.js':    __LOBBY_JS__,
  '/js/socket.js':   __SOCKET_JS__,
  '/js/render.js':   __RENDER_JS__,
  '/js/renderMap.js':__RENDERMAP_JS__,
  '/js/hex.js':      __HEX_JS__,
  '/js/hex-constants.js': __HEX_CONSTANTS_JS__,
  '/js/input.js':    __INPUT_JS__,
  '/js/poiModal.js': __POIMODAL_JS__,
  '/js/mapSettingsModal.js': __MAPSETTINGS_JS__,
  '/js/seedCodec.js':__SEEDCODEC_JS__,
};

const CONTENT_TYPES = {
  '.html':  'text/html; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.js':    'application/javascript; charset=utf-8',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const origin = request.headers.get('Origin');

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return handlePreflight(request);
    }

    // Origin check for cross-origin requests to WS / SSE / state-changing API.
    // Same-origin requests (no Origin header) and GETs of public resources pass through.
    const needsOriginCheck =
      request.headers.get('Upgrade') === 'websocket' ||
      pathname === '/sse' ||
      pathname === '/post-event' ||
      (pathname.startsWith('/api/') && request.method !== 'GET');
    if (needsOriginCheck && !isOriginAllowed(origin)) {
      return new Response('Forbidden origin', { status: 403 });
    }

    const response = await dispatch(request, env, ctx, pathname);

    // Apply CORS for cross-origin requests on non-WS responses.
    // Status 101 (WS upgrade) cannot be mutated.
    if (origin && isOriginAllowed(origin) && response.status !== 101) {
      const cors = corsHeaders(origin);
      const merged = new Response(response.body, response);
      for (const [k, v] of Object.entries(cors)) merged.headers.set(k, v);
      return merged;
    }
    return response;
  },
};

async function dispatch(request, env, ctx, pathname) {
  // WebSocket upgrade
  if (request.headers.get('Upgrade') === 'websocket') {
    return handleWebSocket(request, env);
  }

  // SSE stream
  if (pathname === '/sse') {
    return handleSSE(request, env);
  }

  // Post event (SSE companion channel for client → server messages)
  if (pathname === '/post-event') {
    return handlePostEvent(request, env);
  }

  // API routes
  if (pathname.startsWith('/api/')) {
    return handleAPI(request, env, ctx);
  }

  // Lobby routes (map image proxy, game state, etc.)
  if (pathname.startsWith('/lobbies/')) {
    return handleLobbies(request, env, ctx);
  }

  // Lobby page routes: /lobby/:code
  const lobbyPageMatch = pathname.match(/^\/lobby\/([^/]+)$/);
  if (lobbyPageMatch) {
    return serveStatic(__LOBBY_HTML__, 'text/html');
  }

  // Static files
  return serveStaticFile(pathname);
}

async function handleWebSocket(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return new Response('Missing code parameter', { status: 400 });
  }

  const id = env.LOBBY_DO.idFromName(code);
  const stub = env.LOBBY_DO.get(id);
  return stub.fetch(new Request(`http://internal/ws${url.search}`, request));
}

async function handleSSE(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return new Response('Missing code parameter', { status: 400 });
  }

  const id = env.LOBBY_DO.idFromName(code);
  const stub = env.LOBBY_DO.get(id);
  return stub.fetch(new Request(`http://internal/sse${url.search}`, request));
}

async function handlePostEvent(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return jsonResp({ error: 'missing_params' }, 400);
  }

  const id = env.LOBBY_DO.idFromName(code);
  const stub = env.LOBBY_DO.get(id);
  const headers = { 'Content-Type': 'application/json' };
  const authz = request.headers.get('Authorization');
  if (authz) headers['Authorization'] = authz;
  return stub.fetch(new Request(`http://internal/post-event${url.search}`, {
    method: 'POST',
    headers,
    body: await request.text(),
  }));
}

async function handleAPI(request, env, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method;

  // Health check
  if (pathname === '/api/health' && method === 'GET') {
    return jsonResp({ ok: true });
  }

  // Create lobby
  if ((pathname === '/api/lobbies' || pathname === '/api/lobbies/import') && method === 'POST') {
    const requireSeed = pathname === '/api/lobbies/import';
    return createLobby(request, env, ctx, requireSeed);
  }

  // Get lobby info
  const getMatch = pathname.match(/^\/api\/lobbies\/([^/]+)$/);
  if (getMatch && method === 'GET') {
    const code = getMatch[1];
    const id = env.LOBBY_DO.idFromName(code);
    const stub = env.LOBBY_DO.get(id);
    const res = await stub.fetch(new Request(`http://internal/get`));
    return res;
  }

  // Join lobby
  const joinMatch = pathname.match(/^\/api\/lobbies\/([^/]+)\/join$/);
  if (joinMatch && method === 'POST') {
    const code = joinMatch[1];
    const id = env.LOBBY_DO.idFromName(code);
    const stub = env.LOBBY_DO.get(id);
    const res = await stub.fetch(new Request(`http://internal/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: await request.text(),
    }));
    return res;
  }

  // Render complete notification
  const renderCompleteMatch = pathname.match(/^\/api\/lobbies\/([^/]+)\/render-complete$/);
  if (renderCompleteMatch && method === 'POST') {
    const code = renderCompleteMatch[1];
    const id = env.LOBBY_DO.idFromName(code);
    const stub = env.LOBBY_DO.get(id);
    const headers = { 'Content-Type': 'application/json' };
    const authz = request.headers.get('Authorization');
    if (authz) headers['Authorization'] = authz;
    const res = await stub.fetch(new Request(`http://internal/render-complete`, {
      method: 'POST',
      headers,
      body: await request.text(),
    }));
    return res;
  }

  return new Response('Not found', { status: 404 });
}

async function handleLobbies(request, env, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Game state export
  const gameStateMatch = pathname.match(/^\/lobbies\/([^/]+)\/game-state\.json$/);
  if (gameStateMatch) {
    const code = gameStateMatch[1];
    const id = env.LOBBY_DO.idFromName(code);
    const stub = env.LOBBY_DO.get(id);
    const headers = {};
    const authz = request.headers.get('Authorization');
    if (authz) headers['Authorization'] = authz;
    const res = await stub.fetch(new Request(`http://internal/game-state`, { headers }));
    return res;
  }

  // Map image - no longer served from server (rendered client-side)
  // Keep route for backward compatibility, returns 410 Gone
  const mapMatch = pathname.match(/^\/lobbies\/([^/]+)\/map\.png$/);
  if (mapMatch) {
    return new Response('Map rendering has moved to client-side. Please update.', {
      status: 410,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return new Response('Not found', { status: 404 });
}

async function createLobby(request, env, ctx, requireSeed) {
  // Imports embed full game state (revealed tiles, POIs); allow more headroom.
  const maxBytes = requireSeed ? 512 * 1024 : 8 * 1024;
  const cl = Number(request.headers.get('Content-Length') || 0);
  if (cl && cl > maxBytes) {
    return jsonResp({ error: ERROR_CODES.PAYLOAD_TOO_LARGE }, 413);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResp({ error: 'bad_request' }, 400);
  }

  const endpoint = requireSeed ? '/import' : '/create';

  for (let attempt = 0; attempt < 20; attempt++) {
    const code = crypto.getRandomValues(new Uint32Array(1))[0] % 100000;
    const padded = String(code).padStart(5, '0');

    const id = env.LOBBY_DO.idFromName(padded);
    const stub = env.LOBBY_DO.get(id);
    const url = new URL(`http://internal${endpoint}?code=${padded}`);

    const res = await stub.fetch(new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, code: padded }),
    }));

    if (res.status === 201) {
      const data = await res.json();
      data.code = padded;
      return jsonResp(data, 201);
    }

    if (res.status !== 409) {
      const data = await res.json().catch(() => ({}));
      return jsonResp(data, res.status);
    }
  }

  return jsonResp({ error: ERROR_CODES.CODE_EXHAUSTED }, 503);
}

function serveStaticFile(pathname) {
  const cleanPath = pathname.split('?')[0];
  const file = STATIC_FILES[cleanPath];
  if (!file) {
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  }
  if (cleanPath === '/' || cleanPath === '/index.html') {
    return serveStatic(file, 'text/html');
  }
  const ext = '.' + cleanPath.split('.').pop();
  const contentType = CONTENT_TYPES[ext] || 'text/plain';
  return serveStatic(file, contentType);
}

function serveStatic(content, contentType) {
  const isHTML = contentType.includes('html');
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': isHTML ? 'no-cache' : 'max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
  if (isHTML) {
    headers['Content-Security-Policy'] = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "connect-src 'self' ws: wss:",
      "font-src 'self' data:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');
    headers['X-Frame-Options'] = 'DENY';
    headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=()';
  }
  return new Response(content, { headers });
}

function jsonResp(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}
