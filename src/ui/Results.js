import { Scores } from '../engine/Storage.js';

/** Full-screen results card shown when a run ends. */
export function showResults(root, entry, score, detail, { onReplay, onMenu }) {
  const higher = entry.higherIsBetter !== false;
  const record = Scores.submit(entry.id, score, higher);
  const best = Scores.best(entry.id) ?? score;
  const unit = entry.unit ? ` ${entry.unit}` : '';
  const value = Number.isInteger(score) ? score : score.toFixed(1);

  root.innerHTML = `
    <div class="overlay">
      <div class="card">
        <h2>${record ? 'New personal best!' : 'Run over'}</h2>
        <p>${detail || entry.name}</p>
        <div class="score">${value}${unit}</div>
        <div class="best">best ${Number.isInteger(best) ? best : best.toFixed(1)}${unit}</div>
        <div class="row">
          <button class="btn primary" data-act="replay">Play again</button>
          <button class="btn" data-act="menu">All games</button>
        </div>
      </div>
    </div>`;

  root.querySelector('[data-act="replay"]').onclick = onReplay;
  root.querySelector('[data-act="menu"]').onclick = onMenu;
  root.querySelector('[data-act="replay"]').focus();
}

export function showError(root, message, onMenu) {
  root.innerHTML = `
    <div class="overlay">
      <div class="card">
        <h2>Could not start</h2>
        <p>${message}</p>
        <div class="row"><button class="btn primary" data-act="menu">All games</button></div>
      </div>
    </div>`;
  root.querySelector('[data-act="menu"]').onclick = onMenu;
}
