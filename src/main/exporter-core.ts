// Dialog-free bulk-export core (no Electron imports) so tests and other
// consumers (MCP, scripts) can build workbooks/CSV folders directly.
import { createWriteStream } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import ExcelJS from 'exceljs';
import type { DbReader } from './db-reader';
import { TABS, type TabDef } from '../shared/tabs';

const PAGE_SIZE = 5000;

export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}


export function* tabRows(
  reader: DbReader,
  tab: TabDef
): Generator<Record<string, unknown>[], void, unknown> {
  const req = {
    tab: tab.id, filterId: null, search: null, sortCol: null, sortDir: null,
  };
  let offset = 0;
  for (;;) {
    const { rows } = reader.query({ ...req, offset, limit: PAGE_SIZE });
    if (rows.length > 0) yield rows;
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
}

export function exportableTabs(reader: DbReader): TabDef[] {
  return TABS.filter(
    (t) =>
      t.id !== 'visualization' &&
      reader.query({
        tab: t.id, filterId: null, search: null, sortCol: null, sortDir: null,
        offset: 0, limit: 1,
      }).total > 0
  );
}

/** Every-view XLSX workbook: Summary + Issues sheets, then one sheet per populated tab. */
export function buildWorkbook(reader: DbReader): { wb: ExcelJS.Workbook; sheets: number } {
  const tabs = exportableTabs(reader);
  const overview = reader.overview();

  const wb = new ExcelJS.Workbook();
  const summary = wb.addWorksheet('Summary');
  summary.columns = [
    { header: 'Metric', key: 'm', width: 40 },
    { header: 'Value', key: 'v', width: 20 },
  ];
  summary.getRow(1).font = { bold: true };
  summary.addRows([
    ['URLs crawled', overview.crawlInfo.pages],
    ['Internal', overview.crawlInfo.internal],
    ['External', overview.crawlInfo.external],
    ['Indexable', overview.crawlInfo.indexable],
  ]);
  const issuesWs = wb.addWorksheet('Issues');
  issuesWs.columns = [
    { header: 'Severity', key: 's', width: 12 },
    { header: 'Issue', key: 'n', width: 50 },
    { header: 'Category', key: 'c', width: 20 },
    { header: 'Count', key: 'k', width: 10 },
  ];
  issuesWs.getRow(1).font = { bold: true };
  for (const i of overview.issues) issuesWs.addRow([i.severity, i.name, i.category, i.count]);

  const usedNames = new Set(['Summary', 'Issues']);
  for (const tab of tabs) {
    let name = tab.label.slice(0, 31);
    for (let n = 2; usedNames.has(name); n++) name = `${tab.label.slice(0, 28)} ${n}`;
    usedNames.add(name);
    const ws = wb.addWorksheet(name);
    ws.columns = tab.columns.map((c) => ({
      header: c.label, key: c.key,
      width: Math.min(80, Math.max(12, (c.width ?? 120) / 8)),
    }));
    ws.getRow(1).font = { bold: true };
    for (const rows of tabRows(reader, tab)) {
      for (const row of rows) ws.addRow(tab.columns.map((c) => row[c.key] ?? null));
    }
  }
  return { wb, sheets: tabs.length + 2 };
}

/** Every-view CSV export into a folder: issues-summary.csv + one file per populated tab. */
export async function writeCsvFolder(reader: DbReader, dir: string): Promise<number> {
  const tabs = exportableTabs(reader);
  const overview = reader.overview();

  const issuesCsv = ['Severity,Issue,Category,Count']
    .concat(overview.issues.map((i) => [i.severity, i.name, i.category, i.count].map(csvEscape).join(',')))
    .join('\r\n');
  await writeFile(join(dir, 'issues-summary.csv'), '﻿' + issuesCsv + '\r\n', 'utf8');

  for (const tab of tabs) {
    const stream = createWriteStream(join(dir, `${tab.id}.csv`), { encoding: 'utf8' });
    stream.write('﻿');
    stream.write(tab.columns.map((c) => csvEscape(c.label)).join(',') + '\r\n');
    for (const rows of tabRows(reader, tab)) {
      for (const row of rows) {
        stream.write(tab.columns.map((c) => csvEscape(row[c.key])).join(',') + '\r\n');
      }
    }
    await new Promise<void>((resolve, reject) => {
      stream.end(() => resolve());
      stream.on('error', reject);
    });
  }
  return tabs.length + 1;
}

