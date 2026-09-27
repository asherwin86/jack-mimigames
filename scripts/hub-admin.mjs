#!/usr/bin/env node
/**
 * Operator tool for the account server: rename an account, set a password, and
 * grant the bug report inbox. It talks to the running server, which must have
 * HUB_ADMIN_TOKEN set (16+ characters); the server makes the change itself.
 *
 *   HUB_URL=https://mimi-arcade-hub.onrender.com HUB_ADMIN_TOKEN=... \
 *     node scripts/hub-admin.mjs <command> ...
 *
 * Commands:
 *   accounts                          list every account (names and flags only)
 *   set-password <name> <password>    set a new password (signs every device out)
 *   rename <from> <to> <password>     rename an account, keep its worlds and Rocoins, set its password
 *   make-admin <name>                 let the account read the bug report inbox
 *   remove-admin <name>
 *   setup <from> <to> <password>      rename (if the name differs), set the password and make it the admin
 */
const USAGE = `Account server operator tool. Needs HUB_ADMIN_TOKEN (and optionally HUB_URL) in the environment.

  node scripts/hub-admin.mjs accounts
  node scripts/hub-admin.mjs set-password <name> <password>
  node scripts/hub-admin.mjs rename <from> <to> <password>
  node scripts/hub-admin.mjs make-admin <name>        (lets the account read the bug report inbox)
  node scripts/hub-admin.mjs remove-admin <name>
  node scripts/hub-admin.mjs setup <from> <to> <password>   (rename if needed, set the password, make it the admin)`;
const [cmd, ...args] = process.argv.slice(2);
const HUB = (process.env.HUB_URL || 'https://mimi-arcade-hub.onrender.com').replace(/\/$/, '');
const TOKEN = process.env.HUB_ADMIN_TOKEN || '';

async function call(action, body = {}) {
  const res = await fetch(`${HUB}/api/admin/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminToken: TOKEN, ...body }) });
  if (res.status === 404) throw new Error('The server says "not found": it needs HUB_ADMIN_TOKEN set (16+ characters) and a redeploy first.');
  if (res.status === 429) throw new Error('Too many wrong tries. Wait a minute.');
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.msg || `Failed (${res.status}).`);
  return data;
}
const need = (n) => { if (args.length < n) { console.error('Missing arguments. Run with no command to see the list.'); process.exit(2); } };

try {
  if (!cmd) { console.log(USAGE); process.exit(0); }
  if (!TOKEN) throw new Error('Set HUB_ADMIN_TOKEN to the token you put on the server.');
  if (cmd === 'accounts') {
    const r = await call('accounts');
    for (const a of r.accounts) console.log(`${a.name.padEnd(26)} key=${a.key.padEnd(20)} ${a.admin ? '[admin] ' : ''}${a.devices} device(s)`);
  } else if (cmd === 'set-password') { need(2); console.log((await call('set-password', { name: args[0], password: args[1] })).msg); }
  else if (cmd === 'rename') { need(3); console.log((await call('rename', { from: args[0], to: args[1], password: args[2] })).msg); }
  else if (cmd === 'make-admin' || cmd === 'remove-admin') { need(1); console.log((await call('set-admin', { name: args[0], admin: cmd === 'make-admin' })).msg); }
  else if (cmd === 'setup') {
    need(3);
    const [from, to, password] = args;
    if (from.trim().toLowerCase() !== to.trim().toLowerCase()) console.log((await call('rename', { from, to, password })).msg);
    else console.log((await call('set-password', { name: from, password })).msg);
    console.log((await call('set-admin', { name: to, admin: true })).msg);
  } else throw new Error(`Unknown command "${cmd}".`);
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
