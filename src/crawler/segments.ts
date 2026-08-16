import type Database from 'better-sqlite3';
import type { Segment } from '../shared/types';

export interface CompiledSegment {
  name: string;
  regex: RegExp;
}

/** Compile segment patterns, skipping empties and invalid regexes. */
export function compileSegments(segments: Segment[]): CompiledSegment[] {
  const out: CompiledSegment[] = [];
  for (const s of segments ?? []) {
    if (!s.name.trim() || !s.pattern.trim()) continue;
    try {
      out.push({ name: s.name.trim(), regex: new RegExp(s.pattern) });
    } catch {
      // invalid pattern — skip rather than abort the crawl
    }
  }
  return out;
}

/** First matching segment wins; null when nothing matches. */
export function segmentForUrl(url: string, compiled: CompiledSegment[]): string | null {
  for (const s of compiled) {
    if (s.regex.test(url)) return s.name;
  }
  return null;
}

/** Stamp pages.segment for every fetched internal page (analysis phase). */
export function assignSegments(db: Database.Database, segments: Segment[]): void {
  const compiled = compileSegments(segments);
  const update = db.prepare('UPDATE pages SET segment = ? WHERE id = ?');
  const rows = db
    .prepare('SELECT id, url FROM pages WHERE is_internal = 1 AND fetched >= 1')
    .all() as { id: number; url: string }[];
  const tx = db.transaction(() => {
    for (const r of rows) update.run(compiled.length ? segmentForUrl(r.url, compiled) : null, r.id);
  });
  tx();
}
