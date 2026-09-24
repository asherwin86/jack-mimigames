// Kart Circuit runs inside 100 Mimi Games in an <iframe>. Keys pressed while the
// game has focus never reach the arcade around it, so Escape is forwarded here
// (the arcade takes you back to the menu). Does nothing when the page is opened on its own.
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && window.parent !== window) {
    window.parent.postMessage({ source: 'kart-circuit', type: 'exit' }, '*');
  }
});

// Powers bought in the arcade's admin panel arrive as messages from the page around us. They only
// apply to a live, offline race (never online, where they would be unfair), and we answer either way
// so the arcade can hand the Rocoins back when nothing happened.
addEventListener('message', (e) => {
  if (e.source !== window.parent || !e.data || e.data.source !== 'arcade' || e.data.type !== 'power') return;
  let ok = false;
  let why = '';
  try {
    const me = racers && racers[0];
    if (!running || paused || !me) why = 'Start a race first.';
    else if (mpConnected) why = 'Not allowed in online races.';
    else if (e.data.power === 'boost') { me.boostTimer = Math.max(me.boostTimer, 3.5); ok = true; }
    else if (e.data.power === 'item') {
      if (me.item) why = 'You are already holding an item.';
      else { me.item = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)]; ok = true; }
    }
  } catch (err) { why = 'Could not apply it.'; }
  window.parent.postMessage({ source: 'kart-circuit', type: 'power-result', power: e.data.power, ok, why }, '*');
});

// The backtick key opens the arcade's admin panel — pressed in here it would never reach the page around us.
addEventListener('keydown', (e) => {
  if (e.key === '`' && window.parent !== window) {
    window.parent.postMessage({ source: 'kart-circuit', type: 'admin' }, '*');
  }
});
