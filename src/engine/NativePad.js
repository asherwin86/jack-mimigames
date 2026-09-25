/**
 * Controllers inside the Android app.
 *
 * Android's WebView doesn't reliably expose the browser Gamepad API (a Shield TV controller did nothing), so the
 * Android side (android/.../MainActivity.java) reads the controller itself and calls window.__mimiPad(...) with its
 * sticks and buttons. This makes that look like a normal standard-mapping gamepad: navigator.getGamepads() returns it
 * and a "gamepadconnected" event fires, so engine/Input.js — and Kart Circuit's own gamepad code — work unchanged.
 * A real Gamepad API pad, when the browser has one, always wins. Harmless everywhere else: nothing calls __mimiPad.
 */
const state = { axes: [0, 0, 0, 0], mask: 0, connected: false };
let fake = null;
const realGet = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads.bind(navigator) : null;

/** A fresh Gamepad-shaped snapshot of the current state. */
export function nativePadSnapshot() {
  const buttons = [];
  for (let i = 0; i < 17; i++) {
    const on = (state.mask & (1 << i)) !== 0;
    buttons.push({ pressed: on, touched: on, value: on ? 1 : 0 });
  }
  return {
    id: 'Android controller (standard)', index: 0, connected: true, mapping: 'standard',
    timestamp: Date.now(), axes: state.axes.slice(), buttons, vibrationActuator: null,
  };
}

/** Called from Java: left stick, right stick, and the buttons as a bit mask (bit i = standard button i). */
export function feedNativePad(lx, ly, rx, ry, mask) {
  state.axes = [lx, ly, rx, ry];
  state.mask = mask | 0;
  if (!state.connected) {
    state.connected = true;
    if (typeof dispatchEvent === 'function' && typeof Event === 'function') {
      const ev = new Event('gamepadconnected');
      ev.gamepad = nativePadSnapshot();
      dispatchEvent(ev);
    }
  }
}

if (typeof window !== 'undefined') {
  window.__mimiPad = feedNativePad;
  if (typeof navigator !== 'undefined') {
    try {
      navigator.getGamepads = () => {
        const real = realGet ? realGet() : [];
        for (const p of real || []) if (p) return real;
        if (!state.connected) return real || [];
        fake = nativePadSnapshot();
        return [fake, null, null, null];
      };
    } catch { /* read-only navigator: the real Gamepad API is all there is */ }
  }
}
