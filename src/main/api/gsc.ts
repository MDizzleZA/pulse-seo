// Google Search Console client. Pulls clicks/impressions/ctr/position by page
// and upserts into api_gsc — including GSC URLs with no crawled page, which
// feed the gsc tab's "orphan" filter. Pure core: injected fetch + access token.
import type Database from 'better-sqlite3';
import { daysAgoIso, apiError, type FetchLike } from './common';

const GSC_BASE = 'https://www.googleapis.com/webmasters/v3';
const PAGE_SIZE = 25000; // API hard cap per query page

export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

export interface GscRow {
  url: string;
  clicks: number;
  impressions: number;
  ctr: number; // percent, matching the tab's "CTR %" column
  position: number;
}

export async function listGscSites(fetchImpl: FetchLike, accessToken: string): Promise<GscSite[]> {
  const res = await fetchImpl(`${GSC_BASE}/sites`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status !== 200) throw new Error(await apiError(res, 'GSC sites'));
  const body = (await res.json()) as { siteEntry?: GscSite[] };
  return body.siteEntry ?? [];
}

/** Paginated Search Analytics query, dimension=page, over the last N days. */
export async function fetchGscPages(
  fetchImpl: FetchLike,
  accessToken: string,
  property: string,
  days: number,
  maxRows = 100000
): Promise<GscRow[]> {
  const endpoint = `${GSC_BASE}/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
  const rows: GscRow[] = [];
  let startRow = 0;

  while (rows.length < maxRows) {
    const pageSize = Math.min(PAGE_SIZE, maxRows - rows.length);
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate: daysAgoIso(days),
        endDate: daysAgoIso(0),
        dimensions: ['page'],
        rowLimit: pageSize,
        startRow,
      }),
    });
    if (res.status !== 200) throw new Error(await apiError(res, 'GSC query'));

    const body = (await res.json()) as {
      rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[];
    };
    const page = body.rows ?? [];
    if (page.length === 0) break;

    for (const r of page) {
      rows.push({
        url: r.keys[0],
        clicks: r.clicks ?? 0,
        impressions: r.impressions ?? 0,
        ctr: Math.round((r.ctr ?? 0) * 10000) / 100,
        position: Math.round((r.position ?? 0) * 10) / 10,
      });
    }
    if (page.length < pageSize) break;
    startRow += pageSize;
  }

  return rows;
}

/** Replace api_gsc with this fetch's rows. Returns orphan count (not crawled). */
export function writeGsc(
  db: Database.Database,
  rows: GscRow[]
): { written: number; orphans: number } {
  const hasPage = db.prepare('SELECT 1 FROM pages WHERE url = ?');
  const upsert = db.prepare(
    `INSERT INTO api_gsc (url, clicks, impressions, ctr, position, fetched_at)
     VALUES (@url, @clicks, @impressions, @ctr, @position, @fetched_at)
     ON CONFLICT(url) DO UPDATE SET
       clicks = excluded.clicks, impressions = excluded.impressions,
       ctr = excluded.ctr, position = excluded.position, fetched_at = excluded.fetched_at`
  );

  let orphans = 0;
  const fetchedAt = new Date().toISOString();
  const write = db.transaction(() => {
    // Full replace: a fresh pull is the complete picture for its date range.
    db.prepare('DELETE FROM api_gsc').run();
    for (const row of rows) {
      upsert.run({ ...row, fetched_at: fetchedAt });
      if (!hasPage.get(row.url)) orphans++;
    }
  });
  write();

  return { written: rows.length, orphans };
}
