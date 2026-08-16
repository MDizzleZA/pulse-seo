import { dialog, type BrowserWindow } from 'electron';
import { createWriteStream } from 'fs';
import ExcelJS from 'exceljs';
import type { DbReader } from './db-reader';
import { tabById } from '../shared/tabs';
import type { QueryRequest } from '../shared/types';
import { buildWorkbook, csvEscape, exportableTabs, writeCsvFolder } from './exporter-core';

const PAGE_SIZE = 5000;


export async function exportView(
  win: BrowserWindow,
  reader: DbReader,
  req: Omit<QueryRequest, 'offset' | 'limit'>,
  format: 'csv' | 'xlsx',
  suggestedName: string
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const tab = tabById(req.tab);
  if (!tab) return { ok: false, error: 'Unknown tab' };

  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: `${suggestedName}.${format}`,
    filters:
      format === 'csv'
        ? [{ name: 'CSV', extensions: ['csv'] }]
        : [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
  });
  if (canceled || !filePath) return { ok: false };

  const cols = tab.columns;

  try {
    if (format === 'csv') {
      const stream = createWriteStream(filePath, { encoding: 'utf8' });
      stream.write('﻿'); // BOM so Excel opens UTF-8 correctly
      stream.write(cols.map((c) => csvEscape(c.label)).join(',') + '\r\n');
      let offset = 0;
      for (;;) {
        const { rows } = reader.query({ ...req, offset, limit: PAGE_SIZE });
        for (const row of rows) {
          stream.write(cols.map((c) => csvEscape(row[c.key])).join(',') + '\r\n');
        }
        if (rows.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      await new Promise<void>((resolve, reject) => {
        stream.end(() => resolve());
        stream.on('error', reject);
      });
    } else {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(tab.label.slice(0, 31));
      ws.columns = cols.map((c) => ({
        header: c.label,
        key: c.key,
        width: Math.min(80, Math.max(12, (c.width ?? 120) / 8)),
      }));
      ws.getRow(1).font = { bold: true };
      let offset = 0;
      for (;;) {
        const { rows } = reader.query({ ...req, offset, limit: PAGE_SIZE });
        for (const row of rows) {
          ws.addRow(cols.map((c) => row[c.key] ?? null));
        }
        if (rows.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      await wb.xlsx.writeFile(filePath);
    }
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function exportAll(
  win: BrowserWindow,
  reader: DbReader,
  format: 'csv' | 'xlsx',
  suggestedName: string
): Promise<{ ok: boolean; path?: string; sheets?: number; error?: string }> {
  if (exportableTabs(reader).length === 0) {
    return { ok: false, error: 'Nothing to export — run a crawl first' };
  }

  try {
    if (format === 'xlsx') {
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'Bulk export — one workbook, a sheet per view',
        defaultPath: `${suggestedName}-full-export.xlsx`,
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
      });
      if (canceled || !filePath) return { ok: false };
      const { wb, sheets } = buildWorkbook(reader);
      await wb.xlsx.writeFile(filePath);
      return { ok: true, path: filePath, sheets };
    }

    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose a folder for the CSV files (one per view)',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || filePaths.length === 0) return { ok: false };
    const files = await writeCsvFolder(reader, filePaths[0]);
    return { ok: true, path: filePaths[0], sheets: files };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
