import { useEffect, useState } from 'react';
import type { PageDetail } from '../../../shared/types';
import { measurePx, TITLE_FONT_PX, DESC_FONT_PX } from '../../../shared/serp-widths';

interface Props {
  url: string;
  onClose: () => void;
}

const DETAIL_TABS = [
  'Overview', 'SERP', 'Inlinks', 'Outlinks', 'Images', 'Hreflang', 'Structured Data',
  'Duplicates', 'Headers', 'Accessibility', 'Issues', 'HTML',
] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

/** Truncate text with an ellipsis once its estimated Arial width exceeds maxPx. */
function truncateAtPx(text: string, fontSizePx: number, maxPx: number): string {
  if (measurePx(text, fontSizePx) <= maxPx) return text;
  let out = text;
  while (out.length > 0 && measurePx(out + ' ...', fontSizePx) > maxPx) {
    out = out.slice(0, -1);
  }
  return out.trimEnd() + ' ...';
}

/** Split a flattened Set-Cookie header (comma-joined) into individual cookies.
 *  Splits only before `name=` tokens so Expires dates survive. */
function splitCookies(setCookie: string): string[] {
  return setCookie.split(/,\s(?=[^\s;,=]+=)/).map((c) => c.trim()).filter(Boolean);
}

function serpDisplayUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '');
    const crumbs = path.split('/').filter(Boolean).join(' › ');
    return u.hostname + (crumbs ? ' › ' + crumbs : '');
  } catch {
    return url;
  }
}

export default function DetailsPane(props: Props): React.JSX.Element {
  const [detail, setDetail] = useState<PageDetail | null>(null);
  const [tab, setTab] = useState<DetailTab>('Overview');
  const [html, setHtml] = useState<string | null>(null);
  const [htmlWhich, setHtmlWhich] = useState<'raw' | 'rendered'>('raw');

  useEffect(() => {
    setDetail(null);
    setHtml(null);
    window.pulse.pageDetail(props.url).then(setDetail).catch(() => setDetail(null));
  }, [props.url]);

  useEffect(() => {
    if (tab === 'HTML') {
      setHtml(null);
      window.pulse.htmlSource(props.url, htmlWhich).then(setHtml).catch(() => setHtml(null));
    }
  }, [tab, htmlWhich, props.url]);

  const page = detail?.page;

  const field = (label: string, value: unknown): React.JSX.Element => (
    <div className="flex py-0.5">
      <span className="w-44 shrink-0 text-slate-500">{label}</span>
      <span className="text-slate-200 break-all">{value === null || value === undefined || value === '' ? '—' : String(value)}</span>
    </div>
  );

  return (
    <div className="h-72 shrink-0 border-t border-slate-700 bg-slate-900 flex flex-col">
      <div className="flex items-center border-b border-slate-800">
        {DETAIL_TABS.map((t) => (
          <button
            key={t}
            className={
              'px-3 py-1.5 text-xs cursor-pointer ' +
              (t === tab ? 'text-emerald-300 bg-slate-800' : 'text-slate-400 hover:text-slate-200')
            }
            onClick={() => setTab(t)}
          >
            {t}
            {detail && t === 'Inlinks' ? ` (${detail.inlinks.length})` : ''}
            {detail && t === 'Outlinks' ? ` (${detail.outlinks.length})` : ''}
            {detail && t === 'Duplicates' && detail.duplicates.length > 0 ? ` (${detail.duplicates.length})` : ''}
            {detail && t === 'Issues' ? ` (${detail.issues.length})` : ''}
          </button>
        ))}
        <span className="flex-1 truncate text-xs text-slate-500 px-2">{props.url}</span>
        <button
          className="px-3 text-slate-400 hover:text-slate-100 cursor-pointer"
          onClick={props.onClose}
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-auto p-2 text-xs">
        {!detail && <div className="text-slate-500">Loading…</div>}

        {detail && tab === 'Overview' && page && (
          <div className="grid grid-cols-2 gap-x-6">
            <div>
              {field('URL', page.url)}
              {field('Status', `${page.status ?? ''} ${page.status_text ?? ''}`)}
              {field('Indexable', page.indexable === 1 ? 'Yes' : page.indexability_reason ?? 'No')}
              {field('Content Type', page.content_type)}
              {field('Segment', page.segment)}
              {field('Depth', page.depth)}
              {field('Response Time', page.response_ms != null ? `${page.response_ms} ms` : null)}
              {field('Size', page.size != null ? `${page.size} bytes` : null)}
              {field('Redirect Target', page.redirect_target)}
              {field('Redirect Chain', (() => {
                if (!page.redirect_chain) return null;
                try {
                  return (JSON.parse(page.redirect_chain) as { url: string; status: number }[])
                    .map((h) => `${h.url} (${h.status})`)
                    .concat(page.redirect_target ? [page.redirect_target] : [])
                    .join(' → ');
                } catch {
                  return page.redirect_chain;
                }
              })())}
              {field('Rel Next / Prev', page.rel_next || page.rel_prev
                ? `${page.rel_next ?? '—'} / ${page.rel_prev ?? '—'}` : null)}
              {field('Word Count', page.word_count)}
              {field('Inlinks / Outlinks', `${page.inlinks} / ${page.outlinks}`)}
            </div>
            <div>
              {field('Title', page.title)}
              {field('Title Pixels', page.title_px)}
              {field('Meta Description', page.meta_description)}
              {field('Meta Robots', page.meta_robots)}
              {field('X-Robots-Tag', page.x_robots)}
              {field('Canonical', page.canonical)}
              {field('HTTP Canonical', page.canonical_header)}
              {field('H1', page.h1 ? JSON.parse(page.h1).join(' | ') : null)}
              {field('SPA Framework', page.spa_framework)}
              {detail.gsc && field('GSC Clicks / Impr.', `${detail.gsc.clicks} / ${detail.gsc.impressions}`)}
              {detail.psi && field('PSI Perf / LCP', `${detail.psi.performance} / ${detail.psi.lcp_ms}ms`)}
            </div>
          </div>
        )}

        {detail && tab === 'SERP' && page && (
          <div className="max-w-2xl">
            <div className="bg-white rounded p-4" style={{ fontFamily: 'Arial, sans-serif' }}>
              <div style={{ fontSize: 14, color: '#202124', lineHeight: '20px' }}>
                {serpDisplayUrl(page.url)}
              </div>
              <div style={{ fontSize: TITLE_FONT_PX, color: '#1a0dab', lineHeight: '26px', marginTop: 2 }}>
                {page.title
                  ? truncateAtPx(page.title, TITLE_FONT_PX, 600)
                  : <span style={{ color: '#999' }}>(missing title)</span>}
              </div>
              <div style={{ fontSize: DESC_FONT_PX, color: '#4d5156', lineHeight: '22px', marginTop: 2 }}>
                {page.meta_description
                  ? truncateAtPx(page.meta_description, DESC_FONT_PX, 920 * 2)
                  : <span style={{ color: '#999' }}>(missing meta description — Google will pick its own snippet)</span>}
              </div>
            </div>
            <div className="mt-2 text-slate-500">
              Title: {page.title_px ?? 0}px of 600px · Description: {page.meta_description_px ?? 0}px of 920px.
              Text past the limit is truncated in Google results.
            </div>
          </div>
        )}

        {detail && tab === 'Duplicates' && (
          <div>
            {detail.duplicates.length === 0 && (
              <div className="text-slate-500">No exact or near-duplicate pages found for this URL.</div>
            )}
            {detail.duplicates.length > 0 && (
              <table className="w-full">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="pr-4">Duplicate Of / Similar To</th>
                    <th className="pr-4">Type</th>
                    <th>Similarity</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.duplicates.map((d, i) => (
                    <tr key={i} className="border-t border-slate-800">
                      <td className="pr-4 text-slate-300 break-all">{d.url}</td>
                      <td className="pr-4">
                        {d.kind === 'exact'
                          ? <span className="text-red-400">Exact</span>
                          : <span className="text-yellow-400">Near</span>}
                      </td>
                      <td>{d.similarity != null ? `${d.similarity}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {detail && tab === 'Headers' && page && (() => {
          let headers: Record<string, string> = {};
          try {
            headers = page.headers ? (JSON.parse(page.headers) as Record<string, string>) : {};
          } catch {
            headers = {};
          }
          const entries = Object.entries(headers).sort(([a], [b]) => a.localeCompare(b));
          const cookies = headers['set-cookie'] ? splitCookies(headers['set-cookie']) : [];
          return (
            <div>
              {entries.length === 0 && (
                <div className="text-slate-500">No response headers stored for this URL.</div>
              )}
              {entries.length > 0 && (
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="pr-4 w-56">Header</th><th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(([k, v], i) => (
                      <tr key={i} className="border-t border-slate-800 align-top">
                        <td className="pr-4 text-emerald-300 whitespace-nowrap">{k}</td>
                        <td className="text-slate-300 break-all">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {cookies.length > 0 && (
                <div className="mt-3">
                  <div className="text-slate-500 mb-1">Cookies set ({cookies.length})</div>
                  {cookies.map((c, i) => {
                    const [nameValue, ...attrs] = c.split(';');
                    return (
                      <div key={i} className="py-0.5 border-t border-slate-800">
                        <span className="text-emerald-300">{nameValue.split('=')[0]}</span>
                        <span className="text-slate-500 ml-2">{attrs.join(';').trim()}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {detail && tab === 'Inlinks' && (
          <table className="w-full">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pr-4">From</th><th className="pr-4">Anchor</th><th>Follow</th>
              </tr>
            </thead>
            <tbody>
              {detail.inlinks.map((l, i) => (
                <tr key={i} className="border-t border-slate-800">
                  <td className="pr-4 text-slate-300 break-all">{l.src}</td>
                  <td className="pr-4 text-slate-400">{l.anchor}</td>
                  <td>{l.follow ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {detail && tab === 'Outlinks' && (
          <table className="w-full">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pr-4">To</th><th className="pr-4">Anchor</th>
                <th className="pr-4">Internal</th><th>Follow</th>
              </tr>
            </thead>
            <tbody>
              {detail.outlinks.map((l, i) => (
                <tr key={i} className="border-t border-slate-800">
                  <td className="pr-4 text-slate-300 break-all">{l.dst}</td>
                  <td className="pr-4 text-slate-400">{l.anchor}</td>
                  <td className="pr-4">{l.is_internal ? 'Yes' : 'No'}</td>
                  <td>{l.follow ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {detail && tab === 'Images' && (
          <table className="w-full">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pr-4">Src</th><th className="pr-4">Alt</th>
                <th className="pr-4">Bytes</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {detail.images.map((img, i) => (
                <tr key={i} className="border-t border-slate-800">
                  <td className="pr-4 text-slate-300 break-all">{img.src}</td>
                  <td className="pr-4 text-slate-400">
                    {img.alt === null ? <span className="text-red-400">missing</span> : img.alt || <span className="text-yellow-400">empty</span>}
                  </td>
                  <td className="pr-4">{img.bytes ?? '—'}</td>
                  <td>{img.status ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {detail && tab === 'Hreflang' && (
          <table className="w-full">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pr-4">Lang</th><th className="pr-4">Href</th><th>Source</th>
              </tr>
            </thead>
            <tbody>
              {detail.hreflang.map((h, i) => (
                <tr key={i} className="border-t border-slate-800">
                  <td className="pr-4 text-slate-300">{h.lang}</td>
                  <td className="pr-4 text-slate-400 break-all">{h.href}</td>
                  <td>{h.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {detail && tab === 'Structured Data' && (
          <div>
            {detail.structured.length === 0 && <div className="text-slate-500">None found.</div>}
            {detail.structured.map((sd, i) => {
              const errors = JSON.parse(sd.errors || '[]') as string[];
              const warnings = JSON.parse(sd.warnings || '[]') as string[];
              return (
                <div key={i} className="mb-3 border border-slate-800 rounded p-2">
                  <div className="flex gap-3 mb-1">
                    <span className="text-emerald-300 font-semibold">{sd.type}</span>
                    <span className="text-slate-500">{sd.format}</span>
                    {errors.length > 0 && <span className="text-red-400">{errors.length} errors</span>}
                    {warnings.length > 0 && <span className="text-yellow-400">{warnings.length} warnings</span>}
                  </div>
                  {errors.map((e, j) => <div key={j} className="text-red-400">✗ {e}</div>)}
                  {warnings.map((w, j) => <div key={j} className="text-yellow-400">⚠ {w}</div>)}
                  <pre className="mt-1 text-slate-400 whitespace-pre-wrap break-all max-h-40 overflow-auto">
                    {JSON.stringify(JSON.parse(sd.json), null, 2)}
                  </pre>
                </div>
              );
            })}
          </div>
        )}

        {detail && tab === 'Accessibility' && page && (() => {
          let violations: { id: string; impact: string; help: string; nodes: number; sample: string }[] = [];
          try {
            violations = page.a11y_violations ? JSON.parse(page.a11y_violations) : [];
          } catch {
            violations = [];
          }
          if (violations.length === 0) {
            return (
              <div className="text-slate-500">
                {page.a11y_violations === null
                  ? 'No audit data — enable JS rendering + "Accessibility audit" in Settings and re-crawl.'
                  : 'No accessibility violations found on this page.'}
              </div>
            );
          }
          const impactColor: Record<string, string> = {
            critical: 'text-red-400', serious: 'text-orange-400',
            moderate: 'text-yellow-400', minor: 'text-slate-400',
          };
          return (
            <table className="w-full">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pr-4">Impact</th><th className="pr-4">Rule</th>
                  <th className="pr-4">Help</th><th className="pr-4">Nodes</th><th>Example</th>
                </tr>
              </thead>
              <tbody>
                {violations.map((v, i) => (
                  <tr key={i} className="border-t border-slate-800 align-top">
                    <td className={`pr-4 font-semibold uppercase ${impactColor[v.impact] ?? ''}`}>{v.impact}</td>
                    <td className="pr-4 text-emerald-300 whitespace-nowrap">{v.id}</td>
                    <td className="pr-4 text-slate-300">{v.help}</td>
                    <td className="pr-4">{v.nodes}</td>
                    <td className="text-slate-500 break-all font-mono text-[10px]">{v.sample}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })()}

        {detail && tab === 'Issues' && (
          <div>
            {detail.issues.length === 0 && <div className="text-slate-500">No issues for this URL.</div>}
            {detail.issues.map((issue, i) => (
              <div key={i} className="py-1 border-b border-slate-800">
                <span className={`font-semibold uppercase mr-2 severity-${issue.severity}`}>
                  {issue.severity}
                </span>
                <span className="text-slate-200">{issue.name}</span>
                {issue.detail && <span className="text-slate-500 ml-2">{issue.detail}</span>}
              </div>
            ))}
          </div>
        )}

        {detail && tab === 'HTML' && (
          <div className="h-full flex flex-col">
            <div className="mb-1">
              <button
                className={'px-2 py-0.5 rounded-l cursor-pointer ' + (htmlWhich === 'raw' ? 'bg-emerald-700 text-white' : 'bg-slate-800 text-slate-400')}
                onClick={() => setHtmlWhich('raw')}
              >
                Raw
              </button>
              <button
                className={'px-2 py-0.5 rounded-r cursor-pointer ' + (htmlWhich === 'rendered' ? 'bg-emerald-700 text-white' : 'bg-slate-800 text-slate-400')}
                onClick={() => setHtmlWhich('rendered')}
              >
                Rendered
              </button>
            </div>
            <pre className="flex-1 overflow-auto text-slate-400 whitespace-pre-wrap break-all">
              {html ?? 'Not stored (enable "Store HTML" in settings, or page not rendered).'}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
