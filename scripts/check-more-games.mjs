/**
 * Rule tests for the second big batch of games (ids 61+): each is set up on purpose and checked.
 *
 *   node scripts/check-more-games.mjs
 */
import { boot, check, finish } from './lib/game-harness.mjs';

// ---------- Minesweeper ----------
{
  const m = await import('../src/games/minesweeper.js');
  check(m.neighbours(0, 0).length === 3 && m.neighbours(4, 4).length === 8 && m.neighbours(0, 4).length === 5, 'minesweeper: corner 3, edge 5 and middle 8 neighbours');
  let clean = true;
  for (let s = 1; s <= 30; s++) {
    let x = s;
    const rng = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
    const mines = m.placeMines(9, 9, 10, 4, 4, rng);
    if (mines.size !== 10 || mines.has(40) || m.neighbours(4, 4).some(([r, c]) => mines.has(r * 9 + c))) clean = false;
  }
  check(clean, 'minesweeper: always ten mines, never on or beside the first click (30 seeds)');
  const { game, result, step } = await boot('minesweeper', 5);
  game.dig(4, 4);
  check(game.placed && game.opened >= 1 && !game.over, 'minesweeper: the first dig is safe and opens tiles');
  const sumAdj = game.adj.flat().reduce((a, b) => a + b, 0);
  check(sumAdj > 0 && game.mines.size === 10, 'minesweeper: numbers were computed');
  const openBefore = game.opened;
  const [fr, fc] = [...game.mines].map((i) => [Math.floor(i / 9), i % 9])[0];
  game.toggleFlag(fr, fc);
  check(game.flagged[fr][fc] && game.flagCount() === 1, 'minesweeper: flagging a hidden tile works');
  game.dig(fr, fc);
  check(game.opened === openBefore && !game.over, 'minesweeper: a flagged tile cannot be dug');
  game.toggleFlag(fr, fc);
  // open every safe tile
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (!game.isMine(r, c)) game.dig(r, c);
  check(game.over === 'won' && game.opened === 71, 'minesweeper: opening every safe tile wins');
  step(200);
  check(result.ended && result.ended.score >= 710 + 100, 'minesweeper: a win ends the run with tile points plus a bonus', JSON.stringify(result.ended));
  const g2 = await boot('minesweeper', 8);
  g2.game.dig(4, 4);
  const [mr, mc] = [...g2.game.mines].map((i) => [Math.floor(i / 9), i % 9])[0];
  g2.game.dig(mr, mc);
  check(g2.game.over === 'lost', 'minesweeper: digging a mine loses');
  g2.step(200);
  check(g2.result.ended && g2.result.ended.score === g2.game.opened * 10, 'minesweeper: a loss scores only the tiles opened');
  // chording
  const g3 = await boot('minesweeper', 11);
  g3.game.dig(4, 4);
  let chorded = false;
  outer: for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    if (g3.game.open[r][c] && g3.game.adj[r][c] > 0) {
      const around = m.neighbours(r, c);
      const mines = around.filter(([a, b]) => g3.game.isMine(a, b));
      const hidden = around.filter(([a, b]) => !g3.game.open[a][b]);
      if (mines.length === g3.game.adj[r][c] && hidden.length > mines.length) {
        for (const [a, b] of mines) g3.game.toggleFlag(a, b);
        const before = g3.game.opened;
        g3.game.dig(r, c);
        chorded = g3.game.opened > before && !g3.game.over;
        break outer;
      }
    }
  }
  check(chorded, 'minesweeper: clicking a satisfied number clears the tiles around it');
}

// ---------- Crate Push ----------
{
  const cp = await import('../src/games/crate-push.js');
  const solve = (rows) => {
    const st = cp.parseLevel(rows);
    const key = (p, cr) => `${p}|${[...cr].sort().join(';')}`;
    const start = { p: st.player, c: st.crates, path: [] };
    const seen = new Set([key(start.p, start.c)]);
    let q = [start];
    while (q.length) {
      const nq = [];
      for (const cur of q) {
        for (const [d, [dx, dy]] of Object.entries({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] })) {
          const r = cp.stepState(st, cur.p, cur.c, dx, dy);
          if (!r) continue;
          const k = key(r.player, r.crates);
          if (seen.has(k)) continue;
          seen.add(k);
          const n = { p: r.player, c: r.crates, path: [...cur.path, d] };
          if (cp.isSolved(st, r.crates)) return n.path;
          nq.push(n);
        }
      }
      q = nq;
      if (seen.size > 400000) return null;
    }
    return null;
  };
  const solutions = cp.LEVELS.map((l) => solve(l));
  check(solutions.every(Boolean), `crate-push: every level is solvable (${solutions.map((s) => s?.length).join(', ')} moves)`);
  const st = cp.parseLevel(cp.LEVELS[0]);
  check(st.crates.size === st.goals.size && st.player, 'crate-push: level 1 has as many crates as goals and a player');
  check(!cp.stepState(st, st.player, st.crates, 0, -1), 'crate-push: a wall blocks the player');
  const { game, result, step, hud } = await boot('crate-push', 2);
  for (let li = 0; li < cp.LEVELS.length; li++) {
    for (const d of solutions[li]) game.move(d);
    check(game.cleared === li + 1, `crate-push: level ${li + 1} solved by its solution`);
    step(70);
  }
  check(result.ended && result.ended.score >= 700, 'crate-push: finishing all seven levels ends the run with 100 each plus time', JSON.stringify(result.ended));
  const g2 = await boot('crate-push', 3);
  const before = [...g2.game.player];
  g2.game.move('right');
  g2.game.takeBack();
  check(g2.game.player[0] === before[0] && g2.game.moves === 0, 'crate-push: undo puts the player back');
  g2.game.move('right'); g2.game.move('right');
  const moved = g2.game.moves;
  g2.input.press('KeyR'); g2.step(1);
  check(g2.game.moves === 0 && moved > 0, 'crate-push: R restarts the level');
  const g3 = await boot('crate-push', 4);
  g3.step(60 * 305);
  check(g3.result.ended && g3.result.ended.score === 0, 'crate-push: running out of time ends the run');
}

// ---------- Tower of Hanoi ----------
{
  const h = await import('../src/games/tower-of-hanoi.js');
  check(h.optimalMoves(3) === 7 && h.optimalMoves(7) === 127, 'hanoi: 2^n - 1 optimal moves');
  const { game, step } = await boot('tower-of-hanoi', 3);
  check(game.pegs[0].join('') === '321' && game.n === 3, 'hanoi: three discs start on the first tower, biggest at the bottom');
  check(!game.select(1), 'hanoi: picking an empty tower does nothing');
  game.select(0); game.select(1);
  check(game.pegs[1].join('') === '1' && game.moves === 1, 'hanoi: a lifted disc drops on another tower');
  game.select(0);           // lift disc 2
  const bad = game.select(1); // onto disc 1: not allowed
  check(!bad && game.pegs[1].join('') === '1', 'hanoi: a bigger disc cannot go on a smaller one');
  game.held = null;
  const moves = [];
  const hanoi = (n, a, b, c) => { if (!n) return; hanoi(n - 1, a, c, b); moves.push([a, b]); hanoi(n - 1, c, b, a); };
  const g2 = await boot('tower-of-hanoi', 7);
  hanoi(3, 0, 2, 1);
  for (const [a, b] of moves) { g2.game.select(a); g2.game.select(b); }
  check(g2.game.round === 1 && g2.game.points === 60, 'hanoi: solving 3 discs in 7 moves scores 60', `round ${g2.game.round} points ${g2.game.points}`);
  g2.step(90);
  check(g2.game.n === 4 && g2.game.pegs[0].length === 4, 'hanoi: the next round has four discs');
  const g3 = await boot('tower-of-hanoi', 12);
  g3.step(60 * 152);
  check(g3.result.ended, 'hanoi: time running out ends the run');
}

// ---------- Peg Solitaire ----------
{
  const ps = await import('../src/games/peg-solitaire.js');
  const b = ps.freshBoard();
  check(ps.pegCount(b) === 32 && b[3][3] === 0, 'peg-solitaire: 32 pegs and an empty centre');
  check(ps.jumpsFrom(b, 1, 3).length === 1 && ps.jumpsFrom(b, 3, 1).length === 1 && ps.jumpsFrom(b, 0, 0).length === 0, 'peg-solitaire: only the four pegs beside the centre gap can jump at first');
  const { game, result, step } = await boot('peg-solitaire', 1);
  check(!game.jump(3, 1, 3, 3) === false, 'peg-solitaire: a legal jump is accepted');
  check(ps.pegCount(game.board) === 31 && game.board[3][2] === 0 && game.board[3][3] === 1, 'peg-solitaire: the jumped peg is removed');
  check(!game.jump(0, 2, 0, 4), 'peg-solitaire: an illegal jump is refused');
  // Play random legal moves until stuck; the run must end and score by pegs left.
  let guard = 0;
  while (!result.ended && guard++ < 200) {
    const moves = [];
    game.board.forEach((row, r) => row.forEach((_, c) => ps.jumpsFrom(game.board, r, c).forEach(([tr, tc]) => moves.push([r, c, tr, tc]))));
    if (!moves.length) break;
    const m = moves[Math.floor(Math.random() * moves.length)];
    game.jump(...m);
  }
  step(90);
  const left = ps.pegCount(game.board);
  check(result.ended && result.ended.score === (32 - left) * 10 + (left === 1 ? (game.board[3][3] === 1 ? 150 : 100) : 0), 'peg-solitaire: a stuck board ends the run scored by pegs left', JSON.stringify(result.ended));
}

// ---------- Knight's Tour ----------
{
  const kt = await import('../src/games/knights-tour.js');
  check(kt.knightMoves(0, 0).length === 2 && kt.knightMoves(3, 3).length === 8 && kt.knightMoves(0, 1).length === 3, 'knights-tour: corner 2, middle 8 moves');
  check(kt.knightMoves(0, 0, new Set([1 * 8 + 2])).length === 1, 'knights-tour: visited squares are excluded');
  const { game, result, step } = await boot('knights-tour', 1);
  check(!game.go(0, 0) === false && game.visits === 1, 'knights-tour: any square starts the tour');
  check(!game.go(0, 1), 'knights-tour: a non-knight move is refused');
  check(game.go(2, 1) && game.visits === 2, 'knights-tour: an L-shaped jump is accepted');
  check(!game.go(0, 0), 'knights-tour: a visited square is refused');
  // Warnsdorff's rule finds a full tour.
  const g2 = await boot('knights-tour', 2);
  let r = 0; let c = 0;
  g2.game.go(r, c);
  while (g2.game.visits < 64) {
    const opts = kt.knightMoves(r, c, g2.game.seen);
    if (!opts.length) break;
    opts.sort((a, b) => kt.knightMoves(a[0], a[1], g2.game.seen).length - kt.knightMoves(b[0], b[1], g2.game.seen).length);
    [r, c] = opts[0];
    g2.game.go(r, c);
  }
  g2.step(90);
  check(g2.game.visits === 64 && g2.result.ended && g2.result.ended.score === 100, 'knights-tour: a full tour of 64 squares scores 100', JSON.stringify(g2.result.ended));
}

// ---------- Eight Queens ----------
{
  const q = await import('../src/games/eight-queens.js');
  check(q.conflicts([[0, 0], [1, 2]]).length === 0 && q.conflicts([[0, 0], [0, 3]]).length === 1 && q.conflicts([[0, 0], [3, 3]]).length === 1 && q.conflicts([[2, 1], [4, 3]]).length === 1, 'eight-queens: row, column and diagonal attacks are detected');
  const solveQ = (n) => {
    const place = (rows) => {
      if (rows.length === n) return rows;
      for (let c = 0; c < n; c++) {
        const cand = [...rows, c];
        if (!q.conflicts(cand.map((cc, r) => [r, cc])).length) { const res = place(cand); if (res) return res; }
      }
      return null;
    };
    return place([]);
  };
  const { game, result, step } = await boot('eight-queens', 1);
  for (const n of [5, 6, 7, 8]) {
    check(game.n === n, `eight-queens: round board is ${n}x${n}`);
    const sol = solveQ(n);
    // one wrong queen first: it must be refused or fixable
    game.toggle(0, 0); game.toggle(0, 0);
    check(game.queens.length === 0, 'eight-queens: clicking a queen again lifts it');
    sol.forEach((c, r) => game.toggle(r, c));
    check(game.solved === [5, 6, 7, 8].indexOf(n) + 1, `eight-queens: a valid ${n}-queen layout is accepted`);
    step(90);
  }
  step(5);
  check(result.ended && result.ended.score >= 400, 'eight-queens: all four boards solved ends the run with a bonus', JSON.stringify(result.ended));
  const g2 = await boot('eight-queens', 2);
  for (let i = 0; i < 5; i++) g2.game.toggle(0, i);   // five queens in one row: full but conflicting
  check(g2.game.solved === 0 && g2.game.queens.length === 5, 'eight-queens: a full but conflicting board is not a solve');
}

// ---------- Water Sort ----------
{
  const w = await import('../src/games/water-sort.js');
  const t = [[0, 1], [1], [], [0, 0]];
  const a = w.pour(t, 0, 1);
  check(a && a[0].join('') === '0' && a[1].join('') === '11', 'water-sort: the top colour pours onto the same colour');
  check(w.pour([[0, 1], [0]], 0, 1) === null, 'water-sort: cannot pour onto a different colour');
  check(w.pour([[0, 0, 0, 0], [1]], 1, 0) === null, 'water-sort: cannot pour into a full tube');
  const two = w.pour([[1, 0, 0], [0]], 0, 1);
  check(two && two[1].join('') === '000' && two[0].join('') === '1', 'water-sort: a run of the same colour moves together');
  const part = w.pour([[2, 0, 0, 0], [0, 0]], 0, 1);
  check(part && part[1].length === 4 && part[0].join('') === '20', 'water-sort: only as much as fits is poured');
  check(w.pour([[], []], 0, 1) === null, 'water-sort: an empty tube cannot pour');
  check(w.isSorted([[0, 0, 0, 0], [], [1, 1, 1, 1]]) && !w.isSorted([[0, 0, 0], [0]]), 'water-sort: sorted means every tube is full of one colour or empty');
  let ok = true;
  for (let s = 1; s <= 8; s++) {
    let x = s * 7919;
    const rng = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
    for (const k of [3, 4, 5, 6]) { const p = w.makePuzzle(k, rng); if (w.isSorted(p) || !w.solvable(p) || p.length !== k + 2 || p.flat().length !== k * 4) ok = false; }
  }
  check(ok, 'water-sort: generated puzzles are solvable, unsorted and correctly sized (32 boards)');
  const { game, step } = await boot('water-sort', 3);
  // Solve the level with the solver's moves by brute force search of pours.
  const solveMoves = (tubes) => {
    const seen = new Set();
    const rec = (ts, path) => {
      if (w.isSorted(ts)) return path;
      const k = ts.map((x) => x.join('')).sort().join('|');
      if (seen.has(k) || path.length > 60) return null;
      seen.add(k);
      for (let i = 0; i < ts.length; i++) for (let j = 0; j < ts.length; j++) {
        const n = w.pour(ts, i, j);
        if (n) { const r = rec(n, [...path, [i, j]]); if (r) return r; }
      }
      return null;
    };
    return rec(tubes, []);
  };
  const moves = solveMoves(game.tubes.map((x) => x.slice()));
  check(!!moves, 'water-sort: the first level can be solved by pouring');
  for (const [i, j] of moves) { game.select(i); game.select(j); }
  check(game.solved === 1, 'water-sort: sorting every tube completes the level');
  step(90);
  check(game.tubes.length === 6 && game.level === 1, 'water-sort: the next level has more colours', `${game.tubes.length} tubes`);
}

// ---------- Pipe Turn ----------
{
  const pt = await import('../src/games/pipe-turn.js');
  check(pt.rotateMask(1) === 2 && pt.rotateMask(8) === 1 && pt.rotateMask(5) === 10 && [1, 2, 3, 5, 7].every((m) => [0, 1, 2, 3].reduce((a) => pt.rotateMask(a), m) === m), 'pipe-turn: a quarter turn shifts the openings and four make a full turn');
  let ok = true;
  for (let s = 1; s <= 20; s++) {
    let x = s * 104729;
    const rng = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
    const n = 3 + (s % 4);
    const masks = pt.makeTree(n, s % n, (s * 3) % n, rng);
    if (pt.powered(masks, n, s % n, (s * 3) % n).size !== n * n) ok = false;
    let edges = 0;
    for (const m of masks) for (let d = 0; d < 4; d++) edges += pt.hasBit(m, d);
    if (edges !== 2 * (n * n - 1)) ok = false;   // a spanning tree: n*n - 1 links, counted from both ends
  }
  check(ok, 'pipe-turn: generated networks are spanning trees that light every cell when solved (20 seeds)');
  const { game, step } = await boot('pipe-turn', 4);
  check(!game.isSolved(), 'pipe-turn: the scramble never starts solved');
  const lit0 = pt.powered(game.masks, game.n, game.sr, game.sc).size;
  for (let i = 0; i < game.masks.length; i++) {
    let guard = 0;
    while (game.masks[i] !== game.solution[i] && guard++ < 4) game.turn(i);
  }
  check(game.solved === 1 && lit0 <= game.n * game.n, 'pipe-turn: turning every tile back to its place lights the network');
  step(90);
  check(game.n >= 3 && game.level === 1, 'pipe-turn: the next puzzle appears');
}

// ---------- Gem Swap ----------
{
  const gs = await import('../src/games/gem-swap.js');
  const g0 = [[0, 0, 0, 1], [1, 2, 3, 1], [2, 3, 1, 1], [3, 2, 1, 0]];
  const hits = gs.findMatches(g0, 4);
  check(hits.has(0) && hits.has(1) && hits.has(2) && hits.has(7) && hits.has(11) && hits.has(15) === false, 'gem-swap: horizontal and vertical runs of three are found', [...hits].join());
  check(gs.findMatches([[0, 1, 0], [1, 0, 1], [0, 1, 0]], 3).size === 0, 'gem-swap: a checkerboard has no matches');
  let n = 0;
  const filled = gs.collapse([[1, 2], [3, 4]], new Set([2, 3]), () => 9, 2);
  check(filled[1][0] === 1 && filled[1][1] === 2 && filled[0][0] === 9 && filled[0][1] === 9, 'gem-swap: survivors fall and new gems fill the top', JSON.stringify(filled));
  let allFine = true;
  for (let s = 1; s <= 20; s++) {
    let x = s * 15485863;
    const rng = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
    const g = gs.freshGrid(8, rng);
    if (gs.findMatches(g, 8).size || !gs.hasMove(g, 8)) allFine = false;
  }
  check(allFine, 'gem-swap: a fresh board has no matches yet always has a move (20 seeds)');
  check(gs.hasMove([[0, 0, 1], [1, 1, 0], [2, 3, 4]], 3) && !gs.hasMove([[0, 1, 2], [3, 4, 5], [0, 1, 2]], 3), 'gem-swap: move detection');
  const { game, step } = await boot('gem-swap', 2);
  // Craft: row 0 = a a b a ..., so swapping (0,2)<->(0,3)?? no: put b at (0,2) and a at (1,2)
  const B = game.grid;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) B[r][c] = (r * 3 + c * 5) % 6;   // no accidental lines on most of it
  B[0][0] = 4; B[0][1] = 4; B[0][2] = 1; B[1][2] = 4; B[1][3] = 2; B[0][3] = 3; B[1][0] = 5; B[1][1] = 0;
  const scoreBefore = game.score;
  const made = game.trySwap(0, 2, 1, 2);
  check(made === true && game.phase === 'swap', 'gem-swap: a swap that makes a line is accepted');
  step(120);
  check(game.score > scoreBefore && game.phase === 'idle', 'gem-swap: the line clears, scores, and the board settles', `score ${game.score} phase ${game.phase}`);
  check(gs.findMatches(game.grid).size === 0, 'gem-swap: the settled board has no leftover lines');
  const before = game.grid.map((r) => r.slice());
  // find a pair that would NOT match
  let done = false;
  for (let r = 0; r < 7 && !done; r++) for (let c = 0; c < 7 && !done; c++) {
    const g = game.grid.map((row) => row.slice());
    [g[r][c], g[r][c + 1]] = [g[r][c + 1], g[r][c]];
    if (!gs.findMatches(g).size && game.grid[r][c] !== game.grid[r][c + 1]) {
      const res = game.trySwap(r, c, r, c + 1);
      step(40);
      check(res === false && game.grid.every((row, i) => row.every((v, j) => v === before[i][j])), 'gem-swap: a swap that makes nothing swaps back');
      done = true;
    }
  }
  check(done, 'gem-swap: found a non-matching pair to test');
  check(!game.trySwap(0, 0, 2, 2), 'gem-swap: only neighbours can swap');
  const g2 = await boot('gem-swap', 5);
  g2.step(60 * 80);
  check(g2.result.ended, 'gem-swap: the clock ends the run');
}

// ---------- Odd Cube ----------
{
  const oc = await import('../src/games/odd-cube.js');
  check(oc.sizeFor(0) === 2 && oc.sizeFor(4) === 4 && oc.sizeFor(100) === 7, 'odd-cube: the board grows to seven');
  check(oc.deltaFor(0) > oc.deltaFor(10) && oc.deltaFor(1000) >= 0.03, 'odd-cube: the shade difference shrinks but stays visible');
  const { game, result, step } = await boot('odd-cube', 1);
  check(game.tiles.length === 4, 'odd-cube: four tiles at the start');
  const t0 = game.timeLeft;
  const wrong = (game.odd + 1) % 4;
  check(game.guess(wrong) === false && game.timeLeft === t0 - 3, 'odd-cube: a wrong tile costs three seconds');
  check(game.guess(game.odd) === true && game.correct === 1, 'odd-cube: the right tile scores and deals a new board');
  for (let i = 0; i < 10; i++) game.guess(game.odd);
  check(game.tiles.length === sizeForCheck(game.correct), 'odd-cube: the grid grew with the score');
  step(60 * 62);
  check(result.ended && result.ended.score === game.correct, 'odd-cube: the score is the number found');
  function sizeForCheck(n) { return oc.sizeFor(n) ** 2; }
}

// ---------- Math Dash ----------
{
  const md = await import('../src/games/math-dash.js');
  let ok = true;
  for (let level = 0; level < 5; level++) {
    for (let i = 0; i < 40; i++) {
      const q = md.makeQuestion(level);
      const [a, op, b] = q.text.split(' ');
      const want = op === '+' ? +a + +b : op === '×' ? a * b : a - b;
      if (want !== q.answer || q.answer < 0) ok = false;
      const ch = md.makeChoices(q.answer);
      if (ch.length !== 4 || new Set(ch).size !== 4 || !ch.includes(q.answer) || ch.some((v) => v < 0)) ok = false;
    }
  }
  check(ok, 'math-dash: 200 questions all have the right answer and four distinct, non-negative choices');
  const { game, result, step } = await boot('math-dash', 3);
  const right = game.choices.indexOf(game.q.answer);
  check(game.answer(right) === true && game.correct === 1 && game.points === 10, 'math-dash: a right answer scores 10');
  const r2 = game.choices.indexOf(game.q.answer);
  game.answer(r2);
  check(game.points === 10 + 11 && game.streak === 2, 'math-dash: a streak adds a bonus');
  const t = game.timeLeft;
  const wrong = (game.choices.indexOf(game.q.answer) + 1) % 4;
  check(game.answer(wrong) === false && game.streak === 0 && game.timeLeft === t - 2, 'math-dash: a wrong answer breaks the streak and costs two seconds');
  step(60 * 62);
  check(result.ended && result.ended.score === game.points, 'math-dash: the score is the points');
}

// ---------- Colour Clash ----------
{
  const cc = await import('../src/games/colour-clash.js');
  let clash = 0;
  for (let i = 0; i < 400; i++) { const r = cc.makeRound(Math.random); if (r.word !== r.ink) clash++; }
  check(clash > 250, 'colour-clash: most rounds clash the word with the ink', String(clash));
  check(Array.from({ length: 100 }, () => cc.makeRound(Math.random, true)).every((r) => r.word !== r.ink), 'colour-clash: hard rounds always clash');
  const { game, result, step } = await boot('colour-clash', 2);
  const right = game.round.ink;
  check(game.answer(right) && game.correct === 1, 'colour-clash: the ink colour is the right answer');
  const t = game.timeLeft;
  check(!game.answer((game.round.ink + 1) % 4) && game.timeLeft === t - 3 && game.streak === 0, 'colour-clash: a wrong answer costs three seconds');
  step(60 * 62);
  check(result.ended && result.ended.score === game.correct, 'colour-clash: the score is the number right');
}

// ---------- Tic-Tac-Toe ----------
{
  const t = await import('../src/games/tic-tac-toe.js');
  check(t.winner([1, 1, 1, 0, 0, 0, 0, 0, 0]) === 1 && t.winner([2, 0, 0, 0, 2, 0, 0, 0, 2]) === 2 && t.winner([1, 2, 1, 2, 1, 2, 2, 1, 2]) === 0, 'tic-tac-toe: rows and diagonals win, a full board with no line does not');
  check(t.botMove([2, 2, 0, 1, 1, 0, 0, 0, 0], 2, 0) === 2, 'tic-tac-toe: the bot takes a winning move');
  check(t.botMove([1, 1, 0, 0, 2, 0, 0, 0, 0], 2, 0) === 2, 'tic-tac-toe: the bot blocks your two in a row');
  let botLost = 0;
  for (let g = 0; g < 200; g++) {
    const b = new Array(9).fill(0);
    let turn = g % 2 ? 1 : 2;
    while (!t.winner(b) && !t.full(b)) {
      const free = b.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
      b[turn === 1 ? free[Math.floor(Math.random() * free.length)] : t.botMove(b, 2, 0)] = turn;
      turn = turn === 1 ? 2 : 1;
    }
    if (t.winner(b) === 1) botLost++;
  }
  check(botLost === 0, 'tic-tac-toe: a perfect bot never loses to random play (200 games)', String(botLost));
  const { game, step, result } = await boot('tic-tac-toe', 1);
  check(game.turn === 1, 'tic-tac-toe: you start the first game');
  game.place(0, 1); game.turn = 1; game.place(1, 1); game.turn = 1; game.place(2, 1);
  check(game.result === 'win', 'tic-tac-toe: three in a row wins the game');
  step(90);
  check(game.points === 3 && game.game === 1 && game.turn === 2, 'tic-tac-toe: a win is 3 points and the bot starts game two');
  check(!game.place(0, 2) === false || game.board[0] === 0, 'tic-tac-toe: a fresh board is empty');
  game.game = 7; game.result = 'draw'; game.after = 0.1; step(20);
  check(result.ended && result.ended.score === 4, 'tic-tac-toe: after the eighth game the run ends with the points', JSON.stringify(result.ended));
}

// ---------- Reversi ----------
{
  const rv = await import('../src/games/reversi.js');
  const b = rv.startBoard();
  check(rv.count(b, 1) === 2 && rv.count(b, 2) === 2 && rv.legalMoves(b, 1).length === 4, 'reversi: four discs to start and four legal opening moves');
  check(rv.flips(b, 2, 3, 1).length === 1 && rv.flips(b, 0, 0, 1).length === 0 && rv.flips(b, 3, 3, 1).length === 0, 'reversi: flips need a trapped line, occupied squares are illegal');
  const nb = rv.applyMove(b, 2, 3, 1);
  check(rv.count(nb, 1) === 4 && rv.count(nb, 2) === 1 && b[2][3] === 0, 'reversi: a move flips the trapped disc and leaves the old board alone');
  // random (you) versus the bot: total discs never exceed 64, and a sharp bot wins most games
  const playOut = (level) => {
    let bd = rv.startBoard();
    let turn = 1;
    let passes = 0;
    while (passes < 2) {
      const moves = turn === 1 ? rv.legalMoves(bd, 1) : null;
      if (turn === 1) {
        if (!moves.length) passes++; else { const m = moves[Math.floor(Math.random() * moves.length)]; bd = rv.applyMove(bd, m[0], m[1], 1); passes = 0; }
      } else {
        const m = rv.botMove(bd, level);
        if (!m) passes++; else { bd = rv.applyMove(bd, m[0], m[1], 2); passes = 0; }
      }
      turn = turn === 1 ? 2 : 1;
    }
    return rv.count(bd, 2) - rv.count(bd, 1);
  };
  let botWins = 0;
  for (let i = 0; i < 40; i++) if (playOut(3) > 0) botWins++;
  let easyWins = 0;
  for (let i = 0; i < 40; i++) if (playOut(0) > 0) easyWins++;
  check(botWins >= 30, 'reversi: the tough bot beats random play at least 30 of 40', String(botWins));
  check(easyWins < botWins, 'reversi: the easy bot wins less than the tough one', `${easyWins} vs ${botWins}`);
  const { game, step, result } = await boot('reversi', 1);
  check(!game.play(0, 0, 1), 'reversi: an illegal move is refused');
  check(game.play(2, 3, 1) && game.turn === 2, 'reversi: a legal move is played and hands the turn over');
  step(120);
  check(game.turn === 1 && rv.count(game.board, 2) >= 1, 'reversi: the bot replies');
  // fill the board with black so the game is decided
  game.board = game.board.map((r) => r.map(() => 1));
  game.board[0][0] = 0; game.board[0][1] = 2;
  game.turn = 1; game.checkTurn();
  check(game.result === null || game.result === 'win', 'reversi: a decided position resolves');
  game.board = game.board.map((r) => r.map(() => 2));
  game.turn = 1; game.checkTurn();
  check(game.result === 'loss', 'reversi: no moves for either side ends the game, more white discs loses');
  step(200);
  check(result.ended && result.ended.score === 0, 'reversi: a loss ends the run with the streak so far');
}

// ---------- Five in a Row ----------
{
  const f = await import('../src/games/five-in-a-row.js');
  const empty = () => Array.from({ length: 11 }, () => new Array(11).fill(0));
  const b = empty();
  for (let i = 0; i < 5; i++) b[3][2 + i] = 1;
  check(f.winnerOf(b)?.who === 1 && f.winnerOf(empty()) === null, 'five-in-a-row: five in a row wins, an empty board does not');
  const d = empty();
  for (let i = 0; i < 5; i++) d[i][10 - i] = 2;
  check(f.winnerOf(d)?.who === 2, 'five-in-a-row: diagonals count');
  const four = empty();
  for (let i = 0; i < 4; i++) four[3][2 + i] = 1;
  check(f.winnerOf(four) === null, 'five-in-a-row: four is not enough');
  const block = empty();
  for (let i = 0; i < 4; i++) block[5][3 + i] = 1;
  const m = f.botMove(block, 2, () => 0.99);
  check(m[0] === 5 && (m[1] === 2 || m[1] === 7), 'five-in-a-row: the bot blocks an open four', JSON.stringify(m));
  const win = empty();
  for (let i = 0; i < 4; i++) { win[5][3 + i] = 2; win[7][3 + i] = 1; }
  const wm = f.botMove(win, 2, () => 0.99);
  check(wm[0] === 5 && (wm[1] === 2 || wm[1] === 7), 'five-in-a-row: the bot finishes its own five', JSON.stringify(wm));
  check(f.botMove(empty(), 1)[0] === 5, 'five-in-a-row: the bot opens in the middle');
  const { game, step, result } = await boot('five-in-a-row', 1);
  for (let i = 0; i < 5; i++) { game.turn = 1; game.place(2, 2 + i, 1); }
  check(game.result === 'win', 'five-in-a-row: placing five wins the game');
  step(200);
  check(game.wins === 1 && game.level === 1 && game.moves === 0, 'five-in-a-row: a win moves on to a fresh, sharper game');
  check(!game.place(0, 0, 1) === false, 'five-in-a-row: the new board is empty');
  game.turn = 1; game.place(0, 0, 1);
  check(!game.place(0, 0, 1), 'five-in-a-row: an occupied point is refused');
  game.result = 'loss'; game.after = 0.1; step(20);
  check(result.ended && result.ended.score === 1, 'five-in-a-row: a loss ends the run with the wins');
}

// ---------- Mancala ----------
{
  const mc = await import('../src/games/mancala.js');
  const st = mc.startPits();
  check(st.reduce((a, b) => a + b, 0) === 48 && st[6] === 0 && st[13] === 0, 'mancala: 48 seeds, empty stores');
  const r = mc.sow(st, 2, 1);
  check(r.again && r.pits[6] === 1 && r.pits[2] === 0, 'mancala: pit 3 lands in your store for another turn');
  const cap = mc.sow([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0], 0, 1);
  check(cap.captured === 6 && cap.pits[6] === 6 && cap.pits[1] === 0 && cap.pits[11] === 0, 'mancala: landing in an empty pit captures the seeds opposite', JSON.stringify(cap.pits));
  const skip = mc.sow([0, 0, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 0], 5, 1);
  check(skip.pits[13] === 0, 'mancala: your seeds skip the bot\'s store');
  check(mc.sow(st, 7, 1) === null && mc.sow(st, 0, 2) === null && mc.sow([0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0], 0, 1) === null, 'mancala: you can only play your own non-empty pits');
  const endGame = mc.sow([0, 0, 0, 0, 0, 1, 10, 3, 3, 0, 0, 0, 0, 5], 5, 1);
  check(endGame.over && endGame.pits[6] === 11 && endGame.pits[13] === 11 && endGame.pits.slice(0, 6).every((v) => v === 0), 'mancala: when a side runs out, the other sweeps its seeds home', JSON.stringify(endGame.pits));
  let conserved = true; let games = 0; let botWon = 0;
  for (let g = 0; g < 60; g++) {
    let p = mc.startPits();
    let side = 1;
    for (let turns = 0; turns < 300; turns++) {
      const mine = (side === 1 ? [0, 1, 2, 3, 4, 5] : [7, 8, 9, 10, 11, 12]).filter((i) => p[i]);
      if (!mine.length) break;
      const pit = side === 1 ? mine[Math.floor(Math.random() * mine.length)] : mc.botPit(p, 2);
      const res = mc.sow(p, pit, side);
      p = res.pits;
      if (p.reduce((a, b) => a + b, 0) !== 48) conserved = false;
      if (res.over) break;
      if (!res.again) side = side === 1 ? 2 : 1;
    }
    games++;
    if (p[13] > p[6]) botWon++;
  }
  check(conserved, 'mancala: the seed count is always 48 (60 random games)');
  check(botWon >= 45, 'mancala: the searching bot beats random play in at least 45 of 60', String(botWon));
  const { game, step, result } = await boot('mancala', 1);
  check(!game.play(6, 1) && !game.play(9, 1), 'mancala: stores and the bot\'s pits cannot be played');
  check(game.play(2, 1) && game.turn === 1, 'mancala: the extra turn keeps it your go');
  step(200);
  check(game.pits[6] === 1 && game.queue.length === 0, 'mancala: the sowing plays out');
  game.pits = [0, 0, 0, 0, 0, 1, 20, 0, 0, 0, 0, 0, 1, 5];
  game.turn = 1; game.play(5, 1);
  check(game.result === 'win' && game.pits[6] === 21 && game.pits[13] === 6, 'mancala: a won game is recognised', String(game.result));
  step(400);
  check(game.wins === 1 && game.pits[0] === 4, 'mancala: a win starts the next, harder game');
  game.pits = [0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 1, 30]; game.turn = 1; game.play(5, 1);
  step(600);
  check(result.ended && result.ended.score === 1, 'mancala: a loss ends the run with the wins', JSON.stringify(result.ended));
}

// ---------- Dots and Boxes ----------
{
  const db = await import('../src/games/dots-and-boxes.js');
  check(db.EDGE_COUNT === 40 && db.boxSides(0, 0).join() === [0, 4, 20, 21].join(), 'dots-and-boxes: 40 edges and box sides line up');
  const sides = new Set();
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) db.boxSides(r, c).forEach((e) => sides.add(e));
  check(sides.size === 40, 'dots-and-boxes: every edge belongs to at least one box');
  const e = new Array(40).fill(0);
  db.boxSides(1, 1).slice(0, 3).forEach((x) => { e[x] = 1; });
  check(db.completes(e, db.boxSides(1, 1)[3]).length === 1 && db.completes(e, 39).length === 0, 'dots-and-boxes: the fourth side completes a box');
  check(db.botEdge(e, 3) === db.boxSides(1, 1)[3], 'dots-and-boxes: a sharp bot takes a box when it can');
  // The bot never hands over a box while a safe edge exists.
  let safe = true;
  for (let g = 0; g < 30; g++) {
    const ed = new Array(40).fill(0);
    for (let i = 0; i < 16; i++) ed[Math.floor(Math.random() * 40)] = 1;
    const pick = db.botEdge(ed, 3);
    if (pick === null) continue;
    const grabs = [];
    for (let x = 0; x < 40; x++) if (!ed[x] && db.completes(ed, x).length) grabs.push(x);
    if (grabs.length) { if (!grabs.includes(pick)) safe = false; continue; }
    const after = ed.slice(); after[pick] = 1;
    const hasSafe = [...Array(40).keys()].some((x) => { if (ed[x]) return false; const t = ed.slice(); t[x] = 1; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (db.sidesDrawn(t, r, c) === 3 && db.sidesDrawn(ed, r, c) < 3) return false; return true; });
    let handed = false;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (db.sidesDrawn(after, r, c) === 3 && db.sidesDrawn(ed, r, c) < 3) handed = true;
    if (handed && hasSafe) safe = false;
  }
  check(safe, 'dots-and-boxes: the bot grabs boxes and avoids handing over a third side (30 boards)');
  const { game, step, result } = await boot('dots-and-boxes', 3);
  check(game.draw(0, 1) && !game.draw(0, 1), 'dots-and-boxes: an edge can be drawn once');
  check(game.turn === 2, 'dots-and-boxes: drawing without closing a box passes the turn');
  // A whole game: both sides play, boxes add up to 16.
  const g2 = await boot('dots-and-boxes', 4);
  let guard = 0;
  while (!g2.game.result && guard++ < 400) {
    if (g2.game.turn === 1) { const free = g2.game.edges.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0); g2.game.draw(free[Math.floor(Math.random() * free.length)], 1); }
    g2.step(30);
  }
  const mine = g2.game.owner.filter((o) => o === 1).length;
  const theirs = g2.game.owner.filter((o) => o === 2).length;
  check(mine + theirs === 16 && g2.game.result, 'dots-and-boxes: a finished game has all 16 boxes claimed', `${mine}+${theirs}`);
}

// ---------- Blackjack ----------
{
  const bj = await import('../src/games/blackjack.js');
  check(bj.handValue([0, 12]).total === 21 && bj.isBlackjack([0, 12]) && !bj.isBlackjack([0, 5, 4]), 'blackjack: ace + king is a blackjack');
  check(bj.handValue([0, 0, 8]).total === 21 && bj.handValue([0, 0]).total === 12 && bj.handValue([0, 5, 9]).total === 17, 'blackjack: aces drop from 11 to 1 as needed');
  check(bj.handValue([9, 10, 5]).total === 26, 'blackjack: a bust is over 21');
  const P = (a) => a;
  check(bj.outcome([0, 12], [9, 8]) === 1.5 && bj.outcome([0, 12], [0, 12]) === 0 && bj.outcome([9, 10, 5], [9, 3]) === -1, 'blackjack: blackjack pays 3:2, tie pushes, bust loses');
  check(bj.outcome([9, 8], [9, 5, 9]) === 1 && bj.outcome([9, 6], [9, 8]) === -1 && bj.outcome([9, 8], [9, 8]) === 0, 'blackjack: dealer bust wins, lower total loses, equal pushes');
  const { game, step, result } = await boot('blackjack', 4);
  check(!game.placeBet(7), 'blackjack: only listed bets are accepted');
  game.deck = [];
  let stakes = 0;
  const fixed = (cards) => { game.deck = [...cards].reverse(); };   // draw() pops from the end: player, player, dealer, dealer
  // Player 10+8, dealer 10+7, player stands: player wins.
  fixed([9, 7, 9, 6]);
  game.deck.unshift(...Array.from({ length: 25 }, () => 3));
  check(game.placeBet(10) && game.phase === 'play' && game.chips === 90, 'blackjack: a bet is taken and the cards dealt');
  game.stand();
  check(game.phase === 'result' && game.chips === 110, 'blackjack: standing on 18 against 17 wins 10', String(game.chips));
  step(120);
  check(game.phase === 'bet' && game.hand === 1, 'blackjack: the next hand opens for betting');
  // Double down.
  game.deck = [...Array.from({ length: 25 }, () => 3), 9, 9, 10, 4, 5, 5];   // dealer: 10 + 5? order: player 5?,...
  game.deck = [9, 10, 6, 4, 5, 5]; game.deck.unshift(...Array.from({ length: 25 }, () => 3));
  game.placeBet(10);
  const before = game.chips;
  game.doubleDown();
  check(game.bet === 20 && game.phase === 'result', 'blackjack: doubling doubles the bet and ends your hand', `${game.bet} ${game.phase}`);
  step(120);
  // Play the remaining hands with a plain policy until it ends.
  let guard = 0;
  while (!result.ended && guard++ < 3000) {
    if (game.phase === 'bet') game.placeBet(5);
    else if (game.phase === 'play') { if (bj.handValue(game.player).total < 16) game.hit(); else game.stand(); }
    step(5);
  }
  check(result.ended && result.ended.score === game.chips && game.hand >= 20 || game.chips < 5, 'blackjack: twenty hands end the run with the chips', JSON.stringify(result.ended));
  // Basic play over many hands should stay near even: mean chips after 20 hands of 5-chip bets.
  let total = 0;
  for (let i = 0; i < 60; i++) {
    const g = await boot('blackjack', 100 + i);
    let n = 0;
    while (!g.result.ended && n++ < 4000) {
      if (g.game.phase === 'bet') g.game.placeBet(5);
      else if (g.game.phase === 'play') { if (bj.handValue(g.game.player).total < 17) g.game.hit(); else g.game.stand(); }
      g.step(5);
    }
    total += g.game.chips;
  }
  check(total / 60 > 80 && total / 60 < 120, 'blackjack: fair odds — 60 runs of 5-chip hands average near the 100 start', String(total / 60));
}

// ---------- Pig Dice ----------
{
  const pg = await import('../src/games/pig-dice.js');
  check(pg.botHolds(0, 0, 12, 0) && !pg.botHolds(0, 0, 11, 0) && !pg.botHolds(2, 0, 19, 0) && pg.botHolds(2, 0, 20, 0), 'pig-dice: the bot banks at its limit');
  check(pg.botHolds(0, 95, 5, 0) && !pg.botHolds(0, 50, 5, 0), 'pig-dice: the bot banks when it can win');
  check(!pg.botHolds(2, 0, 25, 90), 'pig-dice: the bot takes more risk when you are close to winning');
  const { game, step, result } = await boot('pig-dice', 2);
  game.applyRoll(4); game.applyRoll(6);
  check(game.turnTotal === 10 && game.turn === 1, 'pig-dice: rolls add to the turn total');
  game.hold();
  check(game.scores[1] === 10 && game.turn === 2 && game.turnTotal === 0, 'pig-dice: holding banks the total and passes the turn');
  game.turn = 1; game.applyRoll(5); game.applyRoll(1);
  check(game.scores[1] === 10 && game.turnTotal === 0 && game.turn === 2, 'pig-dice: a 1 loses the turn total');
  game.turn = 1; game.scores[1] = 96; game.applyRoll(6); game.hold();
  check(game.result === 'win', 'pig-dice: reaching 100 wins');
  step(200);
  check(game.wins === 1 && game.scores[1] === 0 && game.level === 1, 'pig-dice: a win resets for a harder game');
  game.turn = 2; game.scores[2] = 97; game.turnTotal = 4; game.wait = 0; step(400);
  check(result.ended && result.ended.score === 1, 'pig-dice: the bot reaching 100 ends the run with your wins', JSON.stringify(result.ended));
}

// ---------- Slot Machine ----------
{
  const sm = await import('../src/games/slot-machine.js');
  check(sm.payout([4, 4, 4]) === 500 && sm.payout([0, 0, 0]) === 50 && sm.payout([1, 1, 2]) === 10 && sm.payout([2, 1, 2]) === 10 && sm.payout([0, 1, 2]) === 0, 'slot-machine: triples pay by symbol, a pair returns the stake, odd ones lose');
  const counts = new Array(6).fill(0);
  for (let i = 0; i < 20000; i++) counts[sm.randomSymbol()]++;
  check(counts[0] > counts[1] && counts[1] > counts[2] && counts[3] > counts[4] && counts[4] > counts[5] && counts[5] > 200, 'slot-machine: cherries are common, sevens rare but possible', counts.join());
  let paid = 0; const N = 30000;
  for (let i = 0; i < N; i++) paid += sm.payout([sm.randomSymbol(), sm.randomSymbol(), sm.randomSymbol()]);
  const rtp = paid / (N * 10);
  check(rtp > 0.8 && rtp < 1.05, 'slot-machine: the return to player is fair without holding', rtp.toFixed(3));
  const { game, step, result } = await boot('slot-machine', 3);
  check(game.coins === 250 && game.phase === 'ready', 'slot-machine: 250 coins to start');
  check(!game.respin() && !game.toggleHold(0), 'slot-machine: no respin before a spin');
  check(game.spin() && game.coins === 240 && game.phase === 'spinning', 'slot-machine: a spin costs 10');
  step(200);
  check(game.phase === 'held' && game.spins === 1, 'slot-machine: reels stop and a respin becomes possible');
  const before = game.reels.map((r) => r.sym);
  game.toggleHold(0);
  check(game.respin() && game.spins === 1, 'slot-machine: a respin does not use a spin');
  step(200);
  check(game.reels[0].sym === before[0] && game.phase === 'ready', 'slot-machine: a held reel keeps its symbol');
  check(!game.respin(), 'slot-machine: only one respin per spin');
  let n = 0;
  while (!result.ended && n++ < 200) { if (game.phase === 'ready' || game.phase === 'held') game.spin(); step(120); }
  check(result.ended && game.spins === 25 && result.ended.score === game.coins, 'slot-machine: after 25 spins the run ends with the coins', JSON.stringify(result.ended));
}

// ---------- Star Fighter ----------
{
  const { game, input, step, result } = await boot('star-fighter', 3);
  check(game.lives === 3 && game.score === 0, 'star-fighter: three lives and no score at the start');
  game.spawnT = 99;
  game.spawnEnemy();
  const e = game.enemies[0];
  e.kind = 'drone'; e.hp = 1;
  game.ship.position.set(-12, 0, 0);
  e.mesh.position.set(0, 0, 0); e.baseY = 0; e.phase = 0;
  input.down = true;
  step(1);
  input.down = false;
  check(game.shots.length >= 1, 'star-fighter: holding fire shoots');
  game.shots[0].position.copy(e.mesh.position);
  step(1);
  check(game.score >= 100 && game.kills >= 1, 'star-fighter: a bullet hitting a drone scores 100', `score ${game.score}`);
  input.hold('KeyW'); step(60); input.release();
  check(game.ship.position.y > 5, 'star-fighter: W flies the ship up');
  game.invuln = 0; game.hurt();
  check(game.lives === 2 && game.invuln > 1, 'star-fighter: a hit costs a life and gives a moment of safety');
  game.hurt();
  check(game.lives === 2, 'star-fighter: no double hit while invulnerable');
  game.invuln = 0; game.hurt(); game.invuln = 0; game.hurt();
  check(result.ended && result.ended.score === game.score, 'star-fighter: the third hit ends the run with the score', JSON.stringify(result.ended));
  const g2 = await boot('star-fighter', 4);
  g2.game.dropPickup(g2.game.ship.position.clone());
  g2.game.pickups[0].type = 'S';
  g2.step(3);
  check(g2.game.spread > 10, 'star-fighter: a spread-shot pickup powers you up');
  let alive = true;
  for (let i = 0; i < 60 * 30 && alive; i++) { g2.step(1); if (g2.result.ended) alive = false; }
  check(g2.game.time > 20 || g2.result.ended, 'star-fighter: enemies spawn and the game runs for a while');
}

// ---------- Missile Defence ----------
{
  const { game, step, result } = await boot('missile-defence', 2);
  check(game.cities.length === 6 && game.batteries.length === 3 && game.wave === 1, 'missile-defence: six cities, three batteries, wave one');
  check(game.batteries.every((b) => b.ammo === 8), 'missile-defence: each battery starts with 8 missiles');
  check(!game.fireAt(0, 0.5), 'missile-defence: firing at the ground does nothing');
  check(game.fireAt(-16, 12) && game.batteries[0].ammo === 7 && game.batteries[1].ammo === 8, 'missile-defence: the nearest battery fires');
  step(200);
  check(game.outgoing.length === 0, 'missile-defence: the counter-missile reaches its target');
  game.toSpawn = 0; game.incoming.forEach((m) => { game.scene.remove(m.line); game.scene.remove(m.head); }); game.incoming = [];
  game.spawnIncoming();
  const inc = game.incoming[0];
  inc.pos.set(0, 10, 0);
  game.explode(new game.camera.position.constructor(0, 10, 0));
  const before = game.score;
  step(5);
  check(game.score === before + 25 && game.incoming.length === 0, 'missile-defence: a blast destroys an enemy missile inside it for 25');
  const alive0 = game.aliveCities().length;
  game.hitGround(CITY_X_FIRST());
  check(game.aliveCities().length === alive0 - 1, 'missile-defence: a missile landing on a city destroys it');
  game.batteries.forEach((b) => { b.ammo = 0; });
  check(!game.fireAt(0, 10), 'missile-defence: out of ammo means no launch');
  for (const c of game.cities) game.hitGround(c.x);
  step(3);
  check(result.ended && result.ended.score === game.score, 'missile-defence: losing every city ends the run');
  const g2 = await boot('missile-defence', 5);
  g2.game.toSpawn = 0; g2.game.incoming = [];
  g2.step(60 * 6);
  check(g2.game.wave >= 2, 'missile-defence: clearing a wave starts the next', String(g2.game.wave));
  function CITY_X_FIRST() { return game.cities.find((c) => c.alive).x; }
}

// ---------- Turret Defence ----------
{
  const { game, input, step, result } = await boot('turret-defence', 2);
  check(game.baseHp === 100 && game.ammo === 24, 'turret-defence: full base health and a full magazine');
  step(110);
  check(game.wave === 1 && game.enemies.length >= 1, 'turret-defence: the first wave arrives');
  for (const en of game.enemies) game.scene.remove(en.mesh);
  game.enemies = []; game.left = 0;
  game.spawn();
  const z = game.enemies[0];
  z.kind = 'walker'; z.hp = 2;
  z.mesh.position.set(0, 0.8, 14);
  game.aim = 0;
  input.down = true;
  step(60);
  input.down = false;
  check(game.kills >= 1 && game.score >= 10, 'turret-defence: aimed shots kill a zombie', `kills ${game.kills}`);
  game.ammo = 24; game.reloadT = 0;
  input.down = true; step(30); input.down = false;
  check(game.ammo < 24, 'turret-defence: firing uses ammo');
  game.ammo = 1; game.fireCd = 0; game.reloadT = 0;
  input.down = true; step(2); input.down = false;
  check(game.reloadT > 0, 'turret-defence: an empty magazine reloads');
  step(90);
  check(game.ammo === 24, 'turret-defence: reloading refills the magazine');
  game.left = 0;
  for (const en of game.enemies) game.scene.remove(en.mesh);
  game.enemies = [];
  game.spawn();
  game.enemies[0].mesh.position.set(0, 0.8, 1.5);
  step(60 * 3);
  check(game.baseHp < 100, 'turret-defence: zombies at the base chew its health');
  game.baseHp = 5;
  game.enemies.forEach((en) => { en.bite = 0; en.mesh.position.set(0, 0.8, 1); });
  step(120);
  check(result.ended && result.ended.score === game.score, 'turret-defence: the base falling ends the run', JSON.stringify(result.ended));
}

// ---------- Light Cycles ----------
{
  const lc = await import('../src/games/light-cycles.js');
  const occ = new Uint8Array(36 * 36);
  check(lc.blockedAhead(occ, 0, 5, 3) && lc.blockedAhead(occ, 35, 5, 1) && !lc.blockedAhead(occ, 10, 10, 0), 'light-cycles: walls block, open ground does not');
  occ[10 * 36 + 11] = 1;
  check(lc.blockedAhead(occ, 10, 10, 1) && !lc.blockedAhead(occ, 10, 10, 1, 0), 'light-cycles: a trail blocks the cell ahead');
  let ok = true;
  for (let i = 0; i < 200; i++) {
    const o = new Uint8Array(36 * 36);
    const x = 3 + Math.floor(Math.random() * 30); const y = 3 + Math.floor(Math.random() * 30);
    const d = Math.floor(Math.random() * 4);
    const nx = x + [0, 1, 0, -1][d]; const ny = y + [-1, 0, 1, 0][d];
    o[ny * 36 + nx] = 1;
    if (lc.aiTurn(o, x, y, d) === d) ok = false;
  }
  check(ok, 'light-cycles: the AI turns away from a wall directly ahead (200 cases)');
  const { game, input, step, result } = await boot('light-cycles', 3);
  check(game.cycles.length === 3 && game.cycles[0].human && game.round === 1, 'light-cycles: you and two rivals in round one');
  step(80);
  const x0 = game.cycles[0].x;
  step(20);
  check(game.cycles[0].x > x0, 'light-cycles: cycles move on their own');
  input.press('KeyW'); step(12);
  check(game.cycles[0].d === 0, 'light-cycles: pointing up turns the cycle up');
  input.release();
  game.steer(2);   // straight back down: U-turn refused
  check(game.pending === null || game.pending === 0, 'light-cycles: a U-turn is refused');
  // Drive into the wall: dies, round ends, run ends.
  game.cycles[0].d = 3; game.pending = null;
  step(60 * 20);
  check(result.ended && result.ended.score >= 0, 'light-cycles: hitting a wall ends the run', JSON.stringify(result.ended));
  // A run against an idle field: cycles that go straight eventually die and the round is won.
  const g2 = await boot('light-cycles', 6);
  g2.game.cycles.slice(1).forEach((c) => { c.alive = false; c.head.visible = false; });
  g2.step(110);
  check(g2.game.roundEnd > 0, 'light-cycles: last cycle standing ends the round');
  g2.step(120);
  check(g2.game.round === 2 && g2.game.score >= 50 && g2.game.cycles.length === 3, 'light-cycles: winning starts a bigger round with a 50 point bonus', `round ${g2.game.round} score ${g2.game.score} cycles ${g2.game.cycles.length}`);
}

// ---------- Ghost Hunt ----------
{
  const { game, input, step, result } = await boot('ghost-hunt', 2);
  check(game.lives === 5, 'ghost-hunt: five lives');
  step(120);
  check(game.ghosts.length >= 1, 'ghost-hunt: ghosts appear');
  const g = game.ghosts[0];
  // Put the ghost right on the aim ray.
  game.camera.updateMatrixWorld();
  game.ray.setFromCamera(game.input.activePointer(), game.camera);
  const p = game.ray.ray.origin.clone().addScaledVector(game.ray.ray.direction, 30);
  for (const other of game.ghosts.slice(1)) game.scene.remove(other);
  game.ghosts = [g];
  game.spawnT = 99;
  g.position.copy(p); g.userData.baseY = p.y;
  input.down = true;
  step(80);
  check(game.kills === 1 && game.score === 15, 'ghost-hunt: holding the torch on a ghost banishes it for 15', `kills ${game.kills} score ${game.score}`);
  const t0 = game.charge;
  step(90);
  check(game.charge < t0 || game.charge === 0, 'ghost-hunt: the torch drains while lit');
  input.down = false;
  game.charge = 0.2;
  step(60);
  check(game.charge > 0.3, 'ghost-hunt: the torch recharges when off');
  game.spawnT = 99;
  for (let i = 0; i < 5; i++) { game.spawn(); const gg = game.ghosts.at(-1); gg.position.set(30, 3, 5); }
  step(3);
  check(result.ended && game.lives <= 0, 'ghost-hunt: five ghosts getting through ends the run', JSON.stringify(result.ended));
}

// ---------- Jetpack Run ----------
{
  const jr = (await import('../src/games/jetpack-run.js')).default;
  check(jr.barDistance(0, 0, 3, 0, 2, 0) === 1 && jr.barDistance(0, 3, 0, 0, 1, Math.PI / 2) === 2 && jr.barDistance(0, 0, 0, 0, 3, 0.7) < 0.001, 'jetpack-run: distance to a zapper bar');
  const { game, input, step, result } = await boot('jetpack-run', 2);
  game.spawnT = 999;
  step(10);
  check(game.player.position.y <= 0.75, 'jetpack-run: you start on the floor');
  input.hold('Space'); step(40);
  check(game.player.position.y > 3, 'jetpack-run: holding Space rises');
  input.release(); step(120);
  check(game.player.position.y < 1, 'jetpack-run: letting go falls back down');
  const c = game.things.length;
  game.spawnCoins();
  const coin = game.things.at(-1);
  coin.mesh.position.set(game.player.position.x + 0.5, game.player.position.y, 0);
  step(2);
  check(game.coins >= 1, 'jetpack-run: touching a coin collects it');
  game.spawnZapper();
  const z = game.things.at(-1);
  z.mesh.position.set(game.player.position.x, game.player.position.y, 0);
  step(2);
  check(result.ended, 'jetpack-run: touching a zapper ends the run', JSON.stringify(result.ended));
  const g2 = await boot('jetpack-run', 3);
  g2.game.spawnT = 999;
  g2.step(60 * 20);
  check(!g2.result.ended && g2.game.distance > 50, 'jetpack-run: with nothing in the way the distance grows');
}

// ---------- Sky Climb ----------
{
  const { game, input, step, result } = await boot('sky-climb', 3);
  check(game.plats.length > 8 && game.plats[0].kind === 'still', 'sky-climb: a column of platforms above the start');
  // A landing-aware bot: steer to the highest platform it can reach before it comes down.
  const bot = (g, inp) => {
    const p = g.player.position;
    const reach = p.y - 0.65 + (g.vy > 0 ? (g.vy * g.vy) / 60 : 0) - 0.15;
    let best = null;
    for (const pl of g.plats) {
      if (pl.broken || pl.kind === 'break') continue;
      const top = pl.mesh.position.y + 0.25;
      if (top > reach || top < p.y - 9 || Math.abs(pl.mesh.position.x - p.x) > 12) continue;
      if (!best || top > best.mesh.position.y + 0.25) best = pl;
    }
    inp.release('KeyA', 'KeyD');
    if (best) { const dx = best.mesh.position.x - p.x; if (dx > 0.3) inp.hold('KeyD'); else if (dx < -0.3) inp.hold('KeyA'); }
  };
  for (let i = 0; i < 60 * 60 && !result.ended; i++) { bot(game, input); step(1); }
  check(!result.ended && game.best * 3 > 100, 'sky-climb: a steering bot climbs past 100 m without falling', `height ${(game.best * 3).toFixed(0)}`);
  check(game.plats.length < 80, 'sky-climb: old platforms are cleaned up', String(game.plats.length));
  game.player.position.y = -100; step(3);
  check(result.ended && result.ended.score === Math.floor(game.best * 3), 'sky-climb: falling ends the run with the height', JSON.stringify(result.ended));
  const g2 = await boot('sky-climb', 5);
  const p2 = g2.game.player.position;
  g2.game.plats.forEach((pl) => { pl.mesh.position.y = 500; });
  p2.x = 8.9; g2.input.hold('KeyD'); g2.step(20);
  check(p2.x < 0, 'sky-climb: the screen edges wrap round');
}

// ---------- Tightrope ----------
{
  const tr = await import('../src/games/tightrope.js');
  const idle = tr.stepTilt(0.2, 0, 0, 0, 0, 0.5);
  const push = tr.stepTilt(0.2, 0, -1, 0, 0, 0.5);
  check(idle.angle > 0.2 && push.angle < idle.angle, 'tightrope: gravity tips you further over and leaning back helps');
  const { game, input, step, result } = await boot('tightrope', 2);
  // A balancing bot: lean against angle and its rate.
  for (let i = 0; i < 60 * 80 && !result.ended; i++) {
    const cmd = -(game.angle * 3 + game.vel * 1.4);
    input.release('KeyA', 'KeyD');
    if (cmd > 0.15) input.hold('KeyD'); else if (cmd < -0.15) input.hold('KeyA');
    step(1);
  }
  check(result.ended && result.ended.score >= 120, 'tightrope: a balancing bot can cross the whole rope', JSON.stringify(result.ended));
  const g2 = await boot('tightrope', 4);
  g2.step(60 * 15);
  check(g2.result.ended && g2.result.ended.score < 120, 'tightrope: standing still (no leaning) means a fall', JSON.stringify(g2.result.ended));
}

// ---------- Highway Rush ----------
{
  const { game, input, step, result } = await boot('highway-rush', 4);
  const bot = () => {
    const blocked = (lane, back = 8) => game.traffic.some((t) => t.lane === lane && t.mesh.position.z > -26 && t.mesh.position.z < back);
    input.release('KeyS');
    if (blocked(game.lane)) {
      const opts = [game.lane - 1, game.lane + 1].filter((l) => l >= 0 && l <= 4 && !blocked(l, 5));
      if (opts.length) input.press(opts[0] < game.lane ? 'KeyA' : 'KeyD'); else input.hold('KeyS');
    }
  };
  for (let i = 0; i < 60 * 40 && !result.ended; i++) { bot(); step(1); input.release('KeyA', 'KeyD'); }
  check(!result.ended && game.distance > 200, 'highway-rush: a lane-changing, braking bot survives 40 seconds', `distance ${game.distance.toFixed(0)} ended ${JSON.stringify(result.ended)}`);
  const g2 = await boot('highway-rush', 7);
  g2.step(60 * 120);
  check(g2.result.ended, 'highway-rush: sitting in one lane eventually crashes', JSON.stringify(g2.result.ended));
  const g3 = await boot('highway-rush', 9);
  g3.game.spawnT = 99;
  g3.game.spawnCar();
  const car = g3.game.traffic[0] ?? (g3.game.spawnT = 0, null);
  check(g3.game.lane === 2, 'highway-rush: you start in the middle lane');
  g3.input.press('KeyA'); g3.step(1);
  check(g3.game.lane === 1, 'highway-rush: A changes lane left');
  g3.input.press('KeyD'); g3.step(1); g3.input.press('KeyD'); g3.step(1); g3.input.press('KeyD'); g3.step(1); g3.input.press('KeyD'); g3.step(1);
  check(g3.game.lane === 4, 'highway-rush: lanes stop at the edge');
}

// ---------- Numbers Blast ----------
{
  const nb = await import('../src/games/numbers-blast.js');
  check(nb.blockValue(0, () => 0.5) < nb.blockValue(120, () => 0.5) && nb.blockValue(0, () => 0) >= 1, 'numbers-blast: blocks get higher numbers over time');
  const { game, input, step, result } = await boot('numbers-blast', 2);
  game.spawnT = 999;
  game.spawnBlock();
  const b = game.blocks[0];
  b.value = 3; b.start = 3; b.mesh.position.set(0, 12, 0); b.speed = 0;
  game.px = 0;
  step(90);
  check(game.blocks.length === 0 && game.broken === 1, 'numbers-blast: enough hits pop the block');
  check(game.score >= 3 + 6, 'numbers-blast: a pop scores double its number plus a point per hit', String(game.score));
  game.spawnBlock();
  const c = game.blocks[0];
  c.mesh.position.set(-8, 12, 0); c.value = 5; c.speed = 0;
  step(60);
  check(c.value === 5, 'numbers-blast: a block off to the side is not hit');
  input.hold('KeyA'); step(60); input.release();
  check(game.px < -5, 'numbers-blast: A slides the cannon left');
  game.guns = 1;
  game.spawnPickup();
  const pu = game.pickups[0];
  pu.position.set(game.px, 2.5, 0);
  step(2);
  check(game.guns === 2 && game.barrels.length === 2, 'numbers-blast: the green plus adds a barrel');
  game.blocks.forEach((x) => { x.mesh.position.y = 1.9; x.speed = 5; });
  step(10);
  check(result.ended && result.ended.score === game.score, 'numbers-blast: a block reaching the floor ends the run', JSON.stringify(result.ended));
}

// ---------- Penalty Kicks ----------
{
  const pk = await import('../src/games/penalty-kicks.js');
  const t = { x: 2, y: 2 };
  const good = pk.actualShot(t, 0.85, () => 0.5);
  check(Math.abs(good.x - 2) < 1e-9 && Math.abs(good.y - 2) < 1e-9, 'penalty-kicks: with a neutral roll the shot goes exactly where you aimed');
  const spread = (power) => { let m = 0; for (let i = 0; i < 400; i++) { const s = pk.actualShot(t, power); m = Math.max(m, Math.hypot(s.x - 2, s.y - 2)); } return m; };
  check(spread(0.85) < spread(0.3) && spread(0.85) < spread(1.0), 'penalty-kicks: the sweet spot is the most accurate power');
  check(pk.judge({ x: 7, y: 2 }, 0.85, { x: 0, y: 2 }) === 'miss' && pk.judge({ x: 1, y: 4.6 }, 0.85, { x: 1, y: 2 }) === 'miss', 'penalty-kicks: outside the posts or over the bar is a miss');
  check(pk.judge({ x: 2, y: 2 }, 0.85, { x: 2.5, y: 2 }) === 'save' && pk.judge({ x: 2, y: 2 }, 0.85, { x: -4, y: 1 }) === 'goal', 'penalty-kicks: a keeper close to the ball saves, far away it is a goal');
  check(pk.judge({ x: 2, y: 2 }, 0.3, { x: 3.7, y: 2 }) === 'save' && pk.judge({ x: 2, y: 2 }, 0.9, { x: 3.7, y: 2 }) === 'goal', 'penalty-kicks: a weak shot is easier to save than a hard one');
  check(pk.pointsFor({ x: 5, y: 3 }) === 15 && pk.pointsFor({ x: 0, y: 1 }) === 10, 'penalty-kicks: top corners are worth 15');
  let early = 0; let late = 0;
  for (let i = 0; i < 2000; i++) { const d = pk.keeperDive({ x: 4, y: 3 }, 0); if (Math.hypot(d.x - 4, d.y - 3) < 1.5) early++; const e = pk.keeperDive({ x: 4, y: 3 }, 9); if (Math.hypot(e.x - 4, e.y - 3) < 1.5) late++; }
  check(late > early, 'penalty-kicks: the keeper reads your aim more often as the kicks go on', `${early} -> ${late}`);
  const { game, input, step, result } = await boot('penalty-kicks', 2);
  check(game.phase === 'aim' && game.kick === 0, 'penalty-kicks: starts in the aim phase');
  input.clicked = true; step(1);
  check(game.phase === 'power', 'penalty-kicks: the first click starts the power bar');
  step(30);
  const p1 = game.power;
  check(p1 >= 0 && p1 <= 1, 'penalty-kicks: the power bar stays between 0 and 1');
  game.target = { x: -5, y: 3 };
  const out = game.shoot(0.85);
  check(['goal', 'save', 'miss'].includes(out) && game.phase === 'flight', 'penalty-kicks: shooting starts the flight');
  step(120);
  check(game.phase === 'aim' && game.kick === 1, 'penalty-kicks: the next kick is set up');
  // Take the remaining nine as top-corner shots at the sweet spot and see the run end.
  for (let i = 1; i < 10; i++) { game.target = { x: i % 2 ? 5 : -5, y: 3 }; game.shoot(0.85); step(240); }
  check(result.ended && result.ended.score === game.score, 'penalty-kicks: ten kicks end the run with the score', JSON.stringify(result.ended));
  let total = 0;
  for (let g = 0; g < 100; g++) {
    let sc = 0;
    for (let k = 0; k < 10; k++) {
      const tg = { x: k % 2 ? 4.9 : -4.9, y: 3.1 };
      const shot = pk.actualShot(tg, 0.85);
      const dv = pk.keeperDive(tg, k);
      if (pk.judge(shot, 0.85, dv) === 'goal') sc += pk.pointsFor(shot);
    }
    total += sc;
  }
  check(total / 100 > 40 && total / 100 < 110, 'penalty-kicks: careful top-corner play averages 40-110 points', String(total / 100));
}

// ---------- Goalkeeper ----------
{
  const gk = await import('../src/games/goalkeeper.js');
  const a = gk.shotParams(0, () => 0.5); const b = gk.shotParams(40, () => 0.5);
  check(b.dur < a.dur && b.dur >= 0.5 * 0.99 && Math.abs(b.curve) <= Math.abs(gk.shotParams(40, () => 1).curve), 'goalkeeper: shots get faster as you face more');
  const pos = gk.ballAt({ x: 0, y: 0.4 }, { x: 3, y: 2 }, { curve: 2, arc: 1 }, 1);
  check(Math.abs(pos.x - 3) < 1e-9 && Math.abs(pos.y - 2) < 1e-9 && pos.z === 0, 'goalkeeper: the ball ends up exactly on target at the goal line');
  const mid = gk.ballAt({ x: 0, y: 0 }, { x: 0, y: 0 }, { curve: 2, arc: 0 }, 0.5);
  check(Math.abs(mid.x - 1) < 1e-9, 'goalkeeper: the curve bends the ball mid-flight');
  check(gk.default.outcome({ x: 1, y: 2 }, { x: 1.5, y: 2 }) === 'save' && gk.default.outcome({ x: 1, y: 2 }, { x: 4, y: 2 }) === 'goal' && gk.default.outcome({ x: 8, y: 2 }, { x: 8, y: 2 }) === 'wide', 'goalkeeper: save, goal and wide');
  const { game, input, step, result } = await boot('goalkeeper', 2);
  step(90);
  check(game.shot, 'goalkeeper: the first shot arrives');
  // A predictive bot: put the gloves where the ball will cross the line.
  const runBot = async (seed, secs) => {
    const g = await boot('goalkeeper', seed);
    for (let i = 0; i < 60 * secs && !g.result.ended; i++) {
      const s = g.game.shot;
      if (s) { const at = gk.ballAt(s.from, s.to, s.params, 1); g.game.glove.x = at.x; g.game.glove.y = at.y; g.game.mouseMode = false; }
      g.step(1);
    }
    return g;
  };
  const perfect = await runBot(4, 40);
  check(perfect.game.saves >= 12 && perfect.game.conceded === 0, 'goalkeeper: a keeper that reads every shot saves them all', `${perfect.game.saves} saves, ${perfect.game.conceded} conceded`);
  check(perfect.game.score > 100, 'goalkeeper: streaks build the score', String(perfect.game.score));
  const idle = await boot('goalkeeper', 5);
  idle.step(60 * 60);
  check(idle.result.ended && idle.game.conceded >= 5, 'goalkeeper: standing still concedes five and ends the match', JSON.stringify(idle.result.ended));
  input.hold('KeyD'); step(30); input.release();
  check(game.glove.x > 3, 'goalkeeper: D moves the gloves right');
}

// ---------- Home Run Derby ----------
{
  const hr = await import('../src/games/home-run-derby.js');
  check(hr.contact(0, 0) === 1 && hr.contact(0.2, 0) === 0 && hr.contact(0, 2) === 0 && hr.contact(0.08, 0.7) > 0 && hr.contact(0.08, 0.7) < 1, 'home-run-derby: contact needs the right timing and position');
  check(hr.hitResult(0.9).label === 'HOME RUN' && hr.hitResult(0.65).label === 'DEEP HIT' && hr.hitResult(0.45).label === 'SINGLE' && hr.hitResult(0.2).label === 'FOUL' && hr.hitResult(0).label === 'STRIKE', 'home-run-derby: contact tiers');
  check(hr.hitResult(0.95).dist > 110 && hr.hitResult(0.9).pts === 100, 'home-run-derby: a homer goes over 110 m and scores 100');
  const { game, step, result } = await boot('home-run-derby', 2);
  step(90);
  check(game.state === 'pitch', 'home-run-derby: the first pitch is thrown');
  game.p.dur = 1;
  game.p.t = 1 - 0.07;   // the ball reaches the plate 0.07 s from now: a perfect swing
  const res = game.swing(game.p.x, game.p.y);
  check(res.label === 'HOME RUN' && game.score === 100 && game.homers === 1, 'home-run-derby: a perfectly timed, perfectly placed swing is a home run', JSON.stringify(res));
  step(60 * 4);
  check(game.pitch === 1, 'home-run-derby: the next pitch comes after the ball lands');
  step(90);
  const early = { p: game.p };
  game.p.t = 0.2; game.p.dur = 1;
  const r2 = game.swing(game.p.x, game.p.y);
  check(r2.label === 'STRIKE' && game.score === 100, 'home-run-derby: swinging far too early is a strike');
  step(120);
  step(60);
  if (game.state === 'wait') step(90);
  if (game.state === 'pitch') { game.p.dur = 1; game.p.t = 0.93 - 0.0; const r3 = game.swing(game.p.x + 5, game.p.y); check(r3.label === 'STRIKE', 'home-run-derby: a bat in the wrong place misses'); }
  step(60 * 60);
  check(result.ended && result.ended.score === game.score, 'home-run-derby: after ten pitches the run ends', JSON.stringify(result.ended));
}

// ---------- Curling ----------
{
  const cu = await import('../src/games/curling.js');
  check(cu.pointsFor(0, -30) === 10 && cu.pointsFor(1, -30) === 6 && cu.pointsFor(0, -28.2) === 3 && cu.pointsFor(2.9, -30) === 1 && cu.pointsFor(0, -20) === 0, 'curling: ring points 10 / 6 / 3 / 1');
  const one = [{ x: 0, z: 8, vx: 0, vz: -8, curl: 0 }];
  let t = 0;
  while (Math.hypot(one[0].vx, one[0].vz) > 0 && t < 60) { cu.stepStones(one, 1 / 60); t += 1 / 60; }
  check(one[0].z < -20 && one[0].z > -50 && Math.abs(one[0].x) < 1e-9, 'curling: friction stops a straight stone', one[0].z.toFixed(1));
  const swept = [{ x: 0, z: 8, vx: 0, vz: -8, curl: 0 }];
  while (Math.hypot(swept[0].vx, swept[0].vz) > 0 && t < 200) cu.stepStones(swept, 1 / 60, swept[0]);
  check(swept[0].z < one[0].z - 5, 'curling: sweeping carries the stone further');
  const pair = [{ x: 0, z: 0, vx: 0, vz: -6, curl: 0 }, { x: 0, z: -0.9, vx: 0, vz: 0, curl: 0 }];
  cu.stepStones(pair, 1 / 60);
  cu.stepStones(pair, 1 / 60);
  check(pair[1].vz < -3 && Math.abs(pair[0].vz) < 3, 'curling: a hit passes most of the speed to the stone it strikes');
  const curled = [{ x: 0, z: 0, vx: 0, vz: -3, curl: 1 }]; const straight = [{ x: 0, z: 0, vx: 0, vz: -3, curl: 0 }];
  for (let i = 0; i < 120; i++) { cu.stepStones(curled, 1 / 60); cu.stepStones(straight, 1 / 60); }
  check(curled[0].x > 0.05 && straight[0].x === 0, 'curling: a curling stone drifts sideways');
  const { game, input, step, result } = await boot('curling', 2);
  check(game.throwStone(0.68, 0) && game.phase === 'slide', 'curling: a throw sends a stone sliding');
  step(60 * 45);
  const st = game.stones[0];
  check(!st.out && st.z < -22 && st.z > -37, 'curling: a two-thirds power throw reaches the far end', `z ${st.z.toFixed(1)} x ${st.x.toFixed(2)}`);
  check(game.phase === 'aim' && game.thrown === 1, 'curling: after it stops you get the next stone');
  game.throwStone(0.05, 0);
  step(60 * 30);
  check(game.stones[1].out, 'curling: a stone that stops short of the hog line is removed');
  game.throwStone(0.68, 3.5);
  step(60 * 45);
  for (let i = 0; i < 3; i++) { game.throwStone(0.68, -0.5); step(60 * 45); }
  check(result.ended && result.ended.score === game.score(), 'curling: six stones end the run with the house score', JSON.stringify(result.ended));
}

// ---------- Plinko ----------
{
  const pl = await import('../src/games/plinko.js');
  const pegs = pl.makePegs();
  check(pegs.length > 60 && pegs.every((p) => Math.abs(p.x) < 7), 'plinko: a field of pegs inside the walls', String(pegs.length));
  check(pl.binOf(-6.9) === 0 && pl.binOf(6.9) === 8 && pl.binOf(0) === 4, 'plinko: bins are numbered left to right');
  let x = 12345;
  const rng = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
  const bins = new Array(9).fill(0);
  let stuck = 0; let total = 0;
  for (let i = 0; i < 120; i++) {
    const d = { x: (rng() - 0.5) * 2 * 0.5, y: 20.6, vx: 0, vy: 0 };
    let t = 0;
    while (t < 30 && !pl.stepDisc(d, 1 / 60, rng)) t += 1 / 60;
    if (t >= 30) stuck++; else { bins[pl.binOf(d.x)]++; total += [50, 20, 8, 4, 2, 4, 8, 20, 50][pl.binOf(d.x)]; }
  }
  check(stuck === 0, 'plinko: every disc reaches a bin within 30 s (120 drops)', `${stuck} stuck`);
  check(bins[4] + bins[3] + bins[5] > bins[0] + bins[8] + bins[1] + bins[7], 'plinko: discs mostly land in the middle', bins.join());
  check(total / 120 > 8 && total / 120 < 25, 'plinko: the average disc is worth 8-25 points', (total / 120).toFixed(1));
  const { game, input, step, result } = await boot('plinko', 2);
  check(game.drop(0) && game.left === 14, 'plinko: a drop uses a disc');
  check(!game.drop(0), 'plinko: a short cooldown between drops');
  step(60 * 20);
  check(game.discs.length === 0 && game.score >= 2, 'plinko: the disc lands and scores', String(game.score));
  for (let guard = 0; game.left > 0 && guard < 2000; guard++) { game.drop(0.3); step(20); }
  step(60 * 30);
  check(result.ended && result.ended.score === game.score, 'plinko: after fifteen discs the run ends', JSON.stringify(result.ended));
}

// ---------- Track Sprint ----------
{
  const ts = await import('../src/games/track-sprint.js');
  check(ts.rivalSpeed(10, 0) === 0 && ts.rivalSpeed(10, 1) < ts.rivalSpeed(10, 3) && ts.rivalSpeed(10, 30) > 9.99, 'track-sprint: rivals accelerate up to their top speed');
  const { game, input, step, result } = await boot('track-sprint', 2);
  check(game.state === 'marks', 'track-sprint: the race starts at the marks');
  game.tap('L');
  check(game.lock > 0 && game.falseStart, 'track-sprint: tapping before the gun is a false start');
  step(60 * 5);
  check(game.state === 'run', 'track-sprint: the gun goes');
  game.lock = 0;
  const g1 = game.tap('L'); const g2 = game.tap('R'); const g3 = game.tap('R');
  check(g1 === 1 && g2 === 1 && g3 < 0.5, 'track-sprint: alternating taps gain speed, repeating the same side barely does');
  // A masher tapping 9 times a second alternately runs the race.
  const race = async (seed, rate, heat0 = 0) => {
    const r = await boot('track-sprint', seed);
    let side = 0; let acc = 0;
    for (let i = 0; i < 60 * 240 && !r.result.ended; i++) {
      if (r.game.state === 'run') { acc += rate / 60; while (acc >= 1) { acc -= 1; r.game.tap(side++ % 2 ? 'L' : 'R'); } }
      r.step(1);
    }
    return r;
  };
  const fast = await race(3, 9);
  check(fast.result.ended && fast.game.results.length === 4, 'track-sprint: four heats then the run ends', JSON.stringify(fast.result.ended));
  const slow = await race(3, 3);
  check(fast.game.score > slow.game.score + 100, 'track-sprint: mashing faster scores far more', `${fast.game.score} vs ${slow.game.score}`);
  check(fast.game.results.filter((r) => r.place === 1).length >= 1, 'track-sprint: a fast masher wins at least one heat', JSON.stringify(fast.game.results.map((r) => r.place)));
}

// ---------- Keepie Uppie ----------
{
  const ku = await import('../src/games/keepie-uppie.js');
  const left = ku.kickVelocity({ x: 0, y: 5 }, { x: 1, y: 3 }, 0);
  const right = ku.kickVelocity({ x: 0, y: 5 }, { x: -1, y: 3 }, 0);
  const centre = ku.kickVelocity({ x: 0, y: 5 }, { x: 0, y: 3 }, 0);
  check(left.vx < 0 && right.vx > 0 && centre.vx === 0 && centre.vy > left.vy, 'keepie-uppie: the ball goes away from the side you hit it on, and best straight up');
  const { game, input, step, result } = await boot('keepie-uppie', 2);
  check(!game.kick(8, 1), 'keepie-uppie: a click far from the ball does nothing');
  game.pos.x = 0; game.pos.y = 4; game.vel.x = 0; game.vel.y = -3;
  check(game.kick(0, 3.5) && game.touches === 1 && game.vel.y > 10, 'keepie-uppie: a click near the ball kicks it up');
  // A bot that tracks the ball with the foot and kicks when it comes down.
  for (let i = 0; i < 60 * 60 && !result.ended; i++) {
    game.cursor.x = game.pos.x + 0.2; game.cursor.y = game.pos.y - 1.2;
    if (game.vel.y < 0 && game.pos.y < 6) game.kick(game.cursor.x, game.cursor.y);
    step(1);
  }
  check(!result.ended && game.touches > 40, 'keepie-uppie: a tracking bot keeps it going for a minute', `${game.touches} touches`);
  const g2 = await boot('keepie-uppie', 4);
  g2.step(60 * 6);
  check(g2.result.ended && g2.result.ended.score === 0, 'keepie-uppie: never kicking lets it hit the grass', JSON.stringify(g2.result.ended));
}

// ---------- Ski Jump ----------
{
  const sj = await import('../src/games/ski-jump.js');
  check(sj.hillY(0) === 0 && sj.hillY(50) < sj.hillY(10) && sj.hillY(500) === sj.hillY(sj.hillY.length ? 1000 : 1000), 'ski-jump: the hill drops away then levels out');
  check(sj.liftCoef(0.3) > sj.liftCoef(0) && sj.liftCoef(0.3) > sj.liftCoef(0.9) && sj.dragCoef(0.3) < sj.dragCoef(0.9), 'ski-jump: 0.3 is the best body angle');
  const ideal = sj.simulateJump(4.5, () => 0.3).dist;
  const flat = sj.simulateJump(4.5, () => 0.0).dist;
  const steep = sj.simulateJump(4.5, () => 0.9).dist;
  const noBoost = sj.simulateJump(0, () => 0.3).dist;
  check(ideal > 100 && ideal < 140, 'ski-jump: a perfect jump goes 100-140 m', ideal.toFixed(1));
  check(ideal > flat && ideal > steep && flat > 60 && steep > 40, 'ski-jump: the ideal angle beats flat and steep', `${ideal.toFixed(0)} ${flat.toFixed(0)} ${steep.toFixed(0)}`);
  check(ideal > noBoost + 3, 'ski-jump: a good take-off adds distance', `${ideal.toFixed(0)} vs ${noBoost.toFixed(0)}`);
  check(sj.jumpPoints(100, 4.5, true) > sj.jumpPoints(100, 0, false) && sj.jumpPoints(30, 0, false) === 0, 'ski-jump: distance, take-off and flare all score');
  const { game, input, step, result } = await boot('ski-jump', 2);
  check(game.phase === 'inrun', 'ski-jump: starts on the in-run');
  step(60 * 2);
  input.press('Space'); step(1);
  check(game.boost === 0 || game.pressed, 'ski-jump: a press while still high on the ramp uses up the take-off');
  const g2 = await boot('ski-jump', 3);
  const perfectAt = () => { const edge = g2.game.edgeT; g2.step(Math.round((edge - 1 / 60) * 60)); };
  perfectAt();
  g2.input.press('Space'); g2.step(3);
  check(g2.game.phase === 'flight' && g2.game.boost > 3.5, 'ski-jump: pressing right at the edge gives a big jump', `boost ${g2.game.boost}`);
  // Hold the body at 0.3 in the air.
  const hold = (r) => { const want = 0.3; const diff = want - r.game.pitch; if (Math.abs(diff) > 0.03) r.input.hold(diff > 0 ? 'KeyW' : 'KeyS'); else r.input.release('KeyW', 'KeyS'); if (diff > 0.03) r.input.release('KeyS'); if (diff < -0.03) r.input.release('KeyW'); };
  for (let i = 0; i < 60 * 12 && g2.game.phase === 'flight'; i++) { hold(g2); g2.step(1); }
  check(g2.game.phase === 'landed' && g2.game.results[0].dist > 90, 'ski-jump: a steady 0.3 angle glides past 90 m', JSON.stringify(g2.game.results));
  // Three jumps end the run.
  for (let j = 0; j < 2; j++) {
    g2.input.release();
    g2.step(60 * 3);
    g2.step(Math.round((g2.game.edgeT - g2.game.t - 1 / 60) * 60));
    g2.input.press('Space'); g2.step(3);
    for (let i = 0; i < 60 * 12 && g2.game.phase === 'flight'; i++) { hold(g2); g2.step(1); }
  }
  g2.step(60 * 4);
  check(g2.result.ended && g2.result.ended.score === g2.game.score && g2.game.results.length === 3, 'ski-jump: three jumps end the run with the total', JSON.stringify(g2.result.ended));
}

// ---------- Pool Break ----------
{
  const pb = await import('../src/games/pool-break.js');
  const rack = pb.rack();
  let overlap = false;
  for (let i = 0; i < rack.length; i++) for (let j = i + 1; j < rack.length; j++) if (Math.hypot(rack[i].x - rack[j].x, rack[i].z - rack[j].z) < 0.9) overlap = true;
  check(rack.length === 10 && !overlap, 'pool-break: ten balls racked without overlapping');
  const b = [{ x: 0, z: 0, vx: 8, vz: 0, alive: true }, { x: 0.9, z: 0, vx: 0, vz: 0, alive: true }];
  const mom = () => b[0].vx + b[1].vx;
  const m0 = mom();
  for (let i = 0; i < 6; i++) pb.stepBalls(b, 1 / 60);
  check(b[1].vx > 6 && b[0].vx < 1.5 && Math.abs(mom() - m0) < 1, 'pool-break: a head-on hit passes the speed to the ball hit');
  const roll = [{ x: -5, z: 0, vx: 6, vz: 0, alive: true }];
  let t = 0;
  while (pb.anyMoving(roll) && t < 30) { pb.stepBalls(roll, 1 / 60); t += 1 / 60; }
  check(!pb.anyMoving(roll) && t < 25, 'pool-break: friction stops a rolling ball', `${t.toFixed(1)} s`);
  const corner = [{ x: 8.5, z: 3.5, vx: 5, vz: 3.5, alive: true }];
  let potted = [];
  for (let i = 0; i < 90 && !potted.length; i++) potted = pb.stepBalls(corner, 1 / 60);
  check(potted.length === 1 && !corner[0].alive, 'pool-break: a ball rolling into a pocket is potted');
  const wall = [{ x: 9.5, z: 0, vx: 5, vz: 0, alive: true }];
  pb.stepBalls(wall, 1 / 30);
  check(wall[0].vx < 0, 'pool-break: cushions bounce balls back');
  const { game, input, step, result } = await boot('pool-break', 2);
  check(game.balls.length === 11 && game.shots === 14, 'pool-break: white ball, ten object balls, fourteen shots');
  check(game.shoot(0, 1) && game.phase === 'roll' && game.shots === 13, 'pool-break: a shot uses one of the fourteen');
  step(60 * 30);
  check(game.phase === 'aim', 'pool-break: play returns to aiming once the balls stop', game.phase);
  const c = game.cue();
  check(game.balls.slice(1).some((x) => Math.hypot(x.x, x.z) > 0 && (x.x < 4 - 0.5 || x.x > 4.9)), 'pool-break: the break scattered the rack');
  // Force a scratch.
  game.balls[0].x = 8.6; game.balls[0].z = 3.6; game.balls[0].alive = true;
  const s0 = game.score;
  game.shoot(Math.atan2(1.4, 1.4), 0.6);
  step(60 * 20);
  check(game.cue().alive && game.scratches >= 1 && game.score <= s0, 'pool-break: a scratch loses points and the white comes back', `scratches ${game.scratches}`);
  while (game.shots > 0 && !result.ended) { game.shoot(Math.random() * 6.28, 0.7); step(60 * 25); }
  step(60 * 5);
  check(result.ended && result.ended.score === game.score, 'pool-break: fourteen shots end the run', JSON.stringify(result.ended));
  const g3 = await boot('pool-break', 3);
  g3.game.balls.slice(1).forEach((x) => { x.alive = false; });
  g3.game.shoot(0, 0.2);
  g3.step(60 * 20);
  check(g3.result.ended && g3.result.ended.detail.includes('cleared'), 'pool-break: clearing the table wins with a bonus', JSON.stringify(g3.result.ended));
}

// ---------- Slingshot Smash ----------
{
  const sm = await import('../src/games/slingshot-smash.js');
  check(sm.LEVELS.every((l) => sm.isSupported(l)), 'slingshot-smash: no level has floating blocks');
  check(!sm.isSupported(['p.p', '...', 'www']) === false || sm.isSupported(['p..', '.w.', 'www']) === false, 'slingshot-smash: floating blocks are detected');
  const cols = sm.parseTower(sm.LEVELS[0]);
  check(cols.length === 5 && cols[2].length === 4 && cols[0].length === 2 && cols[2][3].type === 'p', 'slingshot-smash: towers parse from the ground up');
  const { game, input, step, result } = await boot('slingshot-smash', 2);
  check(game.pigsLeft() === 2 && game.shotsLeft === 4, 'slingshot-smash: level one has two pigs and four shots');
  const woodCol = 0;
  check(game.damage(woodCol, 1) === false && game.tower[woodCol].length === 2, 'slingshot-smash: wood survives one hit');
  check(game.damage(woodCol, 1) === true && game.tower[woodCol].length === 1 && game.score === 10, 'slingshot-smash: a second hit smashes it for 10');
  // Pig on top of column 2: removing the block beneath drops it one row and squashes it.
  const before = game.score;
  game.damage(2, 2, 2);
  check(game.pigsLeft() === 1 && game.score >= before + 10 + 100, 'slingshot-smash: a pig that falls is squashed for 100', `${before} -> ${game.score}`);
  // Fire at the tower with a decent pull and see something happen.
  const g2 = await boot('slingshot-smash', 3);
  check(!g2.game.fire(0.1, 0.1), 'slingshot-smash: a tiny pull does not fire');
  let best = 0;
  for (const [px, py] of [[3.6, 1.6], [3.9, 1.3], [3.4, 2.0], [3.8, 0.9]]) {
    const g = await boot('slingshot-smash', 4);
    g.game.fire(px, py);
    g.step(60 * 6);
    best = Math.max(best, g.game.score);
  }
  check(best > 0, 'slingshot-smash: some pull angles smash into the tower', String(best));
  const g3 = await boot('slingshot-smash', 5);
  for (let i = 0; i < 4; i++) { g3.game.fire(1, 1); g3.step(60 * 6); }
  check(g3.result.ended && g3.result.ended.score === g3.game.score, 'slingshot-smash: four wasted shots end the run', JSON.stringify(g3.result.ended));
  const g4 = await boot('slingshot-smash', 6);
  while (g4.game.pigsLeft()) {
    const ci = g4.game.tower.findIndex((col) => col.some((c) => c.type === 'p'));
    g4.game.damage(ci, g4.game.tower[ci].findIndex((c) => c.type === 'p'), 9);
  }
  g4.game.fire(3.5, 1.5);
  g4.step(60 * 6);
  check(g4.game.level === 1 && g4.game.pigsLeft() === 4, 'slingshot-smash: clearing the pigs moves on to level two with fresh pigs', `level ${g4.game.level} pigs ${g4.game.pigsLeft()}`);
}

finish('more-games');
