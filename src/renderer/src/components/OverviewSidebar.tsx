import { useState } from 'react';
import { TABS } from '../../../shared/tabs';
import type { OverviewCounts } from '../../../shared/types';

interface Props {
  overview: OverviewCounts | null;
  onNavigate: (tab: string, filter: string | null) => void;
  onRefresh: () => void;
}

/** Where clicking an issue should land the user. */
const CATEGORY_TAB: Record<string, string> = {
  Response: 'response_codes',
  Directives: 'directives',
  Canonicals: 'canonicals',
  Titles: 'titles',
  Descriptions: 'meta_descriptions',
  Headings: 'h1',
  Images: 'internal',
  Content: 'content',
  URL: 'internal',
  Security: 'internal',
  Mobile: 'internal',
  Site: 'internal',
  Hreflang: 'hreflang',
  'Structured Data': 'structured_data',
  Sitemap: 'sitemaps',
  Rendering: 'js_rendering',
  Pagination: 'internal',
  Accessibility: 'accessibility',
};

const SITEMAP_FILTERS: Record<string, string> = {
  'sitemap-orphan': 'orphan',
  'sitemap-missing-indexable': 'not-in-sitemap',
  'sitemap-non200': 'in-sitemap',
  'sitemap-noindex': 'non-indexable',
  'sitemap-canonicalised': 'in-sitemap',
};

export default function OverviewSidebar(props: Props): React.JSX.Element {
  const [section, setSection] = useState<'overview' | 'issues'>('issues');
  const ov = props.overview;

  return (
    <div className="w-80 shrink-0 bg-slate-900 border-l border-slate-700 flex flex-col">
      <div className="flex border-b border-slate-700">
        <button
          className={
            'flex-1 py-2 text-sm cursor-pointer ' +
            (section === 'issues' ? 'text-emerald-300 bg-slate-800' : 'text-slate-400')
          }
          onClick={() => setSection('issues')}
        >
          Issues{ov ? ` (${ov.issues.reduce((s, i) => s + i.count, 0)})` : ''}
        </button>
        <button
          className={
            'flex-1 py-2 text-sm cursor-pointer ' +
            (section === 'overview' ? 'text-emerald-300 bg-slate-800' : 'text-slate-400')
          }
          onClick={() => setSection('overview')}
        >
          Overview
        </button>
        <button
          className="px-3 text-slate-400 hover:text-slate-100 cursor-pointer"
          title="Refresh counts"
          onClick={props.onRefresh}
        >
          ⟳
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!ov && (
          <div className="p-4 text-slate-500 text-sm">
            Crawl a site to see overview counts and issues.
          </div>
        )}

        {ov && section === 'overview' && (
          <div className="p-2">
            <div className="text-xs text-slate-500 px-1 pb-2">
              {ov.crawlInfo.pages} URLs · {ov.crawlInfo.internal} internal ·{' '}
              {ov.crawlInfo.external} external · {ov.crawlInfo.indexable} indexable
            </div>
            {TABS.map((tab) => {
              const counts = ov.tabs[tab.id];
              if (!counts) return null;
              return (
                <div key={tab.id} className="mb-1">
                  <button
                    className="w-full flex justify-between px-2 py-1 rounded hover:bg-slate-800 cursor-pointer"
                    onClick={() => props.onNavigate(tab.id, null)}
                  >
                    <span className="text-slate-200">{tab.label}</span>
                    <span className="text-slate-400">{counts.total}</span>
                  </button>
                  {tab.filters.map((f) => {
                    const n = counts.filters[f.id] ?? 0;
                    return (
                      <button
                        key={f.id}
                        className={
                          'w-full flex justify-between pl-6 pr-2 py-0.5 rounded text-xs cursor-pointer hover:bg-slate-800 ' +
                          (n > 0 ? 'text-slate-300' : 'text-slate-600')
                        }
                        onClick={() => props.onNavigate(tab.id, f.id)}
                      >
                        <span>{f.label}</span>
                        <span>{n}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {ov && section === 'issues' && (
          <div className="p-2">
            {ov.health.length > 0 && (() => {
              const site = Math.round(
                ov.health.reduce((s, h) => s + h.score, 0) / ov.health.length
              );
              const siteColor =
                site >= 80 ? 'text-emerald-400' : site >= 50 ? 'text-yellow-400' : 'text-red-400';
              return (
                <div className="mb-2 px-1 flex items-baseline justify-between">
                  <span className="text-xs uppercase text-slate-500">Site health</span>
                  <span className={`text-2xl font-bold ${siteColor}`}>
                    {site}
                    <span className="text-xs font-normal text-slate-500"> / 100</span>
                  </span>
                </div>
              );
            })()}
            {ov.health.length > 0 && (
              <div className="mb-3 px-1">
                <div className="text-xs uppercase text-slate-500 mb-1">Health by category</div>
                {ov.health
                  .sort((a, b) => a.score - b.score)
                  .map((h) => (
                    <div key={h.category} className="flex items-center gap-2 py-0.5">
                      <span className="text-xs w-28 shrink-0 text-slate-300">{h.category}</span>
                      <div className="flex-1 h-2 bg-slate-800 rounded">
                        <div
                          className={
                            'h-2 rounded ' +
                            (h.score >= 80
                              ? 'bg-emerald-500'
                              : h.score >= 50
                                ? 'bg-yellow-500'
                                : 'bg-red-500')
                          }
                          style={{ width: `${h.score}%` }}
                        />
                      </div>
                      <span className="text-xs w-8 text-right text-slate-400">{h.score}</span>
                    </div>
                  ))}
              </div>
            )}
            {ov.issues.length === 0 && (
              <div className="text-slate-500 text-sm px-2">No issues found.</div>
            )}
            {ov.issues.map((issue) => (
              <button
                key={issue.check_id}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-800 cursor-pointer"
                onClick={() => {
                  const tab = CATEGORY_TAB[issue.category] ?? 'internal';
                  const filter =
                    issue.category === 'Sitemap'
                      ? (SITEMAP_FILTERS[issue.check_id] ?? null)
                      : `issue:${issue.check_id}`;
                  props.onNavigate(tab, filter);
                }}
              >
                <div className="flex justify-between items-center">
                  <span className={`text-xs font-semibold uppercase severity-${issue.severity}`}>
                    {issue.severity}
                  </span>
                  <span className="text-slate-400 text-xs">{issue.count}</span>
                </div>
                <div className="text-sm text-slate-200">{issue.name}</div>
                <div className="text-xs text-slate-500">{issue.category}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
