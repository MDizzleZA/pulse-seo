// Pulse SEO MCP server: exposes a .pulse crawl database to MCP clients
// (Claude Code, Claude Desktop) over stdio, read-only.
//
// Usage:  node out/main/mcp-server.js [path\to\project.pulse]
// Register: claude mcp add pulse -- node path/to/pulse-seo/out/main/mcp-server.js "path/to/crawl.pulse"
//
// The path argument is optional — clients can call pulse_open_project instead.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { DbReader } from '../main/db-reader';
import { buildReport } from '../main/report';
import { buildRedirectEntries, REDIRECT_FORMATS, type RedirectFormat } from '../main/redirect-map';
import { openProjectDb } from '../db/schema';
import { TABS } from '../shared/tabs';
import { CHECKS } from '../checks/registry';

const reader = new DbReader();
let projectPath: string | null = null;

function openProject(path: string): string {
  if (!existsSync(path)) throw new Error(`No such file: ${path}`);
  // Brief write connection first so schema migrations run on older .pulse files
  // (the same thing the app's ProjectManager.open does).
  openProjectDb(path).close();
  reader.setPath(path);
  projectPath = path;
  return path;
}

function requireOpen(): void {
  if (!projectPath) {
    throw new Error(
      'No project open. Call pulse_open_project with the path to a .pulse file first.'
    );
  }
}

function jsonResult(data: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] };
}

const server = new McpServer({ name: 'pulse-seo', version: '0.1.0' });

server.registerTool(
  'pulse_open_project',
  {
    description: 'Open a Pulse SEO crawl project (.pulse file) for querying.',
    inputSchema: { path: z.string().describe('Absolute path to the .pulse file') },
  },
  async ({ path }) => jsonResult({ opened: openProject(path) })
);

server.registerTool(
  'pulse_overview',
  {
    description:
      'Crawl overview: page counts, per-category health scores (0-100), and every SEO issue found with severity and count.',
    inputSchema: {},
  },
  async () => {
    requireOpen();
    const o = reader.overview();
    return jsonResult({ project: projectPath, crawl: o.crawlInfo, health: o.health, issues: o.issues });
  }
);

server.registerTool(
  'pulse_list_tabs',
  {
    description:
      'List the queryable views (tabs), their filters, and their columns. Use with pulse_query.',
    inputSchema: {},
  },
  async () =>
    jsonResult(
      TABS.map((t) => ({
        tab: t.id,
        label: t.label,
        filters: t.filters.map((f) => f.id),
        columns: t.columns.map((c) => c.key),
      }))
    )
);

server.registerTool(
  'pulse_query',
  {
    description:
      'Query a crawl view. `tab` is a tab id from pulse_list_tabs (e.g. "internal", "response_codes", "titles"). ' +
      'Optional `filter` is one of that tab\'s filter ids, or "issue:<check_id>" on page-based tabs to select pages with that issue. ' +
      '`search` substring-matches the URL.',
    inputSchema: {
      tab: z.string(),
      filter: z.string().optional(),
      search: z.string().optional(),
      sortCol: z.string().optional(),
      sortDir: z.enum(['asc', 'desc']).optional(),
      limit: z.number().int().min(1).max(500).default(50),
      offset: z.number().int().min(0).default(0),
    },
  },
  async ({ tab, filter, search, sortCol, sortDir, limit, offset }) => {
    requireOpen();
    if (!TABS.some((t) => t.id === tab)) {
      throw new Error(`Unknown tab "${tab}". Valid: ${TABS.map((t) => t.id).join(', ')}`);
    }
    const res = reader.query({
      tab,
      filterId: filter ?? null,
      search: search ?? null,
      sortCol: sortCol ?? null,
      sortDir: sortDir ?? null,
      limit,
      offset,
    });
    return jsonResult(res);
  }
);

server.registerTool(
  'pulse_page_detail',
  {
    description:
      'Everything known about one crawled URL: metadata, indexability, inlinks/outlinks, images, hreflang, structured data, duplicates, issues, and any GSC/GA4/PSI data.',
    inputSchema: { url: z.string() },
  },
  async ({ url }) => {
    requireOpen();
    const d = reader.detail(url);
    if (!d.page) throw new Error(`URL not found in this crawl: ${url}`);
    return jsonResult(d);
  }
);

server.registerTool(
  'pulse_list_checks',
  {
    description: 'List all SEO checks the auditor runs (id, name, category, severity).',
    inputSchema: {},
  },
  async () => jsonResult(CHECKS)
);

server.registerTool(
  'pulse_sql',
  {
    description:
      'Run a read-only SQL SELECT against the crawl database. Tables: pages, links, images, image_refs, ' +
      'hreflang, structured_data, issues, extractions, search_hits, sitemap_urls, api_gsc, api_ga4, api_psi, ' +
      'backlinks, compare_results, meta. The connection is read-only; writes fail.',
    inputSchema: {
      query: z.string().describe('A single SELECT statement'),
      limit: z.number().int().min(1).max(1000).default(200),
    },
  },
  async ({ query, limit }) => {
    requireOpen();
    if (!/^\s*(select|with)\b/i.test(query)) {
      throw new Error('Only SELECT/WITH queries are allowed.');
    }
    // Separate readonly handle so pulse_sql can never hold reader state.
    const db = new Database(projectPath!, { readonly: true, fileMustExist: true });
    try {
      const rows = db.prepare(query).all().slice(0, limit) as Record<string, unknown>[];
      // Blobs (gzipped HTML) are not useful over MCP — replace with a marker.
      for (const row of rows) {
        for (const k of Object.keys(row)) {
          if (Buffer.isBuffer(row[k])) row[k] = `<blob ${(row[k] as Buffer).length} bytes>`;
        }
      }
      return jsonResult({ rows, truncatedTo: rows.length === limit ? limit : undefined });
    } finally {
      db.close();
    }
  }
);

server.registerTool(
  'pulse_report',
  {
    description:
      'Generate a branded DOCX crawl report (summary, health scores, segments, issues, worst pages) and write it to out_path.',
    inputSchema: {
      out_path: z.string().describe('Absolute path for the .docx file to create'),
      agency_name: z.string().optional().describe('Byline; defaults to "Marcos Diez"'),
    },
  },
  async ({ out_path, agency_name }) => {
    requireOpen();
    const db = new Database(projectPath!, { readonly: true, fileMustExist: true });
    try {
      const buf = await buildReport(db, agency_name);
      await writeFile(out_path, buf);
      return jsonResult({ written: out_path, bytes: buf.length });
    } finally {
      db.close();
    }
  }
);

server.registerTool(
  'pulse_redirect_map',
  {
    description:
      'Generate a 301 redirect map from Compare results (old URLs now missing/broken, with ' +
      'suggested targets by slug/title similarity). Returns the file content as text. ' +
      'Requires a prior Compare run in this project.',
    inputSchema: {
      format: z.enum(['htaccess', 'nginx', 'wp-csv']).default('htaccess'),
    },
  },
  async ({ format }) => {
    requireOpen();
    const db = new Database(projectPath!, { readonly: true, fileMustExist: true });
    try {
      const entries = buildRedirectEntries(db);
      if (entries.length === 0) {
        throw new Error('No missing/broken URLs in compare_results — run a Compare first.');
      }
      const text = REDIRECT_FORMATS[format as RedirectFormat].render(entries);
      return { content: [{ type: 'text' as const, text }] };
    } finally {
      db.close();
    }
  }
);

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg) openProject(arg);
  await server.connect(new StdioServerTransport());
  // stdio transport: never write to stdout outside the protocol.
  console.error(
    `pulse-seo MCP server ready${projectPath ? ` (project: ${projectPath})` : ' (no project open)'}`
  );
}

main().catch((err) => {
  console.error('MCP server failed:', err);
  process.exit(1);
});
