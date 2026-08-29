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

  start() {}
  update() {}
  dispose() {}
}
