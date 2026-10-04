/* Parental controls: the rules and the timer. No screens in here (those are src/ui/Parental.js).
 *
 * One classic script, loaded by the arcade page and by the Unity game pages (same website, so they share the same
 * browser storage), so play time is counted in one place wherever the child is playing:  window.MimiParental.
 *
 * What it does:
 *   - Play time per day (one limit for weekdays, one for weekends), extra time a parent grants, and allowed hours.
 *   - Counts time only while the page is visible, the child is doing something (pointer, keys, touch or controller
 *     within the last 5 minutes) and this tab holds the "lease" (two tabs open never count double).
 *   - Warns at 5 and 1 minutes left, can remind about a break, and reports when it is time to lock.
 *   - A PIN (4-8 digits), stored salted and hashed, with a 5 minute lock-out after 5 wrong tries.
 *   - A list of blocked games, and "keep inside the arcade" (hide links to other sites, sign-in, bug reports).
 *
 * Honest limits: this is kept in the browser, on this device. Someone who clears the site's data, or uses another
 * browser, a private window or another device, is not limited. It is a house rule, not a security system.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MimiParental = api;
})(typeof window !== 'undefined' ? window : globalThis, function (g) {
  'use strict';

  var KEY = 'mg.parental.v1';
  var USED_KEY = 'mg.parental.used.v1';
  var LEASE_KEY = 'mg.parental.lease.v1';
  var IDLE_MS = 5 * 60 * 1000;
  var LEASE_MS = 2500;
  var PIN_ROUNDS = 1000;

  var clock = function () { return Date.now(); };
  var memory = {};   // used when the browser will not let us store anything

  /* ------------------------------------------------------------ storage */
  function read(k) {
    try { var v = g.localStorage.getItem(k); if (v !== null && v !== undefined) return v; } catch (e) { /* fall through */ }
    return Object.prototype.hasOwnProperty.call(memory, k) ? memory[k] : null;
  }
  function write(k, v) {
    try { g.localStorage.setItem(k, v); return; } catch (e) { /* fall through */ }
    memory[k] = v;
  }

  /* ----------------------------------------------------------- settings */
  function num(v, lo, hi, d) { v = Number(v); return isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d; }
  function hm(v, d) { return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : d; }

  function sanitize(r) {
    r = r && typeof r === 'object' ? r : {};
    var pin = r.pin && typeof r.pin.salt === 'string' && typeof r.pin.hash === 'string' && r.pin.salt.length <= 64 && r.pin.hash.length <= 120
      ? { salt: r.pin.salt, hash: r.pin.hash } : null;
    var seen = {};
    var blocked = (Array.isArray(r.blocked) ? r.blocked : []).filter(function (x) {
      if (typeof x !== 'string' || x.length > 60 || seen[x]) return false;
      seen[x] = true; return true;
    }).slice(0, 400);
    var every = num(r.breakEvery, 0, 180, 0);
    return {
      v: 1,
      enabled: r.enabled === true && !!pin,                 // can never be on without a PIN to turn it off
      pin: pin,
      limits: { weekday: num(r.limits && r.limits.weekday, 0, 600, 60), weekend: num(r.limits && r.limits.weekend, 0, 600, 120) },   // minutes, 0 = no limit
      hours: { on: !!(r.hours && r.hours.on), from: hm(r.hours && r.hours.from, '07:00'), to: hm(r.hours && r.hours.to, '19:30') },
      breakEvery: every > 0 && every < 5 ? 5 : every,
      keepInside: r.keepInside !== false,
      blocked: blocked,
      bonus: { date: r.bonus && /^\d{4}-\d{2}-\d{2}$/.test(r.bonus.date) ? r.bonus.date : '', minutes: num(r.bonus && r.bonus.minutes, 0, 600, 0) },
      pass: { until: num(r.pass && r.pass.until, 0, 4e12, 0) },   // a parent let them play outside the allowed hours until this time
      lock: { fails: num(r.lock && r.lock.fails, 0, 100, 0), until: num(r.lock && r.lock.until, 0, 4e12, 0) },
    };
  }

  var listeners = [];
  function load() {
    var raw = read(KEY), parsed = null;
    if (raw) { try { parsed = JSON.parse(raw); } catch (e) { parsed = null; } }
    return sanitize(parsed);
  }
  function assign(cur, patch) {
    var out = {};
    Object.keys(cur).forEach(function (k) { out[k] = cur[k]; });
    Object.keys(patch || {}).forEach(function (k) {
      var v = patch[k];
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && cur[k] && typeof cur[k] === 'object' && !Array.isArray(cur[k]) ? assign(cur[k], v) : v;
    });
    return out;
  }
  function save(patch) {
    var next = sanitize(assign(load(), patch));
    write(KEY, JSON.stringify(next));
    refresh();
    listeners.slice().forEach(function (fn) { try { fn(next); } catch (e) { /* a listener's bug must not break saving */ } });
    return next;
  }

  /* -------------------------------------------------------------- dates */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dateKey(d) { d = d || new Date(clock()); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function isWeekend(d) { var w = d.getDay(); return w === 0 || w === 6; }
  function minutesOf(s) { return Number(s.slice(0, 2)) * 60 + Number(s.slice(3)); }

  /* ---------------------------------------------------------- the clock */
  function usedSeconds() {
    var u = null;
    try { u = JSON.parse(read(USED_KEY)); } catch (e) { u = null; }
    return u && u.date === dateKey() && isFinite(u.seconds) && u.seconds > 0 ? u.seconds : 0;
  }
  function addUsed(sec) { write(USED_KEY, JSON.stringify({ date: dateKey(), seconds: usedSeconds() + sec })); }

  function hoursState(s, d, now) {
    if (!s.hours.on) return { ok: true };
    if (s.pass.until > now) return { ok: true, pass: true };
    var from = minutesOf(s.hours.from), to = minutesOf(s.hours.to), m = d.getHours() * 60 + d.getMinutes();
    if (from === to) return { ok: true };
    var ok = from < to ? (m >= from && m < to) : (m >= from || m < to);   // from > to is an overnight window
    return { ok: ok };
  }

  /** Where things stand right now: { enabled, locked: null | {kind:'time'|'hours', ...}, remaining (seconds, or null for no limit), limit (minutes), bonus, used (seconds) }. */
  function status() {
    var s = load();
    if (!s.enabled) return { enabled: false, locked: null, remaining: null, limit: 0, bonus: 0, used: usedSeconds() };
    var now = clock(), d = new Date(now);
    var limit = isWeekend(d) ? s.limits.weekend : s.limits.weekday;
    var bonus = s.bonus.date === dateKey(d) ? s.bonus.minutes : 0;
    var used = usedSeconds();
    var remaining = limit > 0 ? Math.max(0, (limit + bonus) * 60 - used) : null;
    var hrs = hoursState(s, d, now);
    var locked = null;
    if (!hrs.ok) locked = { kind: 'hours', from: s.hours.from, to: s.hours.to };
    else if (remaining !== null && remaining <= 0) locked = { kind: 'time', limit: limit, bonus: bonus };
    return { enabled: true, locked: locked, remaining: remaining, limit: limit, bonus: bonus, used: used };
  }

  /* ---------------------------------------------------------------- PIN */
  function toHex(buf) { var a = new Uint8Array(buf), o = ''; for (var i = 0; i < a.length; i++) o += (a[i] < 16 ? '0' : '') + a[i].toString(16); return o; }
  function randomHex(n) {
    var a = new Uint8Array(n);
    if (g.crypto && g.crypto.getRandomValues) g.crypto.getRandomValues(a); else for (var i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256);
    return toHex(a);
  }
  function cyrb(str, seed) {   // a small non-cryptographic hash, only for pages with no WebCrypto (plain http)
    var h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (var i = 0; i < str.length; i++) { var c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return ('00000000' + (h2 >>> 0).toString(16)).slice(-8) + ('00000000' + (h1 >>> 0).toString(16)).slice(-8);
  }
  function digest(text) {
    if (g.crypto && g.crypto.subtle && typeof TextEncoder !== 'undefined') {
      return g.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(toHex);
    }
    return Promise.resolve(cyrb(text, 1) + cyrb(text, 7));
  }
  function hashPin(salt, pin) {
    var h = salt + ':' + pin;
    var step = function (i) { return i >= PIN_ROUNDS ? Promise.resolve(h) : digest(h + ':' + i).then(function (x) { h = x; return step(i + 1); }); };
    return step(0);
  }
  var validPin = function (pin) { return typeof pin === 'string' && /^\d{4,8}$/.test(pin); };

  /** Sets the PIN (and switches the controls on). */
  function setPin(pin) {
    if (!validPin(pin)) return Promise.resolve({ ok: false, msg: 'The PIN is 4 to 8 digits.' });
    var salt = randomHex(16);
    return hashPin(salt, pin).then(function (hash) {
      save({ pin: { salt: salt, hash: hash }, enabled: true, lock: { fails: 0, until: 0 } });
      return { ok: true };
    });
  }

  /** Checks a PIN. { ok:true } | { ok:false, left } tries remaining | { ok:false, wait } seconds locked out | { ok:false, noPin:true }. */
  function verifyPin(pin) {
    var s = load(), now = clock();
    if (!s.pin) return Promise.resolve({ ok: false, noPin: true });
    if (s.lock.until > now) return Promise.resolve({ ok: false, wait: Math.ceil((s.lock.until - now) / 1000) });
    if (!validPin(pin)) return Promise.resolve({ ok: false, left: Math.max(0, 5 - s.lock.fails) });
    return hashPin(s.pin.salt, pin).then(function (hash) {
      if (hash === s.pin.hash) { if (s.lock.fails || s.lock.until) save({ lock: { fails: 0, until: 0 } }); return { ok: true }; }
      var fails = s.lock.fails + 1;
      if (fails >= 5) { save({ lock: { fails: 0, until: clock() + 5 * 60 * 1000 } }); return { ok: false, wait: 300 }; }
      save({ lock: { fails: fails, until: 0 } });
      return { ok: false, left: 5 - fails };
    });
  }

  function changePin(oldPin, newPin) {
    return verifyPin(oldPin).then(function (r) { return r.ok ? setPin(newPin) : r; });
  }

  /* ------------------------------------------------- parents' shortcuts */
  /** Adds minutes to today's allowance (and lets them play out of hours for that long). */
  function grant(minutes) {
    var s = load(), today = dateKey();
    var add = num(minutes, 0, 600, 0);
    var next = save({ bonus: { date: today, minutes: Math.min(600, (s.bonus.date === today ? s.bonus.minutes : 0) + add) }, pass: { until: clock() + add * 60 * 1000 } });
    return next;
  }
  function resetToday() { write(USED_KEY, JSON.stringify({ date: dateKey(), seconds: 0 })); refresh(); }

  /* ------------------------------------------------------ what is allowed */
  function gameBlocked(id) { var s = load(); return s.enabled && s.blocked.indexOf(id) >= 0; }
  function keepInside() { var s = load(); return s.enabled && s.keepInside; }

  /* ----------------------------------------------------------- the timer */
  var active = null;   // the running ticker, if any

  function createTicker(h) {
    return { id: randomHex(6), h: h || {}, lastActive: clock(), sinceBreak: 0, warned: {}, lockKey: null, changeKey: null, timer: null, last: clock(), undo: [] };
  }

  function lease(T) {
    var now = clock(), L = null;
    try { L = JSON.parse(read(LEASE_KEY)); } catch (e) { L = null; }
    if (L && L.id !== T.id && now - L.t < LEASE_MS) return false;   // another tab of this site is counting
    write(LEASE_KEY, JSON.stringify({ id: T.id, t: now }));
    return true;
  }

  function pollGamepads(T) {
    try {
      var pads = g.navigator && g.navigator.getGamepads ? g.navigator.getGamepads() : [];
      for (var i = 0; i < pads.length; i++) {
        var p = pads[i]; if (!p) continue;
        var busy = p.buttons.some(function (b) { return b.pressed; }) || p.axes.some(function (a) { return Math.abs(a) > 0.4; });
        if (busy) { T.lastActive = clock(); return; }
      }
    } catch (e) { /* no gamepad API */ }
  }

  /** Advances the timer by `dt` seconds of wall-clock time and reports what changed. (The real timer calls this every second; tests call it directly.) */
  function tick(dt, o) {
    var T = active;
    if (!T) return status();
    o = o || {};
    var before = status();
    if (before.enabled) {
      var visible = o.visible !== undefined ? o.visible : (!g.document || g.document.visibilityState !== 'hidden');
      var idle = !o.ignoreIdle && clock() - T.lastActive > IDLE_MS;
      if (visible && !idle && !before.locked && dt > 0 && lease(T)) { addUsed(dt); T.sinceBreak += dt; }
      if (idle) T.sinceBreak = 0;
    }
    return evaluate(T);
  }

  function evaluate(T) {
    var st = status(), h = T.h, s = st.enabled ? load() : null;
    if (st.enabled && st.remaining !== null && !st.locked) {
      [300, 60].forEach(function (th) {
        var k = dateKey() + ':' + th;
        if (st.remaining <= th && !T.warned[k]) { T.warned[k] = true; if (h.onWarn) h.onWarn(Math.max(1, Math.ceil(st.remaining / 60)), st); }
      });
    }
    if (s && s.breakEvery > 0 && T.sinceBreak >= s.breakEvery * 60) { T.sinceBreak = 0; if (h.onBreak) h.onBreak(s.breakEvery); }
    var lockKey = st.locked ? st.locked.kind : null;
    if (lockKey !== T.lockKey) { T.lockKey = lockKey; if (lockKey) { if (h.onLock) h.onLock(st); } else if (h.onUnlock) h.onUnlock(st); }
    var changeKey = [lockKey, st.remaining === null ? 'x' : Math.ceil(st.remaining / 60), st.limit, st.enabled].join('|');
    if (changeKey !== T.changeKey) { T.changeKey = changeKey; if (h.onChange) h.onChange(st); }
    return st;
  }

  /** Re-checks everything now (after settings changed, or a grant). */
  function refresh() { if (active) evaluate(active); }

  /** Starts the real timer. hooks: onChange(status), onWarn(minutesLeft), onBreak(everyMinutes), onLock(status), onUnlock(status). */
  function start(hooks) {
    stop();
    var T = createTicker(hooks);
    active = T;
    var note = function () { T.lastActive = clock(); };
    if (g.addEventListener) {
      ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'].forEach(function (n) {
        g.addEventListener(n, note, { passive: true, capture: true });
        T.undo.push(function () { g.removeEventListener(n, note, { capture: true }); });
      });
    }
    T.timer = setInterval(function () {
      var now = clock(), dt = Math.min(5, Math.max(0, (now - T.last) / 1000));   // a computer that slept is not counted as playing
      T.last = now;
      pollGamepads(T);
      tick(dt);
    }, 1000);
    if (T.timer && T.timer.unref) T.timer.unref();   // (lets a test process exit)
    evaluate(T);
    return T;
  }
  function stop() {
    if (!active) return;
    clearInterval(active.timer);
    active.undo.forEach(function (u) { try { u(); } catch (e) { /* ignore */ } });
    active = null;
  }

  return {
    // settings
    load: load, save: save, onSettings: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    hasPin: function () { return !!load().pin; }, enabled: function () { return load().enabled; },
    // PIN
    setPin: setPin, verifyPin: verifyPin, changePin: changePin, validPin: validPin,
    // rules
    status: status, gameBlocked: gameBlocked, keepInside: keepInside, dateKey: dateKey, isWeekend: isWeekend,
    // parents' shortcuts
    grant: grant, resetToday: resetToday,
    // the timer
    start: start, stop: stop, tick: tick, refresh: refresh, noteActivity: function () { if (active) active.lastActive = clock(); },
    // for tests
    _setClock: function (fn) { clock = fn; }, _memory: memory, IDLE_MS: IDLE_MS,
  };
});
