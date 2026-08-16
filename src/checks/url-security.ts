import type Database from 'better-sqlite3';
import { makeAddIssue, INTERNAL_HTML_200 } from './helpers';
import type { CrawlConfig } from '../shared/types';

export function checkUrlAndSecurity(db: Database.Database, config: CrawlConfig): void {
  const add = makeAddIssue(db);

  const internalFetched = db
    .prepare(
      `SELECT id, url, headers FROM pages WHERE is_internal = 1 AND fetched = 1 AND status = 200`
    )
    .all() as { id: number; url: string; headers: string | null }[];

  for (const p of internalFetched) {
    let u: URL;
    try {
      u = new URL(p.url);
    } catch {
      continue;
    }
    const path = u.pathname + u.search;

    // URL structure
    if (p.url.length > config.maxUrlLength) add('url-too-long', p.id, `${p.url.length} chars`);
    if (/[A-Z]/.test(u.pathname)) add('url-uppercase', p.id);
    if (u.pathname.includes('_')) add('url-underscores', p.id);
    if (u.search.length > 0) add('url-params', p.id, u.search);
    // eslint-disable-next-line no-control-regex
    if (/[^\x00-\x7F]/.test(path)) add('url-non-ascii', p.id);

    // Security
    if (u.protocol === 'http:') add('security-not-https', p.id);

    let headers: Record<string, string> = {};
    try {
      headers = p.headers ? (JSON.parse(p.headers) as Record<string, string>) : {};
    } catch {
      headers = {};
    }
    if (u.protocol === 'https:') {
      if (!headers['strict-transport-security']) add('security-missing-hsts', p.id);
      if (!headers['x-content-type-options']) add('security-missing-xcto', p.id);
      const csp = headers['content-security-policy'] ?? '';
      if (!headers['x-frame-options'] && !/frame-ancestors/i.test(csp))
        add('security-missing-xfo', p.id);
      if (!csp) add('security-missing-csp', p.id);
      if (!headers['referrer-policy']) add('security-missing-referrer', p.id);
    }
  }

  // HTTP links / mixed content from HTTPS pages.
  const httpLinks = db
    .prepare(
      `SELECT p.id AS pid, COUNT(*) AS n FROM links l
       JOIN pages p ON p.id = l.src_id
       WHERE p.url LIKE 'https://%' AND l.dst_url LIKE 'http://%' AND l.link_type = 'ahref'
       GROUP BY p.id`
    )
    .all() as { pid: number; n: number }[];
  for (const row of httpLinks) add('security-http-links', row.pid, `${row.n} HTTP links`);

  const mixedImages = db
    .prepare(
      `SELECT r.page_id AS pid, COUNT(*) AS n FROM image_refs r
       JOIN images i ON i.id = r.image_id JOIN pages p ON p.id = r.page_id
       WHERE p.url LIKE 'https://%' AND i.src LIKE 'http://%' GROUP BY r.page_id`
    )
    .all() as { pid: number; n: number }[];
  for (const row of mixedImages) add('security-mixed-content', row.pid, `${row.n} HTTP images`);

  // Mobile: viewport.
  for (const p of db
    .prepare(
      `SELECT id FROM pages WHERE ${INTERNAL_HTML_200} AND (viewport IS NULL OR viewport = '')`
    )
    .all() as { id: number }[]) {
    add('mobile-viewport-missing', p.id);
  }

  // Deep pages (>3 clicks).
  for (const p of db
    .prepare(`SELECT id, depth FROM pages WHERE ${INTERNAL_HTML_200} AND depth > 3`)
    .all() as { id: number; depth: number }[]) {
    add('site-deep-pages', p.id, `depth ${p.depth}`);
  }
}
