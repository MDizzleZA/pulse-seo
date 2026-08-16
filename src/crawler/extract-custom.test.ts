import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { gzipSync } from 'zlib';
import { SCHEMA_STATEMENTS } from '../db/schema';
import { runExtractionAndSearch } from './extract-custom';
import { DEFAULT_CONFIG, type CrawlConfig, type Extractor, type CustomSearch } from '../shared/types';

const HTML = `<!DOCTYPE html><html><head>
<meta name="description" content="Buy now">
<script>/* GTM-ABCD123 loaded */ (function(){ window.dataLayer = []; })();</script>
</head><body>
<h1>Hello World</h1>
<span class="price">R199.00</span>
<a class="cta" href="/buy">Buy now</a>
<p>SKU: ABC123</p>
</body></html>`;

function seed(html: string | null): Database.Database {
  const d = new Database(':memory:');
  for (const s of SCHEMA_STATEMENTS) d.prepare(s).run();
  d.prepare(
    `INSERT INTO pages (url, is_internal, fetched, status, content_type, raw_html)
     VALUES ('https://ex.com/p', 1, 1, 200, 'text/html', ?)`
  ).run(html === null ? null : gzipSync(Buffer.from(html, 'utf8')));
  return d;
}

function cfg(extractors: Extractor[], customSearches: CustomSearch[]): CrawlConfig {
  return { ...DEFAULT_CONFIG, extractors, customSearches };
}

function values(d: Database.Database, extractorId: string): string[] {
  return (
    d.prepare('SELECT value FROM extractions WHERE extractor_id = ? ORDER BY id').all(extractorId) as {
      value: string;
    }[]
  ).map((r) => r.value);
}

function hits(d: Database.Database, searchId: string): number {
  return (
    d.prepare('SELECT hits FROM search_hits WHERE search_id = ?').get(searchId) as { hits: number }
  ).hits;
}

describe('runExtractionAndSearch', () => {
  it('extracts via CSS text, CSS attribute, XPath and regex', () => {
    const d = seed(HTML);
    const extractors: Extractor[] = [
      { id: 'price', name: 'Price', type: 'css', expression: '.price', extract: 'text' },
      { id: 'cta', name: 'CTA', type: 'css', expression: 'a.cta', extract: 'attr', attribute: 'href' },
      { id: 'h1x', name: 'H1x', type: 'xpath', expression: '//h1', extract: 'text' },
      { id: 'sku', name: 'SKU', type: 'regex', expression: 'SKU:\\s*(\\w+)', extract: 'text' },
    ];
    runExtractionAndSearch(d, cfg(extractors, []));

    expect(values(d, 'price')).toEqual(['R199.00']);
    expect(values(d, 'cta')).toEqual(['/buy']);
    expect(values(d, 'h1x')).toEqual(['Hello World']);
    expect(values(d, 'sku')).toEqual(['ABC123']);
    d.close();
  });

  it('counts custom searches as literal text and as regex', () => {
    const d = seed(HTML);
    const searches: CustomSearch[] = [
      { id: 'gtm-literal', name: 'GTM literal', pattern: 'GTM-', isRegex: false },
      { id: 'gtm-regex', name: 'GTM regex', pattern: 'GTM-[A-Z0-9]+', isRegex: true },
      { id: 'absent', name: 'Absent', pattern: 'fbq(', isRegex: false },
    ];
    runExtractionAndSearch(d, cfg([], searches));

    expect(hits(d, 'gtm-literal')).toBe(1);
    expect(hits(d, 'gtm-regex')).toBe(1);
    expect(hits(d, 'absent')).toBe(0);
    d.close();
  });

  it('clears prior results on re-run and skips pages without stored HTML', () => {
    const d = seed(HTML);
    const extractors: Extractor[] = [
      { id: 'price', name: 'Price', type: 'css', expression: '.price', extract: 'text' },
    ];
    runExtractionAndSearch(d, cfg(extractors, []));
    runExtractionAndSearch(d, cfg(extractors, [])); // second pass must not duplicate
    expect((d.prepare('SELECT COUNT(*) n FROM extractions').get() as { n: number }).n).toBe(1);

    // A page with no stored HTML yields nothing.
    const d2 = seed(null);
    runExtractionAndSearch(d2, cfg(extractors, []));
    expect((d2.prepare('SELECT COUNT(*) n FROM extractions').get() as { n: number }).n).toBe(0);
    d.close();
    d2.close();
  });

  it('does not touch result tables when nothing is configured', () => {
    const d = seed(HTML);
    // Pre-existing rows should remain untouched when there are no extractors/searches.
    d.prepare("INSERT INTO extractions (page_id, extractor_id, value) VALUES (1, 'stale', 'x')").run();
    runExtractionAndSearch(d, cfg([], []));
    expect((d.prepare('SELECT COUNT(*) n FROM extractions').get() as { n: number }).n).toBe(1);
    d.close();
  });
});
