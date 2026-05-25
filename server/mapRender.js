const { Worker } = require('worker_threads');
const path = require('path');

class RenderQueue {
  constructor() {
    this._jobId = 0;
    this._pending = new Map(); // jobId -> { resolve, reject }
    this._queue = [];
    this._busy = false;
    this._spawn();
  }

  _spawn() {
    this._worker = new Worker(path.join(__dirname, 'renderWorker.js'));
    this._worker.on('message', this._onMessage.bind(this));
    this._worker.on('error', this._onError.bind(this));
    this._worker.on('exit', (code) => {
      if (code !== 0) this._onError(new Error(`Worker exited with code ${code}`));
    });
  }

  _onMessage({ jobId, ok, pngBuffer, biomeTags, error }) {
    const cb = this._pending.get(jobId);
    this._pending.delete(jobId);
    this._busy = false;
    if (cb) {
      if (ok) cb.resolve({ pngBuffer, biomeTags });
      else cb.reject(new Error(error));
    }
    this._processNext();
  }

  _onError(err) {
    console.error('Render worker error:', err);
    for (const [, cb] of this._pending) cb.reject(err);
    this._pending.clear();
    for (const { reject } of this._queue) reject(err);
    this._queue.length = 0;
    this._busy = false;
    this._spawn();
  }

  _processNext() {
    if (this._busy || this._queue.length === 0) return;
    const { jobId, msg, resolve, reject } = this._queue.shift();
    this._busy = true;
    this._pending.set(jobId, { resolve, reject });
    this._worker.postMessage(msg);
  }

  render(seed, rows, cols, opts = {}) {
    return new Promise((resolve, reject) => {
      const jobId = ++this._jobId;
      const msg = { jobId, seed, rows, cols, options: opts };
      this._queue.push({ jobId, msg, resolve, reject });
      this._processNext();
    });
  }
}

const renderQueue = new RenderQueue();
module.exports = { renderQueue };
