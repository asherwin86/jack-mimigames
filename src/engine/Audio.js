/** Tiny WebAudio blip synth — no assets, no loading, works everywhere. */
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('mg.muted') === '1';
  }

  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setMuted(m) {
    this.muted = m;
    localStorage.setItem('mg.muted', m ? '1' : '0');
  }

  /** A single shaped tone. freq may be [from, to] to sweep. */
  tone(freq = 440, dur = 0.12, { type = 'square', gain = 0.14, delay = 0 } = {}) {
    if (this.muted) return;
    const ctx = this._ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    const [f0, f1] = Array.isArray(freq) ? freq : [freq, freq];
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Filtered noise burst — impacts, explosions, whooshes. */
  noise(dur = 0.18, { gain = 0.16, cutoff = 1400, sweep = 0.3 } = {}) {
    if (this.muted) return;
    const ctx = this._ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(cutoff, t0);
    filt.frequency.exponentialRampToValueAtTime(Math.max(60, cutoff * sweep), t0 + dur);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t0);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt).connect(amp).connect(ctx.destination);
    src.start(t0);
  }

  blip(n = 0) { this.tone(440 * Math.pow(2, n / 12), 0.08, { type: 'square', gain: 0.1 }); }
  pickup() { this.tone([620, 1180], 0.11, { type: 'triangle', gain: 0.16 }); }
  good() { [0, 4, 7].forEach((s, i) => this.tone(440 * Math.pow(2, s / 12), 0.13, { type: 'triangle', delay: i * 0.07, gain: 0.14 })); }
  bad() { this.tone([220, 70], 0.3, { type: 'sawtooth', gain: 0.16 }); }
  thud() { this.noise(0.14, { gain: 0.18, cutoff: 700 }); }
  boom() { this.noise(0.42, { gain: 0.24, cutoff: 900, sweep: 0.08 }); }
  win() { [0, 4, 7, 12].forEach((s, i) => this.tone(523.25 * Math.pow(2, s / 12), 0.18, { type: 'triangle', delay: i * 0.1, gain: 0.15 })); }
  lose() { [0, -3, -7].forEach((s, i) => this.tone(392 * Math.pow(2, s / 12), 0.26, { type: 'sawtooth', delay: i * 0.13, gain: 0.13 })); }
}
