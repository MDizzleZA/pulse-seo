import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_STATEMENTS } from '../../db/schema';
import { parseCsv, parseBacklinksCsv, writeBacklinks } from './backlinks-csv';

function fresh(): Database.Database {
  const d = new Database(':memory:');
  for (const s of SCHEMA_STATEMENTS) d.prepare(s).run();
  return d;
}

describe('parseCsv', () => {
  it('handles quoted fields, embedded commas/quotes/newlines, CRLF and BOM', () => {
    const text = '\uFEFF' + 'a,b,c\r\n"1,x","say ""hi""","line\nbreak"\r\nplain,2,3\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['1,x', 'say "hi"', 'line\nbreak'],
      ['plain', '2', '3'],
    ]);
  });

  it('drops fully blank lines', () => {
    expect(parseCsv('a,b\n\n1,2\n,\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseBacklinksCsv', () => {
  it('detects Ahrefs headers and maps ratings', () => {
    const csv = [
      'Target URL,Domain Rating,URL Rating,Referring Domains,Backlinks',
      'https://ex.com/,71,45,"1,234",5678',
      'not-a-url,1,2,3,4',
    ].join('\n');
    const parsed = parseBacklinksCsv(csv);
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.provider).toBe('ahrefs');
    expect(parsed.skipped).toBe(1);
    expect(parsed.rows).toEqual([
      {
        url: 'https://ex.com/',
        domain_rating: 71,
        url_rating: 45,
        ref_domains: 1234,
        backlinks: 5678,
      },
    ]);
  });

  it('detects Moz headers (DA/PA aliases)', () => {
    const csv = 'URL,Domain Authority,Page Authority,Linking Root Domains,Inbound Links\nhttps://ex.com/p,40,35,12,99';
    const parsed = parseBacklinksCsv(csv);
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.provider).toBe('moz');
    expect(parsed.rows[0]).toMatchObject({ domain_rating: 40, url_rating: 35, ref_domains: 12 });
  });

  it('detects Majestic (Item/TrustFlow) and tolerates missing columns', () => {
    const csv = 'Item,TrustFlow,CitationFlow\nhttps://ex.com/,22,31';
    const parsed = parseBacklinksCsv(csv);
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.provider).toBe('majestic');
    expect(parsed.rows[0]).toMatchObject({
      domain_rating: 22,
      url_rating: 31,
      ref_domains: null,
      backlinks: null,
    });
  });

  it('errors when no URL column or no valid rows exist', () => {
    expect(parseBacklinksCsv('foo,bar\n1,2')).toHaveProperty('error');
    expect(parseBacklinksCsv('URL,DR\nnope,3')).toHaveProperty('error');
    expect(parseBacklinksCsv('URL,DR')).toHaveProperty('error');
  });
});

describe('writeBacklinks', () => {
  it('upserts by URL with the detected provider', () => {
    const d = fresh();
    const rows = [
      { url: 'https://ex.com/', domain_rating: 70, url_rating: 40, ref_domains: 10, backlinks: 50 },
    ];
    expect(writeBacklinks(d, rows, 'ahrefs')).toBe(1);
    // Re-import with new figures replaces, not duplicates.
    rows[0].domain_rating = 72;
    writeBacklinks(d, rows, 'ahrefs');
    const all = d.prepare('SELECT * FROM backlinks').all() as Record<string, unknown>[];
    expect(all).toHaveLength(1);
    expect(all[0].domain_rating).toBe(72);
    expect(all[0].provider).toBe('ahrefs');
    d.close();
  });
});
