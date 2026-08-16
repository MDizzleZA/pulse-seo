// Installs better-sqlite3 prebuilt binaries for BOTH runtimes on this machine
// (no Visual Studio toolchain needed):
//   - plain Node  (vitest)            → lib/binding/node-v<nodeAbi>-win32-x64/
//   - Electron    (dev + packaged app) → lib/binding/node-v<electronAbi>-win32-x64/
// The `bindings` loader resolves lib/binding/node-v{process.versions.modules}-…
// at runtime, so each runtime picks its own ABI. build/Release is removed —
// a single-ABI binary there would shadow the per-runtime paths and break one
// of the two runtimes. Runs from postinstall; electron-builder packaging uses
// npmRebuild:false so this layout ships as-is.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const pkgDir = dirname(require.resolve('better-sqlite3/package.json'));
const built = join(pkgDir, 'build', 'Release', 'better_sqlite3.node');
const platform = `${process.platform}-${process.arch}`;

const electronVersion = JSON.parse(
  readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8')
).version;
const { getAbi } = require('node-abi');

const targets = [
  { runtime: 'node', target: process.versions.node, abi: process.versions.modules },
  { runtime: 'electron', target: electronVersion, abi: getAbi(electronVersion, 'electron') },
];

for (const t of targets) {
  const dest = join(pkgDir, 'lib', 'binding', `node-v${t.abi}-${platform}`);
  console.log(`better-sqlite3: fetching ${t.runtime} ${t.target} (abi ${t.abi}) prebuild…`);
  execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['prebuild-install', '-r', t.runtime, '-t', t.target],
    { cwd: pkgDir, stdio: 'inherit', shell: process.platform === 'win32' }
  );
  mkdirSync(dest, { recursive: true });
  copyFileSync(built, join(dest, 'better_sqlite3.node'));
  console.log(`  → ${dest}`);
}

// Remove the single-ABI copy so per-runtime resolution is the only path.
if (existsSync(built)) rmSync(built);
console.log('better-sqlite3: dual-ABI binding layout ready.');
