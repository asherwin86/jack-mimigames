/**
 * The commands of the admin console (src/ui/AdminConsole.js), kept apart from the screen so they can be checked on their
 * own (scripts/check-admin-console.mjs). Every command returns { ok, text }, or a Promise of one.
 *
 * `env` is everything a command touches, so a test can fake it:
 *   { Rocoins, tools (RocoinTools), games: [{id,name}], go(hash), info(), hub: { url(), set(url|null), ping() },
 *     season(value), refresh(), lock(), clear() }
 */
const num = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : NaN; };
const ok = (text) => ({ ok: true, text });
const bad = (text) => ({ ok: false, text });

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
      usage: 'reset coins yes', about: 'wipe the Rocoin wallet on this device (cannot be undone)',
      run: ([what, sure]) => {
        if (what !== 'coins') return bad('Use: reset coins yes');
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
