import * as cheerio from 'cheerio';
import { DOMParser, MIME_TYPE } from '@xmldom/xmldom';
import xpath from 'xpath';
import type Database from 'better-sqlite3';
import { gunzipSync } from 'zlib';
import type { CrawlConfig, Extractor, CustomSearch } from '../shared/types';

const MAX_MATCHES = 50;

function htmlOf(row: { raw_html: Buffer | null; rendered_html: Buffer | null }): string | null {
  const blob = row.rendered_html ?? row.raw_html;
  if (!blob) return null;
  try {
    return gunzipSync(blob).toString('utf8');
  } catch {
    return null;
  }
}

function runCssExtractor(html: string, ex: Extractor): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];
  $(ex.expression).each((_, el) => {
    if (out.length >= MAX_MATCHES) return false;
    const $el = $(el);
    let v: string | undefined;
    if (ex.extract === 'attr' && ex.attribute) v = $el.attr(ex.attribute);
    else if (ex.extract === 'html') v = $.html($el) ?? undefined;
    else v = $el.text().replace(/\s+/g, ' ').trim();
    if (v !== undefined && v !== '') out.push(v.slice(0, 2000));
    return undefined;
  });
  return out;
}

function runXpathExtractor(html: string, ex: Extractor): string[] {
  // Round-trip through cheerio's XML serializer so xmldom gets well-formed input.
  const $ = cheerio.load(html);
  const xml = $.xml();
  const doc = new DOMParser({ onError: () => undefined }).parseFromString(
    xml,
    MIME_TYPE.XML_TEXT
  );
  const out: string[] = [];
  const nodes = xpath.select(ex.expression, doc as never);
  const list = Array.isArray(nodes) ? nodes : [nodes];
  for (const node of list.slice(0, MAX_MATCHES)) {
    if (node == null) continue;
    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
      out.push(String(node).slice(0, 2000));
      continue;
    }
    const n = node as { textContent?: string | null; nodeValue?: string | null };
    const v =
      ex.extract === 'attr'
        ? (n.nodeValue ?? n.textContent ?? '')
        : (n.textContent ?? '');
    const clean = v.replace(/\s+/g, ' ').trim();
    if (clean) out.push(clean.slice(0, 2000));
  }
  return out;
}

function runRegexExtractor(html: string, ex: Extractor): string[] {
  const out: string[] = [];
  let re: RegExp;
  try {
    re = new RegExp(ex.expression, 'gi');
  } catch {
    return out;
  }
  for (const m of html.matchAll(re)) {
    out.push((m[1] ?? m[0]).slice(0, 2000));
    if (out.length >= MAX_MATCHES) break;
  }
  return out;
}

function countSearch(html: string, search: CustomSearch): number {
  if (search.isRegex) {
    try {
      const re = new RegExp(search.pattern, 'gi');
      let count = 0;
      for (const _ of html.matchAll(re)) count++;
      return count;
    } catch {
      return 0;
    }
  }
  if (!search.pattern) return 0;
  return html.split(search.pattern).length - 1;
}

/** Run configured extractors and searches over every stored internal HTML page. */
export function runExtractionAndSearch(
  db: Database.Database,
  config: CrawlConfig,
  onProgress?: (done: number, total: number) => void
): void {
  const hasExtractors = config.extractors.length > 0;
  const hasSearches = config.customSearches.length > 0;
  if (!hasExtractors && !hasSearches) return;

  db.prepare('DELETE FROM extractions').run();
  db.prepare('DELETE FROM search_hits').run();

  const rows = db
    .prepare(
      `SELECT id, raw_html, rendered_html FROM pages
       WHERE is_internal = 1 AND fetched = 1 AND status = 200
         AND (raw_html IS NOT NULL OR rendered_html IS NOT NULL)`
    )
    .all() as { id: number; raw_html: Buffer | null; rendered_html: Buffer | null }[];

  const insertExtraction = db.prepare(
    'INSERT INTO extractions (page_id, extractor_id, value) VALUES (?, ?, ?)'
  );
  const insertHit = db.prepare(
    'INSERT INTO search_hits (page_id, search_id, hits) VALUES (?, ?, ?)'
  );

  let done = 0;
  for (const row of rows) {
    const html = htmlOf(row);
    if (html) {
      for (const ex of config.extractors) {
        let values: string[] = [];
        try {
          if (ex.type === 'css') values = runCssExtractor(html, ex);
          else if (ex.type === 'xpath') values = runXpathExtractor(html, ex);
          else values = runRegexExtractor(html, ex);
        } catch {
          values = [];
        }
        const tx = db.transaction(() => {
          for (const v of values) insertExtraction.run(row.id, ex.id, v);
        });
        tx();
      }
      for (const s of config.customSearches) {
        insertHit.run(row.id, s.id, countSearch(html, s));
      }
    }
    done++;
    if (onProgress && done % 25 === 0) onProgress(done, rows.length);
  }
}
