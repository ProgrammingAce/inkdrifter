import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const HEX_CONSTANTS_TEMPLATE = `export const HEX_SIZE = 54;
export const HEX_W = ${(Math.sqrt(3) * 54).toFixed(10)};
export const HEX_H = ${2 * 54};
export const DEFAULT_COLS = 7;
export const DEFAULT_ROWS = 11;
export const DEFAULT_GRID_ORIGIN_X = 173;
export const DEFAULT_GRID_ORIGIN_Y = 70;
export const MIN_GRID = 6;
export const MAX_GRID = 50;
export function gridCanvasSize(rows, cols, originX, originY) {
  const HEX_W = Math.sqrt(3) * 54;
  const HEX_H = 2 * 54;
  const rightExtent = originX + (cols - 1) * HEX_W + HEX_W;
  const bottomExtent = originY + (rows - 1) * 0.75 * HEX_H + HEX_H / 2;
  return { W: Math.ceil(rightExtent + 100), H: Math.ceil(bottomExtent + 12) };
}
`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'web', 'js', 'hex-constants.js'), HEX_CONSTANTS_TEMPLATE);

const CLIENT_BUNDLES = [
  'home.js', 'lobby.js', 'render.js', 'renderMap.js', 'input.js',
  'poiModal.js', 'mapSettingsModal.js', 'seedCodec.js', 'socket.js', 'hex.js',
];

const contexts = await Promise.all(CLIENT_BUNDLES.map((name) =>
  esbuild.context({
    entryPoints: [join(root, 'web', 'js', name)],
    bundle: true,
    format: 'esm',
    outfile: join(root, 'dist', name),
    sourcemap: 'inline',
    minify: false,
    platform: 'browser',
    loader: { '.js': 'js' },
  })
));

await Promise.all(contexts.map((c) => c.rebuild()));
await Promise.all(contexts.map((c) => c.watch()));
console.log('[dev] esbuild watching web/js + src/ for changes');

const server = spawn(
  process.execPath,
  ['--watch', join(root, 'server', 'main.js')],
  { stdio: 'inherit', env: process.env }
);

const shutdown = async () => {
  server.kill('SIGTERM');
  await Promise.all(contexts.map((c) => c.dispose()));
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.on('exit', (code) => {
  console.log(`[dev] server exited (${code})`);
  shutdown();
});
