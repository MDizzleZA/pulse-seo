// Packaged-runtime verification, no GUI. Run with: npx electron scripts/verify-packaged.cjs
// Proves, under the real Electron runtime (same ABI as the shipped app):
//   1. better-sqlite3 loads (lib/binding/node-v<electronAbi> layout)
//   2. @napi-rs/keyring loads
//   3. the crawler worker spawns FROM INSIDE the packaged app.asar and completes
//      a real 1-page crawl (worker_threads + asar + externalized deps).
const { app } = require('electron');
const { Worker } = require('node:worker_threads');
const { existsSync, rmSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function fail(msg, err) {
  console.error('[verify] FAIL:', msg, err ?? '');
  app.exit(1);
}

app.whenReady().then(() => {
  console.log('[verify] electron', process.versions.electron, 'abi', process.versions.modules);

  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.prepare('SELECT 1 AS one').get();
    db.close();
    console.log('[verify] better-sqlite3 loads under Electron: OK');
  } catch (err) {
    return fail('better-sqlite3 under Electron', err);
  }

  try {
    require('@napi-rs/keyring');
    console.log('[verify] @napi-rs/keyring loads under Electron: OK');
  } catch (err) {
    return fail('@napi-rs/keyring under Electron', err);
  }

  const workerPath = path.join(
    root, 'release', 'win-unpacked', 'resources', 'app.asar', 'out', 'main', 'crawler-worker.js'
  );
  const projectPath = path.join(root, 'release', 'asar-smoke.pulse');
  for (const s of ['', '-wal', '-shm']) {
    try { rmSync(projectPath + s); } catch { /* absent */ }
  }
  if (!existsSync(path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar'))) {
    return fail('packaged app.asar not found — run npm run dist first');
  }

  const config = {
    startUrls: ['https://example.com/'], mode: 'spider', listUrls: [], maxUrls: 2, maxDepth: 0,
    includePatterns: [], excludePatterns: [], crawlSubdomains: false, queryParams: 'crawl',
    stripParams: [], respectRobots: true, respectNofollow: true, concurrency: 2, delayMs: 0,
    userAgent: 'pulse-seo-verify/1.0', renderJs: false, renderWaitMs: 2000,
    renderConcurrency: 1, checkExternalLinks: false, checkImages: false, storeHtml: false,
    wordCountMin: 200, nearDupThreshold: 0.9, imgWarnBytes: 204800, imgCriticalBytes: 512000,
    maxTitleChars: 60, minTitleChars: 30, maxTitlePx: 600, maxDescChars: 160, minDescChars: 70,
    maxDescPx: 920, maxUrlLength: 100, extractors: [], customSearches: [],
  };

  console.log('[verify] spawning crawler worker from inside app.asar…');
  const timer = setTimeout(() => fail('worker timed out after 60s'), 60000);
  let worker;
  try {
    worker = new Worker(workerPath, { workerData: { projectPath, config } });
  } catch (err) {
    clearTimeout(timer);
    return fail('worker spawn from asar', err);
  }
  worker.on('error', (err) => {
    clearTimeout(timer);
    fail('worker crashed', err);
  });
  worker.on('message', (msg) => {
    if (msg.type === 'render-request') {
      worker.postMessage({ type: 'render-result', id: msg.id, result: { ok: false, html: '', error: 'n/a' } });
    } else if (msg.type === 'error') {
      clearTimeout(timer);
      fail('worker reported error', msg.message);
    } else if (msg.type === 'done') {
      clearTimeout(timer);
      setTimeout(() => {
        try {
          const Database = require('better-sqlite3');
          const db = new Database(projectPath, { readonly: true });
          const n = db.prepare('SELECT COUNT(*) AS n FROM pages WHERE fetched >= 1').get().n;
          const issues = db.prepare('SELECT COUNT(*) AS n FROM issues').get().n;
          db.close();
          console.log(`[verify] asar worker crawl: ${n} page(s) fetched, ${issues} issues written`);
          console.log(n > 0 ? '[verify] PACKAGED RUNTIME VERIFIED' : '[verify] FAIL: no pages');
          app.exit(n > 0 ? 0 : 1);
        } catch (err) {
          fail('reading result DB', err);
        }
      }, 300);
    }
  });
});
