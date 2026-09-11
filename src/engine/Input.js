import * as THREE from 'three';

/**
 * Unified keyboard + pointer input. The engine clears per-frame edge state
 * (justPressed / justReleased / clicked) after every update tick.
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();

    this.pointer = new THREE.Vector2(0, 0);   // normalised device coords
    this.pixel = new THREE.Vector2(0, 0);     // css pixels
    this.delta = new THREE.Vector2(0, 0);     // movement since last frame
    this.down = false;
    this.clicked = false;
    this.releasedClick = false;
    this.buttons = new Set();        // every held mouse button
    this.clickedButtons = new Set(); // buttons pressed this frame
    this.wheel = 0;
    this.locked = false;

    this.gamepadIndex = null;
    this._gpPrevButtons = new Set();

    this._raycaster = new THREE.Raycaster();
    this._bind();
  }

  _bind() {
    this._onKeyDown = (e) => {
      if (e.repeat) return;
      const k = e.code;
      if (SWALLOW.has(k)) e.preventDefault();
      this.keys.add(k);
      this.pressed.add(k);
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    };
    this._onMove = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (this.locked) {
        this.delta.x += e.movementX || 0;
        this.delta.y += e.movementY || 0;
      } else {
        this.delta.x += x - this.pixel.x;
        this.delta.y += y - this.pixel.y;
      }
      this.pixel.set(x, y);
      this.pointer.set((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1);
    };
    this._onDown = (e) => {
      const b = e.button ?? 0;
      this._onMove(e);
      this.buttons.add(b);
      this.clickedButtons.add(b);
      if (b !== 0) return;
      this.down = true;
      this.clicked = true;
    };
    this._onUp = (e) => {
      const b = e?.button ?? 0;
      this.buttons.delete(b);
      if (b !== 0) return;
      this.down = false;
      this.releasedClick = true;
    };
    // While the pointer is locked, right-click is a game action, not a menu.
    this._onContext = (e) => { if (this.locked) e.preventDefault(); };
    this._onWheel = (e) => { this.wheel += e.deltaY; };
    this._onBlur = () => { this.keys.clear(); this.down = false; };
    this._onLock = () => { this.locked = document.pointerLockElement === this.canvas; };
    this._onGpConnect = (e) => { this.gamepadIndex = e.gamepad.index; };
    this._onGpDisconnect = (e) => { if (this.gamepadIndex === e.gamepad.index) this.gamepadIndex = null; };

    addEventListener('keydown', this._onKeyDown);
    addEventListener('keyup', this._onKeyUp);
    addEventListener('blur', this._onBlur);
    addEventListener('pointermove', this._onMove);
    addEventListener('pointerdown', this._onDown);
    addEventListener('pointerup', this._onUp);
    addEventListener('wheel', this._onWheel, { passive: true });
    addEventListener('contextmenu', this._onContext);
    addEventListener('gamepadconnected', this._onGpConnect);
    addEventListener('gamepaddisconnected', this._onGpDisconnect);
    document.addEventListener('pointerlockchange', this._onLock);
  }

  key(...codes) { return codes.some((c) => this.keys.has(c)); }
  /** Mouse button held / pressed this frame. 0 = left, 1 = middle, 2 = right. */
  button(n) { return this.buttons.has(n); }
  clickedButton(n) { return this.clickedButtons.has(n); }
  hit(...codes) { return codes.some((c) => this.pressed.has(c)); }
  let_go(...codes) { return codes.some((c) => this.released.has(c)); }

  /** The connected gamepad, re-read live: some browsers hand back a stale
   *  snapshot if you hold onto the object across frames. */
  _pad() { return navigator.getGamepads?.()?.[this.gamepadIndex] ?? null; }

  /** Raw stick/trigger axis, dead-zoned. Standard mapping: 0/1 are the left
   *  stick's x/y, 2/3 the right stick's. */
  gpAxis(i, deadzone = 0.15) {
    const v = this._pad()?.axes[i] ?? 0;
    return Math.abs(v) < deadzone ? 0 : v;
  }

  /** Held state of a gamepad button (standard mapping: 0=A 1=B 2=X 3=Y,
   *  4/5=bumpers, 6/7=triggers, 10/11=stick clicks). */
  gpButton(i) { return !!this._pad()?.buttons[i]?.pressed; }

  /** True only on the frame a gamepad button goes down. */
  gpHit(i) { return this.gpButton(i) && !this._gpPrevButtons.has(i); }

  /** -1 / 0 / +1 horizontal from arrows, WASD, or a gamepad's left stick. */
  axisX() {
    const kb = (this.key('ArrowRight', 'KeyD') ? 1 : 0) - (this.key('ArrowLeft', 'KeyA') ? 1 : 0);
    return kb || this.gpAxis(0);
  }
  /** -1 / 0 / +1 vertical; +1 is "forward" (up arrow / W / stick pushed up). */
  axisY() {
    const kb = (this.key('ArrowUp', 'KeyW') ? 1 : 0) - (this.key('ArrowDown', 'KeyS') ? 1 : 0);
    return kb || -this.gpAxis(1);
  }

  /** Raycast the pointer against objects; returns the first intersection or null. */
  pick(camera, objects, recursive = true) {
    this._raycaster.setFromCamera(this.pointer, camera);
    const hits = this._raycaster.intersectObjects(
      Array.isArray(objects) ? objects : [objects], recursive,
    );
    return hits.length ? hits[0] : null;
  }

  /** Point where the pointer ray crosses a plane (defaults to the ground plane). */
  pickPlane(camera, plane = GROUND, target = new THREE.Vector3()) {
    this._raycaster.setFromCamera(this.pointer, camera);
    return this._raycaster.ray.intersectPlane(plane, target);
  }

  requestLock() { if (!this.locked) this.canvas.requestPointerLock?.(); }
  exitLock() { if (this.locked) document.exitPointerLock?.(); }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.clickedButtons.clear();
    this.clicked = false;
    this.releasedClick = false;
    this.wheel = 0;
    this.delta.set(0, 0);

    // Gamepad buttons are polled, not event-driven, so gpHit's "just pressed"
    // edge is computed by diffing against this snapshot from last frame.
    this._gpPrevButtons.clear();
    const pad = this._pad();
    if (pad) pad.buttons.forEach((b, i) => { if (b.pressed) this._gpPrevButtons.add(i); });
  }

  reset() {
    this.keys.clear();
    this.buttons.clear();
    this.endFrame();
    this.exitLock();
  }

  dispose() {
    removeEventListener('keydown', this._onKeyDown);
    removeEventListener('keyup', this._onKeyUp);
    removeEventListener('blur', this._onBlur);
    removeEventListener('pointermove', this._onMove);
    removeEventListener('pointerdown', this._onDown);
    removeEventListener('pointerup', this._onUp);
    removeEventListener('wheel', this._onWheel);
    removeEventListener('contextmenu', this._onContext);
    removeEventListener('gamepadconnected', this._onGpConnect);
    removeEventListener('gamepaddisconnected', this._onGpDisconnect);
    document.removeEventListener('pointerlockchange', this._onLock);
  }
}

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const SWALLOW = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab',
]);
