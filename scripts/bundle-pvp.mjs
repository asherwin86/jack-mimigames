/**
 * Bundles the Blockcraft PvP server into one file the desktop app can run (hub-server/blockcraft-server.bundle.mjs).
 * The server imports two game files (terrain and arena rules) that are ES modules, and inside the packaged app those would be
 * read as CommonJS, so they are folded in here; `ws` stays a normal package (it is unpacked next to the app).
 *   node scripts/bundle-pvp.mjs
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['server/blockcraft-server.mjs'],
  outfile: 'hub-server/blockcraft-server.bundle.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['ws'],
  logLevel: 'warning',
});
console.log('Wrote hub-server/blockcraft-server.bundle.mjs');
