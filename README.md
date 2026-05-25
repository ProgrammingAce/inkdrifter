# Inkdrifter

A small multiplayer hex-map explorer. You generate a parchment-style fantasy map, share a 5-digit code, and your friends wander it with you — one shared marker, fog of war over everything you haven't seen yet.

There's no campaign, no combat, no XP. It's a map and a torch.

## Quick start

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`, hit **Generate**, and pass the code to whoever you're playing with. `npm start` runs the server without the file-watcher; `npm run build` produces the bundled assets used by the Cloudflare Worker.

## Playing it

The host clicks **Generate**, picks a grid size (and a seed, if you want a specific map), and gets a lobby. Up to seven other people can join with the code. Pick a name and you're in.

Nobody can do anything until the host places the marker. Click a hex and that's where the party is. From then on, drag the marker around — every hex it touches gets permanently uncovered, plus the six neighbors. The current ring (one step away) shows up under light fog so players can see *something* without seeing too much.

Players don't move the marker. They can click a light-fog hex to ping the host with "I think we should go here," but the host decides — it's just a suggestion, not a vote.

A few useful things:

- The host can toggle fog independently for themselves and for players, which is handy when you want to peek without spoiling.
- The seed is visible to everyone, so anyone can re-roll the same map in their own lobby later.
- The host can save the whole game state — marker, fog, player positions — to a JSON file and load it back later. Lobbies don't survive server restarts otherwise.

## The map generator

The generator is the part I actually enjoyed writing. It lives in `src/` and renders in this order, all in a hand-drawn ink-on-parchment style:

1. Parchment background with paper-grain noise.
2. Oceans on one or more sides, with the coastline stitched into wiggly polylines and a couple of offset wave rings.
3. Rivers that meander from an edge inward, with optional tributaries, trimmed where they hit land run-out.
4. Lakes — both "scenic" placements (scored for desirability) and terminus lakes where inland rivers dead-end.
5. Biome classification per hex from an elevation and moisture field: mountains, hills, forest, plains, swamp.
6. Ponds, scattered through plains and forest.
7. Hex grid lines, faded at the edges and dimmed over water.
8. Mountain peaks with fir-tick hash marks, grouped into chains and drawn back-to-front so they overlap correctly.
9. Hill arches drawn as little Catmull-Rom curves.
10. Grass tufts on plains.
11. Cities. Each city gets 2–3 buildings — iso houses, market tents, a tower — sharing a baseline and a ground-stroke road, with a clear size hierarchy. Towers are deliberately rare landmarks: at most one of each style per map.
12. A vignette to darken the edges.

You can run the generator standalone:

```bash
node index.js                                     # demo variants
node index.js --rows 12 --cols 16 --seed 42 --out my_map.png
node index.js --rows 10 --cols 14 --seeds 1,2,3
```

If you want to dig into a specific system, the design notes are in `BIOMES.md`, `OCEAN.md`, `RIVER_SPEC.md`, `HEX.md`, and `DESIGN.md`.

## Project layout

```
index.js                 # re-export shim; runs src/cli.js when invoked directly
src/
  cli.js                 # CLI flag parsing + PNG dump
  renderMap.js           # top-level compositing entry point
  constants.js, rng.js, hex.js, grid.js
  ocean.js, rivers.js, biomes.js, cities.js
  terrain/               # per-biome draw passes
server/                  # Express + Socket.IO (local dev)
  main.js, lobby.js, lobbyManager.js
  mapRender.js           # PNG rendering via worker_threads
  renderWorker.js, protocol.js
workers/                 # Cloudflare Worker + Durable Object
  index.js, durableObject.js, lobby.js, ...
web/
  index.html, lobby.html
  js/                    # ES modules, bundled by esbuild into dist/
  css/                   # parchment theme
scripts/
  build.mjs              # production build (client bundles + worker)
  dev.mjs                # dev: esbuild watch + node --watch
```

## Stack

Server is Node + Express + Socket.IO locally, or a Cloudflare Worker with a Durable Object holding the lobby state in production. The client is plain ES modules — no framework, bundled with esbuild. The map renders on the server with `node-canvas` (for the PNG you can save) and on the client with regular `<canvas>` (for the live view plus fog overlay).

Lobbies live in memory. Local dev loses everything on restart; the Cloudflare deployment keeps state in the Durable Object for as long as it lives. Either way, save/load to JSON if you actually care about a session.

## License

AGPL-3.0
