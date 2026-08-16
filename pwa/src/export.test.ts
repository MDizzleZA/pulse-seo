import { describe, it, expect } from 'vitest';
import { buildViewCsv } from './export';
import type { PulseDb } from './db';

// Minimal stand-in for PulseDb: one page of rows, then empty.
function fakeDb(rows: Record<string, unknown>[]): PulseDb {
  let served = false;
  return {
    query: () => {
      if (served) return { rows: [], total: rows.length };
      served = true;
      return { rows, total: rows.length };
    },
  } as unknown as PulseDb;
}

describe('PWA CSV export', () => {
  it('neutralises formula-injection payloads from crawl data', () => {
    const db = fakeDb([
      { url: 'https://ex.com/a', title: '=HYPERLINK("http://evil","x")', title_chars: 1, title_px: 1, title_count: 1, indexable: 'Yes', indexability_reason: '' },
      { url: 'https://ex.com/b', title: '+SUM(A1:A9)', title_chars: 1, title_px: 1, title_count: 1, indexable: 'Yes', indexability_reason: '' },
      { url: 'https://ex.com/c', title: '@cmd', title_chars: 1, title_px: 1, title_count: 1, indexable: 'Yes', indexability_reason: '' },
      { url: 'https://ex.com/d', title: '-2+3+cmd', title_chars: 1, title_px: 1, title_count: 1, indexable: 'Yes', indexability_reason: '' },
      { url: 'https://ex.com/e', title: '-42', title_chars: 1, title_px: 1, title_count: 1, indexable: 'Yes', indexability_reason: '' },
      { url: 'https://ex.com/f', title: 'Normal Title', title_chars: 1, title_px: 1, title_count: 1, indexable: 'Yes', indexability_reason: '' },
    ]);
    const built = buildViewCsv(db, 'titles', null, null)!;
    const lines = built.csv.split('\r\n');
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(lines[2]).toContain("'+SUM(A1:A9)");
    expect(lines[3]).toContain("'@cmd");
    expect(lines[4]).toContain("'-2+3+cmd");
    expect(lines[5]).toContain('-42'); // plain negative numbers stay numeric
    expect(lines[5]).not.toContain("'-42");
    expect(lines[6]).toContain('Normal Title');
    expect(built.rows).toBe(6);
  });
});
