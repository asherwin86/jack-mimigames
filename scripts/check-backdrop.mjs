// Headless check for the menu backdrop: hovering a flying creeper must prime
// it, blow it up and put it back in the sky, and bombs must fall and detonate.
const W = 1280, H = 800;
const DT = 1 / 60;
const SKY_FLOOR_TEST = -23;  // below the backdrop's own recycle line

installShims();
const { buildBackdrop } = await import('../src/ui/Backdrop.js');
const { FLYER_TYPES, FLYER_TOTAL } = await import('../src/ui/flyers.js');

let failures = 0;

function check(label, ok, note = '') {
  console.log(`${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${note ? `  ${note}` : ''}`);
  if (!ok) failures++;
}

const meows = [];
const mockAudio = { meow: (vol = 1) => meows.push(vol), unlock() {} };
const bd = buildBackdrop({ w: W, h: H }, mockAudio);
// Every prop hangs off one group inside the scene, so search the whole tree.
const all = [];
bd.scene.traverse((o) => all.push(o));
const creepers = all.filter((o) => o.isGroup && o.userData?.legs);
const bombs = all.filter((o) => o.isGroup && o.userData?.spark);
const marks = all.filter((o) => o.isMesh && o.userData?.fall !== undefined);
const flock = all.filter((o) => o.isGroup && o.userData?.type);

check('creepers exist', creepers.length === 14, `${creepers.length}`);
check('creeper is built from 6 parts', creepers[0].children.length === 6);
check('bombs exist', bombs.length === 8, `${bombs.length}`);
check('bombs start at the top of the sky', bombs.every((b) => b.position.y === 26));
check('bombs are released in a stagger', bombs.some((b) => b.userData.wait > 0));
check('claude marks exist', marks.length === 6, `${marks.length}`);
check('marks are one extruded burst of 11 spokes',
  marks[0].geometry.attributes.position.count >= 11 * 8,
  `${marks[0].geometry.attributes.position.count} verts`);
check('every mark shares the one geometry', new Set(marks.map((m) => m.geometry)).size === 1);
check('marks start above the sky', marks.every((m) => m.position.y >= 26));
check('the whole flock is in the sky', flock.length === FLYER_TOTAL,
  `${flock.length} flyers, ${FLYER_TYPES.length} types`);
check('no type is missing',
  new Set(flock.map((o) => o.userData.type)).size === FLYER_TYPES.length);
check('three lamborghinis fly',
  flock.filter((o) => o.userData.type === 'lambo').length === 3);
check('each lambo is a different colour',
  new Set(flock.filter((o) => o.userData.type === 'lambo')
    .map((o) => o.children[0].material.color.getHex())).size === 3);
check('headphones and controllers fly',
  ['headphones', 'controller'].every((t) => FLYER_TYPES.includes(t)));
check('both ear cups swivel',
  flock.find((o) => o.userData.type === 'headphones').userData.flap.length === 2);
check('both sticks wobble',
  flock.find((o) => o.userData.type === 'controller').userData.flap.length === 2);
check('a switch 2 flies', FLYER_TYPES.includes('switch2'));
check('a windows logo flies', FLYER_TYPES.includes('winlogo'));
check('three flat-screen tvs fly', flock.filter((o) => o.userData.type === 'tv').length === 3);
check('each tv has a different frame colour',
  new Set(flock.filter((o) => o.userData.type === 'tv').map((o) => o.children[0].material.color.getHex())).size === 3);
check('tvs are thin flat-screens, not the old crt',
  flock.find((o) => o.userData.type === 'tv').children[0].geometry.parameters.depth < 0.1);
check('the logo is four panes', flock.find((o) => o.userData.type === 'winlogo').children.length === 4);
check('the four panes are differently coloured', new Set(
  flock.find((o) => o.userData.type === 'winlogo').children.map((c) => c.material.color.getHex()),
).size === 4);
check('its joy-cons beat',
  flock.find((o) => o.userData.type === 'switch2').userData.flap.length === 2);
check('the joy-cons beat opposite ways', (() => {
  const [l, r] = flock.find((o) => o.userData.type === 'switch2').userData.flap;
  return Math.sign(l.userData.f.amp) !== Math.sign(r.userData.f.amp);
})());
check('nine cats fly', flock.filter((o) => o.userData.type === 'cat').length === 9);
check('the cats come in different coats', new Set(
  flock.filter((o) => o.userData.type === 'cat').map((o) => o.children[0].material.color.getHex()),
).size >= 7);
// --- ambient menu music ------------------------------------------------
// Nyan Cat's jingle loops as background music once unlocked. A direct press
// plays at full volume (1); the ambient loop plays softer (0.45) so the two
// are distinguishable even when they overlap.
const ambientPlays = () => meows.filter((v) => v < 1).length;
const heldPlays = () => meows.filter((v) => v === 1).length;

for (let i = 0; i < 40; i++) bd.update(DT);
check('nothing plays before any click has landed on the page', meows.length === 0,
  `${meows.length} plays`);

// Browsers refuse to start audio without a real gesture — any click anywhere
// unlocks it, not just one that lands on Nyan Cat.
window.__handlers.pointerdown?.({ clientX: -5000, clientY: -5000 });
bd.update(DT);
check('the jingle starts playing once something is clicked', ambientPlays() === 1, `${ambientPlays()} plays`);
check('the ambient loop is softer than a direct press', meows[0] < 1, `vol=${meows[0]}`);
// 44 frames is comfortably short of one jingle length (0.85s @ 60fps = 51
// frames) — leaving a margin so float drift in the accumulator can't tip it
// over early, the way landing exactly on the boundary occasionally did.
for (let i = 0; i < 44; i++) bd.update(DT);
check('it holds for one full jingle before repeating', ambientPlays() === 1, `${ambientPlays()} plays`);
for (let i = 0; i < 15; i++) bd.update(DT);
check('then it loops again', ambientPlays() === 2, `${ambientPlays()} plays`);
bd.setProps(false);
const ambientBefore = ambientPlays();
for (let i = 0; i < 60; i++) bd.update(DT);
check('the music keeps playing even with props hidden', ambientPlays() > ambientBefore,
  `${ambientBefore} -> ${ambientPlays()}`);
bd.setProps(true);

check('nyan cat flies', FLYER_TYPES.includes('nyancat'));
check('nyan cat has a rainbow trail plus sparkles',
  flock.find((o) => o.userData.type === 'nyancat').children.length >= 6 + 5 + 2 + 3);
// --- nyan cat hold-to-loop jingle -------------------------------------------
const nyan = flock.find((o) => o.userData.type === 'nyancat');
nyan.position.set(0, 0, 12);
const downAt = (x, y) => window.__handlers.pointerdown?.({ clientX: x, clientY: y });
const upAt = () => window.__handlers.pointerup?.({});
// Nyan Cat drifts on its own, so this re-aims at wherever it currently is
// rather than trusting a position computed frames ago.
const pressNyan = () => {
  bd.camera.updateMatrixWorld(true);
  const ndc = nyan.position.clone().project(bd.camera);
  downAt((ndc.x + 1) / 2 * W, (1 - ndc.y) / 2 * H);
};

pressNyan();
check('pressing nyan cat plays its jingle at full volume', heldPlays() === 1, `${heldPlays()} plays`);

upAt();
for (let i = 0; i < 90; i++) bd.update(DT);
check('releasing stops it from looping', heldPlays() === 1, `${heldPlays()} plays`);

downAt(-5000, -5000);
check('pressing empty sky does not play it', heldPlays() === 1, `${heldPlays()} plays`);

pressNyan();
check('pressing again plays it once more', heldPlays() === 2, `${heldPlays()} plays`);
for (let i = 0; i < 60; i++) bd.update(DT);   // > one jingle length (51 frames), still held
check('holding it down repeats the jingle', heldPlays() === 3, `${heldPlays()} plays`);
for (let i = 0; i < 60; i++) bd.update(DT);
check('it keeps looping for as long as it is held', heldPlays() === 4, `${heldPlays()} plays`);

upAt();
for (let i = 0; i < 50; i++) bd.update(DT);
check('letting go stops the loop for good', heldPlays() === 4, `${heldPlays()} plays`);
check('ambient music kept looping the whole time regardless', ambientPlays() > 2, `${ambientPlays()} plays`);

check('nyan cat sparkles spin', flock.find((o) => o.userData.type === 'nyancat').userData.spin.length === 2);
check('the game logo flies', FLYER_TYPES.includes('gamelogo'));
check('the logo badge spins on its own axis',
  flock.find((o) => o.userData.type === 'gamelogo').userData.spin.length === 1);
check('three houses fly', flock.filter((o) => o.userData.type === 'house').length === 3);
check('each house has a different wall colour', new Set(
  flock.filter((o) => o.userData.type === 'house').map((o) => o.children[0].material.color.getHex()),
).size === 3);
check('a house has a roof, chimney, door and windows',
  flock.find((o) => o.userData.type === 'house').children.length === 6);
check('a whole fleet of car brands flies',
  ['sedan', 'suv', 'pickup', 'van', 'hatchback', 'muscle', 'lambo']
    .every((t) => FLYER_TYPES.includes(t)));
check('the multi-instance cars come in different colours', ['sedan', 'suv', 'hatchback'].every((t) =>
  new Set(flock.filter((o) => o.userData.type === t).map((o) => o.children[0].material.color.getHex())).size === 3));
check('every car body has wheels', ['sedan', 'suv', 'pickup', 'van', 'hatchback', 'muscle'].every((t) =>
  flock.find((o) => o.userData.type === t).children.some((c) => c.geometry.type === 'CylinderGeometry')));
check('lambos have scissor doors',
  flock.filter((o) => o.userData.type === 'lambo').every((o) => o.userData.flap.length === 2));
check('every flyer has parts', flock.every((o) => o.children.length > 0));
check('the classics are still there',
  ['popcorn', 'soda', 'chips', 'desktop', 'laptop'].every((t) => FLYER_TYPES.includes(t)));
check('some flyers have beating parts', flock.filter((o) => o.userData.flap.length).length >= 6);
check('some flyers have turning parts', flock.filter((o) => o.userData.spin.length).length >= 3);

// Hold the bombs back so the creeper checks below are not disturbed by a blast.
const hold = () => { for (const b of bombs) { b.userData.wait = 1e9; b.visible = false; } };
hold();

// --- hover ---------------------------------------------------------------
// Park one creeper right in front of the camera and aim the pointer at it.
// Banish every other creeper first, miles away and with zero drift so
// nothing carries them back — with 14 at random positions, one can
// occasionally land on the same camera ray as the target by pure chance,
// and a plain position offset isn't enough: the per-frame update recycles
// anything that crosses z=16, which redraws its x/y at random and would
// undo a simple move-it-aside within the test's own animation window. Also
// clear fuse/respawn: bombs ran loose (unheld) through the several simulated
// seconds of ambient-music and nyan-cat tests above, and a real blast could
// legitimately have armed one of these creepers before this section even
// starts — leftover state, not anything this check is meant to catch.
for (const c of creepers.slice(1)) {
  c.position.set(1e4, 1e4, -1e4);
  c.userData.drift = 0;
  c.userData.bob = 0;
  c.userData.fuse = 0;
  c.userData.respawn = 0;
  c.visible = true;
  c.scale.setScalar(1);
}
const target = creepers[0];
target.position.set(0, 2, 10);
bd.camera.updateMatrixWorld(true);
const ndc = target.position.clone().project(bd.camera);
window.__move({
  clientX: (ndc.x + 1) / 2 * W,
  clientY: (1 - ndc.y) / 2 * H,
});

bd.update(DT);
check('hover lights the fuse', target.userData.fuse > 0, `fuse=${target.userData.fuse.toFixed(2)}`);

const others = creepers.slice(1).filter((c) => c.userData.fuse > 0 || c.userData.respawn > 0);
check('only the hovered creeper is armed', others.length === 0, `${others.length} others`);

let blew = false;
for (let i = 0; i < 40 && !blew; i++) {
  bd.update(DT);
  if (target.userData.respawn > 0) blew = true;
}
check('fuse burns down and detonates', blew);
check('creeper is hidden by the blast', target.visible === false);
check('blast throws shards', findShards(bd.scene) > 0, `${findShards(bd.scene)} live`);
check('scale is reset for the respawn', Math.abs(target.scale.x - 1) < 1e-6);

// Point well off-screen first: a ray left parked in the sky can catch another
// creeper drifting through it and make the respawn checks below flaky.
window.__move({ clientX: -5000, clientY: -5000 });
for (let i = 0; i < 60 * 5; i++) { bd.update(DT); hold(); }
check('creeper returns to the sky', target.visible === true && target.userData.respawn === 0);
check('it comes back off in the distance', target.position.z < 16, `z=${target.position.z.toFixed(1)}`);
check('shards are recycled', findShards(bd.scene) === 0);

// A pointer on empty sky must not arm anything. Genuinely off-screen, not just
// a screen corner: with 14 creepers wandering a wide volume over several
// simulated seconds, a corner ray can occasionally graze one by chance.
window.__move({ clientX: -5000, clientY: -5000 });
const armedBefore = creepers.filter((c) => c.userData.fuse > 0).length;
bd.update(DT);
hold();
check('empty sky arms nothing', creepers.filter((c) => c.userData.fuse > 0).length === armedBefore);

// Bring the creepers banished for the hover section back into the flight loop.
const between = (a, b) => a + Math.random() * (b - a);
for (const c of creepers.slice(1)) {
  c.position.set(between(-34, 34), between(-14, 16), between(-70, 6));
  c.userData.drift = between(2.2, 5.4);
  c.userData.bob = between(0.5, 1.3);
}

// --- bombs ---------------------------------------------------------------
// Release one bomb a whisker above the floor and watch it land.
const bomb = bombs[0];
bomb.userData.wait = 0;
bomb.visible = true;
bomb.position.set(30, -16.5, 0);
bomb.userData.vy = -20;
const before = findShards(bd.scene);
for (let i = 0; i < 10 && bomb.userData.wait === 0; i++) bd.update(DT);
check('bomb explodes at the floor', findShards(bd.scene) > before, `${findShards(bd.scene)} shards`);
check('bomb is reloaded at the top', bomb.position.y === 26 && bomb.userData.wait > 0);

// A blast next to a creeper should light its fuse.
const near = creepers.find((c) => c.userData.fuse === 0 && c.userData.respawn === 0);
near.position.set(-30, -14, 0);
bomb.userData.wait = 0;
bomb.visible = true;
bomb.position.set(-30, -12, 0);
bomb.userData.vy = -6;
let lit = false;
for (let i = 0; i < 40 && !lit; i++) { bd.update(DT); lit = near.userData.fuse > 0; }
check('a blast lights nearby creeper fuses', lit);

// Let everything run loose for a while, with the whole flight back in play.
bombs.forEach((b, i) => { b.userData.wait = i * 0.15; b.visible = false; });
for (let i = 0; i < 60 * 30; i++) bd.update(DT);
// --- the flock ------------------------------------------------------------
const laptop = flock.find((o) => o.userData.type === 'laptop');
const hinge = laptop.userData.flap[0];
// Well short of the recycle line, so a second of flapping cannot loop it round.
laptop.position.set(-20, 0, 0);
const angles = new Set();
for (let i = 0; i < 60; i++) { bd.update(DT); angles.add(hinge.rotation.x.toFixed(3)); }
check('the laptop lid flaps', angles.size > 30, `${angles.size} angles`);
check('the lid never folds through the base',
  [...angles].every((a) => Number(a) <= 0), `max=${Math.max(...[...angles].map(Number)).toFixed(2)}`);
check('flyers fly on the wind', laptop.position.z > 0, `z=${laptop.position.z.toFixed(1)}`);

const clock = flock.find((o) => o.userData.type === 'clock');
const hands = clock.userData.spin[0].rotation.z;
bd.update(DT);
check('turning parts turn', clock.userData.spin[0].rotation.z !== hands);

laptop.position.z = 17;
bd.update(DT);
check('a flyer past the camera flies round again', laptop.position.z < -60,
  `z=${laptop.position.z.toFixed(1)}`);

// --- claude marks ---------------------------------------------------------
const mark = marks[0];
mark.userData.wait = 0;
mark.visible = true;
mark.position.set(12, 4, 0);
const startY = mark.position.y;
const startRot = mark.rotation.y;
bd.update(DT);
check('marks fall', mark.position.y < startY, `dy=${(mark.position.y - startY).toFixed(3)}`);
check('marks tumble', mark.rotation.y !== startRot);

mark.position.y = SKY_FLOOR_TEST;
bd.update(DT);
check('a mark that falls past the frame is released again', mark.position.y >= 26);

check('bombs stay inside the sky', bombs.every((b) => b.position.y <= 26 && b.position.y > -17.5));
check('bombs keep being recycled', bombs.some((b) => b.position.y < 26));
check('creepers all still in play', creepers.every((c) => Number.isFinite(c.position.y)));
check('the flock stays in its lane',
  flock.every((o) => o.position.z <= 17 && o.position.z >= -71));
check('marks keep cycling', marks.every((m) => m.position.y <= 36 && m.position.y > -23));
// --- the props toggle -----------------------------------------------------
// The 30 simulated seconds just above ran bombs loose, which can legitimately
// arm a creeper's fuse from a nearby blast. Clear that leftover state first,
// so this section starts clean and isn't testing yesterday's explosion.
for (const c of creepers) { c.userData.fuse = 0; c.userData.respawn = 0; c.visible = true; }
const frozen = { z: flock[0].position.z, y: bombs[0].position.y };
bd.setProps(false);
for (let i = 0; i < 60; i++) bd.update(DT);
check('the toggle hides every prop', flock[0].parent.visible === false);
check('hidden props stop moving',
  flock[0].position.z === frozen.z && bombs[0].position.y === frozen.y);
check('the sky keeps cycling', Number.isFinite(bd.scene.fog.color.r));
window.__move({ clientX: W / 2, clientY: H / 2 });
bd.update(DT);
check('nothing can be blown up while hidden',
  creepers.every((c) => c.userData.fuse === 0));

bd.setProps(true);
bd.update(DT);
check('the toggle brings them back', flock[0].position.z !== frozen.z);

check('nothing went NaN', !findNaN(bd.scene));

bd.dispose();
check('dispose drops the pointer listener', window.__handlers.pointermove === undefined);

console.log(failures ? `\n\x1b[31m${failures} check(s) failed.\x1b[0m` : '\n\x1b[32mBackdrop OK.\x1b[0m');
process.exit(failures ? 1 : 0);

function findShards(scene) {
  let n = 0;
  scene.traverse((o) => { if (o.isMesh && o.userData?.life !== undefined && o.visible) n++; });
  return n;
}

function findNaN(scene) {
  let bad = false;
  scene.traverse((o) => {
    for (const v of [o.position, o.rotation, o.scale]) {
      if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) bad = true;
    }
  });
  return bad;
}

function installShims() {
  const ctx2d = {
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect() {}, clearRect() {}, drawImage() {},
    beginPath() {}, arc() {}, fill() {}, fillText() {},
    set fillStyle(_) {}, get fillStyle() { return '#000'; },
    set font(_) {}, get font() { return ''; },
    set textAlign(_) {}, get textAlign() { return ''; },
    set textBaseline(_) {}, get textBaseline() { return ''; },
  };
  const el = () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} });
  globalThis.document = {
    createElement: el, createElementNS: el,
    addEventListener() {}, removeEventListener() {},
  };
  const handlers = {};
  globalThis.window = {
    innerWidth: W, innerHeight: H,
    __handlers: handlers,
    __move: (e) => handlers.pointermove?.(e),
    addEventListener: (k, fn) => { handlers[k] = fn; },
    removeEventListener: (k, fn) => { if (handlers[k] === fn) delete handlers[k]; },
  };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.self = globalThis;
}
