# River Rendering — Technical Specification

This document specifies, byte-exact, the algorithm that produces the
cartographic river style seen in `landmass1.png`. Anyone implementing this in
Node.js (or any other language) following the algorithms and parameter values
below should produce visually equivalent output to the Python reference in
`render_river_tight.py`.

It covers two things:

1. **River renderer** — takes a polyline centerline and parameters, paints a
   ribbon with two ragged dark banks plus an interior gray ripple line.
2. **Hex-edge path generator** — produces a centerline that follows the edges
   of a hexagonal grid (used to compose the river with the hex map).

---

## 1. Inputs and Outputs

### 1.1 Inputs

- `centerline`: `Array<{x: number, y: number}>` — at least 2 points in
  image coordinates (x right, y down).
- A parameters object (see §3).
- Optional target canvas (PIL Image / HTML Canvas / `node-canvas`) to paint
  onto. If omitted, the renderer auto-crops to a tight bbox and returns a
  new canvas.

### 1.2 Output

- Raster image with the river painted in two colors (bank ink + ripple
  gray) on a parchment background, or directly composited onto the
  provided target.

### 1.3 Coordinate system

Standard image coordinates: origin top-left, x right, y down. All angles are
in radians unless otherwise noted.

---

## 2. Dependencies Required

A Node.js implementation needs:

- A 2-D drawing API that supports filled polygons and stroked polylines with
  configurable line width (e.g. `node-canvas`, `canvas`, `@napi-rs/canvas`).
- A seedable pseudo-random number generator with `nextUniform()` (uniform
  [0,1)) and `nextNormal()` (standard normal). Recommended: a Mulberry32 or
  PCG generator + Box-Muller transform.
- A 1-D Gaussian filter (a small library or inlined convolution; see §A.1).

No image-processing library is required.

---

## 3. Parameters

All parameters with their default values and ranges. These defaults reproduce
the look in `hex_river_seed42.png`.

| Name                     | Default | Type    | Meaning |
|--------------------------|---------|---------|---------|
| `riverWidth`             | 20.0    | float   | Mean bank-to-bank distance, in px. Affects half-width = `riverWidth / 2`. |
| `bankThickness`          | 8.0     | float   | Mean outward thickness of each bank stroke, in px. |
| `bankThicknessJitter`    | 5.0     | float   | Peak ± variation in bank thickness (ragged outer edge). |
| `bankThicknessSmooth`    | 2.5     | float   | Gaussian sigma for the thickness noise. Smaller = jaggier. |
| `blotRate`               | 0.06    | float   | Probability (per sample) that an outward ink-blot seeds. |
| `blotAmp`                | 10.0    | float   | Peak outward bulge from a blot, in px. |
| `blotWidth`              | 3.5     | float   | Gaussian sigma of each blot bump (px along the path). |
| `widthJitterAmp`         | 14.0    | float   | Peak ± variation in river width along the path. |
| `widthJitterSmooth`      | 25.0    | float   | Gaussian sigma for width variation — larger = smoother breathing. |
| `rippleOffsetFrac`       | 0.15    | float   | Ripple line's offset from centerline, as fraction of full width. |
| `rippleJitterAmp`        | 0.8     | float   | Peak ± wobble on the ripple line, in px. |
| `rippleJitterSmooth`     | 12.0    | float   | Sigma for ripple wobble. |
| `rippleThickness`        | 1.5     | float   | Stroke width of ripple line, in px. Drawn `round(rippleThickness)`. |
| `bankColor`              | `[20,16,12]` | RGB | Dark ink color for banks. |
| `waveColor`              | `[135,122,100]` | RGB | Gray-tan color for the ripple line. |
| `bgColor`                | `[232,213,183]` | RGB | Parchment background (only used if no target canvas). |
| `smoothSigma`            | 3.0     | float   | Pre-smoothing applied to the input centerline. **Lower = sharper turns, higher = more rounded.** For hex-edge rivers use `3.0`; for fully-smooth procedural rivers `8.0`–`14.0`. |
| `pad`                    | 12      | int     | Padding around the tight-crop bbox, in px. |
| `seed`                   | 0       | int     | RNG seed. Same seed + same centerline = identical output. |
| `targetCanvas`           | null    | Canvas? | If provided, paint onto it in world coords. Otherwise return new tight-cropped canvas. |

---

## 4. Algorithm

### 4.1 Step 1 — Resample centerline by arc length

Goal: convert the input polyline into N points evenly spaced 1 px apart
along the curve. Every subsequent computation (curvature, normals, noise)
assumes unit-speed arc-length parameterization.

```
input:  pts = [(x_0, y_0), ..., (x_{m-1}, y_{m-1})]
output: pts'= [(X_0, Y_0), ..., (X_{N-1}, Y_{N-1})] where consecutive points
              are ~1 px apart along the polyline.

procedure resampleByArclength(pts, step = 1.0):
    seg_len[i] = sqrt((x_{i+1}-x_i)^2 + (y_{i+1}-y_i)^2)  for i in 0..m-2
    s[0] = 0; s[i] = s[i-1] + seg_len[i-1]                for i in 1..m-1
    total = s[m-1]
    new_s = [0, step, 2*step, ..., k*step] while k*step < total
    For each new_s[j]:
        find i with s[i] <= new_s[j] < s[i+1]
        t = (new_s[j] - s[i]) / (s[i+1] - s[i])
        X_j = x_i + t * (x_{i+1} - x_i)
        Y_j = y_i + t * (y_{i+1} - y_i)
    return (pts', new_s)  # new_s is the arc-length at each new sample
```

`new_s` is needed elsewhere; keep it around.

### 4.2 Step 2 — Pre-smooth the resampled centerline

Apply Gaussian 1-D filter along x and y independently with sigma =
`smoothSigma`. This rounds any sharp corners just enough to prevent
self-intersection artifacts in tight bends.

```
pts'.x[i] = gaussianFilter1D(pts'.x, sigma = smoothSigma)[i]
pts'.y[i] = gaussianFilter1D(pts'.y, sigma = smoothSigma)[i]
```

See §A.1 for the Gaussian implementation. With `smoothSigma=3.0` the path
keeps its hex-corner character; with `smoothSigma=14.0` corners become
fully rounded.

### 4.3 Step 3 — Compute unit tangents and left-hand normals

For each sample i:

```
tx[i] = gradient(pts'.x)[i]            # central difference
ty[i] = gradient(pts'.y)[i]
len   = max(sqrt(tx^2 + ty^2), epsilon)
tx[i] /= len; ty[i] /= len
nx[i] = -ty[i]                          # left-hand normal in image coords
ny[i] =  tx[i]
```

`gradient` here means the NumPy-style central difference: forward diff at
the first sample, backward at the last, central in between.

### 4.4 Step 4 — Variable half-width and curvature clamp

Half-width is the centerline-to-inner-bank distance per sample. Two things
modify it:

1. A slow random "breathing" jitter (so the river is wide here, narrow
   there).
2. A curvature clamp (so offset banks can't cross at tight bends).

```
halfW = riverWidth / 2
widthMod = jitter(N, widthJitterAmp, widthJitterSmooth, rng)
halfW_eff = max(3.0, halfW + widthMod[i])

# Curvature kappa via second derivative of position:
d2x = gradient(gradient(pts'.x))
d2y = gradient(gradient(pts'.y))
kappa = sqrt(d2x^2 + d2y^2)
kappa = gaussianFilter1D(kappa, sigma = 4.0)    # smooth the clamp transition
radius = 1.0 / max(kappa, 1e-4)
halfW_eff[i] = min(halfW_eff[i], 0.85 * radius[i])
```

`jitter()` is defined in §A.2. The 3.0-px floor keeps the channel from
fully closing. The 0.85 factor is empirical — values above ~0.9 risk
self-intersection on sharper curves.

### 4.5 Step 5 — Inner-bank polylines (the channel boundary)

```
upperInner[i] = (pts'.x[i] + nx[i] * halfW_eff[i],
                 pts'.y[i] + ny[i] * halfW_eff[i])
lowerInner[i] = (pts'.x[i] - nx[i] * halfW_eff[i],
                 pts'.y[i] - ny[i] * halfW_eff[i])
```

These are the **clean** inner edges of each bank — they get no further
noise. Critical for the "calligraphy brush" look: the channel side is
crisp, only the outer side is feathered.

### 4.6 Step 6 — Outward bank thickness with noise + blots

Two independent noise streams for the upper and lower banks so they
look hand-drawn-different.

```
thk_u[i] = bankThickness + jitter(N, bankThicknessJitter, bankThicknessSmooth, rng)
thk_l[i] = bankThickness + jitter(N, bankThicknessJitter, bankThicknessSmooth, rng)

# Sparse outward ink blots — one-sided positive bumps.
blot_u = blotSignal(N, blotRate, blotAmp, blotWidth, rng)
blot_l = blotSignal(N, blotRate, blotAmp, blotWidth, rng)

thk_u[i] = max(1.0, thk_u[i] + blot_u[i])
thk_l[i] = max(1.0, thk_l[i] + blot_l[i])
```

`blotSignal` (defined in §A.3) produces sparse positive bumps with
gaussian envelope.

### 4.7 Step 7 — Outer-bank polylines

```
upperOuter[i] = upperInner[i] + (nx[i], ny[i]) * thk_u[i]
lowerOuter[i] = lowerInner[i] - (nx[i], ny[i]) * thk_l[i]
```

### 4.8 Step 8 — Inner ripple line

A single gray line that runs parallel to the river, offset from the center
by a fraction of the local full width, with low-frequency wobble. Killed
where the channel is too narrow.

```
fullW = halfW + widthMod[i]            # half of variable river width
rippleBase[i] = rippleOffsetFrac * fullW * 2.0
rippleOff[i] = rippleBase[i] + jitter(N, rippleJitterAmp, rippleJitterSmooth, rng)

# Kill where pinched (no room for parallel line):
narrow[i] = halfW_eff[i] < 0.8 * halfW ? 1.0 : 0.0
narrowMask = gaussianFilter1D(narrow, sigma = 20.0)
narrowMask = clamp(narrowMask, 0, 1)
rippleOff[i] *= (1 - narrowMask[i])

wave[i] = (pts'.x[i] + nx[i] * rippleOff[i],
           pts'.y[i] + ny[i] * rippleOff[i])
```

### 4.9 Step 9 — Canvas allocation

If no target canvas was provided:

```
all_pts = upperOuter ∪ lowerOuter ∪ wave
minX = floor(min over all_pts of x) - pad
minY = floor(min over all_pts of y) - pad
maxX = ceil(max over all_pts of x) + pad
maxY = ceil(max over all_pts of y) + pad
W = maxX - minX + 1
H = maxY - minY + 1
canvas = new canvas (W × H) filled with bgColor
offset = (minX, minY)
```

If target canvas was provided, `offset = (0, 0)` and we paint in world
coordinates.

### 4.10 Step 10 — Render banks as per-segment filled quads

**Important**: do NOT draw each bank as a single filled polygon
`outer + reverse(inner)`. At sharp curvature the inner edge folds back on
itself, the polygon becomes self-intersecting, and a polygon fill that uses
even/odd or non-zero winding will leave kite-shaped holes. Instead, draw
many small quads — one per pair of consecutive samples — that overlap each
other. Each local quad is convex and renders solidly; their union is the
ribbon.

```
function drawRibbon(outer, inner):
    for i in 0..N-2:
        quad = [
            (outer[i].x - offsetX,   outer[i].y - offsetY),
            (outer[i+1].x - offsetX, outer[i+1].y - offsetY),
            (inner[i+1].x - offsetX, inner[i+1].y - offsetY),
            (inner[i].x - offsetX,   inner[i].y - offsetY),
        ]
        canvas.fillPolygon(quad, bankColor)

drawRibbon(upperOuter, upperInner)
drawRibbon(lowerOuter, lowerInner)
```

### 4.11 Step 11 — Render ripple line

```
points = [(wave[i].x - offsetX, wave[i].y - offsetY) for i in 0..N-1]
canvas.strokeLine(points, waveColor, round(rippleThickness), joint = 'round')
```

If your library doesn't support polyline strokes with joins, fall back to
drawing small line segments — but make sure consecutive segments meet at
their endpoints (no gaps).

---

## 5. Hex-Edge Path Generator (for hex-map composition)

Used when the river should follow the edges of a hexagonal grid. Skip this
section if you're driving the renderer with a procedural or hand-authored
centerline.

### 5.1 Hex grid constants

Same as `HEX.md`:

```
HEX_SIZE       = 54
HEX_W          = sqrt(3) * HEX_SIZE        # ≈ 93.531
HEX_H          = 2 * HEX_SIZE              # 108
COLS           = 7
ROWS           = 11
GRID_ORIGIN_X  = 173
GRID_ORIGIN_Y  = 70
```

### 5.2 Hex centers

```
function hexCenter(row, col):
    offsetX = (row % 2 == 1) ? HEX_W / 2 : 0
    cx = GRID_ORIGIN_X + HEX_W * col + offsetX
    cy = GRID_ORIGIN_Y + HEX_H * 0.75 * row
    return (cx, cy)
```

### 5.3 Hex vertices

**Use `size = HEX_SIZE` (not `HEX_SIZE - 1`) when building the vertex
graph.** The drawing code uses `size - 1` to pull the rendered edges inward
for visual separation, but the path-finding needs the geometric size so
shared vertices between adjacent hexes have identical coordinates.

```
function hexVertices(cx, cy, size):
    for i in 0..5:
        angle = (60 * i - 30) * pi / 180   # -30°, 30°, 90°, 150°, 210°, 270°
        v[i] = (cx + size * cos(angle), cy + size * sin(angle))
    return v
```

### 5.4 Vertex adjacency graph

```
adj = empty map from vertex-key to Set<vertex-key>
key(p) = (round(p.x, 2), round(p.y, 2))   # 2-decimal rounding for floating-point matching
for row in 0..ROWS-1:
    for col in 0..COLS-1:
        c = hexCenter(row, col)
        verts = hexVertices(c.x, c.y, HEX_SIZE)
        for i in 0..5:
            a = key(verts[i])
            b = key(verts[(i+1) % 6])
            adj[a].add(b); adj[b].add(a)
```

### 5.5 Random river path

Strict self-avoiding random walk with directional bias and retries.

```
function randomRiverPath(seed, startSide='left', targetSide='right',
                          maxSteps=120):
    rng = Random(seed)
    adj = buildVertexGraph()
    keys = list(adj.keys)

    direction = (targetSide == 'right') ? +1 : -1

    # Pool of valid start vertices: all left- or right-edge vertices.
    edgeX = (startSide == 'left') ? min(keys.x) : max(keys.x)
    startCandidates = sorted(keys with |k.x - edgeX| < 1.0, by y)
    targetX = (targetSide == 'right') ? max(keys.x) : min(keys.x)

    best = null
    for attempt in 1..40:
        start = startCandidates[rng.uniformInt(0, startCandidates.length)]
        path = [start]
        visited = {start}
        prev = null

        for step in 1..maxSteps:
            cur = path.last
            # Strict self-avoidance + no immediate reversal.
            nbrs = [n for n in adj[cur] if n not in visited and n != prev]
            if nbrs.empty:
                break

            # Bias forward strongly, sideways often, backward rarely.
            weights = []
            for n in nbrs:
                advance = direction * (n.x - cur.x)
                if advance > 0:    weights.push(2.2)
                elif advance == 0: weights.push(1.6)
                else:              weights.push(0.4)
            choice = rng.weightedChoice(nbrs, weights)

            path.push(choice)
            visited.add(choice)
            prev = cur

            # Stop early once we've reached the far side AND walked enough
            # to have meaningful meander.
            if direction * (choice.x - targetX) >= -HEX_W * 0.5
               and path.length >= 40:
                return path

        if best == null or path.length > best.length:
            best = path

    return best
```

Strict (visited-forbidden) is what guarantees no self-intersections. The
multiple attempts handle the case where one walk happens to corner itself
into a dead-end before reaching the far side.

### 5.6 From path to centerline

The raw vertex path has straight segments between hex vertices; that
produces angular zig-zags. Densify each edge and apply a tiny smoothing
sigma to remove pixel-sharp corners (which would cause renderer artifacts)
while keeping the hex-corner character.

```
function hexEdgeCenterline(seed):
    raw = randomRiverPath(seed)
    dense = []
    for i in 0..raw.length-2:
        a = raw[i]; b = raw[i+1]
        steps = 8                              # lower = sharper corners
        for t in 0..steps-1:
            dense.push(a + (b - a) * (t / steps))
    dense.push(raw.last)
    dense.x = gaussianFilter1D(dense.x, sigma = 0.8)
    dense.y = gaussianFilter1D(dense.y, sigma = 0.8)
    return dense
```

Pass the resulting list directly to `drawRiver(...)`.

---

## 6. Helper Functions (Appendix A)

### A.1 1-D Gaussian Filter

`gaussianFilter1D(arr, sigma)`:

```
1. radius = ceil(4 * sigma)        # tail at ~4σ is < 0.5%
2. kernel[k] = exp(-k^2 / (2 * sigma^2))   for k in -radius..radius
3. normalize: kernel /= sum(kernel)
4. for each i in 0..N-1:
       out[i] = sum over k of arr[clamp(i + k, 0, N - 1)] * kernel[k]
5. return out
```

Use **reflect** or **edge-extend** boundary handling — both work; SciPy
defaults to reflect. The renderer is insensitive to which is chosen as
long as it's consistent.

### A.2 Smooth-noise jitter

`jitter(N, amplitude, sigma, rng)`:

```
1. raw[i] = rng.normal()  for i in 0..N-1     # standard normal
2. smoothed = gaussianFilter1D(raw, sigma)
3. peak = max(|smoothed|, epsilon)
4. return smoothed / peak * amplitude
```

The normalization step is **important** — without it the amplitude varies
unpredictably depending on N and sigma. With it, the peak absolute value
of the output is exactly `amplitude`.

### A.3 Blot signal

`blotSignal(N, rate, amp, width, rng)`:

```
1. for i in 0..N-1:
       seed[i] = (rng.uniform() < rate) ? 1.0 : 0.0
       seedAmp[i] = seed[i] * rng.uniform(0.4, 1.0) * amp
2. return gaussianFilter1D(seedAmp, sigma = width)
```

This is **one-sided** (always non-negative) — that's what produces the
outward-only bleed without affecting the inner edge.

### A.4 Seedable RNG

Recommended Node implementation:

```js
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalGen(uniform) {
  // Box-Muller; return one normal per call (cache the spare if you want).
  let u1 = Math.max(uniform(), 1e-12);
  let u2 = uniform();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
```

You'll **not** get byte-identical output to the Python (which uses NumPy's
PCG64), but the visual character is identical for any reasonable PRNG.
Determinism within Node is guaranteed by seeding.

### A.5 Weighted choice

`weightedChoice(items, weights)`:

```
1. total = sum(weights)
2. r = rng.uniform() * total
3. accum = 0
4. for i in 0..items.length-1:
       accum += weights[i]
       if accum >= r: return items[i]
5. return items.last        # numerical safety
```

---

## 7. Failure Modes and Their Fixes

These are real artifacts that occurred during development; each one
corresponds to a load-bearing piece of the algorithm above.

| Symptom | Cause | Fix in spec |
|---------|-------|-------------|
| Kite-shaped hole at a sharp peak | One-polygon bank fill self-intersects + even-odd rule | §4.10: per-segment quads instead of one polygon |
| Banks cross each other at tight U-turn | Offset distance exceeds local curvature radius | §4.4: clamp `halfW_eff <= 0.85 * radius` |
| Ripple line folds at sharp peak | Same as above, but for the offset ripple | §4.8: zero out ripple where channel is narrow |
| River disappears as a black blob | Hex random walk dead-ends in a tight corner | §5.5: retry up to 40× with different starts |
| Hex path graph fragmented | Built with `size = HEX_SIZE - 1` so adjacent hexes' vertex coords don't match | §5.3 / §5.4: build graph with `size = HEX_SIZE` |
| Banks look too smooth/flat | Insufficient bank-thickness noise / blot density | Raise `bankThicknessJitter`, `blotRate`, `blotAmp` |
| River is uniform width | `widthJitterAmp` too low | Use `widthJitterAmp ≈ 0.6 * riverWidth` for dramatic breathing |
| Corners too rounded | `smoothSigma` too high | Lower to 3.0 (hex-edge) or 1.0 (very angular) |

---

## 8. Reference Output

With the defaults in §3 plus the hex path generator in §5, seeding 42, on a
928×946 canvas with the hex grid from `HEX.md`, the output is
`hex_river_seed42.png` in this repo.

A single-seed deterministic test: with `seed = 42`, the first 5 resampled
centerline points (after pre-smoothing with `smoothSigma=3.0`) should be
approximately:

```
(126.4, 691.0)  (126.5, 690.1)  (126.7, 689.2)  (127.0, 688.4)  (127.4, 687.6)
```

Within ~0.5 px is acceptable variation due to PRNG and floating-point
differences across languages. Visual equivalence is the real acceptance
criterion.
