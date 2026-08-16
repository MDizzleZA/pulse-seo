import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_STATEMENTS } from '../../db/schema';
import { fetchGa4Pages, writeGa4, type Ga4Row } from './ga4';
import type { FetchLike } from './common';

function fresh(): Database.Database {
  const d = new Database(':memory:');
  for (const s of SCHEMA_STATEMENTS) d.prepare(s).run();
  return d;
}

function addPage(d: Database.Database, url: string): void {
  d.prepare(
    `INSERT INTO pages (url, is_internal, fetched, status, content_type)
     VALUES (?, 1, 1, 200, 'text/html')`
  ).run(url);
}

function jsonResponse(status: number, body: unknown): ReturnType<FetchLike> {
  return Promise.resolve({
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function apiRow(path: string, sessions: number): Record<string, unknown> {
  return {
    dimensionValues: [{ value: path }],
    metricValues: [
      { value: String(sessions) },
      { value: String(Math.floor(sessions / 2)) },
      { value: '0.5' },
      { value: '3' },
      { value: String(sessions * 2) },
    ],
  };
}

describe('fetchGa4Pages', () => {
  it('parses metric rows and paginates by rowCount', async () => {
    const offsets: number[] = [];
    const fetchImpl: FetchLike = (_url, init) => {
      const body = JSON.parse(init!.body!) as { offset: number };
      offsets.push(body.offset);
      const rows =
        body.offset === 0 ? [apiRow('/a', 10), apiRow('/b', 5)] : [apiRow('/c', 1)];
      return jsonResponse(200, { rows, rowCount: 3 });
    };
    const rows = await fetchGa4Pages(fetchImpl, 'tok', 'properties/12345', 30);
    expect(offsets).toEqual([0, 2]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      path: '/a',
      sessions: 10,
      engaged_sessions: 5,
      engagement_rate: 0.5,
      conversions: 3,
      total_users: 20,
    });
  });

  it('strips a properties/ prefix and throws on API errors', async () => {
    let requested = '';
    const fetchImpl: FetchLike = (url) => {
      requested = url;
      return jsonResponse(403, { error: 'denied' });
    };
    await expect(fetchGa4Pages(fetchImpl, 'tok', 'properties/999', 30)).rejects.toThrow(/403/);
    expect(requested).toContain('/properties/999:runReport');
    expect(requested).not.toContain('properties/properties');
  });
});

describe('writeGa4', () => {
  const row = (path: string, sessions: number, rate = 0.5): Ga4Row => ({
    path,
    sessions,
    engaged_sessions: Math.floor(sessions / 2),
    engagement_rate: rate,
    conversions: 1,
    total_users: sessions,
  });

  it('joins paths to crawled URLs, tolerating trailing-slash differences', () => {
    const d = fresh();
    addPage(d, 'https://ex.com/about'); // GA4 reports '/about/'
    addPage(d, 'https://ex.com/');

    const { written, unmatched } = writeGa4(d, [
      row('/about/', 7),
      row('/', 20),
      row('/nowhere', 3),
    ]);
    expect(written).toBe(2);
    expect(unmatched).toBe(1);

    const about = d
      .prepare('SELECT sessions FROM api_ga4 WHERE url = ?')
      .get('https://ex.com/about') as { sessions: number };
    expect(about.sessions).toBe(7);
    d.close();
  });

  it('aggregates slash variants onto one URL with session-weighted rate', () => {
    const d = fresh();
    addPage(d, 'https://ex.com/page');

    writeGa4(d, [row('/page', 30, 0.8), row('/page/', 10, 0.4)]);
    const merged = d
      .prepare('SELECT sessions, engagement_rate FROM api_ga4 WHERE url = ?')
      .get('https://ex.com/page') as { sessions: number; engagement_rate: number };
    expect(merged.sessions).toBe(40);
    expect(merged.engagement_rate).toBeCloseTo(0.7); // (0.8*30 + 0.4*10) / 40
    d.close();
  });

  it('replaces stale rows on re-import', () => {
    const d = fresh();
    addPage(d, 'https://ex.com/keep');
    d.prepare(
      `INSERT INTO api_ga4 (url, sessions) VALUES ('https://ex.com/stale', 99)`
    ).run();

    writeGa4(d, [row('/keep', 5)]);
    const urls = (d.prepare('SELECT url FROM api_ga4').all() as { url: string }[]).map((r) => r.url);
    expect(urls).toEqual(['https://ex.com/keep']);
    d.close();
  });
});
