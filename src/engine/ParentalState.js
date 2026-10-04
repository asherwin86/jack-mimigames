/**
 * Thin, safe wrappers around the parental controls core (public/parental-core.js, loaded by index.html as
 * window.MimiParental). If that script is somehow missing, everything here says "no controls" instead of crashing.
 */
export const parental = () => (typeof window !== 'undefined' && window.MimiParental) || null;

export const controlsOn = () => !!parental()?.enabled();
export const isBlocked = (id) => !!parental()?.gameBlocked(id);
/** "Keep inside the arcade" is on: hide the link to 51 Mimi Games, the Switch button, sign-in, bug reports and the install button. */
export const keepInside = () => !!parental()?.keepInside();

/** 5 -> "5 min", 65 -> "1 h 5 min". */
export function minutesText(min) {
  min = Math.max(0, Math.round(min));
  return min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`;
}

/** "Time left today: 23 min", or '' when there is no daily limit (or the controls are off). */
export function timeLeftText(st = parental()?.status()) {
  if (!st?.enabled || st.remaining === null) return '';
  return `Time left today: ${minutesText(Math.ceil(st.remaining / 60))}`;
}
