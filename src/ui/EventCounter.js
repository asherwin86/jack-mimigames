import { eventLabel, seasonOverride } from '../engine/Seasons.js';
import { Settings } from '../engine/Settings.js';

/**
 * A small "Holidays: 9 days left" tag beside the FPS counter, shown only during
 * the school holidays (and hidden by the "Holiday colours" switch in Settings).
 */
export function mountEventCounter() {
  const el = document.createElement('div');
  el.id = 'event-days';
  el.hidden = true;
  document.body.appendChild(el);
  const refresh = () => {
    const text = Settings.get('seasonal', true) ? eventLabel(new Date(), seasonOverride()) : null;
    el.hidden = !text;
    if (text) el.textContent = text;
  };
  refresh();
  setInterval(refresh, 60 * 1000);   // ticks over at midnight without a reload
  return { refresh };
}
