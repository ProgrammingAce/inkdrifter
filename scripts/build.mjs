import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
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

// Bundle client JS files
const CLIENT_BUNDLES = [
  { entry: join(root, 'web', 'js', 'home.js'), out: join(root, 'dist', 'home.js') },
  { entry: join(root, 'web', 'js', 'lobby.js'), out: join(root, 'dist', 'lobby.js') },
  { entry: join(root, 'web', 'js', 'render.js'), out: join(root, 'dist', 'render.js') },
  { entry: join(root, 'web', 'js', 'renderMap.js'), out: join(root, 'dist', 'renderMap.js') },
  { entry: join(root, 'web', 'js', 'input.js'), out: join(root, 'dist', 'input.js') },
  { entry: join(root, 'web', 'js', 'poiModal.js'), out: join(root, 'dist', 'poiModal.js') },
  { entry: join(root, 'web', 'js', 'mapSettingsModal.js'), out: join(root, 'dist', 'mapSettingsModal.js') },
  { entry: join(root, 'web', 'js', 'seedCodec.js'), out: join(root, 'dist', 'seedCodec.js') },
  { entry: join(root, 'web', 'js', 'socket.js'), out: join(root, 'dist', 'socket.js') },
  { entry: join(root, 'web', 'js', 'hex.js'), out: join(root, 'dist', 'hex.js') },
];

await Promise.all(CLIENT_BUNDLES.map(({ entry, out }) =>
  esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    outfile: out,
    sourcemap: 'inline',
    minify: true,
    platform: 'browser',
    loader: { '.js': 'js' },
  })
));

// Use timestamp-based version for cache-busting
const buildVer = Math.floor(Date.now() / 1000).toString(36);
console.log(`  build ver: ${buildVer}`);

// Read all static files for worker inlining
const readStatic = (path) => readFileSync(join(root, path), 'utf-8');

// Inject build hash into HTML script tags for cache-busting
const injectBuildHash = (html) =>
  html.replace(/src="\/js\/(lobby\.js)"/g, `src="/js/$1?v=${buildVer}"`)
      .replace(/src="\/js\/(home\.js)"/g, `src="/js/$1?v=${buildVer}"`)
      .replace(/src="js\/(home\.js)"/g, `src="js/$1?v=${buildVer}"`);

const STATIC_CONTENT = {
  __INDEX_HTML__: injectBuildHash(readStatic('web/index.html')),
  __LOBBY_HTML__: injectBuildHash(readStatic('web/lobby.html')),
  __STYLES_CSS__: readStatic('web/css/styles.css'),
  __HOME_JS__: readFileSync(join(root, 'dist', 'home.js'), 'utf-8'),
  __LOBBY_JS__: readFileSync(join(root, 'dist', 'lobby.js'), 'utf-8'),
  __SOCKET_JS__: readFileSync(join(root, 'dist', 'socket.js'), 'utf-8'),
  __RENDER_JS__: readFileSync(join(root, 'dist', 'render.js'), 'utf-8'),
  __RENDERMAP_JS__: readFileSync(join(root, 'dist', 'renderMap.js'), 'utf-8'),
  __HEX_JS__: readFileSync(join(root, 'dist', 'hex.js'), 'utf-8'),
  __HEX_CONSTANTS_JS__: readFileSync(join(root, 'web', 'js', 'hex-constants.js'), 'utf-8'),
  __INPUT_JS__: readFileSync(join(root, 'dist', 'input.js'), 'utf-8'),
  __POIMODAL_JS__: readFileSync(join(root, 'dist', 'poiModal.js'), 'utf-8'),
  __MAPSETTINGS_JS__: readFileSync(join(root, 'dist', 'mapSettingsModal.js'), 'utf-8'),
  __SEEDCODEC_JS__: readFileSync(join(root, 'dist', 'seedCodec.js'), 'utf-8'),
};

// Read worker entry point
let workerSource = readFileSync(join(root, 'workers', 'index.js'), 'utf-8');

// Inline static content as template literal replacements
for (const [key, content] of Object.entries(STATIC_CONTENT)) {
  const escaped = content
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
  workerSource = workerSource.replace(
    new RegExp(key, 'g'),
    `\`${escaped}\``
  );
}

// Write preprocessed worker entry with inlined assets
writeFileSync(join(root, 'workers', 'index.inlined.js'), workerSource);

// Bundle worker modules with esbuild (resolves cross-file ESM imports)
// Note: minify=false to preserve DO lifecycle method names (fetch, connect, alarm)
await esbuild.build({
  entryPoints: [join(root, 'workers', 'index.inlined.js')],
  bundle: true,
  format: 'esm',
  outfile: join(root, 'dist', 'worker.js'),
  platform: 'neutral',
  minify: false,
  target: ['es2022'],
  external: [],
  loader: { '.js': 'js' },
  keepNames: true,
});

writeFileSync(join(root, 'dist', 'worker.js'), readFileSync(join(root, 'dist', 'worker.js'), 'utf-8'));

const workerSize = readFileSync(join(root, 'dist', 'worker.js'), 'utf-8').length;
console.log('Build complete. Output in dist/');
console.log(`  worker.js: ${(workerSize / 1024).toFixed(1)} KB`);
