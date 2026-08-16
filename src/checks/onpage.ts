import type Database from 'better-sqlite3';
import { makeAddIssue, INTERNAL_HTML_200 } from './helpers';
import type { CrawlConfig } from '../shared/types';

export function checkOnPage(db: Database.Database, config: CrawlConfig): void {
  const add = makeAddIssue(db);

  // ---- Titles -------------------------------------------------------------
  for (const p of db
    .prepare(
      `SELECT id FROM pages WHERE ${INTERNAL_HTML_200} AND (title IS NULL OR title = '')`
    )
    .all() as { id: number }[]) {
    add('title-missing', p.id);
  }
  for (const p of db
    .prepare(
      `SELECT id, title FROM pages WHERE ${INTERNAL_HTML_200}
       AND title IS NOT NULL AND title <> '' AND title IN (
         SELECT title FROM pages WHERE ${INTERNAL_HTML_200} AND title IS NOT NULL AND title <> ''
         GROUP BY title HAVING COUNT(*) > 1)`
    )
    .all() as { id: number; title: string }[]) {
    add('title-duplicate', p.id, p.title);
  }
  for (const p of db
    .prepare(
      `SELECT id, LENGTH(title) AS n FROM pages WHERE ${INTERNAL_HTML_200} AND LENGTH(COALESCE(title,'')) > ?`
    )
    .all(config.maxTitleChars) as { id: number; n: number }[]) {
    add('title-over-chars', p.id, `${p.n} chars`);
  }
  for (const p of db
    .prepare(
      `SELECT id, LENGTH(title) AS n FROM pages WHERE ${INTERNAL_HTML_200}
       AND title IS NOT NULL AND title <> '' AND LENGTH(title) < ?`
    )
    .all(config.minTitleChars) as { id: number; n: number }[]) {
    add('title-under-chars', p.id, `${p.n} chars`);
  }
  for (const p of db
    .prepare(`SELECT id, title_px FROM pages WHERE ${INTERNAL_HTML_200} AND title_px > ?`)
    .all(config.maxTitlePx) as { id: number; title_px: number }[]) {
    add('title-over-px', p.id, `${p.title_px}px`);
  }
  for (const p of db
    .prepare(`SELECT id, title_count FROM pages WHERE ${INTERNAL_HTML_200} AND title_count > 1`)
    .all() as { id: number; title_count: number }[]) {
    add('title-multiple', p.id, `${p.title_count} title tags`);
  }

  // ---- Meta descriptions ---------------------------------------------------
  for (const p of db
    .prepare(
      `SELECT id FROM pages WHERE ${INTERNAL_HTML_200}
       AND (meta_description IS NULL OR meta_description = '') AND indexable = 1`
    )
    .all() as { id: number }[]) {
    add('desc-missing', p.id);
  }
  for (const p of db
    .prepare(
      `SELECT id FROM pages WHERE ${INTERNAL_HTML_200}
       AND meta_description IS NOT NULL AND meta_description <> '' AND meta_description IN (
         SELECT meta_description FROM pages WHERE ${INTERNAL_HTML_200}
           AND meta_description IS NOT NULL AND meta_description <> ''
         GROUP BY meta_description HAVING COUNT(*) > 1)`
    )
    .all() as { id: number }[]) {
    add('desc-duplicate', p.id);
  }
  for (const p of db
    .prepare(
      `SELECT id, LENGTH(meta_description) AS n FROM pages WHERE ${INTERNAL_HTML_200}
       AND LENGTH(COALESCE(meta_description,'')) > ?`
    )
    .all(config.maxDescChars) as { id: number; n: number }[]) {
    add('desc-over-chars', p.id, `${p.n} chars`);
  }
  for (const p of db
    .prepare(
      `SELECT id, LENGTH(meta_description) AS n FROM pages WHERE ${INTERNAL_HTML_200}
       AND meta_description IS NOT NULL AND meta_description <> '' AND LENGTH(meta_description) < ?`
    )
    .all(config.minDescChars) as { id: number; n: number }[]) {
    add('desc-under-chars', p.id, `${p.n} chars`);
  }
  for (const p of db
    .prepare(
      `SELECT id, meta_description_px AS px FROM pages WHERE ${INTERNAL_HTML_200}
       AND meta_description_px > ?`
    )
    .all(config.maxDescPx) as { id: number; px: number }[]) {
    add('desc-over-px', p.id, `${p.px}px`);
  }
  for (const p of db
    .prepare(
      `SELECT id, meta_description_count AS n FROM pages WHERE ${INTERNAL_HTML_200}
       AND meta_description_count > 1`
    )
    .all() as { id: number; n: number }[]) {
    add('desc-multiple', p.id, `${p.n} meta descriptions`);
  }

  // ---- Headings -------------------------------------------------------------
  for (const p of db
    .prepare(
      `SELECT id FROM pages WHERE ${INTERNAL_HTML_200}
       AND (h1 IS NULL OR json_array_length(h1) = 0) AND indexable = 1`
    )
    .all() as { id: number }[]) {
    add('h1-missing', p.id);
  }
  for (const p of db
    .prepare(
      `SELECT id, json_array_length(h1) AS n FROM pages WHERE ${INTERNAL_HTML_200}
       AND json_array_length(COALESCE(h1,'[]')) > 1`
    )
    .all() as { id: number; n: number }[]) {
    add('h1-multiple', p.id, `${p.n} H1 tags`);
  }
  for (const p of db
    .prepare(
      `SELECT id, json_extract(h1,'$[0]') AS first FROM pages WHERE ${INTERNAL_HTML_200}
       AND json_extract(h1,'$[0]') IS NOT NULL AND json_extract(h1,'$[0]') <> ''
       AND json_extract(h1,'$[0]') IN (
         SELECT json_extract(h1,'$[0]') FROM pages
         WHERE ${INTERNAL_HTML_200} AND h1 IS NOT NULL AND json_array_length(h1) > 0
         GROUP BY json_extract(h1,'$[0]') HAVING COUNT(*) > 1)`
    )
    .all() as { id: number; first: string }[]) {
    add('h1-duplicate', p.id, p.first);
  }
  for (const p of db
    .prepare(
      `SELECT id FROM pages WHERE ${INTERNAL_HTML_200}
       AND (h2 IS NULL OR json_array_length(h2) = 0) AND word_count > 300`
    )
    .all() as { id: number }[]) {
    add('h2-missing', p.id);
  }
}
