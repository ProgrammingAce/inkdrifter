const { HEX_SIZE } = require('../constants.js');
const { createRng } = require('../rng.js');
const { hexCenter } = require('../hex.js');

function drawGrassTuft(ctx, cx, baseY, size, rng) {
  const leafCount = 3 + Math.floor(rng.uniform() * 3);
  const fanSpread = 70 + rng.uniform() * 30;
  for (let i = 0; i < leafCount; i++) {
    const t = leafCount === 1 ? 0.5 : i / (leafCount - 1);
    const angleDeg = -fanSpread / 2 + t * fanSpread + (rng.uniform() - 0.5) * 8;
    const angle = angleDeg * Math.PI / 180;
    const len = size * (0.85 + rng.uniform() * 0.30);
    const halfBase = size * (0.10 + rng.uniform() * 0.05);
    const tipX = cx + Math.sin(angle) * len;
    const tipY = baseY - Math.cos(angle) * len;
    const perpX = Math.cos(angle);
    const perpY = Math.sin(angle);
    const blX = cx - perpX * halfBase;
    const blY = baseY - perpY * halfBase;
    const brX = cx + perpX * halfBase;
    const brY = baseY + perpY * halfBase;
    const bellyOut = halfBase * 1.4;
    const midX = (cx + tipX) / 2;
    const midY = (baseY + tipY) / 2;
    const cpLx = midX - perpX * bellyOut;
    const cpLy = midY - perpY * bellyOut;
    const cpRx = midX + perpX * bellyOut;
    const cpRy = midY + perpY * bellyOut;
    ctx.beginPath();
    ctx.moveTo(blX, blY);
    ctx.quadraticCurveTo(cpLx, cpLy, tipX, tipY);
    ctx.quadraticCurveTo(cpRx, cpRy, brX, brY);
    ctx.closePath();
    ctx.fill();
  }
}

function drawGrass(canvas, plainsHexes, opts = {}) {
  if (!plainsHexes || plainsHexes.length === 0) return;
  const ctx = canvas.getContext('2d');
  const seed = opts.seed ?? 0;
  const lineColor = opts.lineColor ?? '#2a2015';

  const riverPts = [];
  if (opts.rivers) {
    for (const r of opts.rivers) {
      if (!r || !r.points) continue;
      for (const p of r.points) riverPts.push(p);
    }
  }
  const RIVER_CLEAR = HEX_SIZE * 0.22;
  const nearRiver = (x, y) => {
    if (riverPts.length === 0) return false;
    for (let i = 0; i < riverPts.length; i++) {
      const p = riverPts[i];
      const dx = p.x - x, dy = p.y - y;
      if (dx * dx + dy * dy < RIVER_CLEAR * RIVER_CLEAR) return true;
    }
    return false;
  };

  ctx.fillStyle = lineColor;

  for (const h of plainsHexes) {
    const center = hexCenter(h.r, h.c, opts);
    const rng = createRng((((seed + h.r * 374761393) ^ (h.c * 668265263)) ^ 0x6757A55F) >>> 0);
    const tuftCount = 2 + Math.floor(rng.uniform() * 2);
    for (let i = 0; i < tuftCount; i++) {
      const rRadius = HEX_SIZE * 0.70 * Math.sqrt(rng.uniform());
      const rTheta = rng.uniform() * Math.PI * 2;
      const x = center.x + Math.cos(rTheta) * rRadius;
      const y = center.y + Math.sin(rTheta) * rRadius;
      if (nearRiver(x, y)) continue;
      const size = HEX_SIZE * (0.15 + rng.uniform() * 0.08);
      drawGrassTuft(ctx, x, y, size, rng);
    }
  }
}

module.exports = { drawGrass };
