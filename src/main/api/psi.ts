// PageSpeed Insights client. Fetches lab (Lighthouse) + field (CrUX) metrics
// per URL and upserts into api_psi. Pure core: db + injected fetch.
import type Database from 'better-sqlite3';
import { mapWithConcurrency, apiError, type FetchLike } from './common';

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

export interface PsiOptions {
  apiKey: string;
  strategy: 'mobile' | 'desktop';
  /** PSI quota is per-minute; keep this low. */
  concurrency?: number;
  fetchImpl: FetchLike;
  onProgress?: (done: number, total: number, url: string) => void;
}

export interface PsiResult {
  written: number;
  failed: number;
  errors: string[];
}

/** Candidate URLs for PSI: internal HTML 200 pages, most-linked first. */
export function selectPsiUrls(db: Database.Database, max: number): string[] {
  const rows = db
    .prepare(
      `SELECT url FROM pages
       WHERE is_internal = 1 AND fetched = 1 AND status = 200 AND content_type LIKE '%html%'
       ORDER BY (SELECT COUNT(*) FROM links l WHERE l.dst_id = pages.id) DESC, depth ASC
       LIMIT ?`
    )
    .all(Math.max(1, max)) as { url: string }[];
  return rows.map((r) => r.url);
}

interface PsiRow {
  strategy: string;
  performance: number | null;
  seo: number | null;
  accessibility: number | null;
  best_practices: number | null;
  lcp_ms: number | null;
  inp_ms: number | null;
  cls: number | null;
  field_lcp_ms: number | null;
  field_inp_ms: number | null;
  field_cls: number | null;
}

function score(categories: Record<string, unknown>, key: string): number | null {
  const cat = categories[key] as { score?: number } | undefined;
  return typeof cat?.score === 'number' ? Math.round(cat.score * 100) : null;
}

function auditValue(audits: Record<string, unknown>, key: string): number | null {
  const audit = audits[key] as { numericValue?: number } | undefined;
  return typeof audit?.numericValue === 'number' ? audit.numericValue : null;
}

function fieldPercentile(metrics: Record<string, unknown> | undefined, key: string): number | null {
  const m = metrics?.[key] as { percentile?: number } | undefined;
  return typeof m?.percentile === 'number' ? m.percentile : null;
}

/** Parse one PSI API response body into an api_psi row. Exported for tests. */
export function parsePsiResponse(body: unknown, strategy: string): PsiRow {
  const b = body as {
    lighthouseResult?: {
      categories?: Record<string, unknown>;
      audits?: Record<string, unknown>;
    };
    loadingExperience?: { metrics?: Record<string, unknown> };
  };
  const categories = b.lighthouseResult?.categories ?? {};
  const audits = b.lighthouseResult?.audits ?? {};
  const field = b.loadingExperience?.metrics;
  const fieldCls = fieldPercentile(field, 'CUMULATIVE_LAYOUT_SHIFT_SCORE');
  return {
    strategy,
    performance: score(categories, 'performance'),
    seo: score(categories, 'seo'),
    accessibility: score(categories, 'accessibility'),
    best_practices: score(categories, 'best-practices'),
    lcp_ms: auditValue(audits, 'largest-contentful-paint'),
    inp_ms: auditValue(audits, 'interaction-to-next-paint'),
    cls: auditValue(audits, 'cumulative-layout-shift'),
    field_lcp_ms: fieldPercentile(field, 'LARGEST_CONTENTFUL_PAINT_MS'),
    field_inp_ms: fieldPercentile(field, 'INTERACTION_TO_NEXT_PAINT'),
    // CrUX reports CLS percentile scaled ×100.
    field_cls: fieldCls === null ? null : fieldCls / 100,
  };
}

export async function runPsi(
  db: Database.Database,
  urls: string[],
  opts: PsiOptions
): Promise<PsiResult> {
  const upsert = db.prepare(
    `INSERT INTO api_psi (url, strategy, performance, seo, accessibility, best_practices,
       lcp_ms, inp_ms, cls, field_lcp_ms, field_inp_ms, field_cls, fetched_at)
     VALUES (@url, @strategy, @performance, @seo, @accessibility, @best_practices,
       @lcp_ms, @inp_ms, @cls, @field_lcp_ms, @field_inp_ms, @field_cls, @fetched_at)
     ON CONFLICT(url) DO UPDATE SET
       strategy = excluded.strategy, performance = excluded.performance, seo = excluded.seo,
       accessibility = excluded.accessibility, best_practices = excluded.best_practices,
       lcp_ms = excluded.lcp_ms, inp_ms = excluded.inp_ms, cls = excluded.cls,
       field_lcp_ms = excluded.field_lcp_ms, field_inp_ms = excluded.field_inp_ms,
       field_cls = excluded.field_cls, fetched_at = excluded.fetched_at`
  );

  const errors: string[] = [];
  let written = 0;
  let done = 0;

  await mapWithConcurrency(urls, opts.concurrency ?? 2, async (url) => {
    try {
      const params = new URLSearchParams({ url, strategy: opts.strategy, key: opts.apiKey });
      for (const c of ['performance', 'seo', 'accessibility', 'best-practices']) {
        params.append('category', c);
      }
      const res = await opts.fetchImpl(`${PSI_ENDPOINT}?${params.toString()}`);
      if (res.status !== 200) {
        errors.push(await apiError(res, url));
        return;
      }
      const row = parsePsiResponse(await res.json(), opts.strategy);
      upsert.run({ url, ...row, fetched_at: new Date().toISOString() });
      written++;
    } catch (err) {
      errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      done++;
      opts.onProgress?.(done, urls.length, url);
    }
  });

  return { written, failed: errors.length, errors };
}
