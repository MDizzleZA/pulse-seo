// End-to-end smoke test: runs the BUILT crawler worker (out/main/crawler-worker.js)
// against a real site under plain Node, then inspects the resulting .pulse DB.
// Usage: node scripts/smoke-crawl.mjs [startUrl] [maxUrls] [outFile]
// Prereq: npm run build (worker bundle must exist).
import { Worker } from 'node:worker_threads';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = resolve(root, 'out/main/crawler-worker.js');
if (!existsSync(workerPath)) {
  console.error('Worker bundle missing — run `npm run build` first.');
  process.exit(1);
}

const startUrl = process.argv[2] ?? 'https://example.com/';
const maxUrls = Number(process.argv[3] ?? 15);
const projectPath = resolve(root, process.argv[4] ?? 'release/smoke.pulse');
for (const suffix of ['', '-wal', '-shm']) {
  try { rmSync(projectPath + suffix); } catch { /* absent */ }
}

// Mirrors DEFAULT_CONFIG in src/shared/types.ts (worker needs the full shape).
const config = {
  startUrls: [startUrl],
  mode: 'spider',
  listUrls: [],
  maxUrls,
  maxDepth: 0,
  includePatterns: [],
  excludePatterns: [],
  crawlSubdomains: false,
  queryParams: 'crawl',
  stripParams: [],
  respectRobots: true,
  respectNofollow: true,
  concurrency: 3,
  delayMs: 200, // stay polite on a live site
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 pulse-seo/1.0',
  basicAuthUser: '',
  basicAuthPass: '',
  customHeaders: [],
  renderJs: false, // RenderPool needs Electron windows — not exercisable here
  renderWaitMs: 2000,
  renderConcurrency: 3,
  a11yAudit: false,
  checkExternalLinks: true,
  checkImages: true,
  storeHtml: true,
  wordCountMin: 200,
  nearDupThreshold: 0.9,
  imgWarnBytes: 200 * 1024,
  imgCriticalBytes: 500 * 1024,
  maxTitleChars: 60,
  minTitleChars: 30,
  maxTitlePx: 600,
  maxDescChars: 160,
  minDescChars: 70,
  maxDescPx: 920,
  maxUrlLength: 100,
  extractors: [],
  customSearches: [],
  segments: [
    { id: 'articles', name: 'Articles', pattern: '/article|/blog|/news' },
    { id: 'products', name: 'Products', pattern: '/amethyst|/onyx|/distribution|/short-term' },
  ],
};

console.log(`Crawling ${startUrl} (max ${maxUrls} URLs) → ${projectPath}`);
const worker = new Worker(workerPath, { workerData: { projectPath, config } });
const started = Date.now();

const timeout = setTimeout(() => {
  console.error('TIMEOUT: crawl did not finish within 120s');
  worker.terminate().then(() => process.exit(1));
}, 120000);

worker.on('message', (msg) => {
  if (msg.type === 'progress') {
    const p = msg.progress;
    process.stdout.write(
      `\r[${p.phase}] crawled=${p.crawled} queued=${p.queued} errors=${p.errors}   `
    );
  } else if (msg.type === 'render-request') {
    // No Electron render pool here — answer so the worker doesn't hang.
    worker.postMessage({
      type: 'render-result', id: msg.id,
      result: { ok: false, html: '', error: 'No render pool (smoke test)' },
    });
  } else if (msg.type === 'log') {
    console.log(`\n[log] ${msg.message}`);
  } else if (msg.type === 'done' || msg.type === 'error') {
    clearTimeout(timeout);
    console.log(`\nWorker finished (${msg.type}) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    if (msg.type === 'error') {
      console.error('Crawl error:', msg.message);
      process.exit(1);
    }
    setTimeout(inspect, 200); // let the worker close its DB handle
  }
});

worker.on('error', (err) => {
  clearTimeout(timeout);
  console.error('Worker crashed:', err);
  process.exit(1);
});

function inspect() {
  const db = new Database(projectPath, { readonly: true });
  const one = (sql) => Object.values(db.prepare(sql).get())[0];
  const counts = {
    'pages fetched': one('SELECT COUNT(*) FROM pages WHERE fetched >= 1'),
    'internal 200 HTML': one(
      "SELECT COUNT(*) FROM pages WHERE is_internal = 1 AND status = 200 AND content_type LIKE '%html%'"
    ),
    'external checked': one('SELECT COUNT(*) FROM pages WHERE is_internal = 0 AND fetched >= 1'),
    links: one('SELECT COUNT(*) FROM links'),
    images: one('SELECT COUNT(*) FROM images'),
    'sitemap URLs': one('SELECT COUNT(*) FROM sitemap_urls'),
    issues: one('SELECT COUNT(*) FROM issues'),
    'distinct checks fired': one('SELECT COUNT(DISTINCT check_id) FROM issues'),
    'indexable pages': one('SELECT COUNT(*) FROM pages WHERE indexable = 1'),
  };
  console.log('\n--- .pulse contents ---');
  for (const [k, v] of Object.entries(counts)) console.log(`${k.padEnd(24)} ${v}`);

  const sample = db
    .prepare(
      'SELECT url, status, title, word_count, depth FROM pages WHERE is_internal = 1 AND fetched = 1 ORDER BY depth, id LIMIT 5'
    )
    .all();
  console.log('\n--- sample pages ---');
  for (const p of sample) {
    console.log(`${p.status} d${p.depth} ${p.url}  "${(p.title ?? '').slice(0, 60)}" (${p.word_count} words)`);
  }
  const checks = db
    .prepare('SELECT check_id, COUNT(*) n FROM issues GROUP BY check_id ORDER BY n DESC LIMIT 12')
    .all();
  console.log('\n--- top checks fired ---');
  for (const c of checks) console.log(`${String(c.n).padStart(4)}  ${c.check_id}`);
  db.close();

  const okay = counts['pages fetched'] > 0 && counts['internal 200 HTML'] > 0;
  console.log(okay ? '\nSMOKE TEST PASSED' : '\nSMOKE TEST FAILED — no pages crawled');
  process.exit(okay ? 0 : 1);
}
