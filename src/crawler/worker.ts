// Crawler worker thread: owns the write DB connection and the crawl loop.
import { parentPort, workerData } from 'worker_threads';
import { gzipSync } from 'zlib';
import robotsParser from 'robots-parser';
import { openProjectDb, metaSet } from '../db/schema';
import { DbWriter } from './db-writer';
import { fetchUrl, probeResource, headersFromConfig, type FetchResult } from './fetcher';
import { parsePage, type ParsedPage } from './parse';
import {
  normalizeUrl, applyParamPolicy, baseDomainOf, isInternalUrl,
  compileScopeRules, inScope, looksLikeBinary, type ScopeRules,
} from './url-utils';
import { runExtractionAndSearch } from './extract-custom';
import { discoverSitemapUrls, crawlSitemaps } from './sitemaps';
import { runAllChecks } from '../checks/run-all';
import { assignSegments } from './segments';
import type { CrawlConfig, CrawlPhase, RenderResult } from '../shared/types';

interface WorkerInput {
  projectPath: string;
  config: CrawlConfig;
}

interface QueueItem {
  url: string;
  depth: number;
  source: string | null;
  isInternal: boolean;
}

const port = parentPort;
if (!port) throw new Error('crawler worker must run in a worker thread');

const { projectPath, config } = workerData as WorkerInput;

const db = openProjectDb(projectPath);
const writer = new DbWriter(db);
const extraHeaders = headersFromConfig(config);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let paused = false;
let stopped = false;
let phase: CrawlPhase = 'crawling';
let crawled = 0;
let errors = 0;
let currentUrl = '';
const recentTimes: number[] = [];

const frontier: QueueItem[] = [];
const enqueued = new Set<string>();
const robotsCache = new Map<string, ReturnType<typeof robotsParser> | null>();

let baseDomain = '';
let scopeRules: ScopeRules;

// Render bridge: pending render requests awaiting a reply from main.
let renderSeq = 0;
const pendingRenders = new Map<number, (result: RenderResult) => void>();

port.on('message', (msg: { type: string; [k: string]: unknown }) => {
  if (msg.type === 'pause') paused = true;
  else if (msg.type === 'resume') paused = false;
  else if (msg.type === 'stop') stopped = true;
  else if (msg.type === 'render-result') {
    const resolve = pendingRenders.get(msg.id as number);
    if (resolve) {
      pendingRenders.delete(msg.id as number);
      resolve(msg.result as RenderResult);
    }
  }
});

function requestRender(url: string): Promise<RenderResult> {
  return new Promise((resolve) => {
    const id = ++renderSeq;
    pendingRenders.set(id, resolve);
    port!.postMessage({ type: 'render-request', id, url, waitMs: config.renderWaitMs });
    // Safety timeout so a lost reply never hangs the crawl.
    setTimeout(() => {
      if (pendingRenders.has(id)) {
        pendingRenders.delete(id);
        resolve({ ok: false, html: '', error: 'Render timed out (no reply)' });
      }
    }, Math.max(60000, config.renderWaitMs + 45000));
  });
}

function reportProgress(message?: string): void {
  const now = Date.now();
  while (recentTimes.length > 0 && now - recentTimes[0] > 10000) recentTimes.shift();
  port!.postMessage({
    type: 'progress',
    progress: {
      phase,
      crawled,
      queued: frontier.length,
      errors,
      total: crawled + frontier.length,
      urlsPerSec: Math.round((recentTimes.length / 10) * 10) / 10,
      currentUrl,
      message,
    },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Robots
// ---------------------------------------------------------------------------
async function isAllowedByRobots(url: string): Promise<boolean> {
  if (!config.respectRobots) return true;
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return true;
  }
  if (!robotsCache.has(origin)) {
    try {
      const res = await fetchUrl(origin + '/robots.txt', config.userAgent, true, 15000, true, extraHeaders);
      if (res.ok && res.body) {
        robotsCache.set(origin, robotsParser(origin + '/robots.txt', res.body.toString('utf8')));
      } else {
        robotsCache.set(origin, null); // no robots.txt -> allow all
      }
    } catch {
      robotsCache.set(origin, null);
    }
  }
  const parser = robotsCache.get(origin);
  if (!parser) return true;
  return parser.isAllowed(url, config.userAgent) !== false;
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------
function enqueue(url: string, depth: number, source: string | null, isInternal: boolean): void {
  if (enqueued.has(url)) return;
  if (config.maxUrls > 0 && enqueued.size >= config.maxUrls) return;
  if (isInternal && config.maxDepth > 0 && depth > config.maxDepth) return;
  enqueued.add(url);
  frontier.push({ url, depth, source, isInternal });
  writer.ensurePage(url, isInternal, depth, source);
}

function considerDiscoveredLink(href: string, sourceUrl: string, sourceDepth: number, follow: boolean): void {
  const internal = isInternalUrl(href, baseDomain, config.crawlSubdomains);
  if (internal) {
    const finalUrl = applyParamPolicy(href, config);
    if (!inScope(finalUrl, scopeRules)) return;
    if (looksLikeBinary(finalUrl)) return;
    if (config.mode === 'list') return; // list mode: no spidering
    if (config.respectNofollow && !follow) return;
    enqueue(finalUrl, sourceDepth + 1, sourceUrl, true);
  } else if (config.checkExternalLinks) {
    enqueue(href, 0, sourceUrl, false);
  }
}

// ---------------------------------------------------------------------------
// Single crawl task
// ---------------------------------------------------------------------------
function computeIndexability(
  fetch: FetchResult,
  parsed: ParsedPage | null,
  url: string
): { indexable: boolean; reason: string | null } {
  if (fetch.status >= 300 && fetch.status < 400) return { indexable: false, reason: 'Redirect' };
  if (fetch.status >= 400 && fetch.status < 500)
    return { indexable: false, reason: 'Client Error' };
  if (fetch.status >= 500) return { indexable: false, reason: 'Server Error' };
  if (fetch.status === 0) return { indexable: false, reason: 'Connection Error' };
  if (!fetch.contentType.includes('html')) return { indexable: false, reason: 'Non-HTML' };
  const robotsSignals = [parsed?.metaRobots ?? '', fetch.headers['x-robots-tag'] ?? '']
    .join(',')
    .toLowerCase();
  if (/\bnoindex\b|\bnone\b/.test(robotsSignals)) return { indexable: false, reason: 'Noindex' };
  if (parsed?.canonical && parsed.canonical !== url)
    return { indexable: false, reason: 'Canonicalised' };
  return { indexable: true, reason: null };
}

async function crawlOne(item: QueueItem): Promise<void> {
  currentUrl = item.url;
  const pageId = writer.ensurePage(item.url, item.isInternal, item.depth, item.source);

  if (item.isInternal && !(await isAllowedByRobots(item.url))) {
    writer.writeRobotsSkipped(pageId);
    return;
  }

  // Internal pages: single-hop so every redirect is its own row.
  // External link checks: follow redirects, we only care about the final status.
  const res = await fetchUrl(
    item.url,
    config.userAgent,
    item.isInternal,
    30000,
    !item.isInternal,
    extraHeaders
  );

  if (res.status === 0) {
    writer.writeError(pageId, res);
    errors++;
    return;
  }

  let parsed: ParsedPage | null = null;
  if (
    item.isInternal &&
    res.status === 200 &&
    res.contentType.includes('html') &&
    res.body &&
    res.body.length > 0
  ) {
    try {
      parsed = parsePage(res.body.toString('utf8'), item.url);
    } catch (err) {
      parsed = null;
      port!.postMessage({
        type: 'log',
        message: `Parse failed for ${item.url}: ${err instanceof Error ? err.message : err}`,
      });
    }
  }

  const { indexable, reason } = computeIndexability(res, parsed, item.url);
  writer.writeFetchedPage(pageId, res, parsed, indexable, reason, config.storeHtml);
  if (res.status >= 400) errors++;

  // Redirect: enqueue the target as its own page.
  if (item.isInternal && res.status >= 300 && res.status < 400 && res.headers['location']) {
    const target = normalizeUrl(res.headers['location'], item.url);
    if (target) {
      db.prepare('UPDATE pages SET redirect_target = ? WHERE id = ?').run(target, pageId);
      const targetInternal = isInternalUrl(target, baseDomain, config.crawlSubdomains);
      if (targetInternal) {
        const finalUrl = applyParamPolicy(target, config);
        if (inScope(finalUrl, scopeRules) && !looksLikeBinary(finalUrl)) {
          enqueue(finalUrl, item.depth, item.url, true);
        }
      } else if (config.checkExternalLinks) {
        enqueue(target, 0, item.url, false);
      }
    }
  }

  if (parsed) {
    writer.writeLinks(
      pageId,
      parsed.links.map((l) => ({
        dst: l.href,
        anchor: l.anchor,
        rel: l.rel,
        follow: l.follow,
        isInternal: isInternalUrl(l.href, baseDomain, config.crawlSubdomains),
      })),
      false
    );
    for (const l of parsed.links) {
      considerDiscoveredLink(l.href, item.url, item.depth, l.follow);
    }

    writer.writeImages(
      pageId,
      parsed.images.map((img) => ({
        src: img.src,
        alt: img.alt,
        hasDimensions: img.hasDimensions,
        loading: img.loading,
        isInternal: isInternalUrl(img.src, baseDomain, config.crawlSubdomains),
      }))
    );
    writer.writeHreflang(pageId, parsed.hreflang, 'link');
    writer.writeStructuredData(pageId, parsed.structuredData);
  }
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------
async function runCrawlLoop(): Promise<void> {
  let active = 0;
  let lastReport = 0;

  await new Promise<void>((resolveLoop) => {
    const pump = (): void => {
      if (Date.now() - lastReport > 500) {
        lastReport = Date.now();
        reportProgress();
      }
      if (stopped) {
        if (active === 0) resolveLoop();
        return;
      }
      if (paused) {
        setTimeout(pump, 250);
        return;
      }
      while (active < config.concurrency && frontier.length > 0 && !stopped) {
        const item = frontier.shift()!;
        active++;
        (async () => {
          try {
            await crawlOne(item);
          } catch (err) {
            errors++;
            port!.postMessage({
              type: 'log',
              message: `Crawl error ${item.url}: ${err instanceof Error ? err.message : err}`,
            });
          } finally {
            crawled++;
            recentTimes.push(Date.now());
            active--;
            if (config.delayMs > 0) await sleep(config.delayMs);
            pump();
          }
        })();
      }
      if (active === 0 && frontier.length === 0) {
        resolveLoop();
        return;
      }
      if (active === 0) setTimeout(pump, 100);
    };
    pump();
  });
}

async function runImageProbePhase(): Promise<void> {
  if (!config.checkImages) return;
  const images = db
    .prepare(
      `SELECT src FROM images WHERE checked = 0 AND (is_internal = 1 OR ? = 1)`
    )
    .all(config.checkExternalLinks ? 1 : 0) as { src: string }[];
  phase = 'crawling';
  let done = 0;
  const CONC = 10;
  const queue = [...images];
  await Promise.all(
    Array.from({ length: CONC }, async () => {
      while (queue.length > 0 && !stopped) {
        const img = queue.shift();
        if (!img) break;
        currentUrl = img.src;
        const probe = await probeResource(img.src, config.userAgent, 15000, extraHeaders);
        writer.updateImageProbe(img.src, probe.status, probe.bytes, probe.contentType);
        done++;
        if (done % 20 === 0) reportProgress(`Checking images ${done}/${images.length}`);
      }
    })
  );
}

async function runRenderPhase(): Promise<void> {
  if (!config.renderJs) return;
  phase = 'rendering';
  const rows = db
    .prepare(
      `SELECT id, url FROM pages
       WHERE is_internal = 1 AND fetched = 1 AND status = 200
         AND content_type LIKE '%html%'`
    )
    .all() as { id: number; url: string }[];

  const updateRendered = db.prepare(
    `UPDATE pages SET rendered = 1, rendered_html = ?, rendered_title = ?,
      rendered_meta_description = ?, rendered_canonical = ?, rendered_meta_robots = ?,
      rendered_h1 = ?, rendered_word_count = ?, console_errors = ?, a11y_violations = ?,
      render_error = NULL
     WHERE id = ?`
  );
  const updateRenderError = db.prepare(
    'UPDATE pages SET rendered = 2, render_error = ? WHERE id = ?'
  );

  let done = 0;
  const queue = [...rows];
  const CONC = Math.max(1, config.renderConcurrency);
  await Promise.all(
    Array.from({ length: CONC }, async () => {
      while (queue.length > 0 && !stopped) {
        const row = queue.shift();
        if (!row) break;
        currentUrl = row.url;
        const result = await requestRender(row.url);
        if (result.ok && result.html) {
          try {
            const parsed = parsePage(result.html, row.url);
            updateRendered.run(
              config.storeHtml ? gzipSync(Buffer.from(result.html, 'utf8')) : null,
              parsed.title,
              parsed.metaDescription,
              parsed.canonical,
              parsed.metaRobots,
              JSON.stringify(parsed.h1),
              parsed.wordCount,
              result.consoleErrors && result.consoleErrors.length > 0
                ? JSON.stringify(result.consoleErrors)
                : null,
              result.a11y && result.a11y.length > 0 ? JSON.stringify(result.a11y) : null,
              row.id
            );
            // Record links that only exist in the rendered DOM.
            const rawLinks = new Set(
              (
                db
                  .prepare('SELECT dst_url FROM links WHERE src_id = ? AND from_render = 0')
                  .all(row.id) as { dst_url: string }[]
              ).map((r) => r.dst_url)
            );
            const newLinks = parsed.links.filter((l) => !rawLinks.has(l.href));
            if (newLinks.length > 0) {
              writer.writeLinks(
                row.id,
                newLinks.map((l) => ({
                  dst: l.href,
                  anchor: l.anchor,
                  rel: l.rel,
                  follow: l.follow,
                  isInternal: isInternalUrl(l.href, baseDomain, config.crawlSubdomains),
                })),
                true
              );
            }
          } catch (err) {
            updateRenderError.run(err instanceof Error ? err.message : String(err), row.id);
          }
        } else {
          updateRenderError.run(result.error ?? 'Render failed', row.id);
        }
        done++;
        if (done % 5 === 0) reportProgress(`Rendering ${done}/${rows.length}`);
      }
    })
  );
}

async function runSitemapPhase(origin: string): Promise<void> {
  phase = 'crawling';
  reportProgress('Fetching sitemaps');
  let robotsBody: string | null = null;
  try {
    const res = await fetchUrl(origin + '/robots.txt', config.userAgent, true, 15000, true, extraHeaders);
    if (res.ok && res.body) robotsBody = res.body.toString('utf8');
  } catch {
    robotsBody = null;
  }

  const seeds = discoverSitemapUrls(origin, robotsBody);
  const { entries } = await crawlSitemaps(
    seeds,
    (u) => fetchUrl(u, config.userAgent, true, 20000, true, extraHeaders),
    { onProgress: (n) => reportProgress(`Reading sitemaps (${n})`) }
  );

  // Normalise sitemap URLs the same way crawled pages are stored so in_sitemap
  // matching and orphan detection line up on exact URL equality.
  const normalised = entries.map((e) => ({
    url: applyParamPolicy(normalizeUrl(e.url) ?? e.url, config),
    sitemap: e.sitemap,
    lastmod: e.lastmod,
  }));
  writer.writeSitemapUrls(normalised);
  writer.markInSitemap();
}

function runAnalysisPhase(): void {
  phase = 'analysis';
  reportProgress('Resolving link graph');
  writer.resolveLinkTargets();
  reportProgress('Assigning segments');
  assignSegments(db, config.segments ?? []);
  reportProgress('Running custom extraction');
  runExtractionAndSearch(db, config, (done, total) =>
    reportProgress(`Extraction ${done}/${total}`)
  );
  reportProgress('Running SEO checks');
  runAllChecks(db, config);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  writer.clearCrawlData();
  metaSet(db, 'config', JSON.stringify(config));

  const seeds = config.mode === 'list' ? config.listUrls : config.startUrls;
  const first = normalizeUrl(seeds[0] ?? '');
  if (!first) {
    port!.postMessage({ type: 'error', message: 'No valid start URL' });
    return;
  }
  baseDomain = baseDomainOf(new URL(first).hostname);
  scopeRules = compileScopeRules(config);

  // Fetch the start origin's robots.txt once: seeds the allow-cache and is
  // persisted for the AI-crawler access check in the analysis phase.
  const origin = new URL(first).origin;
  metaSet(db, 'robots_origin', origin);
  try {
    const res = await fetchUrl(origin + '/robots.txt', config.userAgent, true, 15000, true, extraHeaders);
    if (res.ok && res.body) {
      const body = res.body.toString('utf8');
      metaSet(db, 'robots_txt', body);
      robotsCache.set(origin, robotsParser(origin + '/robots.txt', body));
    } else {
      metaSet(db, 'robots_txt', '');
      robotsCache.set(origin, null);
    }
  } catch {
    metaSet(db, 'robots_txt', '');
  }

  for (const s of seeds) {
    const u = normalizeUrl(s);
    if (u) enqueue(applyParamPolicy(u, config), 0, null, true);
  }

  await runCrawlLoop();
  if (!stopped) await runImageProbePhase();
  if (!stopped) await runRenderPhase();
  if (!stopped) {
    try {
      await runSitemapPhase(new URL(first).origin);
    } catch (err) {
      port!.postMessage({
        type: 'log',
        message: `Sitemap phase failed: ${err instanceof Error ? err.message : err}`,
      });
    }
  }
  runAnalysisPhase();

  metaSet(db, 'last_crawl', new Date().toISOString());
  phase = stopped ? 'stopped' : 'done';
  reportProgress();
  port!.postMessage({ type: 'done', stopped });
}

main()
  .catch((err) => {
    port!.postMessage({
      type: 'error',
      message: err instanceof Error ? err.stack ?? err.message : String(err),
    });
  })
  .finally(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
  });
