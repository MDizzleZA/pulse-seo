import { describe, it, expect } from 'vitest';
import { gzipSync } from 'zlib';
import { discoverSitemapUrls, crawlSitemaps } from './sitemaps';
import type { FetchResult } from './fetcher';

function mk(body: string | Buffer | null, status = 200): FetchResult {
  const buf = body === null ? null : Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  return {
    ok: status >= 200 && status < 400,
    status,
    statusText: '',
    finalUrl: '',
    redirectChain: [],
    headers: {},
    contentType: 'application/xml',
    body: buf,
    size: buf?.length ?? 0,
    responseMs: 1,
  };
}

const INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://ex.com/sm1.xml</loc></sitemap>
  <sitemap><loc>https://ex.com/sm2.xml.gz</loc></sitemap>
</sitemapindex>`;

const SM1 = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://ex.com/a</loc><lastmod>2026-01-01</lastmod></url>
  <url><loc>https://ex.com/b</loc></url>
</urlset>`;

const SM2 = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://ex.com/c</loc></url>
</urlset>`;

describe('discoverSitemapUrls', () => {
  it('reads Sitemap: directives from robots.txt', () => {
    const found = discoverSitemapUrls(
      'https://ex.com',
      'User-agent: *\nSitemap: https://ex.com/custom-sitemap.xml\n'
    );
    expect(found).toEqual(['https://ex.com/custom-sitemap.xml']);
  });

  it('falls back to conventional locations when robots has none', () => {
    const found = discoverSitemapUrls('https://ex.com/', null);
    expect(found).toContain('https://ex.com/sitemap.xml');
    expect(found).toContain('https://ex.com/sitemap_index.xml');
  });
});

describe('crawlSitemaps', () => {
  it('expands a sitemap index, follows children, and gunzips .gz sitemaps', async () => {
    const responses: Record<string, FetchResult> = {
      'https://ex.com/sitemap.xml': mk(INDEX),
      'https://ex.com/sm1.xml': mk(SM1),
      'https://ex.com/sm2.xml.gz': mk(gzipSync(Buffer.from(SM2, 'utf8'))),
    };
    const result = await crawlSitemaps(['https://ex.com/sitemap.xml'], async (u) => responses[u] ?? mk(null, 404));

    const urls = result.entries.map((e) => e.url).sort();
    expect(urls).toEqual(['https://ex.com/a', 'https://ex.com/b', 'https://ex.com/c']);
    expect(result.entries.find((e) => e.url === 'https://ex.com/a')?.lastmod).toBe('2026-01-01');
    expect(result.sitemapsFetched).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
  });

  it('parses plain-text sitemaps and records fetch errors', async () => {
    const result = await crawlSitemaps(
      ['https://ex.com/text.txt', 'https://ex.com/missing.xml'],
      async (u) =>
        u.endsWith('text.txt')
          ? mk('https://ex.com/x\nhttps://ex.com/y\n# comment\n')
          : mk(null, 404)
    );
    expect(result.entries.map((e) => e.url).sort()).toEqual(['https://ex.com/x', 'https://ex.com/y']);
    expect(result.errors).toEqual([{ url: 'https://ex.com/missing.xml', error: 'HTTP 404' }]);
  });

  it('does not loop on a self-referential index and respects maxSitemaps', async () => {
    const selfIdx = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://ex.com/loop.xml</loc></sitemap></sitemapindex>`;
    const result = await crawlSitemaps(['https://ex.com/loop.xml'], async () => mk(selfIdx), {
      maxSitemaps: 5,
    });
    expect(result.sitemapsFetched).toHaveLength(1); // seen-set prevents refetch
  });
});
