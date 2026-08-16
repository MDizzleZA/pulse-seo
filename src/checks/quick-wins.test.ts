import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_STATEMENTS, metaSet, openProjectDb } from '../db/schema';
import { checkPagination } from './pagination';
import { checkAiCrawlers } from './ai-crawlers';
import { parsePage } from '../crawler/parse';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  for (const s of SCHEMA_STATEMENTS) db.prepare(s).run();
  return db;
}

function issues(db: Database.Database, checkId: string): { detail: string | null }[] {
  return db
    .prepare('SELECT detail FROM issues WHERE check_id = ?')
    .all(checkId) as { detail: string | null }[];
}

const insPage = `INSERT INTO pages
  (url, is_internal, fetched, status, content_type, canonical, rel_next, rel_prev, indexable)
  VALUES (@url, 1, 1, @status, 'text/html', @canonical, @rel_next, @rel_prev, 1)`;

describe('checkPagination', () => {
  it('flags rel=next targets that resolve to non-200 and canonicalised paginated pages', () => {
    const db = freshDb();
    const ins = db.prepare(insPage);
    ins.run({
      url: 'https://ex.com/blog/', status: 200,
      canonical: 'https://ex.com/blog/', rel_next: 'https://ex.com/blog/page/2/', rel_prev: null,
    });
    // page 2: canonicalised to page 1 (bad), next points at a 404 (bad)
    ins.run({
      url: 'https://ex.com/blog/page/2/', status: 200,
      canonical: 'https://ex.com/blog/', rel_next: 'https://ex.com/blog/page/3/',
      rel_prev: 'https://ex.com/blog/',
    });
    ins.run({
      url: 'https://ex.com/blog/page/3/', status: 404,
      canonical: null, rel_next: null, rel_prev: null,
    });

    checkPagination(db);

    const broken = issues(db, 'pagination-to-non200');
    expect(broken).toHaveLength(1);
    expect(broken[0].detail).toContain('page/3/');
    expect(broken[0].detail).toContain('404');

    const canonicalised = issues(db, 'pagination-canonicalised');
    expect(canonicalised).toHaveLength(1);
    expect(canonicalised[0].detail).toContain('https://ex.com/blog/');
    db.close();
  });

  it('does not flag uncrawled targets or self-canonical paginated pages', () => {
    const db = freshDb();
    db.prepare(insPage).run({
      url: 'https://ex.com/list/', status: 200,
      canonical: 'https://ex.com/list/', rel_next: 'https://ex.com/list/page/2/', rel_prev: null,
    });
    checkPagination(db);
    expect(issues(db, 'pagination-to-non200')).toHaveLength(0);
    expect(issues(db, 'pagination-canonicalised')).toHaveLength(0);
    db.close();
  });
});

describe('checkAiCrawlers', () => {
  it('reports each AI bot blocked by robots.txt', () => {
    const db = freshDb();
    metaSet(db, 'robots_origin', 'https://ex.com');
    metaSet(
      db,
      'robots_txt',
      ['User-agent: GPTBot', 'Disallow: /', '', 'User-agent: ClaudeBot', 'Disallow: /', '',
       'User-agent: *', 'Allow: /'].join('\n')
    );
    checkAiCrawlers(db);
    const details = issues(db, 'site-ai-crawlers').map((i) => i.detail);
    expect(details).toContain('GPTBot blocked by robots.txt');
    expect(details).toContain('ClaudeBot blocked by robots.txt');
    expect(details).toHaveLength(2);
    db.close();
  });

  it('reports nothing when robots.txt is absent or permissive', () => {
    const db = freshDb();
    checkAiCrawlers(db); // no meta at all
    expect(issues(db, 'site-ai-crawlers')).toHaveLength(0);

    metaSet(db, 'robots_origin', 'https://ex.com');
    metaSet(db, 'robots_txt', 'User-agent: *\nAllow: /');
    checkAiCrawlers(db);
    expect(issues(db, 'site-ai-crawlers')).toHaveLength(0);
    db.close();
  });
});

describe('render console errors check', () => {
  it('flags rendered pages whose console_errors array is non-empty', async () => {
    const { checkRender } = await import('./render');
    const db = freshDb();
    const ins = db.prepare(
      `INSERT INTO pages (url, is_internal, fetched, status, content_type, rendered, console_errors)
       VALUES (?, 1, 1, 200, 'text/html', 1, ?)`
    );
    ins.run('https://ex.com/broken-js', JSON.stringify(['Uncaught TypeError: x is not a function (app.js:10)']));
    ins.run('https://ex.com/clean', null);
    checkRender(db);
    const found = issues(db, 'render-console-errors');
    expect(found).toHaveLength(1);
    expect(found[0].detail).toContain('TypeError');
    db.close();
  });
});

describe('schema migration', () => {
  it('adds rel_next/rel_prev to a v1 .pulse file without touching its data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pulse-mig-'));
    const path = join(dir, 'v1.pulse');
    // Build a v1-format file: pages table without the pagination columns.
    const v1 = new Database(path);
    for (const s of SCHEMA_STATEMENTS) {
      v1.prepare(s.replace(/,\s*rel_next TEXT,\s*rel_prev TEXT/, '')).run();
    }
    v1.prepare(
      "INSERT INTO pages (url, is_internal, fetched, status) VALUES ('https://ex.com/', 1, 1, 200)"
    ).run();
    v1.close();

    const db = openProjectDb(path);
    const cols = (db.pragma('table_info(pages)') as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('rel_next');
    expect(cols).toContain('rel_prev');
    const row = db
      .prepare('SELECT url, status, rel_next FROM pages')
      .get() as { url: string; status: number; rel_next: string | null };
    expect(row.url).toBe('https://ex.com/');
    expect(row.status).toBe(200);
    expect(row.rel_next).toBeNull();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('parsePage rel=next/prev extraction', () => {
  it('resolves relative pagination links against the page URL', () => {
    const html = `<html><head>
      <title>Page 2</title>
      <link rel="prev" href="/blog/">
      <link rel="next" href="/blog/page/3/">
      </head><body><p>hello world</p></body></html>`;
    const parsed = parsePage(html, 'https://ex.com/blog/page/2/');
    expect(parsed.relPrev).toBe('https://ex.com/blog/');
    expect(parsed.relNext).toBe('https://ex.com/blog/page/3/');
  });

  it('returns null when no pagination links exist', () => {
    const parsed = parsePage('<html><head><title>t</title></head><body></body></html>',
      'https://ex.com/');
    expect(parsed.relNext).toBeNull();
    expect(parsed.relPrev).toBeNull();
  });
});
