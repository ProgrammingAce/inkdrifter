const { parentPort } = require('worker_threads');
const { renderMap } = require('../index.js');

parentPort.on('message', ({ jobId, seed, rows, cols, islands }) => {
  try {
    const { canvas, biomes } = renderMap({ seed, rows, cols, islands });
    const pngBuffer = canvas.toBuffer('image/png');
    const biomeTags = biomes ? Object.fromEntries(biomes.tags) : {};
    parentPort.postMessage({ jobId, ok: true, pngBuffer, biomeTags });
  } catch (err) {
    parentPort.postMessage({ jobId, ok: false, error: err.message });
  }
});
