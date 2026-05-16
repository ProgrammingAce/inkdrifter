const { parentPort } = require('worker_threads');
const { renderMap } = require('../index.js');

parentPort.on('message', ({ jobId, seed, rows, cols }) => {
  try {
    const { canvas } = renderMap({ seed, rows, cols });
    const pngBuffer = canvas.toBuffer('image/png');
    parentPort.postMessage({ jobId, ok: true, pngBuffer });
  } catch (err) {
    parentPort.postMessage({ jobId, ok: false, error: err.message });
  }
});
