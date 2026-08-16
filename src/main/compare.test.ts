import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_STATEMENTS } from '../db/schema';
import { readOldCrawl, oldPagesFromUrls, runCompare } from './compare';

function fresh(): Database.Database {
  const d = new Database(':memory:');
  for (const s of SCHEMA_STATEMENTS) d.prepare(s).run();
  return d;
}

function addPage(
  d: Database.Database,
  url: string,
  status: number,
  opts: {
    title?: string | null;
    canonical?: string | null;
    redirect?: string | null;
    contentType?: string;
    internal?: number;
    fetched?: number;
  } = {}
): void {
  d.prepare(
    `INSERT INTO pages (url, is_internal, fetched, status, content_type, title, canonical,
       redirect_target)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    url,
    opts.internal ?? 1,
    opts.fetched ?? 1,
    status,
    opts.contentType ?? 'text/html',
    opts.title ?? null,
    opts.canonical ?? null,
    opts.redirect ?? null
  );
}

describe('readOldCrawl', () => {
  it('returns only internal fetched 2xx HTML pages', () => {
    const old = fresh();
    addPage(old, 'https://old.com/', 200, { title: 'Home' });
    addPage(old, 'https://old.com/gone', 404);
    addPage(old, 'https://old.com/r', 301, { redirect: 'https://old.com/' });
    addPage(old, 'https://old.com/file.pdf', 200, { contentType: 'application/pdf' });
    addPage(old, 'https://cdn.com/x', 200, { internal: 0 });

    const pages = readOldCrawl(old);
    expect(pages.map((p) => p.url)).toEqual(['https://old.com/']);
    expect(pages[0].title).toBe('Home');
    old.close();
  });
});

describe('oldPagesFromUrls', () => {
  it('keeps valid http(s) URLs, dedupes, drops junk', () => {
    const pages = oldPagesFromUrls([
      'https://old.com/a',
      ' https://old.com/a ',
      'ftp://old.com/b',
      'not a url',
      'http://old.com/c',
    ]);
    expect(pages.map((p) => p.url)).toEqual(['https://old.com/a', 'http://old.com/c']);
    expect(pages[0].status).toBeNull();
  });
});

describe('runCompare', () => {
  it('classifies ok / redirected / broken / missing and matches across hosts by path', () => {
    const current = fresh();
    // New site on a different host — path matching must bridge the hosts.
    addPage(current, 'https://new.com/', 200, { title: 'Home v2' });
    addPage(current, 'https://new.com/kept', 200, { title: 'Kept' });
    addPage(current, 'https://new.com/moved', 301, { redirect: 'https://new.com/kept' });
    addPage(current, 'https://new.com/dead', 410);

    const old = [
      { url: 'https://old.com/', status: 200, title: 'Home', canonical: null },
      { url: 'https://old.com/kept', status: 200, title: 'Kept', canonical: null },
      { url: 'https://old.com/moved', status: 200, title: 'Moved', canonical: null },
      { url: 'https://old.com/dead', status: 200, title: 'Dead', canonical: null },
      { url: 'https://old.com/vanished', status: 200, title: 'Vanished', canonical: null },
    ];

    const summary = runCompare(current, old);
    expect(summary).toEqual({ total: 5, ok: 2, redirected: 1, broken: 1, missing: 1 });

    const rows = current
      .prepare('SELECT * FROM compare_results ORDER BY old_url')
      .all() as Record<string, unknown>[];
    const byOld = Object.fromEntries(rows.map((r) => [r.old_url as string, r]));

    expect(byOld['https://old.com/kept']).toMatchObject({
      matched_url: 'https://new.com/kept',
      match_type: 'path',
      result: 'ok',
      title_changed: 0,
    });
    expect(byOld['https://old.com/moved']).toMatchObject({
      result: 'redirected',
      redirect_ok: 1,
      redirect_target: 'https://new.com/kept',
      new_status: 301,
    });
    expect(byOld['https://old.com/dead']).toMatchObject({ result: 'broken' });
    expect(byOld['https://old.com/vanished']).toMatchObject({
      result: 'missing',
      matched_url: null,
      match_type: 'none',
    });
    // Home title changed old→new.
    expect(byOld['https://old.com/']).toMatchObject({ result: 'ok', title_changed: 1 });
    current.close();
  });

  it('prefers exact-URL matches, tolerates trailing-slash drift, flags dead-end redirects', () => {
    const current = fresh();
    addPage(current, 'https://site.com/about/', 200, { title: 'About' });
    addPage(current, 'https://site.com/old-page', 302, { redirect: 'https://elsewhere.com/x' });

    const summary = runCompare(current, [
      // exact match even though another page shares the slash-variant path
      { url: 'https://site.com/old-page', status: 200, title: null, canonical: null },
      // old URL without trailing slash still finds /about/
      { url: 'https://site.com/about', status: 200, title: 'About', canonical: null },
    ]);
    // Redirect target was never crawled → dead end → broken.
    expect(summary.broken).toBe(1);
    expect(summary.ok).toBe(1);

    const rows = current.prepare('SELECT * FROM compare_results ORDER BY old_url').all() as Record<
      string,
      unknown
    >[];
    expect(rows[0]).toMatchObject({
      old_url: 'https://site.com/about',
      match_type: 'path',
      result: 'ok',
      title_changed: 0,
    });
    expect(rows[1]).toMatchObject({
      old_url: 'https://site.com/old-page',
      match_type: 'exact',
      result: 'broken',
      redirect_target: 'https://elsewhere.com/x',
      redirect_ok: 0,
    });
    current.close();
  });

  it('follows multi-hop redirect chains to a 200 and replaces prior results', () => {
    const current = fresh();
    addPage(current, 'https://n.com/a', 301, { redirect: 'https://n.com/b' });
    addPage(current, 'https://n.com/b', 301, { redirect: 'https://n.com/c' });
    addPage(current, 'https://n.com/c', 200, { title: 'C' });
    current
      .prepare(
        `INSERT INTO compare_results (old_url, match_type, result) VALUES ('stale', 'none', 'missing')`
      )
      .run();

    const summary = runCompare(current, [
      { url: 'https://o.com/a', status: 200, title: 'A', canonical: null },
    ]);
    expect(summary).toEqual({ total: 1, ok: 0, redirected: 1, broken: 0, missing: 0 });

    const rows = current.prepare('SELECT * FROM compare_results').all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1); // stale row purged
    expect(rows[0]).toMatchObject({
      result: 'redirected',
      redirect_target: 'https://n.com/c',
      new_title: 'C',
      title_changed: 1, // 'A' → 'C'
    });
    current.close();
  });
});
