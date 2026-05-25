import { EVENTS, POI_COLORS, POI_COLOR_HEX, POI_NAME_MAX, POI_DESC_MAX } from './socket.js';
import { pixelToHex } from './hex.js';

const LIST_HTML = `
<div class="modal-overlay" hidden data-poi-list-modal>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="poi-list-title">
    <header class="modal-header">
      <h2 id="poi-list-title">Points of Interest</h2>
      <button type="button" class="modal-close" data-pl-close aria-label="Close">&times;</button>
    </header>
    <div class="modal-body">
      <div class="poi-list-empty" data-pl-empty>No points of interest yet.</div>
      <ul class="poi-list" data-pl-list></ul>
    </div>
    <footer class="modal-footer">
      <button type="button" class="btn" data-pl-new>New POI</button>
    </footer>
  </div>
</div>
`;

const EDIT_HTML = `
<div class="modal-overlay" hidden data-poi-edit-modal>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="poi-edit-title">
    <header class="modal-header">
      <h2 id="poi-edit-title">New POI</h2>
      <button type="button" class="modal-close" data-pe-close aria-label="Close">&times;</button>
    </header>
    <div class="modal-body">
      <p class="poi-coords" data-pe-coords></p>
      <div class="form-group">
        <label data-pe-for="name">Name</label>
        <input type="text" data-pe="name" maxlength="${POI_NAME_MAX}" autocomplete="off" spellcheck="false">
      </div>
      <div class="form-group">
        <label data-pe-for="description">Description <span class="hint">(optional)</span></label>
        <textarea data-pe="description" maxlength="${POI_DESC_MAX}" rows="3"></textarea>
      </div>
      <div class="form-group">
        <label>Flag color</label>
        <div class="poi-color-grid" data-pe-colors></div>
      </div>
      <div class="form-group poi-visibility" data-pe-visibility-group hidden>
        <label>Visibility</label>
        <div class="poi-vis-row">
          <label><input type="radio" name="poi-visibility" value="gm" data-pe-vis="gm" checked> <span>GM only</span></label>
          <label><input type="radio" name="poi-visibility" value="public" data-pe-vis="public"> <span>Public (everyone)</span></label>
        </div>
      </div>
      <div class="form-group form-check" data-pe-player-edit hidden>
        <label><input type="checkbox" data-pe="playerEdit"> <span>Players can edit name &amp; description</span></label>
      </div>
    </div>
    <footer class="modal-footer poi-edit-footer">
      <button type="button" class="btn-danger poi-delete-btn" data-pe-delete hidden>Delete</button>
      <button type="button" class="btn-secondary" data-pe-cancel>Cancel</button>
      <button type="button" class="btn" data-pe-save>Save</button>
    </footer>
  </div>
</div>
`;

export function initPoiModals({ socket, getState, getIsHost, showToast }) {
  const listWrap = document.createElement('div');
  listWrap.innerHTML = LIST_HTML.trim();
  const listRoot = listWrap.firstElementChild;
  document.body.appendChild(listRoot);

  const editWrap = document.createElement('div');
  editWrap.innerHTML = EDIT_HTML.trim();
  const editRoot = editWrap.firstElementChild;
  document.body.appendChild(editRoot);

  const listEl = listRoot.querySelector('[data-pl-list]');
  const emptyEl = listRoot.querySelector('[data-pl-empty]');
  const newBtn = listRoot.querySelector('[data-pl-new]');

  const peTitle = editRoot.querySelector('#poi-edit-title');
  const peCoords = editRoot.querySelector('[data-pe-coords]');
  const peName = editRoot.querySelector('[data-pe="name"]');
  const peDesc = editRoot.querySelector('[data-pe="description"]');
  const peColorsEl = editRoot.querySelector('[data-pe-colors]');
  const peVisGroup = editRoot.querySelector('[data-pe-visibility-group]');
  const peVisPublic = editRoot.querySelector('[data-pe-vis="public"]');
  const peVisGm = editRoot.querySelector('[data-pe-vis="gm"]');
  const pePlayerEditGroup = editRoot.querySelector('[data-pe-player-edit]');
  const pePlayerEdit = editRoot.querySelector('[data-pe="playerEdit"]');
  const peDeleteBtn = editRoot.querySelector('[data-pe-delete]');
  const peSaveBtn = editRoot.querySelector('[data-pe-save]');
  const peCancelBtn = editRoot.querySelector('[data-pe-cancel]');

  // Build color swatch buttons
  let selectedColor = POI_COLORS[0];
  for (const c of POI_COLORS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'poi-color-swatch';
    btn.dataset.color = c;
    btn.style.background = POI_COLOR_HEX[c];
    btn.title = c;
    btn.addEventListener('click', () => {
      selectedColor = c;
      updateColorSelection();
    });
    peColorsEl.appendChild(btn);
  }
  function updateColorSelection() {
    for (const sw of peColorsEl.querySelectorAll('.poi-color-swatch')) {
      sw.classList.toggle('selected', sw.dataset.color === selectedColor);
    }
  }

  // Edit modal state
  let editingPoi = null;       // existing poi being edited, or null for new
  let pendingHex = null;       // { row, col } when creating new

  function openList() {
    renderList();
    listRoot.hidden = false;
  }
  function closeList() { listRoot.hidden = true; }

  function openEdit({ poi = null, hex = null, color = null } = {}) {
    editingPoi = poi;
    pendingHex = poi ? { row: poi.row, col: poi.col } : hex;
    if (!pendingHex) return;
    peCoords.textContent = `Tile (${pendingHex.row}, ${pendingHex.col})`;
    peName.value = poi ? poi.name : '';
    peDesc.value = poi ? (poi.description || '') : '';
    selectedColor = poi ? poi.color : (color && POI_COLORS.includes(color) ? color : POI_COLORS[0]);
    updateColorSelection();
    const isHost = getIsHost();
    peVisGroup.hidden = !isHost;
    pePlayerEditGroup.hidden = !isHost;
    if (isHost) {
      const v = poi ? poi.visibility : 'gm';
      peVisPublic.checked = v === 'public';
      peVisGm.checked = v === 'gm';
      pePlayerEdit.checked = poi ? (poi.editableByPlayers ?? false) : false;
    }
    const canEdit = isHost || !poi || (poi && poi.editableByPlayers);
    peTitle.textContent = poi && !canEdit ? 'POI Details' : (poi ? 'Edit POI' : 'New POI');
    peName.readOnly = !canEdit;
    peDesc.readOnly = !canEdit;
    peColorsEl.classList.toggle('locked', !canEdit);
    peSaveBtn.textContent = canEdit ? 'Save' : 'Done';
    peDeleteBtn.hidden = !poi;
    editRoot.hidden = false;
    setTimeout(() => peName.focus(), 0);
  }
  function closeEdit() {
    editRoot.hidden = true;
    editingPoi = null;
    pendingHex = null;
  }

  function renderList() {
    const state = getState();
    const pois = (state && state.pois) || [];
    listEl.innerHTML = '';
    emptyEl.style.display = pois.length === 0 ? '' : 'none';
    const isHost = getIsHost();
    for (const poi of pois) {
      const li = document.createElement('li');
      li.className = 'poi-list-item';
      li.dataset.poiId = poi.id;

      const sw = document.createElement('span');
      sw.className = 'poi-flag-swatch';
      sw.style.background = POI_COLOR_HEX[poi.color] || '#ccc';
      li.appendChild(sw);

      const info = document.createElement('div');
      info.className = 'poi-info';
      const nameEl = document.createElement('div');
      nameEl.className = 'poi-name';
      nameEl.textContent = poi.name;
      info.appendChild(nameEl);
      const meta = document.createElement('div');
      meta.className = 'poi-meta';
      const visBadge = poi.visibility === 'gm' ? ' • GM only' : '';
      meta.textContent = `(${poi.row}, ${poi.col})${visBadge}`;
      info.appendChild(meta);
      if (poi.description) {
        const desc = document.createElement('div');
        desc.className = 'poi-desc';
        desc.textContent = poi.description;
        info.appendChild(desc);
      }
      li.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'poi-actions';
      if (isHost) {
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'btn-small';
        toggleBtn.textContent = poi.visibility === 'gm' ? 'Show' : 'Hide';
        toggleBtn.title = poi.visibility === 'gm' ? 'Make public' : 'Make GM-only';
        toggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const next = poi.visibility === 'gm' ? 'public' : 'gm';
          socket.emit(EVENTS.POI_UPDATE, { id: poi.id, visibility: next });
        });
        actions.appendChild(toggleBtn);
      }
      li.appendChild(actions);

      li.addEventListener('click', () => {
        closeList();
        openEdit({ poi });
      });
      listEl.appendChild(li);
    }
  }

  // Wire close/cancel
  listRoot.querySelector('[data-pl-close]').addEventListener('click', closeList);
  listRoot.addEventListener('click', (e) => { if (e.target === listRoot) closeList(); });
  newBtn.addEventListener('click', () => {
    closeList();
    const state = getState();
    // Pick a default hex: marker if present, else center
    let hex = null;
    if (state && state.marker) hex = { row: state.marker.row, col: state.marker.col };
    else if (state) hex = { row: Math.floor(state.rows / 2), col: Math.floor(state.cols / 2) };
    openEdit({ hex });
  });

  editRoot.querySelector('[data-pe-close]').addEventListener('click', closeEdit);
  peCancelBtn.addEventListener('click', closeEdit);
  editRoot.addEventListener('click', (e) => { if (e.target === editRoot) closeEdit(); });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!editRoot.hidden) closeEdit();
    else if (!listRoot.hidden) closeList();
  });

  peSaveBtn.addEventListener('click', () => {
    const name = peName.value.trim();
    const canEdit = getIsHost() || !editingPoi || (editingPoi && editingPoi.editableByPlayers);
    if (!canEdit) {
      closeEdit();
      return;
    }
    if (!name) {
      if (showToast) showToast('Name is required.', true);
      peName.focus();
      return;
    }
    const description = peDesc.value;
    const visibility = (getIsHost() && peVisGm.checked) ? 'gm' : 'public';
    if (editingPoi) {
      socket.emit(EVENTS.POI_UPDATE, {
        id: editingPoi.id,
        name,
        description,
        color: selectedColor,
        visibility,
        editableByPlayers: getIsHost() ? pePlayerEdit.checked : undefined,
      });
    } else {
      socket.emit(EVENTS.POI_CREATE, {
        row: pendingHex.row,
        col: pendingHex.col,
        name,
        description,
        color: selectedColor,
        visibility,
        editableByPlayers: getIsHost() ? pePlayerEdit.checked : undefined,
      });
    }
    closeEdit();
  });

  peDeleteBtn.addEventListener('click', () => {
    if (!editingPoi) return;
    if (!confirm(`Delete POI "${editingPoi.name}"?`)) return;
    socket.emit(EVENTS.POI_DELETE, { id: editingPoi.id });
    closeEdit();
  });

  // ── Flag tray ──────────────────────────────────────────────────────────────
  const tray = document.getElementById('poi-tray');
  const trayFlagsEl = document.getElementById('poi-tray-flags');
  let trayVisible = false;

  function renderTray() {
    if (!trayFlagsEl) return;
    trayFlagsEl.innerHTML = '';
    for (const color of POI_COLORS) {
      const wrap = document.createElement('div');
      wrap.className = 'poi-tray-flag';
      wrap.dataset.color = color;
      wrap.title = `Drag onto map to place a ${color} flag`;
      wrap.appendChild(buildFlagSvg(color, 1));
      wrap.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        startDragFromTray(color, e);
      });
      trayFlagsEl.appendChild(wrap);
    }
  }
  function toggleTray(force) {
    if (!tray) return;
    trayVisible = force == null ? !trayVisible : !!force;
    tray.hidden = !trayVisible;
  }

  function startDragFromTray(color, downEvent) {
    const overlay = document.getElementById('overlay-canvas');
    if (!overlay) return;

    const ghost = document.createElement('div');
    ghost.className = 'poi-drag-ghost';
    ghost.appendChild(buildFlagSvg(color, 1.4));
    document.body.appendChild(ghost);

    function place(e) {
      ghost.style.left = e.clientX + 'px';
      ghost.style.top = e.clientY + 'px';
    }

    function move(e) {
      place(e);
      const hex = hexAtClient(e.clientX, e.clientY, overlay);
      ghost.classList.toggle('over-hex', !!hex);
    }

    function up(e) {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      ghost.remove();
      const hex = hexAtClient(e.clientX, e.clientY, overlay);
      if (!hex) return;
      openEdit({ hex, color });
    }

    place(downEvent);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  }

  function hexAtClient(clientX, clientY, overlay) {
    const rect = overlay.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right) return null;
    if (clientY < rect.top || clientY > rect.bottom) return null;
    const sx = overlay.width / rect.width;
    const sy = overlay.height / rect.height;
    const px = (clientX - rect.left) * sx;
    const py = (clientY - rect.top) * sy;
    const state = getState();
    if (!state) return null;
    const hex = pixelToHex(px, py, state.originX, state.originY, state.rows, state.cols);
    if (!hex) return null;
    return { row: hex.row, col: hex.col };
  }

  renderTray();

  return { openList, openEdit, closeList, closeEdit, renderList, toggleTray };
}

function buildFlagSvg(color, scale = 1, { outline = '#1a0e05' } = {}) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const W = 40 * scale;
  const H = 56 * scale;
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', '0 0 40 56');
  svg.setAttribute('class', 'poi-flag-svg');

  const shadow = document.createElementNS(svgNS, 'ellipse');
  shadow.setAttribute('cx', '11');
  shadow.setAttribute('cy', '54');
  shadow.setAttribute('rx', '7');
  shadow.setAttribute('ry', '2');
  shadow.setAttribute('fill', 'rgba(0,0,0,0.35)');
  svg.appendChild(shadow);

  const pole = document.createElementNS(svgNS, 'line');
  pole.setAttribute('x1', '11');
  pole.setAttribute('y1', '52');
  pole.setAttribute('x2', '11');
  pole.setAttribute('y2', '4');
  pole.setAttribute('stroke', outline);
  pole.setAttribute('stroke-width', '3.2');
  pole.setAttribute('stroke-linecap', 'round');
  svg.appendChild(pole);

  const knob = document.createElementNS(svgNS, 'circle');
  knob.setAttribute('cx', '11');
  knob.setAttribute('cy', '4');
  knob.setAttribute('r', '2.6');
  knob.setAttribute('fill', outline);
  svg.appendChild(knob);

  const banner = document.createElementNS(svgNS, 'path');
  banner.setAttribute('d', 'M11 4 L37 13 L11 22 Z');
  banner.setAttribute('fill', (typeof POI_COLOR_HEX !== 'undefined' && POI_COLOR_HEX[color]) || '#ddd');
  banner.setAttribute('stroke', outline);
  banner.setAttribute('stroke-width', '2.4');
  banner.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(banner);

  return svg;
}
