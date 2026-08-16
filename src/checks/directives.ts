import type Database from 'better-sqlite3';
import { makeAddIssue } from './helpers';

export function checkDirectives(db: Database.Database): void {
  const add = makeAddIssue(db);

  const noindex = db
    .prepare(
      `SELECT id, meta_robots, x_robots FROM pages
       WHERE is_internal = 1 AND fetched = 1
         AND (LOWER(COALESCE(meta_robots,'')) LIKE '%noindex%'
           OR LOWER(COALESCE(meta_robots,'')) LIKE '%none%'
           OR LOWER(COALESCE(x_robots,'')) LIKE '%noindex%')`
    )
    .all() as { id: number; meta_robots: string | null; x_robots: string | null }[];
  for (const p of noindex) add('directives-noindex', p.id, p.meta_robots ?? p.x_robots ?? undefined);

  const nofollow = db
    .prepare(
      `SELECT id, meta_robots FROM pages
       WHERE is_internal = 1 AND fetched = 1
         AND (LOWER(COALESCE(meta_robots,'')) LIKE '%nofollow%'
           OR LOWER(COALESCE(x_robots,'')) LIKE '%nofollow%')`
    )
    .all() as { id: number; meta_robots: string | null }[];
  for (const p of nofollow) add('directives-nofollow-page', p.id, p.meta_robots ?? undefined);

  for (const p of db
    .prepare('SELECT id FROM pages WHERE is_internal = 1 AND fetched = 3')
    .all() as { id: number }[]) {
    add('directives-robots-blocked', p.id);
  }

  const noindexInSitemap = db
    .prepare(
      `SELECT id FROM pages
       WHERE in_sitemap = 1 AND (LOWER(COALESCE(meta_robots,'')) LIKE '%noindex%'
         OR LOWER(COALESCE(x_robots,'')) LIKE '%noindex%')`
    )
    .all() as { id: number }[];
  for (const p of noindexInSitemap) add('directives-noindex-in-sitemap', p.id);
}
