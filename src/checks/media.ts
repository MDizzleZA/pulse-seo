import type Database from 'better-sqlite3';
import { makeAddIssue } from './helpers';
import type { CrawlConfig } from '../shared/types';

export function checkImages(db: Database.Database, config: CrawlConfig): void {
  const add = makeAddIssue(db);

  // Missing alt — one issue per page, with count.
  const missingAlt = db
    .prepare(
      `SELECT r.page_id AS pid, COUNT(*) AS n FROM image_refs r
       WHERE r.alt IS NULL OR r.alt = '' GROUP BY r.page_id`
    )
    .all() as { pid: number; n: number }[];
  for (const row of missingAlt) add('img-missing-alt', row.pid, `${row.n} images without alt`);

  const longAlt = db
    .prepare(
      `SELECT r.page_id AS pid, COUNT(*) AS n FROM image_refs r
       WHERE LENGTH(COALESCE(r.alt,'')) > 100 GROUP BY r.page_id`
    )
    .all() as { pid: number; n: number }[];
  for (const row of longAlt) add('img-alt-long', row.pid, `${row.n} images`);

  // Oversized images — per referencing page.
  const overWarn = db
    .prepare(
      `SELECT r.page_id AS pid, COUNT(DISTINCT i.id) AS n FROM image_refs r
       JOIN images i ON i.id = r.image_id
       WHERE i.bytes > ? AND i.bytes <= ? GROUP BY r.page_id`
    )
    .all(config.imgWarnBytes, config.imgCriticalBytes) as { pid: number; n: number }[];
  for (const row of overWarn) {
    add('img-over-warn', row.pid, `${row.n} images over ${Math.round(config.imgWarnBytes / 1024)}KB`);
  }

  const overCritical = db
    .prepare(
      `SELECT r.page_id AS pid, COUNT(DISTINCT i.id) AS n FROM image_refs r
       JOIN images i ON i.id = r.image_id WHERE i.bytes > ? GROUP BY r.page_id`
    )
    .all(config.imgCriticalBytes) as { pid: number; n: number }[];
  for (const row of overCritical) {
    add('img-over-critical', row.pid, `${row.n} images over ${Math.round(config.imgCriticalBytes / 1024)}KB`);
  }

  // Broken images.
  const broken = db
    .prepare(
      `SELECT r.page_id AS pid, GROUP_CONCAT(DISTINCT i.src) AS srcs, COUNT(DISTINCT i.id) AS n
       FROM image_refs r JOIN images i ON i.id = r.image_id
       WHERE i.status >= 400 GROUP BY r.page_id`
    )
    .all() as { pid: number; srcs: string; n: number }[];
  for (const row of broken) {
    add('img-broken', row.pid, `${row.n}: ${row.srcs.slice(0, 300)}`);
  }

  // Missing width/height attributes (CLS risk).
  const noDim = db
    .prepare(
      `SELECT r.page_id AS pid, COUNT(*) AS n FROM image_refs r
       WHERE r.has_dimensions = 0 GROUP BY r.page_id HAVING COUNT(*) > 0`
    )
    .all() as { pid: number; n: number }[];
  for (const row of noDim) add('img-no-dimensions', row.pid, `${row.n} images`);
}
