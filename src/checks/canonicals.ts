import type Database from 'better-sqlite3';
import { makeAddIssue, INTERNAL_HTML_200 } from './helpers';

export function checkCanonicals(db: Database.Database): void {
  const add = makeAddIssue(db);

  for (const p of db
    .prepare(
      `SELECT id FROM pages WHERE ${INTERNAL_HTML_200}
       AND canonical IS NULL AND canonical_header IS NULL AND indexable = 1`
    )
    .all() as { id: number }[]) {
    add('canonical-missing', p.id);
  }

  // Multiple conflicting canonical tags in HTML.
  const multi = db
    .prepare(
      `SELECT id, canonical_all FROM pages WHERE ${INTERNAL_HTML_200} AND canonical_all IS NOT NULL`
    )
    .all() as { id: number; canonical_all: string }[];
  for (const p of multi) {
    try {
      const all = JSON.parse(p.canonical_all) as string[];
      if (new Set(all).size > 1) {
        add('canonical-multiple-conflicting', p.id, all.join(' | '));
      }
    } catch {
      // ignore
    }
  }

  // HTML vs HTTP header conflict.
  for (const p of db
    .prepare(
      `SELECT id, canonical, canonical_header FROM pages WHERE ${INTERNAL_HTML_200}
       AND canonical IS NOT NULL AND canonical_header IS NOT NULL
       AND canonical <> canonical_header`
    )
    .all() as { id: number; canonical: string; canonical_header: string }[]) {
    add('canonical-conflict-header', p.id, `${p.canonical} vs ${p.canonical_header}`);
  }

  // Canonical target status checks (only targets we crawled).
  const targets = db
    .prepare(
      `SELECT p.id, p.canonical, t.status AS t_status, t.meta_robots AS t_robots,
              t.x_robots AS t_xrobots
       FROM pages p JOIN pages t ON t.url = p.canonical
       WHERE p.is_internal = 1 AND p.fetched = 1 AND p.canonical IS NOT NULL
         AND p.canonical <> p.url AND t.fetched = 1`
    )
    .all() as {
    id: number; canonical: string; t_status: number | null;
    t_robots: string | null; t_xrobots: string | null;
  }[];
  for (const p of targets) {
    if (p.t_status != null && p.t_status >= 300 && p.t_status < 400) {
      add('canonical-to-redirect', p.id, `${p.canonical} → ${p.t_status}`);
    } else if (p.t_status != null && p.t_status !== 200) {
      add('canonical-to-non200', p.id, `${p.canonical} → ${p.t_status}`);
    }
    const robots = `${p.t_robots ?? ''} ${p.t_xrobots ?? ''}`.toLowerCase();
    if (robots.includes('noindex')) {
      add('canonical-to-noindex', p.id, p.canonical);
    }
  }

  // Canonical target never linked internally.
  const unlinked = db
    .prepare(
      `SELECT p.id, p.canonical FROM pages p
       WHERE p.is_internal = 1 AND p.fetched = 1 AND p.canonical IS NOT NULL
         AND p.canonical <> p.url
         AND NOT EXISTS (
           SELECT 1 FROM links l WHERE l.dst_url = p.canonical AND l.link_type = 'ahref')`
    )
    .all() as { id: number; canonical: string }[];
  for (const p of unlinked) add('canonical-unlinked', p.id, p.canonical);
}
