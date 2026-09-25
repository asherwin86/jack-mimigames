import { defineConfig } from 'vite';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** After the build, list every file in dist/ (bar videos and the service worker itself) in dist/precache.json, so
 *  public/sw.js can save the whole arcade for offline use the first time the site is opened. */
function precacheList() {
  return {
    name: 'precache-list',
    apply: 'build',
    closeBundle() {
      const root = 'dist';
      const files = [];
      const walk = (dir) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else files.push(relative(root, full).split('\\').join('/'));
        }
      };
      try { walk(root); } catch { return; }
      const skip = /\.(mp4|webm|map)$|^sw\.js$|^precache\.json$/i;
      writeFileSync(join(root, 'precache.json'), JSON.stringify(['./', ...files.filter((f) => !skip.test(f))]));
      // Stamp the service worker with this build, so every deploy installs a fresh one (and drops the old cache).
      try {
        const sw = readFileSync(join(root, 'sw.js'), 'utf8');
        writeFileSync(join(root, 'sw.js'), sw.replace("'mimi-arcade-v1'", `'mimi-arcade-${Date.now().toString(36)}'`));
      } catch { /* no service worker in this build */ }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [precacheList()],
  // host: true binds every interface, so the LAN URL works from a phone
  // or another machine, not just localhost.
  server: { open: true, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
