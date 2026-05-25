// Shared Map Settings modal. Used by the home page (new lobby) and the
// in-lobby Preview Mode (host re-render).
import { decodePackedSeed, looksPacked } from './seedCodec.js';

const MODAL_HTML = `
<div class="modal-overlay" hidden data-map-settings-modal>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="map-settings-title">
    <header class="modal-header">
      <h2 id="map-settings-title">Map Settings</h2>
      <button type="button" class="modal-close" data-ms-close aria-label="Close">&times;</button>
    </header>
    <div class="modal-body">
      <div class="form-row">
        <div class="form-group">
          <label data-ms-for="rows">Rows</label>
          <input type="number" data-ms="rows" value="12" min="6" max="50">
        </div>
        <div class="form-group">
          <label data-ms-for="cols">Columns</label>
          <input type="number" data-ms="cols" value="12" min="6" max="50">
        </div>
       </div>
       <p class="hint" data-ms="gridHint">Grid dimensions can only be changed from the main menu.</p>
      <div class="form-group">
        <label data-ms-for="seed">Seed <span class="hint">(optional — paste a shared seed to copy a map)</span></label>
        <input type="text" data-ms="seed" placeholder="random" autocomplete="off" spellcheck="false" maxlength="17">
      </div>
      <hr class="modal-sep">

      <div class="form-row">
        <div class="form-group">
          <label data-ms-for="oceanCap">Max water coverage</label>
          <input type="number" data-ms="oceanCap" value="40" min="5" max="80" step="1">
          <p class="hint">Percent of map (5–80).</p>
        </div>
        <div class="form-group">
          <label data-ms-for="riverCount">River count <span class="hint">(blank = auto)</span></label>
          <input type="number" data-ms="riverCount" placeholder="auto" min="0" max="20">
        </div>
      </div>

      <div class="form-group">
        <div class="label-row">
          <label>Coast sides</label>
          <label class="auto-toggle">
            <input type="checkbox" data-ms="coastAuto" checked>
            <span>Auto</span>
          </label>
        </div>
        <div class="sides-grid">
          <label><input type="checkbox" data-ms-side value="N"> North</label>
          <label><input type="checkbox" data-ms-side value="S"> South</label>
          <label><input type="checkbox" data-ms-side value="E"> East</label>
          <label><input type="checkbox" data-ms-side value="W"> West</label>
        </div>
      </div>

      <div class="form-group">
        <label data-ms-for="cityCount">City count</label>
        <input type="range" data-ms="cityCount" min="0" max="20" value="5" step="1">
        <div class="range-ends"><span>Min</span><span>Max</span></div>
      </div>

      <div class="form-group">
        <label data-ms-for="elevation">Elevation <span class="hint" data-ms-readout="elevation">50</span></label>
        <input type="range" data-ms="elevation" min="0" max="100" value="50" step="1">
        <p class="hint">Lower = flatter plains; higher = more hills &amp; mountains.</p>
      </div>
      <div class="form-group">
        <label data-ms-for="humidity">Humidity <span class="hint" data-ms-readout="humidity">50</span></label>
        <input type="range" data-ms="humidity" min="0" max="100" value="50" step="1">
        <p class="hint">Lower = drier plains; higher = more forests &amp; swamps.</p>
      </div>

      <div class="form-group form-check">
        <label><input type="checkbox" data-ms="drawOcean" checked> <span>Generate ocean</span></label>
      </div>
      <div class="form-group form-check">
        <label><input type="checkbox" data-ms="drawRiver" checked> <span>Generate rivers</span></label>
      </div>
      <div class="form-group form-check">
        <label><input type="checkbox" data-ms="drawGrid" checked> <span>Show hex grid</span></label>
      </div>

      <hr class="modal-sep">

      <div class="form-group form-check">
        <label>
          <input type="checkbox" data-ms="islands">
          <span>Islands mode <span class="beta-tag">BETA</span></span>
        </label>
        <p class="hint">Generates an archipelago instead of a continent with ocean borders.</p>
      </div>
    </div>
    <footer class="modal-footer">
      <button type="button" class="btn-secondary" data-ms-reset>Reset to defaults</button>
      <button type="button" class="btn" data-ms-done>Done</button>
    </footer>
  </div>
</div>
`;

export function mountMapSettingsModal({ locked = [], onDone } = {}) {
  const wrap = document.createElement('div');
  wrap.innerHTML = MODAL_HTML.trim();
  const root = wrap.firstElementChild;
  document.body.appendChild(root);

  const $ = (name) => root.querySelector(`[data-ms="${name}"]`);
  const sideInputs = Array.from(root.querySelectorAll('[data-ms-side]'));
  const els = {
    rows: $('rows'),
    cols: $('cols'),
    seed: $('seed'),
    oceanCap: $('oceanCap'),
    riverCount: $('riverCount'),
    cityCount: $('cityCount'),
    elevation: $('elevation'),
    humidity: $('humidity'),
    drawOcean: $('drawOcean'),
    drawRiver: $('drawRiver'),
    drawGrid: $('drawGrid'),
    islands: $('islands'),
    coastAuto: $('coastAuto'),
    gridHint: $('gridHint'),
  };

  // Lock requested fields.
  for (const name of locked) {
    const el = els[name];
    if (el) el.disabled = true;
    const lbl = root.querySelector(`[data-ms-for="${name}"]`);
    if (lbl) lbl.classList.add('disabled-label');
  }

 
  // Live readouts for sliders.
  const sliderReadout = (input, name) => {
    const out = root.querySelector(`[data-ms-readout="${name}"]`);
    if (!out) return;
    input.addEventListener('input', () => { out.textContent = input.value; });
  };
  sliderReadout(els.cityCount, 'cityCount');
  sliderReadout(els.elevation, 'elevation');
  sliderReadout(els.humidity, 'humidity');

  // Coast-sides auto toggle.
  const syncCoastAuto = () => {
    const auto = els.coastAuto.checked;
    sideInputs.forEach(i => { i.disabled = auto; });
  };
  els.coastAuto.addEventListener('change', syncCoastAuto);
  syncCoastAuto();

  // Islands depends on ocean being on.
  const syncIslandsDisabled = () => {
    const off = !els.drawOcean.checked;
    els.islands.disabled = off;
    if (off) els.islands.checked = false;
  };
  els.drawOcean.addEventListener('change', syncIslandsDisabled);

  // When the user pastes/types a packed seed, decode it and populate all
  // settings so the form reflects the embedded map.
  els.seed.addEventListener('input', () => {
    if (els.seed.disabled) return;
    const raw = els.seed.value.trim();
    if (!looksPacked(raw)) return;
    const decoded = decodePackedSeed(raw);
    if (!decoded) return;
    applyDecoded(decoded);
  });

  function applyDecoded(decoded) {
    const { rows, cols, options } = decoded;
    if (!els.rows.disabled) els.rows.value = rows;
    if (!els.cols.disabled) els.cols.value = cols;
    setOptions({ ...options, _skipSeed: true });
  }

  // Open/close. Closing always commits current values via onDone (if provided)
  // so the user can dismiss the modal however they like without losing edits.
  const open = () => { root.hidden = false; };
  const close = () => {
    if (root.hidden) return;
    root.hidden = true;
    if (onDone) onDone(getOptions());
  };
  root.querySelector('[data-ms-close]').addEventListener('click', close);
  root.querySelector('[data-ms-done]').addEventListener('click', close);
  root.querySelector('[data-ms-reset]').addEventListener('click', resetDefaults);
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !root.hidden) close();
  });

  function getOptions() {
    const out = {};
    const rows = parseInt(els.rows.value, 10);
    const cols = parseInt(els.cols.value, 10);
    if (Number.isFinite(rows)) out.rows = rows;
    if (Number.isFinite(cols)) out.cols = cols;
    const seedRaw = els.seed.value.trim();
    if (seedRaw !== '') {
      if (looksPacked(seedRaw)) {
        const decoded = decodePackedSeed(seedRaw);
        if (decoded) out.seed = decoded.seed;
      } else {
        const n = parseInt(seedRaw, 10);
        if (Number.isFinite(n)) out.seed = n;
      }
    }

    if (els.islands.checked && !els.islands.disabled) out.islands = true;
    if (!els.drawOcean.checked) out.drawOcean = false;
    if (!els.drawRiver.checked) out.drawRiver = false;
    if (!els.drawGrid.checked) out.drawGrid = false;

    const capPct = parseFloat(els.oceanCap.value);
    if (Number.isFinite(capPct)) out.oceanCap = Math.max(0.05, Math.min(0.80, capPct / 100));
    const rcRaw = els.riverCount.value.trim();
    if (rcRaw !== '') out.riverCount = parseInt(rcRaw, 10);
    out.cityCount = parseInt(els.cityCount.value, 10);

    if (!els.coastAuto.checked) {
      out.coastSides = sideInputs.filter(i => i.checked).map(i => i.value);
    }

    const eVal = parseInt(els.elevation.value, 10);
    if (Number.isFinite(eVal) && eVal !== 50) out.elevationBias = (eVal - 50) / 100 * 0.6;
    const hVal = parseInt(els.humidity.value, 10);
    if (Number.isFinite(hVal) && hVal !== 50) out.humidityBias = (hVal - 50) / 100 * 0.6;

    return out;
  }

  function resetDefaults() {
    // Only reset editable fields; leave locked ones (rows/cols/seed in
    // preview mode) at their current values.
    if (!els.rows.disabled) els.rows.value = 12;
    if (!els.cols.disabled) els.cols.value = 12;
    if (!els.seed.disabled) els.seed.value = '';
    if (!els.oceanCap.disabled) els.oceanCap.value = 40;
    if (!els.riverCount.disabled) els.riverCount.value = '';
    if (!els.cityCount.disabled) els.cityCount.value = 5;
    if (!els.elevation.disabled) els.elevation.value = 50;
    if (!els.humidity.disabled) els.humidity.value = 50;
    if (!els.drawOcean.disabled) els.drawOcean.checked = true;
    if (!els.drawRiver.disabled) els.drawRiver.checked = true;
    if (!els.drawGrid.disabled) els.drawGrid.checked = true;
    if (!els.islands.disabled) els.islands.checked = false;
    if (!els.coastAuto.disabled) {
      els.coastAuto.checked = true;
      sideInputs.forEach(i => { i.checked = false; });
    }
    // Sync readouts and dependent toggles.
    const readout = (name, val) => {
      const out = root.querySelector(`[data-ms-readout="${name}"]`);
      if (out) out.textContent = val;
    };
    readout('cityCount', els.cityCount.value);
    readout('elevation', els.elevation.value);
    readout('humidity', els.humidity.value);
    syncCoastAuto();
    syncIslandsDisabled();
  }

  function setOptions(opts = {}) {
    if (opts.rows != null) els.rows.value = opts.rows;
    if (opts.cols != null) els.cols.value = opts.cols;
    if (opts.seed != null && !opts._skipSeed) els.seed.value = opts.seed;
    els.drawOcean.checked = opts.drawOcean !== false;
    els.drawRiver.checked = opts.drawRiver !== false;
    els.drawGrid.checked = opts.drawGrid !== false;
    els.islands.checked = !!opts.islands;
    if (opts.oceanCap != null) els.oceanCap.value = Math.round(opts.oceanCap * 100);
    if (opts.riverCount != null) els.riverCount.value = opts.riverCount;
    if (opts.cityCount != null) {
      els.cityCount.value = opts.cityCount;
      const out = root.querySelector(`[data-ms-readout="cityCount"]`);
      if (out) out.textContent = opts.cityCount;
    }
    const sides = opts.coastSides ?? opts.sides;
    if (Array.isArray(sides)) {
      els.coastAuto.checked = false;
      const set = new Set(sides);
      sideInputs.forEach(i => { i.checked = set.has(i.value); });
    } else {
      els.coastAuto.checked = true;
    }
    const eBias = opts.elevationBias ?? 0;
    const hBias = opts.humidityBias ?? 0;
    els.elevation.value = Math.round(50 + eBias / 0.6 * 100);
    els.humidity.value = Math.round(50 + hBias / 0.6 * 100);
    const eOut = root.querySelector(`[data-ms-readout="elevation"]`);
    const hOut = root.querySelector(`[data-ms-readout="humidity"]`);
    if (eOut) eOut.textContent = els.elevation.value;
    if (hOut) hOut.textContent = els.humidity.value;
    syncCoastAuto();
    syncIslandsDisabled();
  }

  // URL-driven islands default for the home page.
  const urlIslands = new URLSearchParams(window.location.search).get('islands');
  if (urlIslands != null && urlIslands !== '' && urlIslands !== '0' && urlIslands.toLowerCase() !== 'false') {
    els.islands.checked = true;
  }

  return { root, open, close, getOptions, setOptions };
}
