import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_STATEMENTS } from '../../db/schema';
import { fetchGscPages, writeGsc, listGscSites } from './gsc';
import type { FetchLike } from './common';

function fresh(): Database.Database {
  const d = new Database(':memory:');
  for (const s of SCHEMA_STATEMENTS) d.prepare(s).run();
  return d;
}

function jsonResponse(status: number, body: unknown): ReturnType<FetchLike> {
  return Promise.resolve({
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function gscApiRow(url: string, clicks: number): Record<string, unknown> {
  return { keys: [url], clicks, impressions: clicks * 10, ctr: 0.1, position: 3.14159 };
}

describe('fetchGscPages', () => {
  it('paginates until a short page and converts ctr/position', async () => {
    const calls: { startRow: number; rowLimit: number }[] = [];
    const fetchImpl: FetchLike = (_url, init) => {
      const body = JSON.parse(init!.body!) as { startRow: number; rowLimit: number };
      calls.push({ startRow: body.startRow, rowLimit: body.rowLimit });
      // First page full (3 rows at pageSize 3), second page short (1 row).
      const rows =
        body.startRow === 0
          ? [gscApiRow('https://ex.com/a', 5), gscApiRow('https://ex.com/b', 4), gscApiRow('https://ex.com/c', 3)]
          : [gscApiRow('https://ex.com/d', 1)];
      return jsonResponse(200, { rows });
    };

    // maxRows 6 → pageSize is min(25000, remaining); force pagination with maxRows small
    const rows = await fetchGscPages(fetchImpl, 'tok', 'sc-domain:ex.com', 90, 6);
    // pageSize = 6 on first call; API returned 3 (< 6) → stops after one call.
    expect(calls).toHaveLength(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ url: 'https://ex.com/a', clicks: 5, impressions: 50 });
    expect(rows[0].ctr).toBe(10); // 0.1 → 10%
    expect(rows[0].position).toBe(3.1);
  });

  it('requests successive startRows while pages come back full', async () => {
    const starts: number[] = [];
    const fetchImpl: FetchLike = (_url, init) => {
      const body = JSON.parse(init!.body!) as { startRow: number; rowLimit: number };
      starts.push(body.startRow);
      const rows = Array.from({ length: body.rowLimit }, (_, i) =>
        gscApiRow(`https://ex.com/${body.startRow + i}`, 1)
      );
      return jsonResponse(200, { rows });
    };
    const rows = await fetchGscPages(fetchImpl, 'tok', 'https://ex.com/', 30, 5);
    expect(rows).toHaveLength(5);
    expect(starts).toEqual([0]); // maxRows 5 filled in a single full page
  });

  it('throws with API detail on error status', async () => {
    const fetchImpl: FetchLike = () => jsonResponse(403, { error: 'denied' });
    await expect(fetchGscPages(fetchImpl, 'tok', 'https://ex.com/', 30)).rejects.toThrow(/403/);
  });
});

describe('writeGsc', () => {
  it('replaces previous data, counts orphans against crawled pages', () => {
    const d = fresh();
    d.prepare(
      `INSERT INTO pages (url, is_internal, fetched, status, content_type)
       VALUES ('https://ex.com/a', 1, 1, 200, 'text/html')`
    ).run();
    d.prepare(
      `INSERT INTO api_gsc (url, clicks, impressions, ctr, position) VALUES ('https://ex.com/stale', 1, 1, 1, 1)`
    ).run();

    const { written, orphans } = writeGsc(d, [
      { url: 'https://ex.com/a', clicks: 5, impressions: 50, ctr: 10, position: 3.1 },
      { url: 'https://ex.com/gone', clicks: 2, impressions: 20, ctr: 10, position: 8 },
    ]);
    expect(written).toBe(2);
    expect(orphans).toBe(1);

    const urls = (d.prepare('SELECT url FROM api_gsc ORDER BY url').all() as { url: string }[]).map(
      (r) => r.url
    );
    expect(urls).toEqual(['https://ex.com/a', 'https://ex.com/gone']); // stale row purged
    d.close();
  });
});

describe('listGscSites', () => {
  it('returns siteEntry list', async () => {
    const fetchImpl: FetchLike = () =>
      jsonResponse(200, {
        siteEntry: [{ siteUrl: 'sc-domain:ex.com', permissionLevel: 'siteOwner' }],
      });
    const sites = await listGscSites(fetchImpl, 'tok');
    expect(sites).toEqual([{ siteUrl: 'sc-domain:ex.com', permissionLevel: 'siteOwner' }]);
  });
});
