const fs = require('fs');
const path = require('path');
const { renderMap } = require('./renderMap.js');

function parseCliArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eat = () => argv[++i];
    const m = /^--([a-zA-Z-]+)(?:=(.*))?$/.exec(a);
    if (!m) continue;
    const key = m[1];
    const val = m[2] !== undefined ? m[2] : eat();
    switch (key) {
      case 'size': {
        const n = parseInt(val, 10);
        out.rows = n; out.cols = n;
        break;
      }
      case 'rows': out.rows = parseInt(val, 10); break;
      case 'cols': out.cols = parseInt(val, 10); break;
      case 'seed': out.seed = parseInt(val, 10); break;
      case 'seeds': out.seeds = val.split(',').map(s => parseInt(s, 10)); break;
      case 'out': out.outPath = val; break;
      default: throw new Error(`Unknown flag: --${key}`);
    }
  }
  return out;
}

const DEMO_VARIANTS = [
  { rows: 6,  cols: 6,  seed: 42 },
  { rows: 8,  cols: 12, seed: 7 },
  { rows: 11, cols: 7,  seed: 1337 },
  { rows: 20, cols: 20, seed: 2024 },
  { rows: 14, cols: 36, seed: 88 },
  { rows: 36, cols: 14, seed: 256 },
  { rows: 50, cols: 50, seed: 512 },
];

function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const explicit = cli.rows !== undefined || cli.cols !== undefined
    || cli.seed !== undefined || cli.seeds !== undefined || cli.outPath !== undefined;

  let runs;
  if (explicit) {
    const seeds = cli.seeds ?? (cli.seed !== undefined ? [cli.seed] : [42]);
    runs = seeds.map(seed => ({ seed, rows: cli.rows, cols: cli.cols, outPath: cli.outPath }));
  } else {
    runs = DEMO_VARIANTS.map(v => ({ ...v }));
  }

  const outDir = path.join(__dirname, '..', 'out');
  fs.mkdirSync(outDir, { recursive: true });
  for (const r of runs) {
    const { canvas, ocean } = renderMap({ seed: r.seed, rows: r.rows, cols: r.cols });
    const tag = (r.rows && r.cols) ? `${r.rows}x${r.cols}_` : '';
    const filename = r.outPath
      ?? path.join(outDir, `output_ocean_${tag}${r.seed}.png`);
    fs.writeFileSync(filename, canvas.toBuffer('image/png'));
    const sidesStr = ocean ? ocean.sides.join('') || 'none' : 'n/a';
    const pct = ocean ? (ocean.waterFraction * 100).toFixed(1) : 'n/a';
    console.log(`Saved ${filename} (seed=${r.seed}, ${canvas.width}x${canvas.height}, sides=[${sidesStr}], water=${pct}%)`);
  }
}

module.exports = { parseCliArgs, DEMO_VARIANTS, main };
