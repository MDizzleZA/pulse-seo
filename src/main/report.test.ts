import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_STATEMENTS, metaSet } from '../db/schema';
import { collectReportData, renderReportDocx } from './report';

function seededDb(): Database.Database {
  const db = new Database(':memory:');
  for (const s of SCHEMA_STATEMENTS) db.prepare(s).run();
  metaSet(db, 'robots_origin', 'https://ex.com');
  metaSet(db, 'last_crawl', '2026-07-15T10:00:00.000Z');
  const ins = db.prepare(
    `INSERT INTO pages (url, is_internal, fetched, status, content_type, indexable, response_ms, segment)
     VALUES (?, ?, 1, ?, 'text/html', ?, ?, ?)`
  );
  ins.run('https://ex.com/', 1, 200, 1, 100, 'Home');
  ins.run('https://ex.com/blog/a', 1, 200, 1, 200, 'Blog');
  ins.run('https://ex.com/dead', 1, 404, 0, 50, null);
  ins.run('https://other.com/x', 0, 200, 0, 80, null);
  db.prepare("INSERT INTO issues (check_id, page_id, detail) VALUES ('title-missing', 1, NULL)").run();
  db.prepare("INSERT INTO issues (check_id, page_id, detail) VALUES ('response-broken-internal', 3, NULL)").run();
  return db;
}

describe('report', () => {
  it('collects crawl data: counts, buckets, health, issues, segments', () => {
    const db = seededDb();
    const d = collectReportData(db);
    expect(d.site).toBe('https://ex.com');
    expect(d.crawlDate).toBe('2026-07-15');
    expect(d.pages).toBe(4);
    expect(d.internal).toBe(3);
    expect(d.indexable).toBe(2);
    expect(d.statusBuckets).toContainEqual({ label: '4xx client error', count: 1 });
    expect(d.issues.map((i) => i.name)).toContain('Missing page title');
    expect(d.segments).toHaveLength(2);
    expect(d.segments).toContainEqual({ segment: 'Blog', pages: 1, indexable: 1 });
    expect(d.segments).toContainEqual({ segment: 'Home', pages: 1, indexable: 1 });
    expect(d.worstPages.length).toBeGreaterThan(0);
    db.close();
  });

  it('renders a valid non-trivial docx buffer', async () => {
    const db = seededDb();
    const buf = await renderReportDocx(collectReportData(db));
    expect(buf.length).toBeGreaterThan(1000);
    // DOCX is a zip: PK magic bytes.
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    db.close();
  });
});
