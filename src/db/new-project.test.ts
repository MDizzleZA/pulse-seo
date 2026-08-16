import { describe, it, expect } from 'vitest';
import initSqlJs from 'sql.js';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema-constants';
import { openProjectDb } from './schema';
import { DEFAULT_CONFIG } from '../shared/types';

// Mirrors pwa/src/db.ts createEmptyProject(): the browser builds a blank .pulse
// with sql.js; this proves that file opens in the desktop engine (better-sqlite3).
async function emptyProjectBytes(): Promise<Uint8Array> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  for (const stmt of SCHEMA_STATEMENTS) db.run(stmt);
  const ins = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  ins.run(['schema_version', String(SCHEMA_VERSION)]);
  ins.run(['config', JSON.stringify(DEFAULT_CONFIG)]);
  ins.free();
  const bytes = db.export();
  db.close();
  return bytes;
}

describe('new project round-trip (sql.js -> better-sqlite3)', () => {
  it('creates a blank .pulse the desktop app can open', async () => {
    const bytes = await emptyProjectBytes();
    expect(Buffer.from(bytes.slice(0, 16)).toString('latin1')).toBe('SQLite format 3\0');

    const dir = mkdtempSync(join(tmpdir(), 'pulse-new-'));
    const path = join(dir, 'browser-made.pulse');
    writeFileSync(path, bytes);

    // openProjectDb runs the desktop schema/migrations idempotently — must not throw.
    const upgraded = openProjectDb(path);
    upgraded.close();

    const db = new Database(path, { readonly: true });
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['pages', 'links', 'issues', 'meta']));
    expect((db.prepare('SELECT COUNT(*) n FROM pages').get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as { value: string }).value)
      .toBe(String(SCHEMA_VERSION));
    const cfg = JSON.parse(
      (db.prepare("SELECT value FROM meta WHERE key='config'").get() as { value: string }).value
    );
    expect(Array.isArray(cfg.segments)).toBe(true);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
