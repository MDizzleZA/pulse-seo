// GA4 Data API client. Pulls per-pagePath metrics, joins paths to crawled
// internal URLs (GA4 has no host/scheme), and upserts into api_ga4.
// Pure core: db + injected fetch + access token.
import type Database from 'better-sqlite3';
import { daysAgoIso, apiError, type FetchLike } from './common';

const GA4_BASE = 'https://analyticsdata.googleapis.com/v1beta';
const PAGE_SIZE = 100000; // runReport max limit per request

export interface Ga4Row {
  path: string;
  sessions: number;
  engaged_sessions: number;
  engagement_rate: number;
  conversions: number;
  total_users: number;
}

/** Paginated runReport by pagePath over the last N days. */
export async function fetchGa4Pages(
  fetchImpl: FetchLike,
  accessToken: string,
  propertyId: string,
  days: number
): Promise<Ga4Row[]> {
  const id = propertyId.replace(/^properties\//, '').trim();
  const endpoint = `${GA4_BASE}/properties/${encodeURIComponent(id)}:runReport`;
  const rows: Ga4Row[] = [];
  let offset = 0;

  for (;;) {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: daysAgoIso(days), endDate: daysAgoIso(0) }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [
          { name: 'sessions' },
          { name: 'engagedSessions' },
          { name: 'engagementRate' },
          { name: 'keyEvents' }, // GA4's successor to "conversions"
          { name: 'totalUsers' },
        ],
        limit: PAGE_SIZE,
        offset,
      }),
    });
    if (res.status !== 200) throw new Error(await apiError(res, 'GA4 runReport'));

    const body = (await res.json()) as {
      rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
      rowCount?: number;
    };
    const page = body.rows ?? [];
    for (const r of page) {
      const m = r.metricValues.map((v) => Number(v.value) || 0);
      rows.push({
        path: r.dimensionValues[0]?.value ?? '',
        sessions: m[0],
        engaged_sessions: m[1],
        engagement_rate: Math.round(m[2] * 1000) / 1000,
        conversions: m[3],
        total_users: m[4],
      });
    }
    offset += page.length;
    if (page.length === 0 || offset >= (body.rowCount ?? 0)) break;
  }

  return rows;
}

function pathKey(p: string): string {
  // Normalise trailing slash so '/about' and '/about/' meet in the middle.
  const noSlash = p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
  return noSlash || '/';
}

/**
 * Join GA4 pagePath rows to crawled internal URLs and replace api_ga4.
 * Rows whose path matches no crawled page are counted, not written — the
 * ga4 tab only shows crawled pages.
 */
export function writeGa4(
  db: Database.Database,
  rows: Ga4Row[]
): { written: number; unmatched: number } {
  const pages = db
    .prepare("SELECT url FROM pages WHERE is_internal = 1 AND fetched = 1")
    .all() as { url: string }[];

  // First URL wins per normalised path (crawl order ≈ discovery priority).
  const byPath = new Map<string, string>();
  for (const p of pages) {
    try {
      const key = pathKey(new URL(p.url).pathname);
      if (!byPath.has(key)) byPath.set(key, p.url);
    } catch {
      // unparseable stored URL — skip
    }
  }

  // Aggregate GA4 rows that land on the same URL (slash variants).
  const byUrl = new Map<string, Ga4Row>();
  let unmatched = 0;
  for (const row of rows) {
    const url = byPath.get(pathKey(row.path));
    if (!url) {
      unmatched++;
      continue;
    }
    const prev = byUrl.get(url);
    if (!prev) {
      byUrl.set(url, { ...row });
    } else {
      const total = prev.sessions + row.sessions;
      // Weight engagement rate by sessions so the merged figure stays honest.
      prev.engagement_rate =
        total > 0
          ? Math.round(
              ((prev.engagement_rate * prev.sessions + row.engagement_rate * row.sessions) / total) *
                1000
            ) / 1000
          : 0;
      prev.sessions = total;
      prev.engaged_sessions += row.engaged_sessions;
      prev.conversions += row.conversions;
      prev.total_users += row.total_users;
    }
  }

  const upsert = db.prepare(
    `INSERT INTO api_ga4 (url, sessions, engaged_sessions, engagement_rate, conversions,
       total_users, fetched_at)
     VALUES (@url, @sessions, @engaged_sessions, @engagement_rate, @conversions,
       @total_users, @fetched_at)
     ON CONFLICT(url) DO UPDATE SET
       sessions = excluded.sessions, engaged_sessions = excluded.engaged_sessions,
       engagement_rate = excluded.engagement_rate, conversions = excluded.conversions,
       total_users = excluded.total_users, fetched_at = excluded.fetched_at`
  );

  const fetchedAt = new Date().toISOString();
  const write = db.transaction(() => {
    db.prepare('DELETE FROM api_ga4').run();
    for (const [url, row] of byUrl) {
      upsert.run({
        url,
        sessions: row.sessions,
        engaged_sessions: row.engaged_sessions,
        engagement_rate: row.engagement_rate,
        conversions: row.conversions,
        total_users: row.total_users,
        fetched_at: fetchedAt,
      });
    }
  });
  write();

  return { written: byUrl.size, unmatched };
}
