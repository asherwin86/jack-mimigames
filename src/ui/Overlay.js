/** Full-screen "ready?" card shown before a game's own update loop starts
 *  ticking — the scene behind it is already built and visible, just frozen,
 *  so this doubles as a moment for the first chunk of loading/streaming to
 *  settle in before the player is thrown into it. */
export function showStart(root, entry, onPlay) {
  root.innerHTML = `
    <div class="overlay">
      <div class="card">
        <h2>${entry.name}</h2>
        <p>${entry.blurb || ''}</p>
        <p class="controls">${entry.controls || ''}</p>
        <div class="row"><button class="btn primary" data-act="play">&#9654; Play</button></div>
      </div>
    </div>`;
  const btn = root.querySelector('[data-act="play"]');
  btn.onclick = () => { root.innerHTML = ''; onPlay(); };
  btn.focus();
}

/** Full-screen pause card — Escape mid-run shows this instead of leaving
 *  straight to the menu, so a run in progress isn't lost to a stray tap. */
export function showPause(root, entry, { onResume, onMenu }) {
  root.innerHTML = `
    <div class="overlay">
      <div class="card">
        <h2>Paused</h2>
        <p>${entry.name}</p>
        <div class="row">
          <button class="btn primary" data-act="resume">Resume</button>
          <button class="btn" data-act="menu">Quit to menu</button>
        </div>
      </div>
    </div>`;
  root.querySelector('[data-act="resume"]').onclick = () => { root.innerHTML = ''; onResume(); };
  root.querySelector('[data-act="menu"]').onclick = onMenu;
  root.querySelector('[data-act="resume"]').focus();
}
