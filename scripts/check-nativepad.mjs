/** The Android controller bridge (src/engine/NativePad.js): __mimiPad(...) must look like a standard gamepad. */
let events = [];
globalThis.window = globalThis;
globalThis.dispatchEvent = (e) => events.push(e);
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [null, null, null, null] }, configurable: true });
const { nativePadSnapshot } = await import('../src/engine/NativePad.js');

let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log(`\x1b[31mFAIL\x1b[0m ${m}`); } else console.log(`\x1b[32mok\x1b[0m   ${m}`); };

ok(navigator.getGamepads().every((p) => p === null), 'no controller before the Android side reports one');
window.__mimiPad(0.5, -0.25, 0, 0, (1 << 0) | (1 << 9) | (1 << 14));
ok(events.length === 1 && events[0].type === 'gamepadconnected' && events[0].gamepad.index === 0, 'the first report fires gamepadconnected');
const pad = navigator.getGamepads()[0];
ok(pad && pad.mapping === 'standard' && pad.connected, 'navigator.getGamepads() now returns a standard pad');
ok(pad.axes[0] === 0.5 && pad.axes[1] === -0.25 && pad.axes.length === 4, 'the left stick comes through');
ok(pad.buttons[0].pressed && pad.buttons[9].pressed && pad.buttons[14].pressed && !pad.buttons[1].pressed && pad.buttons.length === 17, 'buttons A, Start and D-pad left are pressed, B is not');
window.__mimiPad(0, 0, 0.9, 0.1, 1 << 7);
const pad2 = navigator.getGamepads()[0];
ok(pad2.axes[2] === 0.9 && pad2.buttons[7].pressed && !pad2.buttons[0].pressed, 'a later report replaces the old state');
ok(events.length === 1, 'gamepadconnected fires only once');
ok(nativePadSnapshot().buttons.every((b) => b.value === 0 || b.value === 1), 'button values are 0 or 1');
console.log(failed ? `\n${failed} failed` : '\n\x1b[32mAll native pad checks passed.\x1b[0m');
process.exit(failed ? 1 : 0);
