// SQLite schema for a Pulse SEO project (.pulse file).
import Database from 'better-sqlite3';

import { SCHEMA_VERSION, SCHEMA_STATEMENTS, PAGES_MIGRATIONS } from './schema-constants';
export { SCHEMA_VERSION, SCHEMA_STATEMENTS } from './schema-constants';


export function metaGet(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : null;
}

export function metaSet(db: Database.Database, key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

export function openProjectDb(path: string, readonly = false): Database.Database {
  const db = new Database(path, readonly ? { readonly: true } : {});
  if (!readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    for (const stmt of SCHEMA_STATEMENTS) db.prepare(stmt).run();
    const existing = new Set(
      (db.pragma('table_info(pages)') as { name: string }[]).map((c) => c.name)
    );
    for (const [column, ddl] of PAGES_MIGRATIONS) {
      if (!existing.has(column)) db.prepare(ddl).run();
    }
    metaSet(db, 'schema_version', String(SCHEMA_VERSION));
  }
  return db;
}
