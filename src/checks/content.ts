import type Database from 'better-sqlite3';
import { makeAddIssue, INTERNAL_HTML_200 } from './helpers';
import { hammingDistance } from '../crawler/simhash';
import type { CrawlConfig } from '../shared/types';

export function checkContent(db: Database.Database, config: CrawlConfig): void {
  const add = makeAddIssue(db);

  for (const p of db
    .prepare(
      `SELECT id, word_count FROM pages WHERE ${INTERNAL_HTML_200}
       AND indexable = 1 AND word_count < ?`
    )
    .all(config.wordCountMin) as { id: number; word_count: number }[]) {
    add('content-thin', p.id, `${p.word_count} words`);
  }

  for (const p of db
    .prepare(
      `SELECT id, content_hash FROM pages WHERE ${INTERNAL_HTML_200}
       AND content_hash IS NOT NULL AND word_count > 30 AND content_hash IN (
         SELECT content_hash FROM pages WHERE ${INTERNAL_HTML_200} AND content_hash IS NOT NULL
           AND word_count > 30
         GROUP BY content_hash HAVING COUNT(*) > 1)`
    )
    .all() as { id: number; content_hash: string }[]) {
    add('content-exact-duplicate', p.id);
  }

  for (const p of db
    .prepare(
      `SELECT id, text_ratio FROM pages WHERE ${INTERNAL_HTML_200}
       AND indexable = 1 AND text_ratio < 0.08 AND word_count > 0`
    )
    .all() as { id: number; text_ratio: number }[]) {
    add('content-low-text-ratio', p.id, `${Math.round(p.text_ratio * 1000) / 10}% text`);
  }

  // Near-duplicates via simhash with band-bucketing to prune comparisons.
  const maxHamming = Math.max(1, Math.floor((1 - config.nearDupThreshold) * 64));
  const rows = db
    .prepare(
      `SELECT id, url, simhash, content_hash FROM pages WHERE ${INTERNAL_HTML_200}
       AND simhash IS NOT NULL AND word_count > 50 AND indexable = 1`
    )
    .all() as { id: number; url: string; simhash: string; content_hash: string }[];

  if (rows.length > 1 && rows.length <= 30000) {
    const buckets = new Map<string, number[]>();
    const parsed = rows.map((r) => ({ ...r, big: BigInt('0x' + r.simhash) }));
    // 4 bands of 16 bits: near-duplicates within hamming<=3 share at least one band.
    // For larger thresholds this is heuristic but catches the vast majority.
    for (let i = 0; i < parsed.length; i++) {
      const h = parsed[i].big;
      for (let band = 0; band < 4; band++) {
        const key = band + ':' + ((h >> BigInt(band * 16)) & 0xffffn).toString(16);
        const arr = buckets.get(key);
        if (arr) arr.push(i);
        else buckets.set(key, [i]);
      }
    }
    const flagged = new Map<number, string>();
    const comparedPairs = new Set<number>();
    let comparisons = 0;
    for (const arr of buckets.values()) {
      if (arr.length < 2 || arr.length > 2000) continue;
      for (let a = 0; a < arr.length && comparisons < 5_000_000; a++) {
        for (let b = a + 1; b < arr.length; b++) {
          const i = arr[a];
          const j = arr[b];
          const pairKey = i * 100000 + j;
          if (comparedPairs.has(pairKey)) continue;
          comparedPairs.add(pairKey);
          comparisons++;
          const pi = parsed[i];
          const pj = parsed[j];
          if (pi.content_hash === pj.content_hash) continue; // exact dup handled above
          const dist = hammingDistance(pi.simhash, pj.simhash);
          if (dist <= maxHamming) {
            const sim = Math.round((1 - dist / 64) * 100);
            if (!flagged.has(pi.id)) flagged.set(pi.id, `${sim}% similar to ${pj.url}`);
            if (!flagged.has(pj.id)) flagged.set(pj.id, `${sim}% similar to ${pi.url}`);
          }
        }
      }
    }
    for (const [pageId, detail] of flagged) add('content-near-duplicate', pageId, detail);
  }
}
