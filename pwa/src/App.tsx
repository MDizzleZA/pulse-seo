import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TABS, tabById } from '../../src/shared/tabs';
import type { OverviewCounts } from '../../src/shared/types';
import { openPulseFile, createEmptyProject, PulseDb, type PageDetailLite } from './db';
import { downloadViewCsv, downloadFullCsv } from './export';
import { crawlSite, type CrawlProgress, type CrawledPage } from './crawler';
import { isInternalUrl, baseDomainOf } from '../../src/crawler/url-utils';

const PAGE = 200;

/** Where clicking an issue lands (mirrors the desktop sidebar). */
const CATEGORY_TAB: Record<string, string> = {
  Response: 'response_codes', Directives: 'directives', Canonicals: 'canonicals',
  Titles: 'titles', Descriptions: 'meta_descriptions', Headings: 'h1', Images: 'internal',
  Content: 'content', URL: 'internal', Security: 'internal', Mobile: 'internal',
  Site: 'internal', Hreflang: 'hreflang', 'Structured Data': 'structured_data',
  Sitemap: 'sitemaps', Rendering: 'js_rendering', Pagination: 'internal',
  Accessibility: 'accessibility',
};

export default function App(): React.JSX.Element {
  const [db, setDb] = useState<PulseDb | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<OverviewCounts | null>(null);
  const [tab, setTab] = useState('internal');
  const [filter, setFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [detail, setDetail] = useState<PageDetailLite | null>(null);
  const initRef = useRef(false);
  const [crawlUrl, setCrawlUrl] = useState('');
  const [crawling, setCrawling] = useState(false);
  const [progress, setProgress] = useState<CrawlProgress | null>(null);
  const crawlAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    (async () => {
      try {
        const blob = await createEmptyProject();
        const buf = await blob.arrayBuffer();
        const opened = await openPulseFile(buf);
        setDb(opened);
        setOverview(opened.overview());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  const runBasicChecks = useCallback((currentDb: PulseDb, pageId: number, page: CrawledPage) => {
    if (page.status === 0) return;
    if (page.isInternal && page.status >= 400 && page.status < 500) {
      currentDb.insertIssue('response-broken-internal', pageId, `HTTP ${page.status}`);
    }
    if (!page.isInternal && page.status >= 400 && page.status < 500) {
      currentDb.insertIssue('response-broken-external', pageId, `HTTP ${page.status}`);
    }
    if (page.status >= 500) {
      currentDb.insertIssue('response-5xx', pageId, `HTTP ${page.status}`);
    }
    if (page.isInternal && page.status === 200) {
      if (!page.title) currentDb.insertIssue('title-missing', pageId, null);
      if (page.title && page.title.length > 60) currentDb.insertIssue('title-long', pageId, `${page.title.length} chars`);
      if (page.title && page.title.length < 10 && page.title.length > 0) currentDb.insertIssue('title-short', pageId, `${page.title.length} chars`);
      if (!page.metaDescription) currentDb.insertIssue('desc-missing', pageId, null);
      if (page.metaDescription && page.metaDescription.length > 160) currentDb.insertIssue('desc-long', pageId, `${page.metaDescription.length} chars`);
      if (page.h1.length === 0) currentDb.insertIssue('h1-missing', pageId, null);
      if (page.h1.length > 1) currentDb.insertIssue('h1-multiple', pageId, `${page.h1.length} H1 tags`);
      if (!page.canonical) currentDb.insertIssue('canonical-missing', pageId, null);
      if (page.metaRobots?.includes('noindex')) currentDb.insertIssue('directives-noindex', pageId, page.metaRobots);
      if (!page.viewport) currentDb.insertIssue('mobile-viewport-missing', pageId, null);
      if (page.wordCount < 100 && page.wordCount > 0) currentDb.insertIssue('content-thin', pageId, `${page.wordCount} words`);
      if (page.images.some(img => img.alt === null || img.alt === '')) {
        const count = page.images.filter(img => img.alt === null || img.alt === '').length;
        currentDb.insertIssue('images-missing-alt', pageId, `${count} images`);
      }
    }
  }, []);

  const startCrawl = useCallback(async () => {
    if (!db || !crawlUrl.trim()) return;
    let url = crawlUrl.trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    setCrawling(true);
    setError(null);
    crawlAbort.current = new AbortController();

    const freshBlob = await createEmptyProject();
    const freshBuf = await freshBlob.arrayBuffer();
    const freshDb = await openPulseFile(freshBuf);
    setDb(prev => { prev?.close(); return freshDb; });

    const domain = baseDomainOf(new URL(url).hostname);

    try {
      await crawlSite({
        startUrl: url,
        maxPages: 100,
        maxDepth: 3,
        signal: crawlAbort.current.signal,
        onProgress: (p) => setProgress({ ...p }),
        onPage: (page) => {
          const pageId = freshDb.insertPage({
            url: page.url,
            isInternal: page.isInternal ? 1 : 0,
            status: page.status,
            statusText: page.statusText,
            error: page.error,
            contentType: page.contentType,
            depth: page.depth,
            size: page.size,
            responseMs: page.responseMs,
            title: page.title,
            titleCount: page.titleCount,
            metaDescription: page.metaDescription,
            metaDescriptionCount: page.metaDescriptionCount,
            metaRobots: page.metaRobots,
            canonical: page.canonical,
            canonicalAll: page.canonicalAll,
            viewport: page.viewport,
            h1: page.h1,
            h2: page.h2,
            wordCount: page.wordCount,
            indexable: page.indexable ? 1 : 0,
            indexabilityReason: page.indexabilityReason,
            headers: JSON.stringify(page.headers),
            og: JSON.stringify(page.og),
            spaFramework: page.spaFramework,
            relNext: page.relNext,
            relPrev: page.relPrev,
          });

          for (const link of page.links) {
            freshDb.insertLink(
              pageId, link.href, link.anchor,
              link.follow ? 1 : 0,
              isInternalUrl(link.href, domain, true) ? 1 : 0
            );
          }

          for (const img of page.images) {
            freshDb.insertImage(pageId, img);
          }

          for (const hl of page.hreflang) {
            freshDb.insertHreflang(pageId, hl.lang, hl.href);
          }

          for (const sd of page.structuredData) {
            freshDb.insertStructuredData(pageId, sd);
          }

          runBasicChecks(freshDb, pageId, page);
          setOverview(freshDb.overview());
        },
      });

      freshDb.linkDstIds();
      setOverview(freshDb.overview());
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setCrawling(false);
      setProgress(null);
      crawlAbort.current = null;
    }
  }, [db, crawlUrl, runBasicChecks]);


  // Query on any navigation or data change.
  useEffect(() => {
    if (!db) return;
    const res = db.query({
      tab, filterId: filter, search: search || null,
      sortCol, sortDir, offset: 0, limit: PAGE,
    });
    setRows(res.rows);
    setTotal(res.total);
  }, [db, tab, filter, search, sortCol, sortDir, overview]);

  const loadMore = (): void => {
    if (!db) return;
    const res = db.query({
      tab, filterId: filter, search: search || null,
      sortCol, sortDir, offset: rows.length, limit: PAGE,
    });
    setRows((r) => [...r, ...res.rows]);
  };

  const navigate = (t: string, f: string | null): void => {
    setTab(t);
    setFilter(f);
    setDetail(null);
    setSortCol(null);
    setSortDir('asc');
  };

  const toggleSort = (col: string): void => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const tabDef = useMemo(() => tabById(tab), [tab]);
  const siteScore = useMemo(() => {
    if (!overview || overview.health.length === 0) return null;
    return Math.round(overview.health.reduce((s, h) => s + h.score, 0) / overview.health.length);
  }, [overview]);

  // ------------------------------------------------------------- loading
  if (!db) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-emerald-400 text-xl font-bold mb-2">Pulse SEO</div>
          {error
            ? <div className="text-sm text-red-400">{error}</div>
            : <div className="text-slate-500 text-sm">Loading…</div>}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------- viewer
  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-2 px-4 py-2 bg-slate-900 border-b border-slate-700 shrink-0 flex-wrap">
        <span className="text-emerald-400 font-bold tracking-tight whitespace-nowrap">
          Pulse SEO
        </span>
        <form className="flex items-center gap-1.5 flex-1 min-w-48 max-w-md" onSubmit={(e) => { e.preventDefault(); startCrawl(); }}>
          <input
            className="input flex-1"
            placeholder="Enter URL to crawl..."
            value={crawlUrl}
            onChange={(e) => setCrawlUrl(e.target.value)}
            disabled={crawling}
          />
          {crawling ? (
            <button type="button" className="btn bg-red-700 hover:bg-red-600 text-white" onClick={() => crawlAbort.current?.abort()}>
              Stop
            </button>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={!crawlUrl.trim()}>
              Crawl
            </button>
          )}
        </form>
        {progress && (
          <span className="text-xs text-slate-400 whitespace-nowrap">
            {progress.crawled} crawled · {progress.queued} queued{progress.errors > 0 ? ` · ${progress.errors} errors` : ''}
          </span>
        )}
        {!progress && (overview?.crawlInfo.pages ?? 0) > 0 && (
          <span className="text-slate-500 text-xs whitespace-nowrap">
            {overview?.crawlInfo.pages ?? 0} URLs · {overview?.crawlInfo.internal ?? 0} internal ·{' '}
            {overview?.crawlInfo.indexable ?? 0} indexable
          </span>
        )}
        <div className="flex-1" />
        {siteScore !== null && (
          <span className="text-xs text-slate-400 whitespace-nowrap">
            Health{' '}
            <b className={siteScore >= 80 ? 'text-emerald-400' : siteScore >= 50 ? 'text-yellow-400' : 'text-red-400'}>
              {siteScore}/100
            </b>
          </span>
        )}
        <button
          className="btn btn-secondary text-xs"
          disabled={!overview || (overview.crawlInfo.pages ?? 0) === 0}
          onClick={() => db && downloadFullCsv(db)}
          title="Download all crawled pages as CSV (all columns)"
        >
          ↓ Export All
        </button>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* main column */}
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 flex-wrap shrink-0">
            <select className="input" value={tab} onChange={(e) => navigate(e.target.value, null)}>
              {TABS.filter((t) => t.id !== 'visualization').map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} ({overview?.tabs[t.id]?.total ?? 0})
                </option>
              ))}
            </select>
            <button
              className={'btn ' + (filter === null ? 'btn-primary' : 'btn-secondary')}
              onClick={() => navigate(tab, null)}
            >
              All
            </button>
            {tabDef?.filters.map((f) => (
              <button
                key={f.id}
                className={'btn ' + (filter === f.id ? 'btn-primary' : 'btn-secondary')}
                onClick={() => navigate(tab, f.id)}
              >
                {f.label} ({overview?.tabs[tab]?.filters[f.id] ?? 0})
              </button>
            ))}
            <input
              className="input flex-1 min-w-32"
              placeholder="Search URL…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="text-xs text-slate-500">{total} rows</span>
            <button
              className="btn btn-secondary"
              disabled={total === 0}
              title="Download this view (all rows, current filter and search applied) as CSV"
              onClick={() => db && downloadViewCsv(db, tab, filter, search || null)}
            >
              Export CSV
            </button>
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="text-left text-slate-400">
                  {tabDef?.columns.map((c) => (
                    <th
                      key={c.key}
                      className="px-2 py-1.5 font-medium whitespace-nowrap cursor-pointer hover:text-slate-200 select-none"
                      title="Click to sort"
                      onClick={() => toggleSort(c.key)}
                    >
                      {c.label}
                      {sortCol === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={i}
                    className="border-t border-slate-800 hover:bg-slate-800/60 cursor-pointer"
                    onClick={() => {
                      const url = r.url as string | undefined;
                      if (url && db) setDetail(db.detail(url));
                    }}
                  >
                    {tabDef?.columns.map((c) => (
                      <td key={c.key} className="px-2 py-1 text-slate-300 max-w-96 truncate">
                        {r[c.key] === null || r[c.key] === undefined ? '' : String(r[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <div className="p-4 text-slate-500">No rows for this view.</div>}
            {rows.length < total && (
              <div className="p-3">
                <button className="btn btn-secondary" onClick={loadMore}>
                  Load more ({rows.length} of {total})
                </button>
              </div>
            )}
          </div>

          {detail && detail.page && (
            <div className="h-64 shrink-0 border-t border-slate-700 bg-slate-900 overflow-auto p-3 text-xs">
              <div className="flex items-center mb-2">
                <b className="text-slate-200 break-all">{String(detail.page.url)}</b>
                <div className="flex-1" />
                <button className="text-slate-400 hover:text-slate-100 px-2" onClick={() => setDetail(null)}>
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 mb-2">
                {(
                  [
                    ['Status', detail.page.status], ['Indexable', detail.page.indexable ? 'Yes' : (detail.page.indexability_reason ?? 'No')],
                    ['Title', detail.page.title], ['Meta description', detail.page.meta_description],
                    ['Canonical', detail.page.canonical], ['Segment', detail.page.segment],
                    ['Words', detail.page.word_count], ['Depth', detail.page.depth],
                    ['Inlinks / Outlinks', `${detail.inlinks.length} / ${detail.outlinks.length}`],
                  ] as [string, unknown][]
                ).map(([k, v]) => (
                  <div key={k} className="flex">
                    <span className="w-36 shrink-0 text-slate-500">{k}</span>
                    <span className="text-slate-300 break-all">{v === null || v === undefined || v === '' ? '—' : String(v)}</span>
                  </div>
                ))}
              </div>
              {detail.issues.length > 0 && (
                <div>
                  <div className="text-slate-500 uppercase text-[10px] mb-1">Issues on this page</div>
                  {detail.issues.map((iss, i) => (
                    <div key={i} className="py-0.5 border-t border-slate-800">
                      <span className={`font-semibold uppercase mr-2 severity-${iss.severity}`}>{iss.severity}</span>
                      <span className="text-slate-200">{iss.name}</span>
                      {iss.detail && <span className="text-slate-500 ml-2">{iss.detail}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* issues sidebar */}
        <aside className="w-72 shrink-0 bg-slate-900 border-l border-slate-700 overflow-y-auto">
          {overview && overview.health.length > 0 && (
            <div className="p-3 border-b border-slate-800">
              <div className="text-[10px] uppercase text-slate-500 mb-1">Health by category</div>
              {[...overview.health]
                .sort((a, b) => a.score - b.score)
                .map((h) => (
                  <div key={h.category} className="flex items-center gap-2 py-0.5">
                    <span className="text-xs w-24 shrink-0 text-slate-300">{h.category}</span>
                    <div className="flex-1 h-2 bg-slate-800 rounded">
                      <div
                        className={
                          'h-2 rounded ' +
                          (h.score >= 80 ? 'bg-emerald-500' : h.score >= 50 ? 'bg-yellow-500' : 'bg-red-500')
                        }
                        style={{ width: `${h.score}%` }}
                      />
                    </div>
                    <span className="text-xs w-7 text-right text-slate-400">{h.score}</span>
                  </div>
                ))}
            </div>
          )}
          <div className="p-2">
            <div className="text-[10px] uppercase text-slate-500 px-1 mb-1">
              Issues ({overview?.issues.reduce((s, i) => s + i.count, 0) ?? 0})
            </div>
            {overview?.issues.map((issue) => (
              <button
                key={issue.check_id}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-800 cursor-pointer"
                onClick={() => navigate(CATEGORY_TAB[issue.category] ?? 'internal', `issue:${issue.check_id}`)}
              >
                <div className="flex justify-between items-center">
                  <span className={`text-[10px] font-semibold uppercase severity-${issue.severity}`}>
                    {issue.severity}
                  </span>
                  <span className="text-slate-400 text-xs">{issue.count}</span>
                </div>
                <div className="text-xs text-slate-200">{issue.name}</div>
              </button>
            ))}
            {overview?.issues.length === 0 && (
              <div className="text-slate-500 text-xs px-2">No issues recorded in this crawl.</div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
