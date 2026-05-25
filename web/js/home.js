import { MAX_PLAYERS_PER_LOBBY } from './socket.js';
import { mountMapSettingsModal } from './mapSettingsModal.js?v=3';

const createForm = document.getElementById('create-form');
const joinForm = document.getElementById('join-form');
const createStatus = document.getElementById('create-status');
const joinStatus = document.getElementById('join-status');
const importBtn = document.getElementById('import-btn');
const importFileInput = document.getElementById('import-file-input');
const hostNameInput = document.getElementById('host-name');
const joinBtn = document.getElementById('join-btn');
const playerNameInput = document.getElementById('player-name');
const mapSettingsBtn = document.getElementById('map-settings-btn');

joinBtn.addEventListener('click', (e) => {
  if (joinBtn.disabled) e.preventDefault();
});

const mapSettings = mountMapSettingsModal();
mapSettingsBtn.addEventListener('click', mapSettings.open);

importBtn.addEventListener('click', () => {
  importFileInput.value = '';
  importFileInput.click();
});

importFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (evt) => {
    try {
      const data = JSON.parse(evt.target.result);
      if (!data.seed || !data.gridRows || !data.gridCols || !data.revealedTiles) {
        createStatus.textContent = 'Invalid game state file.';
        createStatus.className = 'status-msg error';
        return;
      }
      createStatus.textContent = 'Importing…';
      createStatus.className = 'status-msg';
      const hostName = hostNameInput.value.trim();
      const res = await fetch('/api/lobbies/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostName,
          rows: data.gridRows,
          cols: data.gridCols,
          seed: data.seed,
          status: data.status,
          fog: data.fog,
          marker: data.marker,
          revealedTiles: data.revealedTiles,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        createStatus.textContent = 'Error: ' + (result.error || res.statusText);
        createStatus.className = 'status-msg error';
        return;
      }
      localStorage.setItem(`hostToken_${result.code}`, result.hostToken);
      createStatus.textContent = 'Game state imported! Redirecting…';
      window.location.href = `/lobby/${result.code}`;
    } catch (err) {
      createStatus.textContent = 'Network error. Please try again.';
      createStatus.className = 'status-msg error';
    }
  };
  reader.readAsText(file);
});

hostNameInput.addEventListener('input', () => {
  importBtn.disabled = !hostNameInput.value.trim();
});

playerNameInput.addEventListener('input', () => {
  joinBtn.disabled = !playerNameInput.value.trim();
});

createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const hostName = hostNameInput.value.trim();

  createStatus.textContent = 'Creating lobby…';
  createStatus.className = 'status-msg';

  try {
    const body = { hostName, ...mapSettings.getOptions() };
    const res = await fetch('/api/lobbies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      createStatus.textContent = 'Error: ' + (data.error || res.statusText);
      createStatus.className = 'status-msg error';
      return;
    }
    localStorage.setItem(`hostToken_${data.code}`, data.hostToken);
    createStatus.textContent = 'Lobby created! Redirecting…';
    window.location.href = `/lobby/${data.code}`;
  } catch (err) {
    createStatus.textContent = 'Network error. Please try again.';
    createStatus.className = 'status-msg error';
  }
});

joinForm.addEventListener('submit', async (e) => {
  if (joinBtn.disabled) {
    e.preventDefault();
    return;
  }
  e.preventDefault();
  const code = document.getElementById('join-code').value.trim().padStart(5, '0');
  const playerName = document.getElementById('player-name').value.trim();

  joinStatus.textContent = 'Joining…';
  joinStatus.className = 'status-msg';

  try {
    const res = await fetch(`/api/lobbies/${code}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName }),
    });
    const data = await res.json();
    if (!res.ok) {
      const msgs = {
        no_such_lobby: 'Lobby not found. Check the code.',
        lobby_full: `Lobby is full (${MAX_PLAYERS_PER_LOBBY} players max).`,
        name_taken: 'That name is already taken.',
        lobby_not_ready: 'Lobby is still loading. Try again in a moment.',
        lobby_closed: 'Lobby has been closed.',
      };
      joinStatus.textContent = msgs[data.error] || ('Error: ' + (data.error || res.statusText));
      joinStatus.className = 'status-msg error';
      return;
    }
    localStorage.setItem(`playerToken_${code}`, data.playerToken);
    localStorage.setItem(`playerId_${code}`, data.playerId);
    joinStatus.textContent = 'Joined! Redirecting…';
    window.location.href = `/lobby/${code}`;
  } catch (err) {
    joinStatus.textContent = 'Network error. Please try again.';
    joinStatus.className = 'status-msg error';
  }
});
