import { defineConfig } from 'vite';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CATALOG } from './src/games/catalog.js';

const SITE = (process.env.SITE_URL || 'https://mimi-games-hzi0.onrender.com').replace(/\/$/, '');
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Search-engine extras: crawlable text and structured data built from the game catalogue, plus robots.txt and sitemap.xml. */
function seo() {
  return {
    name: 'seo',
    transformIndexHtml(html) {
      const ld = {
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebSite', name: '100 Mimi Games', url: `${SITE}/`, inLanguage: 'en' },
          {
            '@type': 'WebApplication', name: '100 Mimi Games', url: `${SITE}/`, applicationCategory: 'GameApplication', operatingSystem: 'Any',
            description: `A free 3D arcade with ${CATALOG.length} mini-games, Blockcraft, Kart Circuit and more. Play in your browser, install it, or get the Windows and Android apps.`,
            image: `${SITE}/og-image.png`, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
          },
          {
            '@type': 'ItemList', name: 'Games in 100 Mimi Games',
            itemListElement: CATALOG.map((g, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'VideoGame', name: g.name, description: g.blurb, genre: g.tags, url: `${SITE}/#/${g.id}`, gamePlatform: 'Web browser' } })),
          },
        ],
      };
      const list = CATALOG.map((g) => `<li><strong>${esc(g.name)}</strong> - ${esc(g.blurb)}</li>`).join('');
      const text = `<noscript><h1>100 Mimi Games</h1><p>A free 3D arcade with ${CATALOG.length} mini-games you can play right in your browser: puzzles, board and card games, action, racing, sport, and Blockcraft, a build-anything sandbox. It needs JavaScript to run.</p><ul>${list}</ul></noscript>`;
      return html
        .replace('</head>', `    <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n  </head>`)
        .replace('<div id="app">', `${text}\n    <div id="app">`);
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n` });
      const today = new Date().toISOString().slice(0, 10);
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>\n` });
    },
  };
}

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
  plugins: [seo(), precacheList()],
  // host: true binds every interface, so the LAN URL works from a phone
  // or another machine, not just localhost.
  server: { open: true, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
