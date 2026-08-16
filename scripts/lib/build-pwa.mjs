// Shared helpers for the PWA deploy packagers (online + netlify).
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const distDir = join(repoRoot, 'pwa-dist');

/** Build the PWA (throws on failure). Invokes vite via node directly — a fixed
 *  executable path, no shell, no user input (npm.cmd can't spawn without a shell
 *  on Node 20+, and shells are avoided here on purpose). */
export function buildPwa() {
  console.log('Building PWA…');
  const vite = join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  const r = spawnSync(
    process.execPath,
    [vite, 'build', '-c', join(repoRoot, 'pwa', 'vite.config.ts')],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** Refuse to ship crawl data, sourcemaps, or desktop-only deps. Exits on any offender. */
export function assertDeployClean(dir = distDir) {
  const offenders = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(pulse|map)$/i.test(name)) offenders.push(p);
    }
  };
  walk(dir);
  if (offenders.length > 0) {
    console.error('REFUSING TO PACKAGE — sensitive files in build output:');
    for (const o of offenders) console.error('  ' + o);
    process.exit(1);
  }
  const assetsDir = join(dir, 'assets');
  for (const name of readdirSync(assetsDir)) {
    const body = readFileSync(join(assetsDir, name), 'utf8');
    for (const bad of ['exceljs', 'better-sqlite3']) {
      if (body.includes(bad)) {
        console.error(`REFUSING TO PACKAGE — "${bad}" found in bundle ${name}`);
        process.exit(1);
      }
    }
  }
}

/** Version + service-worker cache tag, for the packagers' summary lines. */
export function buildInfo() {
  const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;
  const swCache = /CACHE = '([^']+)'/.exec(readFileSync(join(distDir, 'sw.js'), 'utf8'))?.[1];
  return { version, swCache };
}
