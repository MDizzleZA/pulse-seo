// Client-side CSV export of the current view (full result set, paged queries).
import { tabById } from '../../src/shared/tabs';
import type { PulseDb } from './db';

const PAGE = 5000;

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Formula-injection guard: crawled sites control these strings (titles,
  // anchors, URLs). Neutralise cells Excel would execute as formulas.
  if (/^[=+@\t\r]/.test(s) || (s.startsWith('-') && !/^-\d*\.?\d+$/.test(s))) {
    s = "'" + s;
  }
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function buildViewCsv(
  db: PulseDb,
  tab: string,
  filterId: string | null,
  search: string | null
): { name: string; csv: string; rows: number } | null {
  const def = tabById(tab);
  if (!def) return null;
  const lines = [def.columns.map((c) => csvEscape(c.label)).join(',')];
  let offset = 0;
  for (;;) {
    const { rows } = db.query({
      tab, filterId, search, sortCol: null, sortDir: null, offset, limit: PAGE,
    });
    for (const row of rows) {
      lines.push(def.columns.map((c) => csvEscape(row[c.key])).join(','));
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  const name = `${tab}${filterId ? '-' + filterId.replace(/[^a-z0-9-]/gi, '_') : ''}.csv`;
  return { name, csv: lines.join('\r\n') + '\r\n', rows: lines.length - 1 };
}

export function downloadViewCsv(
  db: PulseDb,
  tab: string,
  filterId: string | null,
  search: string | null
): number {
  const built = buildViewCsv(db, tab, filterId, search);
  if (!built) return 0;
  const blob = new Blob(['﻿' + built.csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = built.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  // breadcrumb for tests/debugging (no data, just metadata)
  (window as unknown as Record<string, unknown>).__lastExport = {
    name: built.name, rows: built.rows, bytes: blob.size,
  };
  return built.rows;
}
