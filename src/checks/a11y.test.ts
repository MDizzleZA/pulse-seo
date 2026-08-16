import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_STATEMENTS } from '../db/schema';
import { checkA11y } from './a11y';

function db_(): Database.Database {
  const db = new Database(':memory:');
  for (const s of SCHEMA_STATEMENTS) db.prepare(s).run();
  return db;
}

function issues(db: Database.Database, id: string): { detail: string | null }[] {
  return db.prepare('SELECT detail FROM issues WHERE check_id = ?').all(id) as {
    detail: string | null;
  }[];
}

describe('checkA11y', () => {
  it('buckets violations into critical/serious/minor issues per page', () => {
    const db = db_();
    const ins = db.prepare(
      `INSERT INTO pages (url, is_internal, fetched, status, content_type, rendered, a11y_violations)
       VALUES (?, 1, 1, 200, 'text/html', 1, ?)`
    );
    ins.run('https://ex.com/bad', JSON.stringify([
      { id: 'image-alt', impact: 'critical', help: 'Images must have alternate text', nodes: 3, sample: 'img.hero' },
      { id: 'color-contrast', impact: 'serious', help: 'Contrast', nodes: 8, sample: '.btn' },
      { id: 'region', impact: 'moderate', help: 'Landmarks', nodes: 1, sample: 'div' },
    ]));
    ins.run('https://ex.com/clean', null);
    ins.run('https://ex.com/not-rendered', JSON.stringify([{ id: 'x', impact: 'critical', help: 'h', nodes: 1, sample: '' }]));
    db.prepare('UPDATE pages SET rendered = 0 WHERE url = ?').run('https://ex.com/not-rendered');

    checkA11y(db);

    const crit = issues(db, 'a11y-critical');
    expect(crit).toHaveLength(1);
    expect(crit[0].detail).toContain('alternate text');
    expect(issues(db, 'a11y-serious')).toHaveLength(1);
    expect(issues(db, 'a11y-minor')).toHaveLength(1);
    db.close();
  });
});
