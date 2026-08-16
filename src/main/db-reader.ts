import Database from 'better-sqlite3';
import { gunzipSync } from 'zlib';
import { TABS } from '../shared/tabs';
import { CHECK_MAP, SEVERITY_WEIGHT, type Severity } from '../checks/registry';
import { generateSitemaps, type GeneratedFile } from './sitemap-gen';
import { buildGraph } from './graph';
import type { GraphData } from '../shared/types';
import type {
  QueryRequest, QueryResponse, PageDetail, OverviewCounts, PageRow, IssueSummaryRow,
} from '../shared/types';

import {
  INTERNAL_HTML_200, INLINKS_SUB, OUTLINKS_SUB, buildTabQuery,
} from '../shared/tab-queries';

export class DbReader {
  private db: Database.Database | null = null;
  private currentPath: string | null = null;
  /** overview() is ~90 aggregate queries; the result only changes when the DB
   *  snapshot changes, i.e. on open/invalidate — so memoise it per connection. */
  private overviewCache: OverviewCounts | null = null;

  open(path: string): void {
    this.close();
    this.db = new Database(path, { readonly: true, fileMustExist: true });
  }

  close(): void {
    this.overviewCache = null;
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // ignore
      }
      this.db = null;
    }
  }

  get isOpen(): boolean {
    return this.db !== null;
  }

  setPath(path: string | null): void {
    this.currentPath = path;
    if (path) this.open(path);
    else this.close();
  }

  /** Reopen after a crawl finishes so a fresh snapshot is visible. */
  invalidate(): void {
    if (this.currentPath) this.open(this.currentPath);
  }

  /** Build XML sitemap file(s) from the current crawl's indexable pages. */
  buildSitemaps(
    baseUrl: string
  ): { files: GeneratedFile[]; urlCount: number; imageCount: number } {
    if (!this.db) return { files: [], urlCount: 0, imageCount: 0 };
    return generateSitemaps(this.db, baseUrl);
  }

  /** Internal-link graph for the architecture visualizations. */
  graph(nodeCap?: number): GraphData {
    if (!this.db) return { nodes: [], edges: [], truncated: false };
    return buildGraph(this.db, nodeCap);
  }

  query(req: QueryRequest): QueryResponse {
    if (!this.db) return { rows: [], total: 0 };
    const built = buildTabQuery(req.tab, req.filterId);
    if (!built) return { rows: [], total: 0 };

    const where = [...built.where];
    const params = [...built.params];
    if (req.search && req.search.trim()) {
      where.push(`${built.searchExpr} LIKE '%' || ? || '%'`);
      params.push(req.search.trim());
    }

    const tabDef = TABS.find((t) => t.id === req.tab);
    const sortable = new Set(tabDef?.columns.map((c) => c.key) ?? []);
    let orderBy = '';
    if (req.sortCol && sortable.has(req.sortCol)) {
      const dir = req.sortDir === 'desc' ? 'DESC' : 'ASC';
      orderBy = `ORDER BY "${req.sortCol}" ${dir} NULLS LAST`;
    }

    const baseSql = `SELECT ${built.select} FROM ${built.from} WHERE ${where.join(' AND ')}`;
    // Count without the select list — correlated subqueries (inlinks etc.) are
    // per-row work the count doesn't need.
    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${built.from} WHERE ${where.join(' AND ')})`)
      .get(...params) as { n: number };
    const rows = this.db
      .prepare(`${baseSql} ${orderBy} LIMIT ? OFFSET ?`)
      .all(...params, req.limit, req.offset) as Record<string, unknown>[];

    return { rows, total: countRow.n };
  }

  /** Count rows for a tab+filter (overview sidebar). */
  count(tabId: string, filterId: string | null): number {
    if (!this.db) return 0;
    const built = buildTabQuery(tabId, filterId);
    if (!built) return 0;
    const sql = `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${built.from}
      WHERE ${built.where.join(' AND ')})`;
    try {
      const row = this.db.prepare(sql).get(...built.params) as { n: number };
      return row.n;
    } catch {
      return 0;
    }
  }

  overview(): OverviewCounts {
    if (this.overviewCache) return this.overviewCache;
    const tabs: OverviewCounts['tabs'] = {};
    if (!this.db) return { tabs, issues: [], health: [], crawlInfo: { pages: 0, internal: 0, external: 0, indexable: 0 } };

    for (const tab of TABS) {
      const filters: Record<string, number> = {};
      for (const f of tab.filters) filters[f.id] = this.count(tab.id, f.id);
      tabs[tab.id] = { total: this.count(tab.id, null), filters };
    }

    const issueRows = this.db
      .prepare('SELECT check_id, COUNT(*) AS n FROM issues GROUP BY check_id')
      .all() as { check_id: string; n: number }[];
    const issues: IssueSummaryRow[] = issueRows
      .map((r) => {
        const def = CHECK_MAP[r.check_id];
        return {
          check_id: r.check_id,
          name: def?.name ?? r.check_id,
          category: def?.category ?? 'Other',
          severity: (def?.severity ?? 'low') as Severity,
          count: r.n,
        };
      })
      .sort(
        (a, b) =>
          SEVERITY_WEIGHT[b.severity as Severity] - SEVERITY_WEIGHT[a.severity as Severity] ||
          b.count - a.count
      );

    const pageCountRow = this.db
      .prepare(
        `SELECT
          COUNT(*) AS pages,
          SUM(CASE WHEN is_internal = 1 THEN 1 ELSE 0 END) AS internal,
          SUM(CASE WHEN is_internal = 0 THEN 1 ELSE 0 END) AS external,
          SUM(CASE WHEN indexable = 1 THEN 1 ELSE 0 END) AS indexable
        FROM pages WHERE fetched >= 1`
      )
      .get() as { pages: number; internal: number; external: number; indexable: number };

    const htmlPages = Math.max(
      1,
      (this.db.prepare(`SELECT COUNT(*) AS n FROM pages WHERE ${INTERNAL_HTML_200}`).get() as { n: number }).n
    );

    const byCategory = new Map<string, number>();
    for (const i of issues) {
      byCategory.set(
        i.category,
        (byCategory.get(i.category) ?? 0) + i.count * SEVERITY_WEIGHT[i.severity as Severity]
      );
    }
    const health = [...byCategory.entries()].map(([category, weighted]) => ({
      category,
      score: Math.max(0, Math.round(100 - (weighted / htmlPages) * 100)),
    }));

    this.overviewCache = {
      tabs,
      issues,
      health,
      crawlInfo: {
        pages: pageCountRow.pages ?? 0,
        internal: pageCountRow.internal ?? 0,
        external: pageCountRow.external ?? 0,
        indexable: pageCountRow.indexable ?? 0,
      },
    };
    return this.overviewCache;
  }

  detail(url: string): PageDetail {
    const empty: PageDetail = {
      page: null, inlinks: [], outlinks: [], images: [], hreflang: [],
      structured: [], issues: [], duplicates: [], extractions: [], searchHits: [],
    };
    if (!this.db) return empty;
    const page = this.db
      .prepare(
        `SELECT *, ${INLINKS_SUB}, ${OUTLINKS_SUB} FROM pages WHERE url = ?`
      )
      .get(url) as (PageRow & { id: number; raw_html?: Buffer; rendered_html?: Buffer }) | undefined;
    if (!page) return empty;
    // Never ship blobs to the renderer via detail.
    delete (page as unknown as Record<string, unknown>).raw_html;
    delete (page as unknown as Record<string, unknown>).rendered_html;

    const inlinks = this.db
      .prepare(
        `SELECT p.url AS src, l.anchor, l.rel, l.follow FROM links l
         JOIN pages p ON p.id = l.src_id WHERE l.dst_id = ? LIMIT 1000`
      )
      .all(page.id) as PageDetail['inlinks'];
    const outlinks = this.db
      .prepare(
        `SELECT l.dst_url AS dst, l.anchor, l.rel, l.follow, l.is_internal
         FROM links l WHERE l.src_id = ? LIMIT 1000`
      )
      .all(page.id) as PageDetail['outlinks'];
    const images = this.db
      .prepare(
        `SELECT i.src, r.alt, i.bytes, i.status FROM image_refs r
         JOIN images i ON i.id = r.image_id WHERE r.page_id = ? LIMIT 500`
      )
      .all(page.id) as PageDetail['images'];
    const hreflang = this.db
      .prepare('SELECT lang, href, source FROM hreflang WHERE page_id = ?')
      .all(page.id) as PageDetail['hreflang'];
    const structured = this.db
      .prepare(
        `SELECT format, type, COALESCE(errors,'[]') AS errors,
         COALESCE(warnings,'[]') AS warnings, json FROM structured_data WHERE page_id = ?`
      )
      .all(page.id) as PageDetail['structured'];
    const issueRows = this.db
      .prepare('SELECT check_id, detail FROM issues WHERE page_id = ?')
      .all(page.id) as { check_id: string; detail: string }[];
    const issues = issueRows.map((r) => ({
      check_id: r.check_id,
      name: CHECK_MAP[r.check_id]?.name ?? r.check_id,
      severity: CHECK_MAP[r.check_id]?.severity ?? 'low',
      detail: r.detail,
    }));
    // Duplicate partners: exact via shared content hash, near via simhash issues
    // (recorded as "NN% similar to <url>" on either side of the pair).
    const duplicates: PageDetail['duplicates'] = [];
    if (page.content_hash) {
      const exact = this.db
        .prepare(
          `SELECT url FROM pages WHERE content_hash = ? AND id <> ? AND ${INTERNAL_HTML_200} LIMIT 200`
        )
        .all(page.content_hash, page.id) as { url: string }[];
      for (const e of exact) duplicates.push({ url: e.url, kind: 'exact', similarity: 100 });
    }
    const nearRows = this.db
      .prepare(
        `SELECT i.detail, p.url AS owner FROM issues i JOIN pages p ON p.id = i.page_id
         WHERE i.check_id = 'content-near-duplicate' AND (i.page_id = ? OR i.detail LIKE ?)
         LIMIT 200`
      )
      .all(page.id, `% similar to ${url}`) as { detail: string; owner: string }[];
    for (const r of nearRows) {
      const m = (r.detail ?? '').match(/^(\d+)% similar to (.+)$/);
      if (!m) continue;
      const partner = r.owner === url ? m[2] : r.owner;
      if (partner === url) continue;
      if (!duplicates.some((d) => d.url === partner)) {
        duplicates.push({ url: partner, kind: 'near', similarity: Number(m[1]) });
      }
    }

    const extractions = this.db
      .prepare(
        `SELECT extractor_id, extractor_id AS name, value FROM extractions WHERE page_id = ? LIMIT 500`
      )
      .all(page.id) as PageDetail['extractions'];
    const searchHits = this.db
      .prepare('SELECT search_id, search_id AS name, hits FROM search_hits WHERE page_id = ?')
      .all(page.id) as PageDetail['searchHits'];

    const gsc = this.db.prepare('SELECT * FROM api_gsc WHERE url = ?').get(url) as
      | Record<string, unknown>
      | undefined;
    const ga4 = this.db.prepare('SELECT * FROM api_ga4 WHERE url = ?').get(url) as
      | Record<string, unknown>
      | undefined;
    const psi = this.db.prepare('SELECT * FROM api_psi WHERE url = ?').get(url) as
      | Record<string, unknown>
      | undefined;

    return {
      page: page as unknown as PageRow,
      inlinks, outlinks, images, hreflang, structured, issues, duplicates, extractions, searchHits,
      gsc: gsc ?? null, ga4: ga4 ?? null, psi: psi ?? null,
    };
  }

  htmlSource(url: string, which: 'raw' | 'rendered'): string | null {
    if (!this.db) return null;
    const col = which === 'raw' ? 'raw_html' : 'rendered_html';
    const row = this.db.prepare(`SELECT ${col} AS blob FROM pages WHERE url = ?`).get(url) as
      | { blob: Buffer | null }
      | undefined;
    if (!row?.blob) return null;
    try {
      return gunzipSync(row.blob).toString('utf8');
    } catch {
      return null;
    }
  }
}
