import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, glow, mat, labelPlane, setLabel, Burst, damp, rand, PALETTE,
} from '../engine/utils.js';

const TARGET = 100;
const YOU = 1;
const BOT = 2;

/** When the bot banks its turn total. Higher levels are greedier and read the score. */
export function botHolds(level, botTotal, turn, youTotal) {
  if (botTotal + turn >= TARGET) return true;
  let limit = [12, 16, 20, 22, 25][Math.min(4, level)];
  if (youTotal >= 80 || (level >= 2 && youTotal - botTotal > 25)) limit = Math.max(limit, 30);   // behind: take more risk
  return turn >= limit;
}

export default class PigDice extends Game {
  start() {
    sky(this.scene, '#3a1f2a', '#0e050a', 30, 90);
    lights(this.scene, { sky: 0xffd6e4, groundCol: 0x2a0f1a });
    this.add(ground(70, 0x1a0a10));
    this.die = this.add(box(2.4, 2.4, 2.4, mat(0xf4f0ea, { roughness: 0.3 })));
    this.die.position.set(0, 1.5, 0);
    this.face = labelPlane('', 2.2, 2.2, { fg: '#15151a', size: 128, scale: 0.8 });
    this.face.position.set(0, 0, 1.22);
    this.die.add(this.face);
    this.turnLabel = labelPlane('', 12, 2.2, { fg: '#ffe6a8', size: 128, scale: 0.5, aspect: 12 / 2.2 });
    this.turnLabel.position.set(0, 4.6, -2);
    this.add(this.turnLabel);

    this.buttons = {};
    const mk = (id, text, x, col) => {
      const b = box(4.2, 0.7, 2, glow(col, { emissiveIntensity: 0.3 }));
      b.position.set(x, 0.35, 3.6);
      b.userData.action = id;
      this.add(b);
      const lp = labelPlane(text, 3.8, 1.4, { fg: '#0a0e14', size: 128, scale: 0.5, aspect: 3.8 / 1.4 });
      lp.rotation.x = -Math.PI / 2;
      lp.position.set(x, 0.72, 3.6);
      this.add(lp);
      this.buttons[id] = b;
    };
    mk('roll', 'ROLL', -3, PALETTE.lime);
    mk('hold', 'HOLD', 3, PALETTE.amber);

    this.burst = new Burst(this.scene, 40, 0.2);
    this.scores = { [YOU]: 0, [BOT]: 0 };
    this.turnTotal = 0;
    this.turn = YOU;
    this.wins = 0;
    this.level = 0;
    this.rolling = null;
    this.wait = 0;
    this.result = null;
    this.after = 0;
    this.showCursor = true;
    this.paintTurn();
    this.camera.position.set(0, 10, 12);
    this.camera.lookAt(0, 1.2, 1);
    this.hud.hint('Roll the die and keep adding · HOLD banks your turn total · roll a 1 and you lose it all · first to 100 wins · win to face a greedier bot (R / A to roll, H / B to hold)');
  }

  paintTurn() {
    setLabel(this.turnLabel, this.result ? (this.result === 'win' ? 'YOU WIN!' : this.result === 'loss' ? 'BOT WINS' : '') : `${this.turn === YOU ? 'Your' : "Bot's"} turn · ${this.turnTotal} at risk`, { fg: '#ffe6a8', size: 128, scale: 0.5 });
  }

  /** Applies a die value to the player whose turn it is. */
  applyRoll(v) {
    if (this.result) return;
    if (v === 1) {
      this.hud.toast(this.turn === YOU ? 'ROLLED A 1 · turn lost' : 'BOT ROLLED A 1', 900);
      this.audio.bad();
      this.turnTotal = 0;
      this.endTurn();
    } else {
      this.turnTotal += v;
      this.audio.blip(v + 2);
      this.wait = rand(0.5, 0.8);
    }
    this.paintTurn();
  }

  /** Banks the turn total. Returns true if it did something. */
  hold() {
    if (this.result || this.rolling || !this.turnTotal) return false;
    this.scores[this.turn] += this.turnTotal;
    this.audio.good();
    this.turnTotal = 0;
    if (this.scores[this.turn] >= TARGET) {
      this.result = this.turn === YOU ? 'win' : 'loss';
      this.after = 1.6;
      this.burst.burst(new THREE.Vector3(0, 2, 0), this.turn === YOU ? PALETTE.lime : PALETTE.red, 24, 9);
    } else this.endTurn();
    this.paintTurn();
    return true;
  }

  endTurn() {
    this.turnTotal = 0;
    this.turn = this.turn === YOU ? BOT : YOU;
    this.wait = rand(0.7, 1.1);
  }

  startRoll() {
    if (this.result || this.rolling) return false;
    this.rolling = { t: 0.55, value: 1 + Math.floor(Math.random() * 6) };
    return true;
  }

  update(dt) {
    this.burst.update(dt);
    this.buttons.roll.visible = this.buttons.hold.visible = true;
    if (this.rolling) {
      this.rolling.t -= dt;
      this.die.rotation.x += dt * 14;
      this.die.rotation.y += dt * 11;
      setLabel(this.face, String(1 + Math.floor(Math.random() * 6)), { fg: '#15151a', size: 128, scale: 0.8 });
      if (this.rolling.t <= 0) {
        const v = this.rolling.value;
        this.rolling = null;
        this.die.rotation.set(0.3, 0.4, 0);
        setLabel(this.face, String(v), { fg: '#15151a', size: 128, scale: 0.8 });
        this.applyRoll(v);
      }
    } else {
      this.die.rotation.x = damp(this.die.rotation.x, 0, 8, dt);
      this.die.rotation.y = damp(this.die.rotation.y, 0, 8, dt);
    }

    if (!this.result && !this.rolling) {
      if (this.turn === YOU) {
        let action = null;
        if (this.input.hit('KeyR', 'Space') || this.input.gpHit(0)) action = 'roll';
        if (this.input.hit('KeyH') || this.input.gpHit(1)) action = 'hold';
        if (!action && this.input.clicked) {
          const hit = this.pickAt([...Object.values(this.buttons), this.die]);
          if (hit) action = hit.object === this.die ? 'roll' : hit.object.userData.action;
        }
        if (action === 'roll') this.startRoll(); else if (action === 'hold') this.hold();
      } else if ((this.wait -= dt) <= 0) {
        if (this.turnTotal > 0 && botHolds(this.level, this.scores[BOT], this.turnTotal, this.scores[YOU])) this.hold();
        else this.startRoll();
      }
    } else if (this.result && (this.after -= dt) <= 0) {
      if (this.result === 'win') {
        this.wins++;
        this.level++;
        this.scores = { [YOU]: 0, [BOT]: 0 };
        this.turnTotal = 0;
        this.turn = YOU;
        this.result = null;
        this.paintTurn();
      } else return this.finish();
    }
    for (const b of Object.values(this.buttons)) b.material.emissiveIntensity = this.turn === YOU && !this.result ? 0.4 : 0.05;
    this.hud.stat('You', this.scores[YOU]);
    this.hud.stat('Bot', this.scores[BOT]);
    this.hud.stat('This turn', this.turnTotal);
    this.hud.stat('Wins', this.wins);
  }

  finish() {
    this.audio.lose();
    this.end(this.wins, `${this.wins} win${this.wins === 1 ? '' : 's'} before the bot reached 100 first.`);
  }
}
