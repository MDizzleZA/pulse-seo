// Branded DOCX crawl report. Pure Node (no Electron imports) so it is usable
// from the app (IPC), the MCP server, and tests alike.
import type Database from 'better-sqlite3';
import {
  AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, ShadingType,
  Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { CHECK_MAP, SEVERITY_WEIGHT, type Severity } from '../checks/registry';
import { metaGet } from '../db/schema';

// Pulse SEO brand: Montserrat, monochrome greys.
const FONT = 'Montserrat';
const GREY_DARK = '333333';
const GREY_MID = '555555';
const GREY_LIGHT = 'EEEEEE';

export interface ReportData {
  site: string;
  crawlDate: string;
  pages: number;
  internal: number;
  external: number;
  indexable: number;
  statusBuckets: { label: string; count: number }[];
  avgResponseMs: number | null;
  health: { category: string; score: number }[];
  issues: { name: string; category: string; severity: Severity; count: number }[];
  worstPages: { url: string; weighted: number; issueCount: number }[];
  segments: { segment: string; pages: number; indexable: number }[];
}

export function collectReportData(db: Database.Database): ReportData {
  const one = <T>(sql: string): T => db.prepare(sql).get() as T;

  let site = metaGet(db, 'robots_origin') ?? '';
  if (!site) {
    try {
      const cfg = JSON.parse(metaGet(db, 'config') ?? '{}') as { startUrls?: string[] };
      site = cfg.startUrls?.[0] ?? '';
    } catch {
      site = '';
    }
  }
  const crawlDate = (metaGet(db, 'last_crawl') ?? new Date().toISOString()).slice(0, 10);

  const counts = one<{ pages: number; internal: number; external: number; indexable: number }>(
    `SELECT COUNT(*) AS pages,
      SUM(CASE WHEN is_internal = 1 THEN 1 ELSE 0 END) AS internal,
      SUM(CASE WHEN is_internal = 0 THEN 1 ELSE 0 END) AS external,
      SUM(CASE WHEN indexable = 1 THEN 1 ELSE 0 END) AS indexable
     FROM pages WHERE fetched >= 1`
  );

  const buckets: { label: string; count: number }[] = [];
  for (const [label, where] of [
    ['2xx success', 'status BETWEEN 200 AND 299'],
    ['3xx redirect', 'status BETWEEN 300 AND 399'],
    ['4xx client error', 'status BETWEEN 400 AND 499'],
    ['5xx server error', 'status >= 500'],
    ['No response', 'fetched = 2'],
    ['Blocked by robots.txt', 'fetched = 3'],
  ] as const) {
    const n = one<{ n: number }>(`SELECT COUNT(*) AS n FROM pages WHERE fetched >= 1 AND ${where}`).n;
    if (n > 0) buckets.push({ label, count: n });
  }

  const avg = one<{ avg: number | null }>(
    'SELECT AVG(response_ms) AS avg FROM pages WHERE is_internal = 1 AND fetched = 1'
  ).avg;

  const issueRows = db
    .prepare('SELECT check_id, COUNT(*) AS n FROM issues GROUP BY check_id')
    .all() as { check_id: string; n: number }[];
  const issues = issueRows
    .map((r) => ({
      name: CHECK_MAP[r.check_id]?.name ?? r.check_id,
      category: CHECK_MAP[r.check_id]?.category ?? 'Other',
      severity: (CHECK_MAP[r.check_id]?.severity ?? 'low') as Severity,
      count: r.n,
    }))
    .sort(
      (a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] || b.count - a.count
    );

  const htmlPages = Math.max(
    1,
    one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM pages WHERE is_internal = 1 AND fetched = 1
       AND status = 200 AND content_type LIKE '%html%'`
    ).n
  );
  const byCategory = new Map<string, number>();
  for (const i of issues) {
    byCategory.set(i.category, (byCategory.get(i.category) ?? 0) + i.count * SEVERITY_WEIGHT[i.severity]);
  }
  const health = [...byCategory.entries()]
    .map(([category, weighted]) => ({
      category,
      score: Math.max(0, Math.round(100 - (weighted / htmlPages) * 100)),
    }))
    .sort((a, b) => a.score - b.score);

  const worstRows = db
    .prepare(
      `SELECT p.url, COUNT(*) AS issueCount, GROUP_CONCAT(i.check_id) AS checkIds
       FROM issues i JOIN pages p ON p.id = i.page_id
       GROUP BY i.page_id ORDER BY issueCount DESC LIMIT 30`
    )
    .all() as { url: string; issueCount: number; checkIds: string }[];
  const worstPages = worstRows
    .map((r) => ({
      url: r.url,
      issueCount: r.issueCount,
      weighted: r.checkIds
        .split(',')
        .reduce((s, id) => s + SEVERITY_WEIGHT[(CHECK_MAP[id]?.severity ?? 'low') as Severity], 0),
    }))
    .sort((a, b) => b.weighted - a.weighted)
    .slice(0, 10);

  const segments = db
    .prepare(
      `SELECT segment, COUNT(*) AS pages, SUM(CASE WHEN indexable = 1 THEN 1 ELSE 0 END) AS indexable
       FROM pages WHERE is_internal = 1 AND fetched >= 1 AND segment IS NOT NULL
       GROUP BY segment ORDER BY pages DESC`
    )
    .all() as { segment: string; pages: number; indexable: number }[];

  return {
    site,
    crawlDate,
    pages: counts.pages ?? 0,
    internal: counts.internal ?? 0,
    external: counts.external ?? 0,
    indexable: counts.indexable ?? 0,
    statusBuckets: buckets,
    avgResponseMs: avg != null ? Math.round(avg) : null,
    health,
    issues,
    worstPages,
    segments,
  };
}

// ---------------------------------------------------------------------------
// DOCX rendering
// ---------------------------------------------------------------------------
function text(t: string, opts: { bold?: boolean; size?: number; color?: string } = {}): TextRun {
  return new TextRun({
    text: t, font: FONT, bold: opts.bold ?? false,
    size: (opts.size ?? 10) * 2, color: opts.color ?? GREY_DARK,
  });
}

function para(t: string, opts: { bold?: boolean; size?: number; color?: string; after?: number } = {}): Paragraph {
  return new Paragraph({ children: [text(t, opts)], spacing: { after: opts.after ?? 80 } });
}

function heading(t: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1): Paragraph {
  return new Paragraph({
    heading: level,
    spacing: { before: 280, after: 120 },
    children: [new TextRun({ text: t, font: FONT, bold: true, color: GREY_DARK })],
  });
}

const NO_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 2, color: GREY_LIGHT },
  bottom: { style: BorderStyle.SINGLE, size: 2, color: GREY_LIGHT },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

function cell(t: string, opts: { header?: boolean; width?: number } = {}): TableCell {
  return new TableCell({
    borders: NO_BORDER,
    shading: opts.header
      ? { type: ShadingType.CLEAR, fill: GREY_LIGHT }
      : undefined,
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [
      new Paragraph({
        children: [text(t, { bold: opts.header ?? false, size: 9 })],
      }),
    ],
  });
}

function table(header: string[], rows: string[][], widths?: number[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: header.map((h, i) => cell(h, { header: true, width: widths?.[i] })),
        tableHeader: true,
      }),
      ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, { width: widths?.[i] })) })),
    ],
  });
}

export async function renderReportDocx(data: ReportData, agencyName = 'Marcos Diez'): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];

  children.push(
    new Paragraph({
      spacing: { before: 1200, after: 60 },
      children: [text('SEO Crawl Report', { bold: true, size: 26 })],
    }),
    para(data.site || '(site unknown)', { size: 14, color: GREY_MID }),
    para(`Crawl date: ${data.crawlDate}`, { size: 10, color: GREY_MID }),
    para(`Prepared by ${agencyName}`, { size: 10, color: GREY_MID, after: 400 })
  );

  children.push(heading('Crawl summary'));
  children.push(
    table(
      ['Metric', 'Value'],
      [
        ['URLs crawled', String(data.pages)],
        ['Internal pages', String(data.internal)],
        ['External URLs checked', String(data.external)],
        ['Indexable pages', String(data.indexable)],
        ...data.statusBuckets.map((b) => [b.label, String(b.count)]),
        ...(data.avgResponseMs != null ? [['Average response time', `${data.avgResponseMs} ms`]] : []),
      ],
      [60, 40]
    )
  );

  if (data.health.length > 0) {
    children.push(heading('Health scores by category'));
    children.push(
      para('100 = no issues found. Weighted by issue severity relative to the number of pages.', {
        size: 9, color: GREY_MID,
      })
    );
    children.push(
      table(
        ['Category', 'Score / 100'],
        data.health.map((h) => [h.category, String(h.score)]),
        [60, 40]
      )
    );
  }

  if (data.segments.length > 0) {
    children.push(heading('Segments'));
    children.push(
      table(
        ['Segment', 'Pages', 'Indexable'],
        data.segments.map((s) => [s.segment, String(s.pages), String(s.indexable)]),
        [50, 25, 25]
      )
    );
  }

  children.push(heading('Issues found'));
  if (data.issues.length === 0) {
    children.push(para('No issues found.'));
  } else {
    children.push(
      table(
        ['Severity', 'Issue', 'Category', 'Count'],
        data.issues.map((i) => [i.severity.toUpperCase(), i.name, i.category, String(i.count)]),
        [15, 45, 25, 15]
      )
    );
  }

  if (data.worstPages.length > 0) {
    children.push(heading('Pages needing the most attention'));
    children.push(
      table(
        ['URL', 'Issues'],
        data.worstPages.map((p) => [p.url, String(p.issueCount)]),
        [85, 15]
      )
    );
  }

  children.push(
    new Paragraph({
      spacing: { before: 400 },
      alignment: AlignmentType.CENTER,
      children: [
        text(`Generated by Pulse SEO on ${new Date().toISOString().slice(0, 10)}`, {
          size: 8, color: GREY_MID,
        }),
      ],
    })
  );

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, color: GREY_DARK } },
        heading1: { run: { font: FONT, bold: true, color: GREY_DARK, size: 32 } },
      },
    },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}

/** Convenience: full pipeline from an open readonly DB to a .docx buffer. */
export async function buildReport(db: Database.Database, agencyName?: string): Promise<Buffer> {
  return renderReportDocx(collectReportData(db), agencyName);
}
