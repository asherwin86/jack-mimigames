import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, glow, mat, labelPlane, setLabel, Burst, damp, shuffle, PALETTE,
} from '../engine/utils.js';

const HANDS = 20;
const START_CHIPS = 100;
const BETS = [5, 10, 25, 50];
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export const cardName = (c) => `${RANKS[c % 13]}${SUITS[Math.floor(c / 13)]}`;
export const cardPoints = (c) => { const r = c % 13; return r === 0 ? 11 : Math.min(10, r + 1); };

/** Best total of a hand with aces counted as 11 or 1: { total, soft }. */
export function handValue(cards) {
  let total = cards.reduce((a, c) => a + cardPoints(c), 0);
  let aces = cards.filter((c) => c % 13 === 0).length;
  while (total > 21 && aces) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
export const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;

/** What a finished hand pays, as a multiple of the bet: blackjack 1.5, win 1, push 0, loss -1. */
export function outcome(player, dealer) {
  const p = handValue(player).total;
  const d = handValue(dealer).total;
  if (p > 21) return -1;
  if (isBlackjack(player) && !isBlackjack(dealer)) return 1.5;
  if (isBlackjack(dealer) && !isBlackjack(player)) return -1;
  if (d > 21 || p > d) return 1;
  return p === d ? 0 : -1;
}

export default class Blackjack extends Game {
  start() {
    sky(this.scene, '#0f3a24', '#04140b', 30, 90);
    lights(this.scene, { sky: 0xd6ffe6, groundCol: 0x0a2416 });
    const felt = ground(70, 0x0c5a34);
    this.add(felt);

    this.board = labelPlane('', 12, 3, { size: 256, fg: '#f2f6ff', aspect: 4 });
    this.board.position.set(0, 5.5, -6);
    this.add(this.board);

    this.cardMeshes = [];
    this.burst = new Burst(this.scene, 50, 0.2);
    this.buttons = {};
    const mk = (id, text, x, z, col, w = 3.2) => {
      const b = box(w, 0.6, 1.8, glow(col, { emissiveIntensity: 0.3 }));
      b.position.set(x, 0.3, z);
      b.userData.action = id;
      this.add(b);
      const lp = labelPlane(text, w - 0.3, 1.2, { size: 128, fg: '#0a0e14', scale: 0.4, aspect: (w - 0.3) / 1.2 });
      lp.rotation.x = -Math.PI / 2;
      lp.position.set(x, 0.62, z);
      this.add(lp);
      this.buttons[id] = { mesh: b, label: lp };
    };
    BETS.forEach((v, i) => mk(`bet${v}`, `BET ${v}`, (i - 1.5) * 3.6, 3.4, PALETTE.amber));
    mk('hit', 'HIT', -4, 3.4, PALETTE.lime);
    mk('stand', 'STAND', 0, 3.4, PALETTE.red);
    mk('double', 'DOUBLE', 4, 3.4, PALETTE.violet);

    this.chips = START_CHIPS;
    this.hand = 0;
    this.deck = [];
    this.phase = 'bet';
    this.showCursor = true;
    this.player = [];
    this.dealer = [];
    this.bet = 0;
    this.after = 0;
    this.message = '';
    this.refreshButtons();
    this.camera.position.set(0, 12, 10);
    this.camera.lookAt(0, 0, 0.6);
    this.hud.hint('Pick a bet, then Hit (another card) or Stand · get closer to 21 than the dealer without going over · Double doubles your bet for one last card · blackjack pays 3 to 2 · 20 hands');
  }

  draw() {
    if (this.deck.length < 20) this.deck = shuffle(Array.from({ length: 52 * 4 }, (_, i) => i % 52));
    return this.deck.pop();
  }

  refreshButtons() {
    const bets = this.phase === 'bet';
    for (const v of BETS) this.setBtn(`bet${v}`, bets && v <= this.chips);
    this.setBtn('hit', this.phase === 'play');
    this.setBtn('stand', this.phase === 'play');
    this.setBtn('double', this.phase === 'play' && this.player.length === 2 && this.chips >= this.bet);
  }

  setBtn(id, on) {
    const b = this.buttons[id];
    b.mesh.visible = on;
    b.label.visible = on;
  }

  /** Places a bet and deals. Returns true if it was accepted. */
  placeBet(v) {
    if (this.phase !== 'bet' || v > this.chips || !BETS.includes(v)) return false;
    this.bet = v;
    this.chips -= v;
    this.player = [this.draw(), this.draw()];
    this.dealer = [this.draw(), this.draw()];
    this.phase = 'play';
    this.audio.blip(3);
    if (isBlackjack(this.player) || isBlackjack(this.dealer)) return this.settle(true), true;
    this.refreshButtons();
    this.sync();
    return true;
  }

  hit() {
    if (this.phase !== 'play') return false;
    this.player.push(this.draw());
    this.audio.blip(4);
    if (handValue(this.player).total >= 21) this.stand(); else { this.refreshButtons(); this.sync(); }
    return true;
  }

  doubleDown() {
    if (this.phase !== 'play' || this.player.length !== 2 || this.chips < this.bet) return false;
    this.chips -= this.bet;
    this.bet *= 2;
    this.player.push(this.draw());
    this.stand();
    return true;
  }

  stand() {
    if (this.phase !== 'play') return false;
    if (handValue(this.player).total <= 21) while (handValue(this.dealer).total < 17) this.dealer.push(this.draw());
    this.settle();
    return true;
  }

  settle() {
    this.phase = 'result';
    const mult = outcome(this.player, this.dealer);
    this.chips += Math.round(this.bet + this.bet * mult);
    this.message = mult > 1 ? 'BLACKJACK!' : mult > 0 ? 'YOU WIN' : mult === 0 ? 'PUSH' : handValue(this.player).total > 21 ? 'BUST' : 'DEALER WINS';
    this.audio[mult > 0 ? 'good' : mult === 0 ? 'blip' : 'bad'](...(mult === 0 ? [3] : []));
    this.hand++;
    this.after = 1.7;
    this.refreshButtons();
    this.sync();
  }

  sync() {
    for (const m of this.cardMeshes) this.scene.remove(m);
    this.cardMeshes = [];
    const showAll = this.phase === 'result';
    const put = (cards, z, hideSecond) => cards.forEach((c, i) => {
      const hidden = hideSecond && i === 1;
      const m = box(1.6, 0.08, 2.3, mat(hidden ? 0x2a4fb0 : 0xf4f4f0));
      m.position.set((i - (cards.length - 1) / 2) * 1.9, 0.3, z);
      this.cardMeshes.push(this.add(m));
      if (!hidden) {
        const red = Math.floor(c / 13) === 1 || Math.floor(c / 13) === 2;
        const lp = labelPlane(cardName(c), 1.5, 1.5, { fg: red ? '#d22b3a' : '#15151a', size: 128, scale: 0.42 });
        lp.rotation.x = -Math.PI / 2;
        lp.position.set(m.position.x, 0.36, z);
        this.cardMeshes.push(this.add(lp));
      }
    });
    put(this.dealer, -3.4, !showAll && this.phase === 'play');
    put(this.player, 0.2, false);
    const dv = this.phase === 'play' ? cardPoints(this.dealer[0]) : handValue(this.dealer).total;
    setLabel(this.board, this.dealer.length ? `Dealer ${dv}  ·  You ${handValue(this.player).total}${this.phase === 'result' ? `  ·  ${this.message}` : ''}` : '', { size: 256, fg: '#f2f6ff', scale: 0.26 });
  }

  update(dt) {
    this.burst.update(dt);
    const order = this.phase === 'result' ? [] : Object.entries(this.buttons);
    for (const [, b] of order) b.mesh.position.y = damp(b.mesh.position.y, 0.3, 12, dt);

    if (this.phase === 'result') {
      if ((this.after -= dt) <= 0) {
        if (this.hand >= HANDS || this.chips < BETS[0]) return this.finish();
        this.phase = 'bet';
        this.player = []; this.dealer = [];
        this.sync();
        this.refreshButtons();
      }
    } else {
      const keys = { Digit1: 'bet5', Digit2: 'bet10', Digit3: 'bet25', Digit4: 'bet50', KeyH: 'hit', KeyS: 'stand', KeyD: 'double' };
      let action = null;
      for (const [k, a] of Object.entries(keys)) if (this.input.hit(k)) action = a;
      if (this.input.gpHit(0)) action = this.phase === 'play' ? 'hit' : action;
      if (this.input.gpHit(1)) action = this.phase === 'play' ? 'stand' : action;
      if (this.input.gpHit(2)) action = this.phase === 'play' ? 'double' : action;
      if (!action && this.input.clicked) {
        const hit = this.pickAt(Object.values(this.buttons).filter((b) => b.mesh.visible).map((b) => b.mesh));
        if (hit) action = hit.object.userData.action;
      }
      if (action) this.act(action);
    }
    this.hud.stat('Chips', this.chips);
    this.hud.stat('Hand', `${Math.min(this.hand + 1, HANDS)}/${HANDS}`);
    this.hud.stat('Bet', this.bet || '—');
  }

  act(a) {
    if (a.startsWith('bet')) this.placeBet(+a.slice(3));
    else if (a === 'hit') this.hit();
    else if (a === 'stand') this.stand();
    else if (a === 'double') this.doubleDown();
  }

  finish() {
    this.audio[this.chips >= START_CHIPS ? 'win' : 'lose']();
    this.end(this.chips, `You left with ${this.chips} chips after ${this.hand} hand${this.hand === 1 ? '' : 's'}.`);
  }
}
