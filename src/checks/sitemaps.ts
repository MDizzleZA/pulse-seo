import type Database from 'better-sqlite3';
import { makeAddIssue, INTERNAL_HTML_200 } from './helpers';

export function checkSitemaps(db: Database.Database): void {
  const add = makeAddIssue(db);

  const sitemapCount = (
    db.prepare('SELECT COUNT(*) n FROM sitemap_urls').get() as { n: number }
  ).n;
  // No sitemap discovered: skip entirely so we don't flag every indexable page
  // as "missing from sitemap" against a sitemap that doesn't exist.
  if (sitemapCount === 0) return;

  // URLs listed in a sitemap that were crawled and returned a non-200 status.
  for (const r of db
    .prepare(
      `SELECT p.id AS id, p.status AS status FROM sitemap_urls su
       JOIN pages p ON p.url = su.url
       WHERE p.fetched = 1 AND p.status IS NOT NULL AND p.status <> 200`
    )
    .all() as { id: number; status: number }[]) {
    add('sitemap-non200', r.id, `HTTP ${r.status}`);
  }

  // Noindex pages that are still listed in the sitemap.
  for (const r of db
    .prepare(
      `SELECT id FROM pages WHERE in_sitemap = 1 AND fetched = 1
       AND indexable = 0 AND indexability_reason = 'Noindex'`
    )
    .all() as { id: number }[]) {
    add('sitemap-noindex', r.id);
  }

  // Pages in the sitemap that canonicalise to a different URL.
  for (const r of db
    .prepare(
      `SELECT id, canonical FROM pages WHERE in_sitemap = 1 AND fetched = 1
       AND canonical IS NOT NULL AND canonical <> '' AND canonical <> url`
    )
    .all() as { id: number; canonical: string }[]) {
    add('sitemap-canonicalised', r.id, r.canonical);
  }

  // Orphans: URLs present in a sitemap but never reached by the crawl.
  for (const r of db
    .prepare(
      `SELECT su.url AS url FROM sitemap_urls su
       LEFT JOIN pages p ON p.url = su.url
       WHERE p.id IS NULL OR p.fetched = 0`
    )
    .all() as { url: string }[]) {
    add('sitemap-orphan', null, r.url);
  }

  // Indexable, crawlable pages that are missing from the sitemap.
  for (const r of db
    .prepare(
      `SELECT id FROM pages WHERE ${INTERNAL_HTML_200} AND indexable = 1 AND in_sitemap = 0`
    )
    .all() as { id: number }[]) {
    add('sitemap-missing-indexable', r.id);
  }
}
