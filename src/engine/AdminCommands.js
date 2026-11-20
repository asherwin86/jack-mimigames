/**
 * The commands of the admin console (src/ui/AdminConsole.js), kept apart from the screen so they can be checked on their
 * own (scripts/check-admin-console.mjs). Every command returns { ok, text }, or a Promise of one.
 *
 * `env` is everything a command touches, so a test can fake it:
 *   { Rocoins, tools (RocoinTools), games: [{id,name}], go(hash), info(), hub: { url(), set(url|null), ping() },
 *     season(value), refresh(), lock(), clear(), rand(), reload(), fullscreen(), reports(), backup(), restore(),
 *     powers(): [{id,name,cost}], runPower(id): Promise<{ok,text}>,
 *     settings: { list(): [{name,on}], set(name, on) }  (name is one of SETTING_NAMES),
 *     scores: { all(): {gameId: score}, clear(gameIdOrNull) }, resetSettings(),
 *     account: { name(), signOut() } }
 */
const num = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : NaN; };
const ok = (text) => ({ ok: true, text });
const bad = (text) => ({ ok: false, text });
/** The display toggles the console can change (the names people type). */
export const SETTING_NAMES = ['props', 'music', 'blacksky', 'seasonal', 'nospin', 'highcontrast', 'compact'];

export function makeCommands(env) {
  const { Rocoins } = env;
  const coinsLine = () => (Rocoins.infinite() ? 'Infinite Rocoins is on.' : `You have ${Rocoins.balance()} Rocoins (${Rocoins.earned()} earned, ${Rocoins.spent()} spent).`);

  const findGame = (q) => {
    const s = String(q || '').trim().toLowerCase();
    if (!s) return null;
    return env.games.find((g) => g.id === s) || env.games.find((g) => g.name.toLowerCase() === s)
      || env.games.find((g) => g.id.includes(s) || g.name.toLowerCase().includes(s)) || null;
  };

  const C = {
    help: {
      usage: 'help', about: 'this list',
      run: () => ok(Object.entries(C).map(([n, c]) => `${c.usage.padEnd(22)} ${c.about}`).join('\n')),
    },
    coins: { usage: 'coins', about: 'show your Rocoins', run: () => ok(coinsLine()) },
    give: {
      usage: 'give <amount>', about: 'add Rocoins (up to 10,000,000)',
      run: ([a]) => {
        const n = num(a);
        if (!(n > 0)) return bad('Give how many? Try: give 500');
        const bal = env.tools.give(Math.min(n, 1e7));
        return bal === null ? bad('The tools are locked.') : ok(`Added ${Math.min(n, 1e7)}. ${coinsLine()}`);
      },
    },
    take: {
      usage: 'take <amount>', about: 'remove Rocoins',
      run: ([a]) => {
        const n = num(a);
        if (!(n > 0)) return bad('Take how many? Try: take 50');
        if (Rocoins.infinite()) return bad('Infinite Rocoins is on. Turn it off first: infinite off');
        return Rocoins.spend(n) ? ok(`Took ${n}. ${coinsLine()}`) : bad(`You only have ${Rocoins.balance()}.`);
      },
    },
    set: {
      usage: 'set <amount>', about: 'make your balance exactly this',
      run: ([a]) => {
        const n = num(a);
        if (!(n >= 0) || n > 1e7) return bad('Set it to a number from 0 to 10,000,000.');
        if (Rocoins.infinite()) return bad('Infinite Rocoins is on. Turn it off first: infinite off');
        const diff = n - Rocoins.balance();
        if (diff > 0) env.tools.give(diff); else if (diff < 0) Rocoins.spend(-diff);
        return ok(coinsLine());
      },
    },
    infinite: {
      usage: 'infinite on|off', about: 'everything costs nothing while on',
      run: ([a]) => {
        const v = String(a || '').toLowerCase();
        if (!['on', 'off'].includes(v)) return bad(`Infinite Rocoins is ${Rocoins.infinite() ? 'on' : 'off'}. Use: infinite on  or  infinite off`);
        env.tools.setInfinite(v === 'on');
        return ok(`Infinite Rocoins is ${v}.`);
      },
    },
    games: {
      usage: 'games [word]', about: 'list games (and their ids)',
      run: ([w]) => {
        const s = String(w || '').toLowerCase();
        const list = env.games.filter((g) => !s || g.id.includes(s) || g.name.toLowerCase().includes(s));
        return list.length ? ok(`${list.length} game${list.length === 1 ? '' : 's'}: ${list.map((g) => `${g.name} (${g.id})`).join(', ')}`) : bad(`No game matches "${w}".`);
      },
    },
    play: {
      usage: 'play <game>', about: 'open a game by name or id',
      run: (args) => {
        const g = findGame(args.join(' '));
        if (!g) return bad(`No game matches "${args.join(' ')}". Try: games`);
        env.go(`#/${g.id}`);
        return ok(`Opening ${g.name}.`);
      },
    },
    random: {
      usage: 'random', about: 'open a random game',
      run: () => {
        const g = env.games[Math.floor(env.rand() * env.games.length)];
        env.go(`#/${g.id}`);
        return ok(`Opening ${g.name}.`);
      },
    },
    powers: {
      usage: 'powers', about: 'list the powers you can run here',
      run: () => {
        const list = env.powers();
        return list.length ? ok(list.map((p) => `${p.id} (${p.name}, ${p.cost})`).join(', ')) : bad('No powers here. Start a game first, then try again.');
      },
    },
    power: {
      usage: 'power <id>', about: 'run any power for free (during a game)',
      run: async ([id]) => {
        if (!id) return bad('Which power? Type powers to see them.');
        const r = await env.runPower(String(id).toLowerCase());
        return r.ok ? ok(r.text) : bad(r.text);
      },
    },
    setting: {
      usage: 'setting [name on|off]', about: 'show or change a display setting (reloads)',
      run: ([name, v]) => {
        const rows = env.settings.list();
        if (!name) return ok(rows.map((r) => `${r.name}: ${r.on ? 'on' : 'off'}`).join('\n'));
        const n = String(name).toLowerCase();
        if (!SETTING_NAMES.includes(n)) return bad(`No setting called "${name}". Choices: ${SETTING_NAMES.join(', ')}`);
        const x = String(v || '').toLowerCase();
        if (!['on', 'off'].includes(x)) return bad(`Use: setting ${n} on  or  setting ${n} off`);
        env.settings.set(n, x === 'on');
        return ok(`${n} is now ${x}. Reloading…`);
      },
    },
    scores: {
      usage: 'scores [clear <game|all> yes]', about: 'show best scores, or wipe them',
      run: ([a, b, c]) => {
        if (!a) {
          const all = env.scores.all();
          const rows = Object.entries(all);
          return rows.length ? ok(`${rows.length} best score${rows.length === 1 ? '' : 's'}: ${rows.map(([id, v]) => `${id} ${v}`).join(', ')}`) : ok('No scores saved yet.');
        }
        if (a !== 'clear') return bad('Use: scores  or  scores clear <game|all> yes');
        if (!b) return bad('Clear which game? Use: scores clear <game|all> yes');
        const g = b === 'all' ? null : findGame(b);
        if (b !== 'all' && !g) return bad(`No game matches "${b}".`);
        if (c !== 'yes') return bad(`This deletes ${g ? `the best score for ${g.name}` : 'every best score on this device'}. If you are sure, add yes: scores clear ${b} yes`);
        env.scores.clear(g ? g.id : null);
        return ok(g ? `Cleared the best score for ${g.name}.` : 'Cleared every best score.');
      },
    },
    reports: { usage: 'reports', about: 'open the bug report inbox', run: () => { env.reports(); return ok('Opening the inbox…'); } },
    account: {
      usage: 'account [signout]', about: 'who is signed in here, or sign out',
      run: ([a]) => {
        const n = env.account.name();
        if (a === 'signout') { if (!n) return bad('Nobody is signed in.'); env.account.signOut(); return ok(`Signed ${n} out.`); }
        return ok(n ? `Signed in as ${n}.` : 'Nobody is signed in.');
      },
    },
    backup: { usage: 'backup', about: 'download your saves (scores, Rocoins, settings) as a file', run: () => ok(env.backup()) },
    restore: {
      usage: 'restore yes', about: 'load a backup file over the saves on this device',
      run: ([sure]) => (sure === 'yes' ? (env.restore(), ok('Choose the backup file…')) : bad('This replaces the saves on this device with the ones in a backup file. If you are sure: restore yes')),
    },
    fullscreen: { usage: 'fullscreen', about: 'toggle fullscreen', run: () => { env.fullscreen(); return ok('Toggled fullscreen.'); } },
    reload: { usage: 'reload', about: 'reload the page (keeps your saved copy)', run: () => { env.reload(); return ok('Reloading…'); } },
    home: { usage: 'home', about: 'back to the menu', run: () => { env.go(''); return ok('Back to the menu.'); } },
    season: {
      usage: 'season holidays|off|auto', about: 'force the holiday colours, turn them off, or go back to normal',
      run: ([v]) => {
        const x = String(v || '').toLowerCase();
        if (!['holidays', 'off', 'auto'].includes(x)) return bad('Use: season holidays  or  season off  or  season auto');
        env.season(x);
        return ok('Reloading with that setting…');
      },
    },
    info: { usage: 'info', about: 'version, account, server and device details', run: () => ok(env.info()) },
    hub: {
      usage: 'hub [url|reset|ping]', about: 'show, change or test the account server address',
      run: async ([a]) => {
        const v = String(a || '').trim();
        if (!v) return ok(`Account server: ${env.hub.url()}`);
        if (v === 'ping') return env.hub.ping();
        if (v === 'reset') { env.hub.set(null); return ok(`Back to the default: ${env.hub.url()}`); }
        if (!/^https?:\/\/[^\s]+$/i.test(v)) return bad('Give a full address, like https://something.example.com');
        env.hub.set(v);
        return ok(`Account server is now ${env.hub.url()}. Try: hub ping`);
      },
    },
    refresh: { usage: 'refresh', about: 'clear the downloaded copy of the app and reload', run: () => { env.refresh(); return ok('Clearing the saved copy and reloading…'); } },
    reset: {
      usage: 'reset coins|settings yes', about: 'wipe the Rocoin wallet, or the display settings, on this device',
      run: ([what, sure]) => {
        if (what === 'settings') {
          if (sure !== 'yes') return bad('This puts every display setting back to normal. If you are sure: reset settings yes');
          env.resetSettings();
          return ok('Display settings reset. Reloading…');
        }
        if (what !== 'coins') return bad('Use: reset coins yes  or  reset settings yes');
        if (sure !== 'yes') return bad('This erases every Rocoin and completed challenge on this device. If you are sure: reset coins yes');
        Rocoins.reset();
        return ok('The wallet on this device is now empty.');
      },
    },
    clear: { usage: 'clear', about: 'clear this screen', run: () => { env.clear(); return ok(''); } },
    lock: { usage: 'lock', about: 'lock the admin tools again', run: () => { env.lock(); return ok('Locked.'); } },
  };

  /** Runs one line of text. */
  async function run(line) {
    const parts = String(line || '').trim().replace(/^\//, '').split(/\s+/).filter(Boolean);
    if (!parts.length) return ok('');
    const name = parts[0].toLowerCase();
    const cmd = C[name] || (name === '?' ? C.help : name === 'balance' ? C.coins : null);
    if (!cmd) return bad(`No command called "${parts[0]}". Type help.`);
    try { return await cmd.run(parts.slice(1)); } catch (e) { return bad(`That did not work: ${e?.message || e}`); }
  }

  return { run, names: Object.keys(C) };
}
