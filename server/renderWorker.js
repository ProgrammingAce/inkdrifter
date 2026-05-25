const { parentPort } = require('worker_threads');
const { renderMap } = require('../index.js');

parentPort.on('message', ({ jobId, seed, rows, cols, options = {} }) => {
  try {
    const { canvas, biomes } = renderMap({ seed, rows, cols, ...options });
    const pngBuffer = canvas.toBuffer('image/png');
    const biomeTags = biomes ? Object.fromEntries(biomes.tags) : {};
    parentPort.postMessage({ jobId, ok: true, pngBuffer, biomeTags });
  } catch (err) {
    parentPort.postMessage({ jobId, ok: false, error: err.message });
  }
});
