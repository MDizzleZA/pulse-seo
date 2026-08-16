// sql.js (SQLite-as-WASM) port of the desktop DbReader: same shared query
// builder, same tabs/checks catalogs, running entirely in the browser.
import initSqlJs, { type Database } from 'sql.js';
import { TABS } from '../../src/shared/tabs';
import { CHECK_MAP, SEVERITY_WEIGHT, type Severity } from '../../src/checks/registry';
import {
  INTERNAL_HTML_200, INLINKS_SUB, OUTLINKS_SUB, buildTabQuery,
} from '../../src/shared/tab-queries';
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from '../../src/db/schema-constants';
import { DEFAULT_CONFIG } from '../../src/shared/types';
import type { OverviewCounts, QueryRequest, QueryResponse } from '../../src/shared/types';

export interface PageDetailLite {
  page: Record<string, unknown> | null;
  inlinks: { src: string; anchor: string; follow: number }[];
  outlinks: { dst: string; anchor: string; is_internal: number; follow: number }[];
  issues: { name: string; severity: string; detail: string | null }[];
}

let sqlPromise: ReturnType<typeof initSqlJs> | null = null;

function getSql(): ReturnType<typeof initSqlJs> {
  if (!sqlPromise) {
    // Absolute URL pinned to the page base — relative paths resolve against the
    // bundled module URL (/assets/) where the SPA fallback would return HTML.
    sqlPromise = initSqlJs({
      locateFile: (f) => new URL(`./${f}`, document.baseURI).href,
    });
  }
  return sqlPromise;
}

/** Create a blank, schema-only .pulse the desktop app can open and crawl into. */
export async function createEmptyProject(): Promise<Blob> {
  const SQL = await getSql();
  const db = new SQL.Database();
  try {
    for (const stmt of SCHEMA_STATEMENTS) db.run(stmt);
    const ins = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
    ins.run(['schema_version', String(SCHEMA_VERSION)]);
    ins.run(['config', JSON.stringify(DEFAULT_CONFIG)]);
    ins.free();
    // Copy out of the WASM heap into a plain ArrayBuffer before the DB closes.
    const exported = db.export();
    const bytes = new Uint8Array(exported.length);
    bytes.set(exported);
    return new Blob([bytes], { type: 'application/octet-stream' });
  } finally {
    db.close();
  }
}

export async function openPulseFile(buf: ArrayBuffer): Promise<PulseDb> {
  const SQL = await getSql();
  const db = new SQL.Database(new Uint8Array(buf));
  // sanity: must look like a .pulse project
  const probe = new PulseDb(db);
  try {
    probe.all("SELECT 1 FROM pages LIMIT 1");
  } catch {
    db.close();
    throw new Error('Not a Pulse SEO project file (no pages table).');
  }
  return probe;
}

export class PulseDb {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  close(): void {
    this.db.close();
  }

  all(sql: string, params: unknown[] = []): Record<string, unknown>[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params as never[]);
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, unknown>);
      return rows;
    } finally {
      stmt.free();
    }
  }

  get(sql: string, params: unknown[] = []): Record<string, unknown> | undefined {
    return this.all(sql, params)[0];
  }

  query(req: QueryRequest): QueryResponse {
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
      orderBy = `ORDER BY "${req.sortCol}" ${req.sortDir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`;
    }

    const total = Number(
      this.get(
        `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${built.from} WHERE ${where.join(' AND ')})`,
        params
      )?.n ?? 0
    );
    const rows = this.all(
      `SELECT ${built.select} FROM ${built.from} WHERE ${where.join(' AND ')} ${orderBy} LIMIT ? OFFSET ?`,
      [...params, req.limit, req.offset]
    );
    return { rows, total };
  }

  count(tabId: string, filterId: string | null): number {
    const built = buildTabQuery(tabId, filterId);
    if (!built) return 0;
    try {
      return Number(
        this.get(
          `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${built.from} WHERE ${built.where.join(' AND ')})`,
          built.params
        )?.n ?? 0
      );
    } catch {
      return 0;
    }
  }

  overview(): OverviewCounts {
    const tabs: OverviewCounts['tabs'] = {};
    for (const tab of TABS) {
      const filters: Record<string, number> = {};
      for (const f of tab.filters) filters[f.id] = this.count(tab.id, f.id);
      tabs[tab.id] = { total: this.count(tab.id, null), filters };
    }

    const issueRows = this.all('SELECT check_id, COUNT(*) AS n FROM issues GROUP BY check_id') as {
      check_id: string;
      n: number;
    }[];
    const issues = issueRows
      .map((r) => {
        const def = CHECK_MAP[r.check_id];
        return {
          check_id: r.check_id,
          name: def?.name ?? r.check_id,
          category: def?.category ?? 'Other',
          severity: (def?.severity ?? 'low') as Severity,
          count: Number(r.n),
        };
      })
      .sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] || b.count - a.count);

    const crawl = this.get(
      `SELECT COUNT(*) AS pages,
        SUM(CASE WHEN is_internal = 1 THEN 1 ELSE 0 END) AS internal,
        SUM(CASE WHEN is_internal = 0 THEN 1 ELSE 0 END) AS external,
        SUM(CASE WHEN indexable = 1 THEN 1 ELSE 0 END) AS indexable
       FROM pages WHERE fetched >= 1`
    ) as { pages: number; internal: number; external: number; indexable: number };

    const htmlPages = Math.max(
      1,
      Number(this.get(`SELECT COUNT(*) AS n FROM pages WHERE ${INTERNAL_HTML_200}`)?.n ?? 0)
    );
    const byCategory = new Map<string, number>();
    for (const i of issues) {
      byCategory.set(i.category, (byCategory.get(i.category) ?? 0) + i.count * SEVERITY_WEIGHT[i.severity]);
    }
    const health = [...byCategory.entries()].map(([category, weighted]) => ({
      category,
      score: Math.max(0, Math.round(100 - (weighted / htmlPages) * 100)),
    }));

    return {
      tabs,
      issues,
      health,
      crawlInfo: {
        pages: Number(crawl?.pages ?? 0),
        internal: Number(crawl?.internal ?? 0),
        external: Number(crawl?.external ?? 0),
        indexable: Number(crawl?.indexable ?? 0),
      },
    };
  }

  detail(url: string): PageDetailLite {
    const page = this.get(`SELECT *, ${INLINKS_SUB}, ${OUTLINKS_SUB} FROM pages WHERE url = ?`, [url]);
    if (!page) return { page: null, inlinks: [], outlinks: [], issues: [] };
    delete page.raw_html;
    delete page.rendered_html;
    const id = page.id;
    const inlinks = this.all(
      `SELECT p.url AS src, l.anchor, l.follow FROM links l
       JOIN pages p ON p.id = l.src_id WHERE l.dst_id = ? LIMIT 500`,
      [id]
    ) as PageDetailLite['inlinks'];
    const outlinks = this.all(
      `SELECT l.dst_url AS dst, l.anchor, l.is_internal, l.follow FROM links l WHERE l.src_id = ? LIMIT 500`,
      [id]
    ) as PageDetailLite['outlinks'];
    const issues = (
      this.all('SELECT check_id, detail FROM issues WHERE page_id = ?', [id]) as {
        check_id: string;
        detail: string | null;
      }[]
    ).map((r) => ({
      name: CHECK_MAP[r.check_id]?.name ?? r.check_id,
      severity: CHECK_MAP[r.check_id]?.severity ?? 'low',
      detail: r.detail,
    }));
    return { page, inlinks, outlinks, issues };
  }
}
