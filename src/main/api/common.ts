// Shared plumbing for the API client modules. Clients take an injected fetch
// so vitest can exercise them without the network (testable-core pattern).
import type Database from 'better-sqlite3';
import { metaGet, metaSet } from '../../db/schema';
import { DEFAULT_API_CONFIG, type ApiConfig } from '../../shared/types';

/** Minimal fetch surface the API clients rely on — global fetch satisfies it. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{ status: number; json(): Promise<unknown>; text(): Promise<string> }>;

/** Run tasks with a fixed concurrency cap, preserving input order in results. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** ISO date N days ago (UTC) — Google APIs take YYYY-MM-DD. */
export function daysAgoIso(days: number, from = new Date()): string {
  const d = new Date(from.getTime() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

export function getApiConfig(db: Database.Database): ApiConfig {
  const raw = metaGet(db, 'api_config');
  if (!raw) return { ...DEFAULT_API_CONFIG };
  try {
    return { ...DEFAULT_API_CONFIG, ...(JSON.parse(raw) as Partial<ApiConfig>) };
  } catch {
    return { ...DEFAULT_API_CONFIG };
  }
}

export function setApiConfig(db: Database.Database, config: ApiConfig): void {
  metaSet(db, 'api_config', JSON.stringify(config));
}

/** Read the body of a non-2xx Google API response into a short error string. */
export async function apiError(
  res: { status: number; text(): Promise<string> },
  context: string
): Promise<string> {
  let body = '';
  try {
    body = (await res.text()).slice(0, 300);
  } catch {
    // unreadable body — status alone will have to do
  }
  return `${context}: HTTP ${res.status}${body ? ` — ${body}` : ''}`;
}
