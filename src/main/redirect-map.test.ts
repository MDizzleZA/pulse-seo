import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_STATEMENTS } from '../db/schema';
import { buildRedirectEntries, renderHtaccess, renderNginx, renderWpCsv } from './redirect-map';

function seededDb(): Database.Database {
  const db = new Database(':memory:');
  for (const s of SCHEMA_STATEMENTS) db.prepare(s).run();
  const insPage = db.prepare(
    `INSERT INTO pages (url, is_internal, fetched, status, content_type, indexable, title)
     VALUES (?, 1, 1, 200, 'text/html', 1, ?)`
  );
  insPage.run('https://new.com/living-annuity-guide/', 'Living Annuity Guide');
  insPage.run('https://new.com/about-us/', 'About Us');
  const insCmp = db.prepare(
    `INSERT INTO compare_results (old_url, old_status, old_title, match_type, result)
     VALUES (?, 200, ?, 'none', ?)`
  );
  insCmp.run('https://old.com/living-annuity/', 'Living Annuity', 'missing');
  insCmp.run('https://old.com/completely-unrelated-xyz/', null, 'missing');
  insCmp.run('https://old.com/about/', 'About Us | Old', 'broken');
  return db;
}

describe('redirect map', () => {
  it('suggests targets by slug/title overlap with confidence tiers', () => {
    const db = seededDb();
    const entries = buildRedirectEntries(db);
    expect(entries).toHaveLength(3);

    const annuity = entries.find((e) => e.oldPath === '/living-annuity/')!;
    expect(annuity.target).toBe('https://new.com/living-annuity-guide/');
    expect(annuity.confidence).not.toBe('none');

    const unrelated = entries.find((e) => e.oldPath === '/completely-unrelated-xyz/')!;
    expect(unrelated.target).toBeNull();
    expect(unrelated.confidence).toBe('none');

    const about = entries.find((e) => e.oldPath === '/about/')!;
    expect(about.target).toBe('https://new.com/about-us/');
    db.close();
  });

  it('renders deployable formats, commenting out unresolved entries', () => {
    const db = seededDb();
    const entries = buildRedirectEntries(db);

    const ht = renderHtaccess(entries);
    expect(ht).toContain('Redirect 301 /living-annuity/ https://new.com/living-annuity-guide/');
    expect(ht).toContain('# TODO no target found: /completely-unrelated-xyz/');

    const ng = renderNginx(entries);
    expect(ng).toContain('location = /living-annuity/ { return 301 https://new.com/living-annuity-guide/; }');

    const csv = renderWpCsv(entries);
    expect(csv.split('\n')[0]).toBe('source,target');
    expect(csv).toContain('/living-annuity/,https://new.com/living-annuity-guide/');
    expect(csv).not.toContain('completely-unrelated');
    db.close();
  });

  it('returns empty when compare has not run', () => {
    const db = new Database(':memory:');
    for (const s of SCHEMA_STATEMENTS) db.prepare(s).run();
    expect(buildRedirectEntries(db)).toEqual([]);
    db.close();
  });
});
