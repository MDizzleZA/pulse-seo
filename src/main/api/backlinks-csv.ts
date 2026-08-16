// Backlinks CSV import. Providers export different headers (Ahrefs, Moz,
// Majestic); detect the provider from the header row, map columns onto the
// backlinks schema, and upsert. Pure core: text in, rows out, db write.
import type Database from 'better-sqlite3';

export interface BacklinkRow {
  url: string;
  domain_rating: number | null;
  url_rating: number | null;
  ref_domains: number | null;
  backlinks: number | null;
}

export interface ParsedBacklinks {
  provider: 'ahrefs' | 'moz' | 'majestic' | 'generic';
  rows: BacklinkRow[];
  skipped: number;
}

/** Minimal RFC-4180 CSV parser: quoted fields, embedded commas/quotes/newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  // Strip a UTF-8 BOM so the first header cell matches cleanly.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

interface ColumnMap {
  url: number;
  domain_rating: number;
  url_rating: number;
  ref_domains: number;
  backlinks: number;
}

// Header aliases per field, checked case-insensitively against trimmed headers.
const FIELD_ALIASES: Record<keyof ColumnMap, string[]> = {
  url: ['target url', 'url', 'page url', 'item', 'target'],
  domain_rating: ['domain rating', 'dr', 'domain authority', 'da', 'trust flow', 'trustflow'],
  url_rating: ['url rating', 'ur', 'page authority', 'pa', 'citation flow', 'citationflow'],
  ref_domains: [
    'referring domains', 'ref domains', 'ref. domains', 'linking root domains', 'refdomains',
    'ref domain', 'referring domain',
  ],
  backlinks: ['backlinks', 'inbound links', 'total backlinks', 'extbacklinks', 'external backlinks'],
};

function detectProvider(headers: string[]): ParsedBacklinks['provider'] {
  const h = headers.map((s) => s.trim().toLowerCase());
  if (h.some((x) => x === 'domain rating' || x === 'dr' || x === 'url rating' || x === 'ur')) {
    return 'ahrefs';
  }
  if (h.some((x) => x === 'domain authority' || x === 'da' || x === 'page authority' || x === 'pa')) {
    return 'moz';
  }
  if (h.some((x) => x.includes('trust flow') || x === 'trustflow' || x === 'citationflow')) {
    return 'majestic';
  }
  return 'generic';
}

function mapColumns(headers: string[]): ColumnMap | null {
  const h = headers.map((s) => s.trim().toLowerCase());
  const find = (aliases: string[]): number => {
    for (const a of aliases) {
      const i = h.indexOf(a);
      if (i !== -1) return i;
    }
    return -1;
  };
  const url = find(FIELD_ALIASES.url);
  if (url === -1) return null; // a URL column is the one hard requirement
  return {
    url,
    domain_rating: find(FIELD_ALIASES.domain_rating),
    url_rating: find(FIELD_ALIASES.url_rating),
    ref_domains: find(FIELD_ALIASES.ref_domains),
    backlinks: find(FIELD_ALIASES.backlinks),
  };
}

function numAt(row: string[], index: number): number | null {
  if (index === -1) return null;
  // Tolerate thousands separators and blank cells.
  const n = Number((row[index] ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) && (row[index] ?? '').trim() !== '' ? n : null;
}

export function parseBacklinksCsv(text: string): ParsedBacklinks | { error: string } {
  const table = parseCsv(text);
  if (table.length < 2) return { error: 'CSV has no data rows' };

  const headers = table[0];
  const cols = mapColumns(headers);
  if (!cols) return { error: 'Could not find a URL column in the CSV header' };
  const provider = detectProvider(headers);

  const rows: BacklinkRow[] = [];
  let skipped = 0;
  for (const raw of table.slice(1)) {
    const url = (raw[cols.url] ?? '').trim();
    if (!/^https?:\/\//i.test(url)) {
      skipped++;
      continue;
    }
    rows.push({
      url,
      domain_rating: numAt(raw, cols.domain_rating),
      url_rating: numAt(raw, cols.url_rating),
      ref_domains: numAt(raw, cols.ref_domains),
      backlinks: numAt(raw, cols.backlinks),
    });
  }
  if (rows.length === 0) return { error: 'No rows with a valid URL found' };
  return { provider, rows, skipped };
}

export function writeBacklinks(
  db: Database.Database,
  rows: BacklinkRow[],
  provider: string
): number {
  const upsert = db.prepare(
    `INSERT INTO backlinks (url, provider, domain_rating, url_rating, ref_domains, backlinks,
       imported_at)
     VALUES (@url, @provider, @domain_rating, @url_rating, @ref_domains, @backlinks, @imported_at)
     ON CONFLICT(url) DO UPDATE SET
       provider = excluded.provider, domain_rating = excluded.domain_rating,
       url_rating = excluded.url_rating, ref_domains = excluded.ref_domains,
       backlinks = excluded.backlinks, imported_at = excluded.imported_at`
  );
  const importedAt = new Date().toISOString();
  const write = db.transaction(() => {
    for (const row of rows) upsert.run({ ...row, provider, imported_at: importedAt });
  });
  write();
  return rows.length;
}
