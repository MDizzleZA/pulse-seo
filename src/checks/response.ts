import type Database from 'better-sqlite3';
import { makeAddIssue } from './helpers';

interface RedirectRow {
  id: number;
  url: string;
  status: number;
  redirect_target: string | null;
}

export function checkResponse(db: Database.Database): void {
  const add = makeAddIssue(db);

  // Broken internal (4xx) - attach to target with inlink count for context.
  const brokenInternal = db
    .prepare(
      `SELECT id, url, status,
        (SELECT COUNT(*) FROM links l WHERE l.dst_id = pages.id) AS inlinks
       FROM pages WHERE is_internal = 1 AND status BETWEEN 400 AND 499`
    )
    .all() as { id: number; url: string; status: number; inlinks: number }[];
  for (const p of brokenInternal) {
    add('response-broken-internal', p.id, `${p.status} — ${p.inlinks} inlinks`);
  }

  // Broken external links.
  const brokenExternal = db
    .prepare(
      `SELECT id, status,
        (SELECT COUNT(*) FROM links l WHERE l.dst_url = pages.url) AS inlinks
       FROM pages WHERE is_internal = 0 AND status >= 400`
    )
    .all() as { id: number; status: number; inlinks: number }[];
  for (const p of brokenExternal) {
    add('response-broken-external', p.id, `${p.status} — linked from ${p.inlinks} pages`);
  }

  // 5xx internal
  for (const p of db
    .prepare('SELECT id, status FROM pages WHERE is_internal = 1 AND status >= 500')
    .all() as { id: number; status: number }[]) {
    add('response-5xx', p.id, String(p.status));
  }

  // Connection errors
  for (const p of db
    .prepare('SELECT id, error FROM pages WHERE is_internal = 1 AND fetched = 2')
    .all() as { id: number; error: string | null }[]) {
    add('response-no-response', p.id, p.error ?? undefined);
  }

  // Internal temporary redirects
  for (const p of db
    .prepare('SELECT id, status FROM pages WHERE is_internal = 1 AND status IN (302, 307)')
    .all() as { id: number; status: number }[]) {
    add('response-302-internal', p.id, String(p.status));
  }

  // Redirect chains & loops: walk redirect_target graph, persist full chains.
  const redirects = db
    .prepare(
      `SELECT id, url, status, redirect_target FROM pages
       WHERE status BETWEEN 300 AND 399 AND redirect_target IS NOT NULL`
    )
    .all() as RedirectRow[];
  const byUrl = new Map(redirects.map((r) => [r.url, r]));
  const statusOf = db.prepare('SELECT status FROM pages WHERE url = ?');
  const setChain = db.prepare('UPDATE pages SET redirect_chain = ? WHERE id = ?');

  for (const r of redirects) {
    const chain: { url: string; status: number }[] = [];
    const seen = new Set<string>();
    let cursor: RedirectRow | undefined = r;
    let loop = false;
    while (cursor) {
      if (seen.has(cursor.url)) {
        loop = true;
        break;
      }
      seen.add(cursor.url);
      chain.push({ url: cursor.url, status: cursor.status });
      const nextUrl: string | null = cursor.redirect_target;
      if (!nextUrl) break;
      const next = byUrl.get(nextUrl);
      if (!next) {
        const finalRow = statusOf.get(nextUrl) as { status: number | null } | undefined;
        chain.push({ url: nextUrl, status: finalRow?.status ?? 0 });
        break;
      }
      cursor = next;
    }
    setChain.run(JSON.stringify(chain), r.id);
    if (loop) {
      add('response-redirect-loop', r.id, chain.map((c) => c.url).join(' → '));
    } else if (chain.length > 2) {
      // start + >1 intermediate hop before the final target
      add('response-redirect-chain', r.id, `${chain.length - 1} hops`);
    }
  }
}
