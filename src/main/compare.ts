// Staging comparison / migration mapping. Takes an "old" URL set (a previous
// .pulse crawl or a CSV list), matches each old URL into the current crawl by
// exact URL then by path (hosts usually differ across a migration), classifies
// the outcome, and writes compare_results. Pure core: db + rows in.
import type Database from 'better-sqlite3';
import type { CompareSummary } from '../shared/types';

export interface OldPage {
  url: string;
  status: number | null;
  title: string | null;
  canonical: string | null;
}

/** Old-crawl page set: internal, fetched, HTML, 2xx — the pages worth mapping. */
export function readOldCrawl(oldDb: Database.Database): OldPage[] {
  return oldDb
    .prepare(
      `SELECT url, status, title, canonical FROM pages
       WHERE is_internal = 1 AND fetched = 1 AND status BETWEEN 200 AND 299
         AND content_type LIKE '%html%'`
    )
    .all() as OldPage[];
}

/** Old set from a plain URL list (CSV import) — no metadata to diff against. */
export function oldPagesFromUrls(urls: string[]): OldPage[] {
  const seen = new Set<string>();
  const out: OldPage[] = [];
  for (const raw of urls) {
    const url = raw.trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, status: null, title: null, canonical: null });
  }
  return out;
}

/** pathname + query, so /page?id=1 and /page stay distinct. */
function pathOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return null;
  }
}

function slashVariant(path: string): string {
  const [p, q = ''] = path.split('?');
  const toggled = p.endsWith('/') && p.length > 1 ? p.slice(0, -1) : p + '/';
  return toggled + (q ? `?${q}` : '');
}

interface CurrentPage {
  url: string;
  status: number | null;
  fetched: number;
  title: string | null;
  canonical: string | null;
  redirect_target: string | null;
}

/** Follow redirect_target hops through the current crawl to a final page. */
function resolveRedirect(
  byUrl: Map<string, CurrentPage>,
  start: CurrentPage
): { finalUrl: string | null; finalPage: CurrentPage | null } {
  let page: CurrentPage = start;
  let finalUrl: string | null = start.redirect_target;
  for (let hop = 0; hop < 10; hop++) {
    if (!page.redirect_target) break;
    finalUrl = page.redirect_target;
    const next = byUrl.get(page.redirect_target);
    if (!next) return { finalUrl, finalPage: null };
    page = next;
    if (page.status !== null && page.status < 300) return { finalUrl: page.url, finalPage: page };
  }
  return { finalUrl, finalPage: page === start ? null : page };
}

export function runCompare(db: Database.Database, oldPages: OldPage[]): CompareSummary {
  const current = db
    .prepare(
      `SELECT url, status, fetched, title, canonical, redirect_target
       FROM pages WHERE is_internal = 1 AND fetched >= 1`
    )
    .all() as CurrentPage[];

  const is2xx = (p: CurrentPage | undefined): boolean =>
    p !== undefined && p.status !== null && p.status >= 200 && p.status < 300;

  const byUrl = new Map<string, CurrentPage>();
  const byPath = new Map<string, CurrentPage>();
  for (const p of current) {
    byUrl.set(p.url, p);
    const path = pathOf(p.url);
    // First page wins per path; a 2xx page later still beats a non-2xx holder.
    if (path !== null) {
      const holder = byPath.get(path);
      if (!holder || (is2xx(p) && !is2xx(holder))) byPath.set(path, p);
    }
  }

  const insert = db.prepare(
    `INSERT INTO compare_results (old_url, old_status, old_title, matched_url, match_type,
       new_status, new_title, redirect_target, redirect_ok, result, title_changed,
       canonical_changed)
     VALUES (@old_url, @old_status, @old_title, @matched_url, @match_type, @new_status,
       @new_title, @redirect_target, @redirect_ok, @result, @title_changed,
       @canonical_changed)`
  );

  const summary: CompareSummary = { total: 0, ok: 0, redirected: 0, broken: 0, missing: 0 };

  const write = db.transaction(() => {
    db.prepare('DELETE FROM compare_results').run();

    for (const old of oldPages) {
      let matchType: 'exact' | 'path' | 'none' = 'none';
      let match: CurrentPage | undefined = byUrl.get(old.url);
      if (match) {
        matchType = 'exact';
      } else {
        const path = pathOf(old.url);
        if (path !== null) {
          match = byPath.get(path) ?? byPath.get(slashVariant(path));
          if (match) matchType = 'path';
        }
      }

      let result: 'ok' | 'redirected' | 'broken' | 'missing';
      let redirectTarget: string | null = null;
      let redirectOk = 0;
      let finalPage: CurrentPage | null = null;

      if (!match) {
        result = 'missing';
      } else if (match.status !== null && match.status >= 200 && match.status < 300) {
        result = 'ok';
        finalPage = match;
      } else if (match.status !== null && match.status >= 300 && match.status < 400) {
        const resolved = resolveRedirect(byUrl, match);
        redirectTarget = resolved.finalUrl;
        finalPage = resolved.finalPage;
        const landedOk =
          finalPage !== null &&
          finalPage.status !== null &&
          finalPage.status >= 200 &&
          finalPage.status < 300;
        redirectOk = landedOk ? 1 : 0;
        result = landedOk ? 'redirected' : 'broken';
      } else {
        // 4xx/5xx, connection error (fetched=2) or blocked
        result = 'broken';
      }

      const canDiff = finalPage !== null && old.title !== null;
      insert.run({
        old_url: old.url,
        old_status: old.status,
        old_title: old.title,
        matched_url: match?.url ?? null,
        match_type: matchType,
        new_status: match?.status ?? null,
        new_title: finalPage?.title ?? null,
        redirect_target: redirectTarget,
        redirect_ok: redirectOk,
        result,
        title_changed: canDiff && (finalPage!.title ?? '') !== (old.title ?? '') ? 1 : 0,
        canonical_changed:
          finalPage !== null && old.canonical !== null &&
          (finalPage.canonical ?? '') !== (old.canonical ?? '')
            ? 1
            : 0,
      });
      summary.total++;
      summary[result]++;
    }
  });
  write();

  return summary;
}
