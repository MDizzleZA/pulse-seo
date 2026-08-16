import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_STATEMENTS } from '../../db/schema';
import { runPsi, selectPsiUrls, parsePsiResponse } from './psi';
import type { FetchLike } from './common';

function fresh(): Database.Database {
  const d = new Database(':memory:');
  for (const s of SCHEMA_STATEMENTS) d.prepare(s).run();
  return d;
}

function addPage(d: Database.Database, url: string, depth = 0): number {
  return Number(
    d
      .prepare(
        `INSERT INTO pages (url, is_internal, fetched, status, content_type, depth)
         VALUES (?, 1, 1, 200, 'text/html', ?)`
      )
      .run(url, depth).lastInsertRowid
  );
}

const PSI_BODY = {
  lighthouseResult: {
    categories: {
      performance: { score: 0.87 },
      seo: { score: 1 },
      accessibility: { score: 0.95 },
      'best-practices': { score: 0.75 },
    },
    audits: {
      'largest-contentful-paint': { numericValue: 2100.5 },
      'cumulative-layout-shift': { numericValue: 0.02 },
    },
  },
  loadingExperience: {
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2900 },
      INTERACTION_TO_NEXT_PAINT: { percentile: 180 },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 12 },
    },
  },
};

function jsonResponse(status: number, body: unknown): ReturnType<FetchLike> {
  return Promise.resolve({
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

describe('parsePsiResponse', () => {
  it('maps categories, lab audits and field percentiles', () => {
    const row = parsePsiResponse(PSI_BODY, 'mobile');
    expect(row.performance).toBe(87);
    expect(row.seo).toBe(100);
    expect(row.best_practices).toBe(75);
    expect(row.lcp_ms).toBeCloseTo(2100.5);
    expect(row.inp_ms).toBeNull(); // INP has no lab audit
    expect(row.field_lcp_ms).toBe(2900);
    expect(row.field_inp_ms).toBe(180);
    expect(row.field_cls).toBeCloseTo(0.12); // CrUX CLS percentile is ×100
  });

  it('tolerates missing sections', () => {
    const row = parsePsiResponse({}, 'desktop');
    expect(row.performance).toBeNull();
    expect(row.field_lcp_ms).toBeNull();
  });
});

describe('selectPsiUrls', () => {
  it('picks internal HTML 200 pages, most-linked first, capped', () => {
    const d = fresh();
    const a = addPage(d, 'https://ex.com/', 0);
    const b = addPage(d, 'https://ex.com/popular', 1);
    addPage(d, 'https://ex.com/lonely', 2);
    d.prepare(
      `INSERT INTO pages (url, is_internal, fetched, status, content_type)
       VALUES ('https://ex.com/broken', 1, 1, 404, 'text/html')`
    ).run();
    // Two inlinks to /popular, one to /.
    d.prepare(
      `INSERT INTO links (src_id, dst_url, dst_id) VALUES (?, 'https://ex.com/popular', ?)`
    ).run(a, b);
    d.prepare(
      `INSERT INTO links (src_id, dst_url, dst_id) VALUES (?, 'https://ex.com/popular', ?)`
    ).run(a, b);
    d.prepare(`INSERT INTO links (src_id, dst_url, dst_id) VALUES (?, 'https://ex.com/', ?)`).run(
      b,
      a
    );

    const urls = selectPsiUrls(d, 2);
    expect(urls).toEqual(['https://ex.com/popular', 'https://ex.com/']);
    d.close();
  });
});

describe('runPsi', () => {
  it('writes rows for successful fetches and collects errors for failures', async () => {
    const d = fresh();
    addPage(d, 'https://ex.com/');
    addPage(d, 'https://ex.com/fail');

    const fetchImpl: FetchLike = (url) =>
      url.includes(encodeURIComponent('https://ex.com/fail'))
        ? jsonResponse(500, { error: 'boom' })
        : jsonResponse(200, PSI_BODY);

    const result = await runPsi(d, ['https://ex.com/', 'https://ex.com/fail'], {
      apiKey: 'k',
      strategy: 'mobile',
      fetchImpl,
    });
    expect(result.written).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain('https://ex.com/fail');

    const row = d.prepare('SELECT * FROM api_psi WHERE url = ?').get('https://ex.com/') as Record<
      string,
      unknown
    >;
    expect(row.performance).toBe(87);
    expect(row.strategy).toBe('mobile');
    expect(row.field_inp_ms).toBe(180);
    d.close();
  });

  it('upserts on re-run instead of duplicating', async () => {
    const d = fresh();
    const fetchImpl: FetchLike = () => jsonResponse(200, PSI_BODY);
    await runPsi(d, ['https://ex.com/'], { apiKey: 'k', strategy: 'mobile', fetchImpl });
    await runPsi(d, ['https://ex.com/'], { apiKey: 'k', strategy: 'desktop', fetchImpl });
    const rows = d.prepare('SELECT strategy FROM api_psi').all() as { strategy: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].strategy).toBe('desktop');
    d.close();
  });

  it('reports progress per URL', async () => {
    const d = fresh();
    const seen: number[] = [];
    await runPsi(d, ['https://ex.com/a', 'https://ex.com/b'], {
      apiKey: 'k',
      strategy: 'mobile',
      fetchImpl: () => jsonResponse(200, PSI_BODY),
      onProgress: (done, total) => seen.push(done * 10 + total),
    });
    expect(seen.sort()).toEqual([12, 22]);
    d.close();
  });
});
