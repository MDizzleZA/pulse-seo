import type Database from 'better-sqlite3';
import { makeAddIssue } from './helpers';

interface Entry {
  lang: string;
  href: string;
}

/** Structural validation of an hreflang value: language[-script][-region] or x-default. */
export function isValidHreflang(code: string): boolean {
  const c = code.trim().toLowerCase();
  if (c === 'x-default') return true;
  // 2-3 letter language, optional 4-letter script, optional 2-letter or 3-digit region.
  return /^[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|[0-9]{3}))?$/.test(c);
}

export function checkHreflang(db: Database.Database): void {
  const add = makeAddIssue(db);

  const rows = db
    .prepare(
      `SELECT h.page_id AS pageId, p.url AS pageUrl, p.status AS status,
        p.fetched AS fetched, h.lang AS lang, h.href AS href
       FROM hreflang h JOIN pages p ON p.id = h.page_id`
    )
    .all() as {
    pageId: number;
    pageUrl: string;
    status: number | null;
    fetched: number;
    lang: string;
    href: string;
  }[];
  if (rows.length === 0) return;

  // Cluster entries by source page, and index each page's declared targets so we
  // can verify return links and self-references.
  const byPage = new Map<number, { url: string; entries: Entry[] }>();
  const targetsByUrl = new Map<string, Set<string>>();
  for (const r of rows) {
    let bucket = byPage.get(r.pageId);
    if (!bucket) {
      bucket = { url: r.pageUrl, entries: [] };
      byPage.set(r.pageId, bucket);
    }
    bucket.entries.push({ lang: r.lang, href: r.href });
    let set = targetsByUrl.get(r.pageUrl);
    if (!set) {
      set = new Set();
      targetsByUrl.set(r.pageUrl, set);
    }
    set.add(r.href);
  }

  // Status of any crawled URL, for broken-target detection.
  const pageStatus = new Map<string, { status: number | null; fetched: number }>();
  for (const p of db
    .prepare('SELECT url, status, fetched FROM pages')
    .all() as { url: string; status: number | null; fetched: number }[]) {
    pageStatus.set(p.url, { status: p.status, fetched: p.fetched });
  }

  for (const [pageId, { url, entries }] of byPage) {
    // Invalid language/region codes.
    const bad = entries.map((e) => e.lang).filter((l) => !isValidHreflang(l));
    if (bad.length > 0) add('hreflang-invalid-code', pageId, [...new Set(bad)].join(', '));

    // Self-reference: the cluster must include an entry pointing at this page.
    if (!entries.some((e) => e.href === url)) add('hreflang-no-self', pageId);

    // x-default is recommended for language/country selectors.
    if (!entries.some((e) => e.lang.trim().toLowerCase() === 'x-default')) {
      add('hreflang-no-xdefault', pageId);
    }

    // Missing return tags: a referenced page that itself declares hreflang must
    // point back here. Only assert when the target's cluster was actually crawled.
    const missingReturn: string[] = [];
    const broken: string[] = [];
    for (const e of entries) {
      if (e.href === url) continue;
      const targetSet = targetsByUrl.get(e.href);
      if (e.lang.trim().toLowerCase() !== 'x-default' && targetSet && !targetSet.has(url)) {
        missingReturn.push(e.href);
      }
      const st = pageStatus.get(e.href);
      if (st && st.fetched === 1 && st.status !== null && st.status !== 200) {
        broken.push(`${e.href} (HTTP ${st.status})`);
      }
    }
    if (missingReturn.length > 0) {
      add('hreflang-missing-return', pageId, [...new Set(missingReturn)].join(', '));
    }
    if (broken.length > 0) add('hreflang-to-broken', pageId, [...new Set(broken)].join(', '));
  }
}
