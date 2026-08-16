// Assemble a ready-to-deploy Netlify site for the Pulse Viewer PWA:
//   dist/viewer-netlify/  (the folder IS the deploy target)
// Flat layout so it works with drag-drop, `netlify deploy`, or Git.
// Source of truth stays in pwa/; run:  npm run pwa:package:netlify
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, distDir, buildPwa, assertDeployClean, buildInfo } from './lib/build-pwa.mjs';

const OUT = 'C:\\Pulse SEO\\Apps\\PulseViewer-Netlify';
const tpl = join(repoRoot, 'pwa/online/netlify');

buildPwa();
assertDeployClean();

// Flat publish dir: the built app + Netlify config files together.
rmSync(OUT, { recursive: true, force: true });
cpSync(distDir, OUT, { recursive: true });
for (const f of ['_headers', '_redirects', 'netlify.toml', 'README-NETLIFY.md']) {
  cpSync(join(tpl, f), join(OUT, f));
}
cpSync(join(repoRoot, 'pwa/online/SECURITY.md'), join(OUT, 'SECURITY.md'));

// Post-assembly sanity.
if (!existsSync(join(OUT, 'sql-wasm-browser.wasm'))) {
  console.error('WARNING: wasm missing — the viewer will not start.');
  process.exit(1);
}
for (const req of ['_headers', '_redirects', 'index.html']) {
  if (!existsSync(join(OUT, req))) {
    console.error(`WARNING: ${req} missing from the deploy folder.`);
    process.exit(1);
  }
}
if (readdirSync(OUT).some((f) => f.toLowerCase().endsWith('.pulse'))) {
  console.error('REFUSING — a .pulse file is in the deploy folder.');
  process.exit(1);
}

const { version, swCache } = buildInfo();
console.log(`\nNetlify package ready — Pulse Viewer v${version} (sw cache: ${swCache})`);
console.log(`→ ${OUT}`);
console.log('Deploy: drag this folder into Netlify, or `cd` in and run `netlify deploy --prod`.');
console.log('Then gate the URL (password / SSO) — see README-NETLIFY.md.');
