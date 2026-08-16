import type Database from 'better-sqlite3';
import { makeAddIssue, INTERNAL_HTML_200 } from './helpers';

/** Pagination sanity: rel=next/prev targets must resolve, and paginated pages
 *  (rel=prev present) should not canonicalise to a different URL. */
export function checkPagination(db: Database.Database): void {
  const add = makeAddIssue(db);

  const pages = db
    .prepare(
      `SELECT id, url, canonical, rel_next, rel_prev FROM pages
       WHERE ${INTERNAL_HTML_200} AND (rel_next IS NOT NULL OR rel_prev IS NOT NULL)`
    )
    .all() as {
    id: number;
    url: string;
    canonical: string | null;
    rel_next: string | null;
    rel_prev: string | null;
  }[];
  if (pages.length === 0) return;

  const statusOf = db.prepare(
    'SELECT status, fetched FROM pages WHERE url = ? AND fetched >= 1'
  );

  for (const p of pages) {
    for (const [rel, target] of [
      ['next', p.rel_next],
      ['prev', p.rel_prev],
    ] as const) {
      if (!target) continue;
      const row = statusOf.get(target) as { status: number | null; fetched: number } | undefined;
      if (!row) continue; // target not crawled (out of scope / limit) — not evidence of breakage
      if (row.fetched === 2) add('pagination-to-non200', p.id, `rel=${rel} → ${target} (no response)`);
      else if (row.status != null && row.status !== 200)
        add('pagination-to-non200', p.id, `rel=${rel} → ${target} (${row.status})`);
    }
    // A page with rel=prev is page 2+ of a series; canonicalising it elsewhere
    // (usually to page 1) tells Google to ignore the paginated content.
    if (p.rel_prev && p.canonical && p.canonical !== p.url) {
      add('pagination-canonicalised', p.id, `canonical → ${p.canonical}`);
    }
  }
}
