# Hex Grid Map — Complete Algorithmic Specification

## Overview

This document describes how to algorithmically generate the exact hex grid map style shown in the reference image. The grid consists of pointy-top hexagons with dashed edges and tick marks at each vertex, drawn on a parchment background. The grid is 7 columns × 11 rows.

---

## 1. Canvas and Global Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `W` | 928 | Canvas width in pixels |
| `H` | 946 | Canvas height in pixels |
| `HEX_SIZE` | 54 | Distance from hex center to any vertex (apothem ≈ 46.77) |
| `HEX_W` | `√3 × HEX_SIZE` ≈ 93.531 | Horizontal distance between centers of adjacent hexes in the same row |
| `HEX_H` | `2 × HEX_SIZE` = 108 | Vertical distance between centers of hexes in the same column (rows 0→2, 2→4, etc.) |
| `COLS` | 7 | Number of columns (0–6) |
| `ROWS` | 11 | Number of rows (0–10) |
| `GRID_ORIGIN_X` | 173 | X-coordinate of the top-left hex center (row 0, col 0) |
| `GRID_ORIGIN_Y` | 70 | Y-coordinate of the top-left hex center (row 0, col 0) |
| `EDGE_GAP_RATIO` | 0.35 | Fraction of each edge that is a gap (middle third). Each solid segment is `(1 - EDGE_GAP_RATIO) × edge_length / 2` from each vertex. |
| `TICK_LEN` | 6 | Length of tick marks extending outward from each vertex |
| `HEX_LINE_WIDTH` | 1.8 | Stroke width for hex edges |
| `TICK_LINE_WIDTH` | 1.5 | Stroke width for tick marks |
| `LINE_COLOR` | `#2a2015` | Dark brown/black color for all grid lines |
| `BASE_COLOR` | `#e8d5b7` | Parchment background color |

---

## 2. Parchment Background

### 2.1 Base Fill

1. Fill the entire canvas (928×946) with the base color `#e8d5b7`.

### 2.2 Per-Pixel Noise

1. Read all pixel data from the canvas.
2. For each pixel at index `i` (every 4 bytes = R, G, B, A):
   - Compute `noise = (Math.random() - 0.5) × 20`
   - Add `noise` to R, G, and B channels (clamp each to [0, 255])
3. Write the modified pixel data back to the canvas.

### 2.3 Random Stains

1. For `s = 0` to `14` (15 stains total):
   - Pick random `x` in `[0, W)` and `y` in `[0, H)`
   - Pick random radius `r` in `[30, 130]`
   - Create a radial gradient centered at `(x, y)`:
     - Stop 0.0: `rgba(139, 119, 90, 0.08)` (dark tan, very transparent)
     - Stop 1.0: `rgba(139, 119, 90, 0)` (fully transparent)
   - Fill a square region `(x - r, y - r, 2r × 2r)` with this gradient

### 2.4 Edge Darkening (Vignette)

1. Create a radial gradient centered at `(W/2, H/2)`:
   - Stop 0.0 at radius `W × 0.3` (278.4): `rgba(0, 0, 0, 0)` (fully transparent)
   - Stop 1.0 at radius `W × 0.7` (649.6): `rgba(80, 60, 40, 0.15)` (dark brown, semi-transparent)
2. Fill the entire canvas with this gradient.

---

## 3. Hexagon Geometry

### 3.1 Pointy-Top Hexagon Vertices

For a hexagon centered at `(cx, cy)` with size `size`, the 6 vertices are computed as:

```
For i = 0 to 5:
    angle_degrees = 60 × i - 30
    angle_radians = angle_degrees × π / 180
    vertex_x = cx + size × cos(angle_radians)
    vertex_y = cy + size × sin(angle_radians)
```

This produces vertices at angles: **-30°, 30°, 90°, 150°, 210°, 270°** (pointy top and bottom).

The six vertices in order are:
- Vertex 0: top-right (angle -30°)
- Vertex 1: bottom-right (angle 30°)
- Vertex 2: bottom (angle 90°)
- Vertex 3: bottom-left (angle 150°)
- Vertex 4: top-left (angle 210°)
- Vertex 5: top (angle 270°)

### 3.2 Hexagon Center Positions

For row `r` (0–10) and column `c` (0–6):

```
offset_x = (r % 2 === 1) ? HEX_W / 2 : 0
cx = GRID_ORIGIN_X + (HEX_W × c) + offset_x
cy = GRID_ORIGIN_Y + (HEX_H × 0.75 × r)
```

Odd rows (1, 3, 5, 7, 9) are offset horizontally by `HEX_W / 2` ≈ 46.77px to create the staggered honeycomb pattern.

The vertical spacing between consecutive rows is `HEX_H × 0.75` = 81px.

### 3.3 Edge Length

Each edge of the hexagon has length equal to `HEX_SIZE` = 54px (this is a property of regular hexagons).

---

## 4. Drawing Hexagon Edges (Dashed Pattern)

Each hexagon edge is drawn as **two short solid segments** with a **gap in the middle**. The solid segments start at each vertex and extend inward.

### 4.1 Edge Segment Calculation

For each hexagon at center `(cx, cy)` with size `(HEX_SIZE - 1)` = 53:

1. Compute the 6 vertices using the formula in Section 3.1.
2. For each edge `i` (0 to 5):
   - `p1 = vertices[i]` (start vertex)
   - `p2 = vertices[(i + 1) % 6]` (end vertex)
   - `dx = p2.x - p1.x`
   - `dy = p2.y - p1.y`
   - `len = sqrt(dx² + dy²)` (should equal HEX_SIZE = 54)
   - `ux = dx / len` (unit vector along edge)
   - `uy = dy / len`
   - `edgeLen = HEX_SIZE × 0.35` ≈ 18.9px (length of each solid segment)
   - `startX = p1.x + ux × edgeLen`
   - `startY = p1.y + uy × edgeLen`
   - `endX = p2.x - ux × edgeLen`
   - `endY = p2.y - uy × edgeLen`
   - Draw a line from `(startX, startY)` to `(endX, endY)` with:
     - `strokeStyle = '#2a2015'`
     - `lineWidth = 1.8`

### 4.2 Visual Effect

The gap between the two solid segments on each edge is:
```
gap_length = HEX_SIZE - 2 × edgeLen = 54 - 2 × 18.9 ≈ 16.2px
```

This creates a distinctive dashed pattern where each hexagon edge has solid segments at the vertices and a gap in the middle. The gap gives the grid a hand-drawn, sketchy appearance.

---

## 5. Drawing Tick Marks at Vertices

At each hexagon vertex, draw a short line extending outward from the hexagon center.

### 5.1 Tick Mark Calculation

For each hexagon at center `(cx, cy)` with size `(HEX_SIZE - 1)` = 53:

1. Compute the 6 vertices using the formula in Section 3.1.
2. For each vertex `i` (0 to 5):
   - `p = vertices[i]` (vertex position)
   - `dx = p.x - cx` (vector from center to vertex)
   - `dy = p.y - cy`
   - `len = sqrt(dx² + dy²)` (should equal HEX_SIZE = 54)
   - `ux = dx / len` (unit vector pointing outward from center)
   - `uy = dy / len`
   - Draw a line from `(p.x, p.y)` to `(p.x + ux × TICK_LEN, p.y + uy × TICK_LEN)` with:
     - `strokeStyle = '#2a2015'`
     - `lineWidth = 1.5`

### 5.2 Visual Effect

Each tick mark extends 6px outward from the vertex, creating the impression of a hand-sketched map where the hexagon boundaries extend slightly beyond their vertices. The tick marks are slightly thinner than the hex edges (1.5px vs 1.8px).

---

## 6. Complete Rendering Order

1. **Draw parchment background** (Sections 2.1–2.4)
2. **For each row `r` from 0 to 10:**
   - **For each column `c` from 0 to 6:**
     - Calculate hex center `(cx, cy)` using Section 3.2
     - Draw hexagon edges using Section 4 (dashed pattern)
     - Draw tick marks using Section 5 (at each vertex)

---

## 7. Implementation Notes

### 7.1 Hex Size Reduction

The hex size is reduced by 1 pixel (`HEX_SIZE - 1` = 53) when drawing. This prevents the dashed edges from touching adjacent hexagons and maintains visual separation.

### 7.2 Coordinate System

- The canvas uses a standard 2D coordinate system with the origin (0, 0) at the top-left corner.
- X increases to the right, Y increases downward.
- The grid origin (173, 70) positions the top-left hex center at that location on the canvas.

### 7.3 Color Palette

| Element | Color | Hex Code |
|---------|-------|----------|
| Hex edges & ticks | Dark brown/black | `#2a2015` |
| Parchment base | Light tan | `#e8d5b7` |
| Stains | Dark tan | `rgba(139, 119, 90, 0.08)` |
| Vignette | Dark brown | `rgba(80, 60, 40, 0.15)` |

### 7.4 Line Widths

| Element | Width |
|---------|-------|
| Hex edges | 1.8px |
| Tick marks | 1.5px |

---

## 8. Quick Reference: Key Formulas

```
// Hex center for row r, column c
cx = 173 + (√3 × 54 × c) + (r % 2 === 1 ? (√3 × 54) / 2 : 0)
cy = 70 + 108 × 0.75 × r

// Hex vertex i (pointy-top)
angle = (60 × i - 30) × π / 180
vx = cx + 53 × cos(angle)
vy = cy + 53 × sin(angle)

// Edge segment endpoints
edgeLen = 54 × 0.35 = 18.9
gap = 54 - 2 × 18.9 = 16.2

// Tick mark endpoint
tx = vx + (vx - cx) / 54 × 6
ty = vy + (vy - cy) / 54 × 6
```

---

## 9. Expected Output

The final hex grid should have:
- **7 columns × 11 rows** of pointy-top hexagons
- **Dashed edges** on each hexagon (solid segments at vertices, gap in middle)
- **Tick marks** extending 6px outward from each vertex
- **Dark brown lines** (`#2a2015`) on a parchment background
- **Staggered layout** with odd rows offset by half a hex width
- **Hand-drawn aesthetic** from the dashed pattern and tick marks
- **Parchment texture** from noise, stains, and vignette

The grid should span approximately from x=173 to x=827 and y=70 to y=880 on the 928×946 canvas.
