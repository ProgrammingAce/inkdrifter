# Inkdrifter

A multiplayer hex map explorer with a procedurally generated fantasy map. The host generates a parchment-style map (oceans, rivers, lakes, ponds, mountains, hills, plains, cities) and shares a 5-digit lobby code. Up to 8 players join and explore the map together through a shared player marker that reveals tiles as it moves — the rest of the world stays under fog of war.

## Quick start

```bash
npm install
npm start
```

Open `http://localhost:3000`, click **Generate** to create a lobby, then share the code shown to invite players.

For development with auto-restart on file changes:

```bash
npm run dev
```

## How it works

- **Host** picks a grid size (and optional seed) and clicks Generate. The server renders the map PNG in a worker thread and creates a lobby.
- **Players** join with the 5-digit code and a display name. The lobby holds up to 8 people total.
- **The marker** starts unplaced. The host clicks a tile to place it, then drags it to move. The marker reveals its hex and the 6 neighbors (fully visible forever once seen).
- **Fog of war** for players: black over unrevealed tiles, light fog over the current ring that has never been revealed, fully clear over any hex the marker has previously visited.
- **Players can click** light-fog ring tiles to send the host a *"request to move here"* notification (advisory only — the host moves wherever they like).
- **Host fog toggle**: the host can show/hide fog on their own view and on players' views independently.
- Both host and players can see and copy the lobby's **seed** so anyone can re-roll the same map in their own lobby later.

The host can also **save** the current game state (player positions, fog, marker location) to a JSON file and **load** it later to resume.

## Map generator

The whole map pipeline lives in `index.js` and can also be run as a CLI to dump PNGs:

```bash
# default demo variants
node index.js

# specific seed and size
node index.js --rows 12 --cols 16 --seed 42 --out my_map.png

# multiple seeds at once
node index.js --rows 10 --cols 14 --seeds 1,2,3
```

### What gets rendered

The renderer composites in this order, all in a hand-drawn ink-on-parchment style:

1. **Parchment background** with a subtle paper-grain texture.
2. **Oceans + coastlines**: hexes on the chosen ocean sides become water; coastline is stitched into wiggly polylines with offset wave rings.
3. **Rivers**: random meandering paths from one edge of the map, trimmed to the land run, with tributary support.
4. **Lakes**: scenic lakes (placed by a desirability score) plus terminus lakes at inland river endpoints.
5. **Biome classification**: each land hex gets a tag from elevation + moisture fields (`mountains`, `hills`, `forest`, `plains`, `swamp`) with a separate `city` placement pass overlaying eligible hexes.
6. **Ponds**: small irregular puddles scattered through plains/forest hexes.
7. **Hex grid lines** with edge-vignette fade and dimmed strokes over water.
8. **Mountains**: triangular peaks with fir-tick hash marks, grouped into chains, drawn back-to-front.
9. **Hills**: small Catmull-Rom arches in clusters per hex.
10. **Grass tufts** on plains hexes.
11. **Cities**: each city hex gets a small settlement — 2–3 buildings (iso houses, market tents, towers) with a unified iso facing, shared baseline, ground-stroke road, and a clear size hierarchy. Towers (round with U-shaped battlemented top, or classic front-elevation with merlons) are the tallest structures in a town. At most one of each tower style appears per map, so each reads as a unique landmark.
12. **Vignette** darkening the parchment toward the edges.

Specs for the major systems live in `BIOMES.md`, `OCEAN.md`, `RIVER_SPEC.md`, `HEX.md`, and `DESIGN.md`.

## Project layout

```
index.js                 # full map generator + renderMap() entry point
server/
  main.js                # Express + Socket.IO, HTTP routes and socket handlers
  lobby.js               # Lobby class (game state, fog logic, rate limiting)
  lobbyManager.js        # in-memory lobby map, grace timers, idle cleanup
  mapRender.js           # RenderQueue, delegates PNG rendering to worker thread
  renderWorker.js        # worker_threads worker that calls renderMap()
  protocol.js            # EVENTS and ERROR_CODES constants
web/
  index.html             # home page (create/join lobby)
  lobby.html             # lobby page (map view + controls)
  js/
    hex.js               # hex geometry mirroring index.js
    lobby.js             # lobby page controller, socket event handling
    render.js            # canvas fog overlay, marker, pending-request indicators
    input.js             # host drag, player ring-click, cursor affordance
  css/                   # parchment/fantasy theme styles
DESIGN.md                # full design spec for the multiplayer layer
BIOMES.md                # biome classification + city placement spec
OCEAN.md                 # ocean side selection + coastline algorithm
RIVER_SPEC.md            # river path generation + trimming
HEX.md                   # offset-rows hex geometry reference
```

## Stack

- **Server**: Node + Express + Socket.IO. Map rendering runs in a `worker_threads` Worker so generation doesn't block the event loop.
- **Client**: vanilla HTML/JS ES modules. No framework.
- **Rendering**: `node-canvas` on the server (PNG) and HTML5 Canvas on the client (fog overlay + marker on top of the served PNG).
- **Persistence**: in-memory only. Lobbies survive host reconnects for a grace period but not server restarts. Use save/load to persist game state to a file.

## License

AGPL-3.0
