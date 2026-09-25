import * as THREE from 'three';

/**
 * Base class every mini-game extends.
 *
 *   start()        build the scene; called once after construction
 *   update(dt, t)  per frame; dt is seconds (clamped), t is seconds since start
 *   resize(w, h)   optional; camera aspect is handled for you
 *   dispose()      optional; scene contents are torn down for you
 *
 * Call `this.end(score)` to finish a run and show the results card.
 *
 * Rocoin powers (the admin panel, ` key): every game gets the generic ones. To
 * add powers of your own define `adminPowers()` returning power objects (see
 * engine/Powers.js); set `this.genericPowers = false` to hide the generic set.
 */
export class Game {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = ctx.scene;
    this.camera = ctx.camera;
    this.renderer = ctx.renderer;
    this.input = ctx.input;
    this.audio = ctx.audio;
    this.hud = ctx.hud;
    this.time = 0;
    this.finished = false;
  }

  get width() { return this.ctx.size.w; }
  get height() { return this.ctx.size.h; }

  add(...objs) { this.scene.add(...objs); return objs[0]; }

  /** Swap in a custom camera (orthographic, different fov, …). */
  useCamera(camera) {
    this.camera = camera;
    this.ctx.setCamera(camera);
    return camera;
  }

  orthoCamera(halfHeight = 10) {
    const a = this.width / this.height;
    const cam = new THREE.OrthographicCamera(
      -halfHeight * a, halfHeight * a, halfHeight, -halfHeight, 0.1, 500,
    );
    cam.userData.halfHeight = halfHeight;
    return this.useCamera(cam);
  }

  /** Finish the run. Called once; further calls are ignored. */
  end(score, detail = '') {
    if (this.finished) return;
    this.finished = true;
    this.ctx.end(score, detail);
  }

  /** The first of `objects` under the pointer (mouse, touch or the controller's cursor), or null. */
  pickAt(objects, recursive = false) {
    this._pickRay ??= new THREE.Raycaster();
    this._pickRay.setFromCamera(this.input.activePointer(), this.camera);
    const hits = this._pickRay.intersectObjects(objects, recursive);
    return hits.length ? hits[0] : null;
  }

  /** A click, tap, or the controller's A button, this frame. */
  clickedNow() { return this.input.clicked || this.input.gpHit(0); }

  /** Extra powers this game sells in the admin panel; see engine/Powers.js. */
  adminPowers() { return []; }

  start() {}
  update() {}
  dispose() {}
}
