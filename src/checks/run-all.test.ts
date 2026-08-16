import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_STATEMENTS } from '../db/schema';
import { runAllChecks } from './run-all';
import { DEFAULT_CONFIG } from '../shared/types';

function seedDb(): Database.Database {
  const db = new Database(':memory:');
  for (const s of SCHEMA_STATEMENTS) db.prepare(s).run();

  // h1/h2 are stored as JSON arrays by the crawler (db-writer JSON.stringifies them).
  const insPage = db.prepare(`INSERT INTO pages
    (url, is_internal, fetched, status, content_type, depth, title, title_count,
     meta_description, meta_robots, canonical, canonical_all, viewport, h1, h2,
     word_count, text_ratio, headers, indexable)
    VALUES (@url,1,1,@status,'text/html; charset=utf-8',@depth,@title,@title_count,
     @meta_description,@meta_robots,@canonical,@canonical,@viewport,@h1,@h2,
     @word_count,@text_ratio,@headers,@indexable)`);

  // A: healthy secure page — but missing meta description and no security headers.
  insPage.run({
    url: 'https://ex.com/',
    status: 200, depth: 0, title: 'Home - Example Store', title_count: 1,
    meta_description: null, meta_robots: null,
    canonical: 'https://ex.com/', viewport: 'width=device-width',
    h1: '["Welcome"]', h2: '["About"]', word_count: 800, text_ratio: 0.4,
    headers: JSON.stringify({ 'content-type': 'text/html' }), indexable: 1,
  });

  // B: insecure (http), missing title, missing viewport, deep, thin content, noindex.
  insPage.run({
    url: 'http://ex.com/deep/a/b/c/thin',
    status: 200, depth: 5, title: null, title_count: 0,
    meta_description: 'short', meta_robots: 'noindex',
    canonical: null, viewport: null,
    h1: null, h2: null, word_count: 20, text_ratio: 0.05,
    headers: JSON.stringify({}), indexable: 0,
  });

  // C: uppercase + underscore + params in URL, duplicate title of A, secure headers set.
  insPage.run({
    url: 'https://ex.com/Path_With/Thing?ref=1',
    status: 200, depth: 1, title: 'Home - Example Store', title_count: 1,
    meta_description: 'A perfectly reasonable meta description of adequate length here.',
    meta_robots: null, canonical: 'https://ex.com/Path_With/Thing?ref=1',
    viewport: 'width=device-width', h1: '["Thing"]', h2: '["Detail"]',
    word_count: 600, text_ratio: 0.35,
    headers: JSON.stringify({
      'strict-transport-security': 'max-age=31536000',
      'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'self'", 'referrer-policy': 'no-referrer',
    }), indexable: 1,
  });

  // D: indexable but genuinely thin — the legitimate target for content-thin.
  insPage.run({
    url: 'https://ex.com/short',
    status: 200, depth: 1, title: 'A Unique Short Indexable Page Title', title_count: 1,
    meta_description: 'A distinct, adequately sized meta description for the short page.',
    meta_robots: null, canonical: 'https://ex.com/short',
    viewport: 'width=device-width', h1: '["Short"]', h2: '["S"]',
    word_count: 20, text_ratio: 0.3,
    headers: JSON.stringify({
      'strict-transport-security': 'max-age=31536000',
      'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'self'", 'referrer-policy': 'no-referrer',
    }), indexable: 1,
  });

  return db;
}

function issueCount(db: Database.Database, checkId: string): number {
  return (
    db.prepare('SELECT COUNT(*) n FROM issues WHERE check_id = ?').get(checkId) as { n: number }
  ).n;
}

describe('runAllChecks', () => {
  it('populates issues for deliberately broken pages without throwing', () => {
    const db = seedDb();
    expect(() => runAllChecks(db, DEFAULT_CONFIG)).not.toThrow();

    const total = (db.prepare('SELECT COUNT(*) n FROM issues').get() as { n: number }).n;
    expect(total).toBeGreaterThan(0);

    // On-page: page B has no title; A & C share a duplicate title.
    expect(issueCount(db, 'title-missing')).toBe(1);
    expect(issueCount(db, 'title-duplicate')).toBe(2);
    expect(issueCount(db, 'desc-missing')).toBe(1); // page A

    // Directives: page B is noindex.
    expect(issueCount(db, 'directives-noindex')).toBe(1);

    // Content: page B is thin.
    expect(issueCount(db, 'content-thin')).toBe(1);

    // Security: page B served over HTTP.
    expect(issueCount(db, 'security-not-https')).toBe(1);
    // Page A is https but missing HSTS/CSP/etc.
    expect(issueCount(db, 'security-missing-hsts')).toBe(1);

    // Mobile: page B missing viewport.
    expect(issueCount(db, 'mobile-viewport-missing')).toBe(1);

    // URL structure: page C has uppercase, underscore, and params.
    expect(issueCount(db, 'url-uppercase')).toBe(1);
    expect(issueCount(db, 'url-underscores')).toBe(1);
    expect(issueCount(db, 'url-params')).toBe(1);

    // Site: page B deeper than 3 clicks.
    expect(issueCount(db, 'site-deep-pages')).toBe(1);

    db.close();
  });

  it('is idempotent — re-running replaces issues rather than duplicating', () => {
    const db = seedDb();
    runAllChecks(db, DEFAULT_CONFIG);
    const first = (db.prepare('SELECT COUNT(*) n FROM issues').get() as { n: number }).n;
    runAllChecks(db, DEFAULT_CONFIG);
    const second = (db.prepare('SELECT COUNT(*) n FROM issues').get() as { n: number }).n;
    expect(second).toBe(first);
    db.close();
  });
});
