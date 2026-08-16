import { basename } from 'path';
import { openProjectDb, metaGet, metaSet } from '../db/schema';
import { DEFAULT_CONFIG, type CrawlConfig, type ProjectInfo } from '../shared/types';
import type { DbReader } from './db-reader';

/** Holds the currently open project and its config. */
export class ProjectManager {
  private reader: DbReader;
  path: string | null = null;

  constructor(reader: DbReader) {
    this.reader = reader;
  }

  /** Create (or open) a project file, ensure schema, and point the reader at it. */
  open(path: string): ProjectInfo {
    // Short-lived write connection creates schema if needed.
    const db = openProjectDb(path);
    const configJson = metaGet(db, 'config');
    if (!configJson) metaSet(db, 'config', JSON.stringify(DEFAULT_CONFIG));
    db.close();

    this.path = path;
    this.reader.setPath(path);
    return this.info()!;
  }

  close(): void {
    this.path = null;
    this.reader.setPath(null);
  }

  info(): ProjectInfo | null {
    if (!this.path) return null;
    const db = openProjectDb(this.path);
    try {
      const configJson = metaGet(db, 'config');
      const lastCrawl = metaGet(db, 'last_crawl');
      const pageCount = (
        db.prepare('SELECT COUNT(*) AS n FROM pages WHERE fetched >= 1').get() as { n: number }
      ).n;
      const config: CrawlConfig = configJson
        ? { ...DEFAULT_CONFIG, ...(JSON.parse(configJson) as Partial<CrawlConfig>) }
        : { ...DEFAULT_CONFIG };
      return {
        path: this.path,
        name: basename(this.path).replace(/\.pulse$/i, ''),
        config,
        lastCrawl,
        pageCount,
      };
    } finally {
      db.close();
    }
  }

  getConfig(): CrawlConfig {
    return this.info()?.config ?? { ...DEFAULT_CONFIG };
  }

  setConfig(config: CrawlConfig): void {
    if (!this.path) throw new Error('No project open');
    const db = openProjectDb(this.path);
    try {
      metaSet(db, 'config', JSON.stringify(config));
    } finally {
      db.close();
    }
  }
}
