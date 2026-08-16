import { XMLParser } from 'fast-xml-parser';
import { gunzipSync } from 'zlib';
import type { FetchResult } from './fetcher';

export interface SitemapEntry {
  url: string;
  sitemap: string;
  lastmod: string | null;
}

export interface SitemapCrawlResult {
  entries: SitemapEntry[];
  sitemapsFetched: string[];
  errors: { url: string; error: string }[];
}

type FetchFn = (url: string) => Promise<FetchResult>;

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

/** Decode a sitemap response body, transparently gunzipping .xml.gz payloads. */
function bodyToText(res: FetchResult): string | null {
  if (!res.body) return null;
  let buf = res.body;
  const isGzip = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  if (isGzip) {
    try {
      buf = gunzipSync(buf);
    } catch {
      return null;
    }
  }
  return buf.toString('utf8');
}

/** fast-xml-parser renders <loc> either as a string or (with attrs) as an object. */
function locOf(node: unknown): string {
  if (typeof node === 'string') return node.trim();
  if (node && typeof node === 'object' && '#text' in node) {
    return String((node as { '#text': unknown })['#text']).trim();
  }
  return '';
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** Seed sitemap URLs from robots.txt `Sitemap:` directives, falling back to conventions. */
export function discoverSitemapUrls(origin: string, robotsBody: string | null): string[] {
  const set = new Set<string>();
  if (robotsBody) {
    for (const line of robotsBody.split(/\r?\n/)) {
      const m = line.match(/^\s*sitemap:\s*(\S+)/i);
      if (m) set.add(m[1].trim());
    }
  }
  if (set.size === 0) {
    set.add(origin.replace(/\/$/, '') + '/sitemap.xml');
    set.add(origin.replace(/\/$/, '') + '/sitemap_index.xml');
  }
  return [...set];
}

/**
 * Fetch and expand a set of sitemaps: follows <sitemapindex> children recursively,
 * collects <urlset> <loc> entries, and also accepts plain-text (one-URL-per-line)
 * sitemaps. Bounded by maxSitemaps to prevent runaway recursion.
 */
export async function crawlSitemaps(
  seeds: string[],
  fetchFn: FetchFn,
  opts?: { maxSitemaps?: number; onProgress?: (fetched: number) => void }
): Promise<SitemapCrawlResult> {
  const maxSitemaps = opts?.maxSitemaps ?? 200;
  const seen = new Set<string>();
  const queue = [...seeds];
  const entries: SitemapEntry[] = [];
  const entrySeen = new Set<string>();
  const sitemapsFetched: string[] = [];
  const errors: { url: string; error: string }[] = [];

  while (queue.length > 0 && sitemapsFetched.length < maxSitemaps) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm);

    let res: FetchResult;
    try {
      res = await fetchFn(sm);
    } catch (e) {
      errors.push({ url: sm, error: e instanceof Error ? e.message : String(e) });
      continue;
    }
    if (!res.ok || res.status !== 200) {
      errors.push({ url: sm, error: `HTTP ${res.status}` });
      continue;
    }
    const text = bodyToText(res);
    if (!text) {
      errors.push({ url: sm, error: 'Empty or unreadable body' });
      continue;
    }
    sitemapsFetched.push(sm);

    // Plain-text sitemap (RFC allows one absolute URL per line).
    if (!text.trimStart().startsWith('<')) {
      for (const line of text.split(/\r?\n/)) {
        const u = line.trim();
        if (/^https?:\/\//i.test(u) && !entrySeen.has(u)) {
          entrySeen.add(u);
          entries.push({ url: u, sitemap: sm, lastmod: null });
        }
      }
      opts?.onProgress?.(sitemapsFetched.length);
      continue;
    }

    let doc: { sitemapindex?: { sitemap?: unknown }; urlset?: { url?: unknown } };
    try {
      doc = parser.parse(text);
    } catch {
      errors.push({ url: sm, error: 'XML parse error' });
      continue;
    }

    // Sitemap index -> enqueue child sitemaps.
    for (const child of asArray(doc.sitemapindex?.sitemap) as { loc?: unknown }[]) {
      const loc = locOf(child.loc);
      if (loc && !seen.has(loc)) queue.push(loc);
    }

    // URL set -> collect entries.
    for (const u of asArray(doc.urlset?.url) as { loc?: unknown; lastmod?: unknown }[]) {
      const loc = locOf(u.loc);
      if (!loc || entrySeen.has(loc)) continue;
      entrySeen.add(loc);
      const lastmod = u.lastmod !== undefined ? locOf(u.lastmod) || null : null;
      entries.push({ url: loc, sitemap: sm, lastmod });
    }

    opts?.onProgress?.(sitemapsFetched.length);
  }

  return { entries, sitemapsFetched, errors };
}
