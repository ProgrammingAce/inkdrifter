const createForm = document.getElementById('create-form');
const joinForm = document.getElementById('join-form');
const createStatus = document.getElementById('create-status');
const joinStatus = document.getElementById('join-status');

createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const hostName = document.getElementById('host-name').value.trim();
  const rows = parseInt(document.getElementById('create-rows').value, 10);
  const cols = parseInt(document.getElementById('create-cols').value, 10);
  const seedRaw = document.getElementById('create-seed').value.trim();

  createStatus.textContent = 'Creating lobby…';
  createStatus.className = 'status-msg';

  try {
    const body = { hostName, rows, cols };
    if (seedRaw) body.seed = parseInt(seedRaw, 10);
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
        lobby_full: 'Lobby is full (8 players max).',
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
