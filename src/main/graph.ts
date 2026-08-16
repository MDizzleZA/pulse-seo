import type Database from 'better-sqlite3';
import type { GraphData, GraphNode } from '../shared/types';

const DEFAULT_NODE_CAP = 1500;
const EDGE_CAP = 25000;

/** Short display path (pathname + search) for a URL, falling back to the raw URL. */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname + u.search;
    return p === '' ? '/' : p;
  } catch {
    return url;
  }
}

/**
 * Build an internal-link graph for visualization. Nodes are the crawled internal
 * pages, prioritised by shallow depth then inbound links so the most structurally
 * important pages survive the cap. Edges are resolved internal links between two
 * included nodes. `sourceUrl` (first discoverer) lets the renderer build a crawl tree.
 */
export function buildGraph(db: Database.Database, nodeCap = DEFAULT_NODE_CAP): GraphData {
  const rows = db
    .prepare(
      `SELECT p.id AS id, p.url AS url, p.depth AS depth, p.status AS status,
        p.indexable AS indexable, p.crawl_source AS sourceUrl,
        (SELECT COUNT(*) FROM links l WHERE l.dst_id = p.id AND l.is_internal = 1) AS inlinks,
        (SELECT COUNT(*) FROM links l WHERE l.src_id = p.id AND l.is_internal = 1) AS outlinks
       FROM pages p
       WHERE p.is_internal = 1 AND p.fetched = 1
       ORDER BY (p.depth IS NULL) ASC, p.depth ASC, inlinks DESC
       LIMIT ?`
    )
    .all(nodeCap + 1) as Omit<GraphNode, 'path'>[];

  const truncatedNodes = rows.length > nodeCap;
  const nodeRows = rows.slice(0, nodeCap);
  const nodes: GraphNode[] = nodeRows.map((n) => ({ ...n, path: pathOf(n.url) }));

  const idSet = new Set(nodes.map((n) => n.id));

  const rawEdges = db
    .prepare(
      `SELECT DISTINCT src_id AS source, dst_id AS target FROM links
       WHERE is_internal = 1 AND dst_id IS NOT NULL AND src_id <> dst_id`
    )
    .all() as { source: number; target: number }[];

  const edges: { source: number; target: number }[] = [];
  let truncatedEdges = false;
  for (const e of rawEdges) {
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
    if (edges.length >= EDGE_CAP) {
      truncatedEdges = true;
      break;
    }
    edges.push(e);
  }

  return { nodes, edges, truncated: truncatedNodes || truncatedEdges };
}
