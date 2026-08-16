import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_STATEMENTS } from '../db/schema';
import { compileSegments, segmentForUrl, assignSegments } from './segments';

describe('segments', () => {
  it('first matching segment wins; invalid patterns are skipped', () => {
    const compiled = compileSegments([
      { id: 'bad', name: 'Bad', pattern: '([' },
      { id: 'blog', name: 'Blog', pattern: '/blog/' },
      { id: 'all', name: 'Everything', pattern: '.' },
      { id: 'empty', name: '', pattern: '/x/' },
    ]);
    expect(compiled.map((c) => c.name)).toEqual(['Blog', 'Everything']);
    expect(segmentForUrl('https://ex.com/blog/post', compiled)).toBe('Blog');
    expect(segmentForUrl('https://ex.com/about', compiled)).toBe('Everything');
    expect(segmentForUrl('https://ex.com/blog/post', [])).toBeNull();
  });

  it('stamps pages.segment for internal fetched pages', () => {
    const db = new Database(':memory:');
    for (const s of SCHEMA_STATEMENTS) db.prepare(s).run();
    const ins = db.prepare(
      'INSERT INTO pages (url, is_internal, fetched, status) VALUES (?, ?, 1, 200)'
    );
    ins.run('https://ex.com/blog/a', 1);
    ins.run('https://ex.com/product/x', 1);
    ins.run('https://ex.com/other', 1);
    ins.run('https://elsewhere.com/blog/b', 0); // external — untouched

    assignSegments(db, [
      { id: 'blog', name: 'Blog', pattern: '/blog/' },
      { id: 'product', name: 'Product', pattern: '/product/' },
    ]);

    const rows = db.prepare('SELECT url, segment FROM pages ORDER BY url').all() as {
      url: string;
      segment: string | null;
    }[];
    expect(rows).toEqual([
      { url: 'https://elsewhere.com/blog/b', segment: null },
      { url: 'https://ex.com/blog/a', segment: 'Blog' },
      { url: 'https://ex.com/other', segment: null },
      { url: 'https://ex.com/product/x', segment: 'Product' },
    ]);

    // Re-running with no segments clears assignments (config removed).
    assignSegments(db, []);
    const cleared = db
      .prepare('SELECT COUNT(*) n FROM pages WHERE segment IS NOT NULL')
      .get() as { n: number };
    expect(cleared.n).toBe(0);
    db.close();
  });
});
