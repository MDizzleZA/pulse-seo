import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_STATEMENTS } from '../db/schema';
import { buildGraph } from './graph';

function fresh(): Database.Database {
  const d = new Database(':memory:');
  for (const s of SCHEMA_STATEMENTS) d.prepare(s).run();
  return d;
}

function addPage(
  d: Database.Database,
  url: string,
  depth: number | null,
  opts: { internal?: number; fetched?: number; source?: string | null } = {}
): number {
  return Number(
    d
      .prepare(
        `INSERT INTO pages (url, is_internal, fetched, status, content_type, depth, crawl_source)
         VALUES (?, ?, ?, 200, 'text/html', ?, ?)`
      )
      .run(url, opts.internal ?? 1, opts.fetched ?? 1, depth, opts.source ?? null).lastInsertRowid
  );
}

function addLink(d: Database.Database, src: number, dst: number, dstUrl: string): void {
  d.prepare(
    `INSERT INTO links (src_id, dst_url, dst_id, anchor, rel, follow, link_type, is_internal)
     VALUES (?, ?, ?, '', '', 1, 'ahref', 1)`
  ).run(src, dstUrl, dst);
}

describe('buildGraph', () => {
  it('returns internal fetched pages as nodes and resolved internal links as edges', () => {
    const d = fresh();
    const home = addPage(d, 'https://ex.com/', 0);
    const a = addPage(d, 'https://ex.com/a', 1, { source: 'https://ex.com/' });
    const b = addPage(d, 'https://ex.com/b', 1);
    const c = addPage(d, 'https://ex.com/c', 2);
    addPage(d, 'https://other.com/x', 0, { internal: 0 }); // external — excluded
    addPage(d, 'https://ex.com/pending', null, { fetched: 0 }); // not fetched — excluded

    addLink(d, home, a, 'https://ex.com/a');
    addLink(d, home, b, 'https://ex.com/b');
    addLink(d, a, c, 'https://ex.com/c');
    addLink(d, b, c, 'https://ex.com/c');
    addLink(d, c, home, 'https://ex.com/');

    const g = buildGraph(d);
    expect(g.nodes).toHaveLength(4);
    expect(g.edges).toHaveLength(5);
    expect(g.truncated).toBe(false);

    // Inlink counts feed node sizing.
    const cNode = g.nodes.find((n) => n.url === 'https://ex.com/c')!;
    expect(cNode.inlinks).toBe(2);
    // First-discoverer is preserved for the crawl tree.
    expect(g.nodes.find((n) => n.url === 'https://ex.com/a')!.sourceUrl).toBe('https://ex.com/');
    d.close();
  });

  it('caps nodes by depth then inlinks, flags truncation, and drops dangling edges', () => {
    const d = fresh();
    const home = addPage(d, 'https://ex.com/', 0);
    const a = addPage(d, 'https://ex.com/a', 1);
    const b = addPage(d, 'https://ex.com/b', 2);
    addLink(d, home, a, 'https://ex.com/a');
    addLink(d, a, b, 'https://ex.com/b');

    const g = buildGraph(d, 2);
    expect(g.nodes).toHaveLength(2);
    expect(g.truncated).toBe(true);
    // The shallowest two pages survive; the a->b edge to the dropped node is gone.
    const urls = g.nodes.map((n) => n.url).sort();
    expect(urls).toEqual(['https://ex.com/', 'https://ex.com/a']);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ source: home, target: a });
    d.close();
  });
});
