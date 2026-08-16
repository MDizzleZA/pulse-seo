// Assemble the deployable online package for the Pulse Viewer PWA (Apache/nginx):
//   dist/viewer-online/{site, server, README-DEPLOY.md, SECURITY.md}
// Source of truth stays in pwa/; run:  npm run pwa:package
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, distDir, buildPwa, assertDeployClean, buildInfo } from './lib/build-pwa.mjs';

const OUT = 'C:\\Pulse SEO\\Apps\\PulseViewer-Online';

buildPwa();
assertDeployClean();

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'server'), { recursive: true });
cpSync(distDir, join(OUT, 'site'), { recursive: true });
cpSync(join(repoRoot, 'pwa/online/apache.htaccess'), join(OUT, 'server', 'apache.htaccess'));
cpSync(join(repoRoot, 'pwa/online/nginx.conf'), join(OUT, 'server', 'nginx.conf'));
cpSync(join(repoRoot, 'pwa/online/README-DEPLOY.md'), join(OUT, 'README-DEPLOY.md'));
cpSync(join(repoRoot, 'pwa/online/SECURITY.md'), join(OUT, 'SECURITY.md'));

const { version, swCache } = buildInfo();
console.log(`\nPackaged Pulse Viewer v${version} (service-worker cache: ${swCache})`);
console.log(`→ ${OUT}`);
console.log('Reminder: bump the sw.js CACHE constant whenever sw.js itself changes.');
if (!existsSync(join(OUT, 'site', 'sql-wasm-browser.wasm'))) {
  console.error('WARNING: wasm missing from site/ — the viewer will not start.');
  process.exit(1);
}
