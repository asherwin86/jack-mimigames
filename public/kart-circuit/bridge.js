// Kart Circuit runs inside 100 Mimi Games in an <iframe>. Keys pressed while the
// game has focus never reach the arcade around it, so Escape is forwarded here
// (the arcade takes you back to the menu). Does nothing when the page is opened on its own.
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && window.parent !== window) {
    window.parent.postMessage({ source: 'kart-circuit', type: 'exit' }, '*');
  }
});
