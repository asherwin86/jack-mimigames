#!/usr/bin/env node
/**
 * Writes the page that wraps a Unity WebGL build (full screen, Back and Fullscreen buttons, ?fs=1 handling) into
 * unity-builds/<id>/index.html from scripts/unity-page-template.html.
 *
 *   node scripts/make-unity-page.mjs <id> "<Title shown to players>" <UnityProductName>
 *
 * Put the build's Build/ and TemplateData/ folders (and StreamingAssets/ if it has one) in unity-builds/<id>/ first.
 * The build must use the default file names (Build/WebBuild.data, .framework.js, .loader.js, .wasm) and be
 * uncompressed (plain files, not .br or .gz), because the website serves them as they are.
 */
import fs from 'node:fs';
import path from 'node:path';

const [id, title, product] = process.argv.slice(2);
if (!id || !title || !product) { console.error('usage: make-unity-page.mjs <id> "<Title>" <UnityProductName>'); process.exit(2); }
const root = new URL('..', import.meta.url).pathname;
const dir = path.join(root, 'unity-builds', id);
const build = path.join(dir, 'Build');
for (const f of ['WebBuild.data', 'WebBuild.framework.js', 'WebBuild.loader.js', 'WebBuild.wasm']) {
  if (!fs.existsSync(path.join(build, f))) { console.error(`Missing unity-builds/${id}/Build/${f}`); process.exit(1); }
}
const mb = Math.floor(fs.readdirSync(build).reduce((n, f) => n + fs.statSync(path.join(build, f)).size, 0) / 1e6);
const html = fs.readFileSync(path.join(root, 'scripts/unity-page-template.html'), 'utf8')
  .replaceAll('{{ID}}', id).replaceAll('{{TITLE}}', title).replaceAll('{{PRODUCT}}', product).replaceAll('{{SIZE}}', String(mb));
fs.writeFileSync(path.join(dir, 'index.html'), html);
console.log(`unity-builds/${id}/index.html written (${mb} MB build).`);
