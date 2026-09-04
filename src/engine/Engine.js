import * as THREE from 'three';
import { Input } from './Input.js';
import { Audio } from './Audio.js';
import { Hud } from './Hud.js';
import { disposeObject } from './utils.js';

export class Engine {
  constructor(canvas, hudRoot) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.input = new Input(canvas);
    this.audio = new Audio();
    this.hud = new Hud(hudRoot);

    this.scene = null;
    this.camera = null;
    this.game = null;
    this.entry = null;
    this.idleScene = null;
    this.running = false;
    this.paused = false;
    this.size = { w: innerWidth, h: innerHeight };

    this.onEnd = null;      // (entry, score, detail) => void
    this.onExit = null;     // back-to-menu button
    this.hud.onExit = () => this.onExit?.();

    // The FPS readout lives outside #hud and #ui so it survives every screen
    // change; it is measured off the wall clock, not the clamped frame delta.
    this._fpsEl = document.getElementById('fps');
    this._fpsAt = performance.now();
    this._frames = 0;

    this._clock = new THREE.Clock();
    this._loop = this._loop.bind(this);
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.paused = true;
      // Reset the FPS window too, or the first sample after a hidden tab is
      // measured over the whole time away.
      else { this.paused = false; this._clock.getDelta(); this._fpsAt = performance.now(); this._frames = 0; }
    });
    this.resize();
    requestAnimationFrame(this._loop);
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.size.w = w;
    this.size.h = h;
    this.renderer.setSize(w, h, false);
    if (this.camera) this._applyAspect(this.camera);
    this.game?.resize?.(w, h);
  }

  _applyAspect(cam) {
    const a = this.size.w / this.size.h;
    if (cam.isPerspectiveCamera) {
      cam.aspect = a;
    } else if (cam.isOrthographicCamera) {
      const hh = cam.userData.halfHeight ?? cam.top;
      cam.left = -hh * a; cam.right = hh * a; cam.top = hh; cam.bottom = -hh;
    }
    cam.updateProjectionMatrix();
  }

  /** Show an ambient scene while no game is mounted (the menu backdrop). */
  setIdle(builder) {
    this.unmount();
    this.idleScene = builder(this.size);
    this.scene = this.idleScene.scene;
    this.camera = this.idleScene.camera;
    this._applyAspect(this.camera);
  }

  /** Tear down whatever is mounted and start `entry` (a catalog entry + class). */
  mount(entry, GameClass) {
    this.unmount();

    this.entry = entry;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, this.size.w / this.size.h, 0.1, 500);
    this.camera.position.set(0, 6, 12);
    this.camera.lookAt(0, 0, 0);

    this.input.reset();
    this.hud.mount(entry.name, entry.controls);

    const ctx = {
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
      input: this.input,
      audio: this.audio,
      hud: this.hud,
      size: this.size,
      setCamera: (cam) => { this.camera = cam; this._applyAspect(cam); },
      end: (score, detail) => this.onEnd?.(entry, score, detail),
    };

    this.game = new GameClass(ctx);
    this.game.start();
    this.camera = this.game.camera || this.camera;
    this._applyAspect(this.camera);
    this._clock.getDelta();
    this.running = true;
  }

  unmount() {
    this.running = false;
    // The idle scene may hold window listeners (the backdrop tracks the pointer).
    try { this.idleScene?.dispose?.(); } catch (e) { console.error(e); }
    this.idleScene = null;
    if (this.game) {
      try { this.game.dispose(); } catch (e) { console.error(e); }
      this.game = null;
    }
    if (this.scene) {
      disposeObject(this.scene);
      this.scene.clear();
      this.scene = null;
    }
    this.entry = null;
    this.hud.clear();
    this.input.reset();
    this.renderer.clear();
  }

  /** Freeze updates but keep rendering (used while the results card is up). */
  freeze() { this.running = false; }

  /** Refreshes the corner readout four times a second. */
  _countFrame() {
    this._frames++;
    const now = performance.now();
    const span = now - this._fpsAt;
    if (span < 250) return;
    const fps = Math.round((this._frames * 1000) / span);
    this._frames = 0;
    this._fpsAt = now;
    if (!this._fpsEl) return;
    this._fpsEl.textContent = `${fps} FPS`;
    this._fpsEl.dataset.rate = fps >= 50 ? 'good' : fps >= 30 ? 'ok' : 'low';
  }

  _loop() {
    requestAnimationFrame(this._loop);
    const dt = Math.min(this._clock.getDelta(), 1 / 20);
    if (this.paused) return;
    this._countFrame();

    if (this.running && this.game) {
      this.game.time += dt;
      try {
        this.game.update(dt, this.game.time);
      } catch (e) {
        console.error('[game crashed]', e);
        this.running = false;
      }
      this.camera = this.game.camera || this.camera;
    }
    if (this.idleScene) this.idleScene.update(dt);
    this.input.endFrame();

    if (this.scene && this.camera) this.renderer.render(this.scene, this.camera);
  }
}
