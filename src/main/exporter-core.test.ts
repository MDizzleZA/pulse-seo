import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_STATEMENTS } from '../db/schema';
import { DbReader } from './db-reader';
import { buildWorkbook, writeCsvFolder, exportableTabs, csvEscape } from './exporter-core';

function makeProject(dir: string): string {
  const path = join(dir, 'bulk.pulse');
  const db = new Database(path);
  for (const s of SCHEMA_STATEMENTS) db.prepare(s).run();
  const ins = db.prepare(
    `INSERT INTO pages (url, is_internal, fetched, status, content_type, indexable, title, word_count)
     VALUES (?, 1, 1, ?, 'text/html', 1, ?, 100)`
  );
  ins.run('https://ex.com/', 200, 'Home, with "quotes"');
  ins.run('https://ex.com/a', 200, 'Page A');
  ins.run('https://ex.com/gone', 404, null);
  db.prepare("INSERT INTO issues (check_id, page_id) VALUES ('title-missing', 3)").run();
  db.close();
  return path;
}

describe('bulk export core', () => {
  it('builds a workbook with Summary, Issues and one sheet per populated tab', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pulse-bulk-'));
    const reader = new DbReader();
    reader.setPath(makeProject(dir));

    const tabs = exportableTabs(reader);
    expect(tabs.map((t) => t.id)).toContain('internal');
    expect(tabs.map((t) => t.id)).not.toContain('visualization');
    expect(tabs.map((t) => t.id)).not.toContain('compare'); // empty — skipped

    const { wb, sheets } = buildWorkbook(reader);
    const names = wb.worksheets.map((w) => w.name);
    expect(names[0]).toBe('Summary');
    expect(names[1]).toBe('Issues');
    expect(sheets).toBe(tabs.length + 2);
    const internal = wb.worksheets.find((w) => w.name === 'Internal')!;
    expect(internal.rowCount).toBe(4); // header + 3 pages

    reader.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes one CSV per populated tab plus an issues summary', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pulse-bulkcsv-'));
    const reader = new DbReader();
    reader.setPath(makeProject(dir));

    const outDir = join(dir, 'out');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(outDir);
    const files = await writeCsvFolder(reader, outDir);
    const names = readdirSync(outDir);
    expect(names).toContain('issues-summary.csv');
    expect(names).toContain('internal.csv');
    expect(files).toBe(names.length);

    const internalCsv = readFileSync(join(outDir, 'internal.csv'), 'utf8');
    expect(internalCsv).toContain('"Home, with ""quotes"""'); // escaping round-trips
    expect(internalCsv.split('\r\n').filter(Boolean).length).toBe(4);

    reader.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('csvEscape quotes commas, quotes and newlines', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"');
    expect(csvEscape(null)).toBe('');
  });
});
