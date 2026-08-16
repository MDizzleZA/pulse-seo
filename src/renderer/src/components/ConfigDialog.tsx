import { useState } from 'react';
import type { CrawlConfig, Extractor, CustomSearch, CustomHeader, Segment } from '../../../shared/types';

interface Props {
  config: CrawlConfig;
  onClose: () => void;
  onSave: (c: CrawlConfig) => void;
}

const SECTIONS = ['Crawl', 'Scope', 'Auth', 'Rendering', 'Content', 'Segments', 'Extraction', 'Search'] as const;
type Section = (typeof SECTIONS)[number];

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
}

export default function ConfigDialog(props: Props): React.JSX.Element {
  const [cfg, setCfg] = useState<CrawlConfig>({ ...props.config });
  const [section, setSection] = useState<Section>('Crawl');

  const set = <K extends keyof CrawlConfig>(key: K, value: CrawlConfig[K]): void =>
    setCfg((c) => ({ ...c, [key]: value }));

  const num = (v: string, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  const row = (label: string, control: React.JSX.Element, hint?: string): React.JSX.Element => (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-56 shrink-0 text-slate-300 text-sm">{label}</span>
      {control}
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </div>
  );

  const textarea = (
    value: string[],
    onChange: (lines: string[]) => void,
    placeholder: string
  ): React.JSX.Element => (
    <textarea
      className="input w-full h-24 font-mono text-xs"
      value={value.join('\n')}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value.split('\n').map((l) => l.trim()).filter(Boolean))}
    />
  );

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-lg w-[820px] max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700">
          <span className="font-semibold text-slate-100">Crawl Configuration</span>
          <button className="text-slate-400 hover:text-slate-100 cursor-pointer" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="w-40 border-r border-slate-800 py-2">
            {SECTIONS.map((s) => (
              <button
                key={s}
                className={
                  'w-full text-left px-4 py-1.5 text-sm cursor-pointer ' +
                  (s === section ? 'bg-slate-800 text-emerald-300' : 'text-slate-400 hover:text-slate-200')
                }
                onClick={() => setSection(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {section === 'Crawl' && (
              <>
                {row('Mode', (
                  <select className="input" value={cfg.mode} onChange={(e) => set('mode', e.target.value as 'spider' | 'list')}>
                    <option value="spider">Spider (follow links)</option>
                    <option value="list">List (only listed URLs)</option>
                  </select>
                ))}
                {cfg.mode === 'list' &&
                  row('URL list', textarea(cfg.listUrls, (v) => set('listUrls', v), 'One URL per line'))}
                {row('Max URLs', (
                  <input className="input w-28" value={cfg.maxUrls} onChange={(e) => set('maxUrls', num(e.target.value, 0))} />
                ), '0 = unlimited')}
                {row('Max depth', (
                  <input className="input w-28" value={cfg.maxDepth} onChange={(e) => set('maxDepth', num(e.target.value, 0))} />
                ), '0 = unlimited')}
                {row('Concurrency (threads)', (
                  <input className="input w-28" value={cfg.concurrency} onChange={(e) => set('concurrency', Math.max(1, num(e.target.value, 5)))} />
                ))}
                {row('Delay between requests (ms)', (
                  <input className="input w-28" value={cfg.delayMs} onChange={(e) => set('delayMs', num(e.target.value, 0))} />
                ))}
                {row('Respect robots.txt', (
                  <input type="checkbox" checked={cfg.respectRobots} onChange={(e) => set('respectRobots', e.target.checked)} />
                ))}
                {row('Respect nofollow links', (
                  <input type="checkbox" checked={cfg.respectNofollow} onChange={(e) => set('respectNofollow', e.target.checked)} />
                ))}
                {row('Check external links', (
                  <input type="checkbox" checked={cfg.checkExternalLinks} onChange={(e) => set('checkExternalLinks', e.target.checked)} />
                ))}
                {row('Check images (size/status)', (
                  <input type="checkbox" checked={cfg.checkImages} onChange={(e) => set('checkImages', e.target.checked)} />
                ))}
                {row('Store HTML', (
                  <input type="checkbox" checked={cfg.storeHtml} onChange={(e) => set('storeHtml', e.target.checked)} />
                ), 'Required for extraction, search and HTML view')}
                {row('User agent', (
                  <input className="input w-full" value={cfg.userAgent} onChange={(e) => set('userAgent', e.target.value)} />
                ))}
              </>
            )}

            {section === 'Scope' && (
              <>
                {row('Crawl subdomains', (
                  <input type="checkbox" checked={cfg.crawlSubdomains} onChange={(e) => set('crawlSubdomains', e.target.checked)} />
                ))}
                {row('Query parameters', (
                  <select className="input" value={cfg.queryParams} onChange={(e) => set('queryParams', e.target.value as CrawlConfig['queryParams'])}>
                    <option value="crawl">Crawl all</option>
                    <option value="strip">Strip all parameters</option>
                    <option value="stripSelected">Strip selected parameters</option>
                  </select>
                ))}
                {cfg.queryParams === 'stripSelected' &&
                  row('Parameters to strip', textarea(cfg.stripParams, (v) => set('stripParams', v), 'utm_source\nutm_medium\nsessionid'))}
                <div className="mt-3 text-sm text-slate-300">Include patterns (regex, one per line — leave empty for all)</div>
                {textarea(cfg.includePatterns, (v) => set('includePatterns', v), '^https://example\\.com/blog/')}
                <div className="mt-3 text-sm text-slate-300">Exclude patterns (regex, one per line)</div>
                {textarea(cfg.excludePatterns, (v) => set('excludePatterns', v), '/wp-admin/\n\\?replytocom=')}
              </>
            )}

            {section === 'Auth' && (
              <>
                <div className="text-sm text-slate-400 mb-2">
                  Sent with every request (pages, images, sitemaps, robots.txt and JS rendering).
                  Use for staging sites behind HTTP Basic auth, or WAF-bypass tokens and cookies.
                </div>
                {row('Basic auth username', (
                  <input className="input w-64" autoComplete="off" value={cfg.basicAuthUser}
                    onChange={(e) => set('basicAuthUser', e.target.value)} />
                ), 'Empty = off')}
                {row('Basic auth password', (
                  <input className="input w-64" type="password" autoComplete="new-password"
                    value={cfg.basicAuthPass} onChange={(e) => set('basicAuthPass', e.target.value)} />
                ))}
                <div className="mt-4 mb-1 text-sm text-slate-300">Custom request headers</div>
                <HeaderEditor headers={cfg.customHeaders} onChange={(v) => set('customHeaders', v)} />
                <div className="mt-3 text-xs text-yellow-500">
                  ⚠ Credentials and header values are stored in plain text inside this .pulse file —
                  don't share project files that contain them.
                </div>
              </>
            )}

            {section === 'Rendering' && (
              <>
                {row('Enable JavaScript rendering', (
                  <input type="checkbox" checked={cfg.renderJs} onChange={(e) => set('renderJs', e.target.checked)} />
                ), 'Second pass renders 200 HTML pages in headless Chromium')}
                {row('Render wait (ms after load)', (
                  <input className="input w-28" value={cfg.renderWaitMs} onChange={(e) => set('renderWaitMs', num(e.target.value, 2000))} />
                ))}
                {row('Render concurrency', (
                  <input className="input w-28" value={cfg.renderConcurrency} onChange={(e) => set('renderConcurrency', Math.max(1, Math.min(8, num(e.target.value, 3))))} />
                ), '1–8 hidden browser windows')}
                {row('Accessibility audit (axe-core)', (
                  <input type="checkbox" checked={cfg.a11yAudit} onChange={(e) => set('a11yAudit', e.target.checked)} disabled={!cfg.renderJs} />
                ), 'WCAG 2.1 A/AA checks per rendered page — needs JS rendering on')}
              </>
            )}

            {section === 'Content' && (
              <>
                {row('Thin content threshold (words)', (
                  <input className="input w-28" value={cfg.wordCountMin} onChange={(e) => set('wordCountMin', num(e.target.value, 200))} />
                ))}
                {row('Near-duplicate similarity', (
                  <input className="input w-28" value={cfg.nearDupThreshold} onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n > 0 && n <= 1) set('nearDupThreshold', n);
                  }} />
                ), '0.9 = 90% similar')}
                {row('Image warning size (bytes)', (
                  <input className="input w-32" value={cfg.imgWarnBytes} onChange={(e) => set('imgWarnBytes', num(e.target.value, 204800))} />
                ))}
                {row('Image critical size (bytes)', (
                  <input className="input w-32" value={cfg.imgCriticalBytes} onChange={(e) => set('imgCriticalBytes', num(e.target.value, 512000))} />
                ))}
                {row('Title max/min chars', (
                  <span className="flex gap-2">
                    <input className="input w-20" value={cfg.maxTitleChars} onChange={(e) => set('maxTitleChars', num(e.target.value, 60))} />
                    <input className="input w-20" value={cfg.minTitleChars} onChange={(e) => set('minTitleChars', num(e.target.value, 30))} />
                  </span>
                ))}
                {row('Title max pixels', (
                  <input className="input w-24" value={cfg.maxTitlePx} onChange={(e) => set('maxTitlePx', num(e.target.value, 600))} />
                ))}
                {row('Description max/min chars', (
                  <span className="flex gap-2">
                    <input className="input w-20" value={cfg.maxDescChars} onChange={(e) => set('maxDescChars', num(e.target.value, 160))} />
                    <input className="input w-20" value={cfg.minDescChars} onChange={(e) => set('minDescChars', num(e.target.value, 70))} />
                  </span>
                ))}
                {row('Description max pixels', (
                  <input className="input w-24" value={cfg.maxDescPx} onChange={(e) => set('maxDescPx', num(e.target.value, 920))} />
                ))}
                {row('Max URL length', (
                  <input className="input w-24" value={cfg.maxUrlLength} onChange={(e) => set('maxUrlLength', num(e.target.value, 100))} />
                ))}
              </>
            )}

            {section === 'Segments' && (
              <SegmentEditor segments={cfg.segments} onChange={(v) => set('segments', v)} />
            )}

            {section === 'Extraction' && (
              <ExtractorEditor
                extractors={cfg.extractors}
                onChange={(v) => set('extractors', v)}
              />
            )}

            {section === 'Search' && (
              <SearchEditor searches={cfg.customSearches} onChange={(v) => set('customSearches', v)} />
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-700">
          <button className="btn btn-secondary" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => props.onSave(cfg)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function SegmentEditor(props: {
  segments: Segment[];
  onChange: (v: Segment[]) => void;
}): React.JSX.Element {
  const add = (): void =>
    props.onChange([
      ...props.segments,
      { id: `segment-${props.segments.length + 1}`, name: '', pattern: '' },
    ]);
  const update = (i: number, patch: Partial<Segment>): void => {
    const next = [...props.segments];
    next[i] = { ...next[i], ...patch };
    if (patch.name !== undefined) next[i].id = slugify(patch.name);
    props.onChange(next);
  };
  const remove = (i: number): void => props.onChange(props.segments.filter((_, j) => j !== i));

  return (
    <div>
      <div className="text-sm text-slate-400 mb-2">
        Group URLs into segments (blog vs product vs landing pages) by regex on the full URL.
        The first matching segment wins; pages get a Segment column in the Internal view.
        Applied during the analysis phase — re-run a crawl to re-segment.
      </div>
      {props.segments.map((s, i) => (
        <div key={i} className="flex gap-2 mb-2">
          <input className="input w-40" placeholder="Name (e.g. Blog)" value={s.name}
            onChange={(e) => update(i, { name: e.target.value })} />
          <input className="input flex-1 font-mono text-xs" placeholder="/blog/|/article/"
            value={s.pattern} onChange={(e) => update(i, { pattern: e.target.value })} />
          <button className="btn btn-danger" onClick={() => remove(i)}>✕</button>
        </div>
      ))}
      <button className="btn btn-secondary" onClick={add}>+ Add segment</button>
    </div>
  );
}

function HeaderEditor(props: {
  headers: CustomHeader[];
  onChange: (v: CustomHeader[]) => void;
}): React.JSX.Element {
  const add = (): void => props.onChange([...props.headers, { name: '', value: '' }]);
  const update = (i: number, patch: Partial<CustomHeader>): void => {
    const next = [...props.headers];
    next[i] = { ...next[i], ...patch };
    props.onChange(next);
  };
  const remove = (i: number): void => props.onChange(props.headers.filter((_, j) => j !== i));

  return (
    <div>
      {props.headers.map((h, i) => (
        <div key={i} className="flex gap-2 mb-2">
          <input className="input w-56 font-mono text-xs" placeholder="Header name (e.g. X-Bypass-Token)"
            value={h.name} onChange={(e) => update(i, { name: e.target.value })} />
          <input className="input flex-1 font-mono text-xs" placeholder="Value"
            value={h.value} onChange={(e) => update(i, { value: e.target.value })} />
          <button className="btn btn-danger" onClick={() => remove(i)}>✕</button>
        </div>
      ))}
      <button className="btn btn-secondary" onClick={add}>+ Add header</button>
    </div>
  );
}

function ExtractorEditor(props: {
  extractors: Extractor[];
  onChange: (v: Extractor[]) => void;
}): React.JSX.Element {
  const add = (): void =>
    props.onChange([
      ...props.extractors,
      { id: `extractor-${props.extractors.length + 1}`, name: '', type: 'css', expression: '', extract: 'text' },
    ]);
  const update = (i: number, patch: Partial<Extractor>): void => {
    const next = [...props.extractors];
    next[i] = { ...next[i], ...patch };
    if (patch.name !== undefined) next[i].id = slugify(patch.name);
    props.onChange(next);
  };
  const remove = (i: number): void =>
    props.onChange(props.extractors.filter((_, j) => j !== i));

  return (
    <div>
      <div className="text-sm text-slate-400 mb-2">
        Scrape custom data from every crawled page (CSS selector, XPath, or regex).
      </div>
      {props.extractors.map((ex, i) => (
        <div key={i} className="border border-slate-800 rounded p-2 mb-2">
          <div className="flex gap-2 mb-1">
            <input className="input flex-1" placeholder="Name (e.g. Price)" value={ex.name}
              onChange={(e) => update(i, { name: e.target.value })} />
            <select className="input" value={ex.type} onChange={(e) => update(i, { type: e.target.value as Extractor['type'] })}>
              <option value="css">CSS Selector</option>
              <option value="xpath">XPath</option>
              <option value="regex">Regex</option>
            </select>
            <select className="input" value={ex.extract} onChange={(e) => update(i, { extract: e.target.value as Extractor['extract'] })}>
              <option value="text">Text</option>
              <option value="html">HTML</option>
              <option value="attr">Attribute</option>
            </select>
            <button className="btn btn-danger" onClick={() => remove(i)}>✕</button>
          </div>
          <div className="flex gap-2">
            <input className="input flex-1 font-mono text-xs" placeholder={
              ex.type === 'css' ? '.product-price' : ex.type === 'xpath' ? '//span[@class="price"]' : 'price:\\s*R([0-9.]+)'
            } value={ex.expression} onChange={(e) => update(i, { expression: e.target.value })} />
            {ex.extract === 'attr' && (
              <input className="input w-32" placeholder="attribute" value={ex.attribute ?? ''}
                onChange={(e) => update(i, { attribute: e.target.value })} />
            )}
          </div>
        </div>
      ))}
      <button className="btn btn-secondary" onClick={add}>+ Add extractor</button>
    </div>
  );
}

function SearchEditor(props: {
  searches: CustomSearch[];
  onChange: (v: CustomSearch[]) => void;
}): React.JSX.Element {
  const add = (): void =>
    props.onChange([
      ...props.searches,
      { id: `search-${props.searches.length + 1}`, name: '', pattern: '', isRegex: false },
    ]);
  const update = (i: number, patch: Partial<CustomSearch>): void => {
    const next = [...props.searches];
    next[i] = { ...next[i], ...patch };
    if (patch.name !== undefined) next[i].id = slugify(patch.name);
    props.onChange(next);
  };
  const remove = (i: number): void => props.onChange(props.searches.filter((_, j) => j !== i));

  return (
    <div>
      <div className="text-sm text-slate-400 mb-2">
        Find text or code across all crawled pages (e.g. verify GA4/GTM tags are present).
      </div>
      {props.searches.map((s, i) => (
        <div key={i} className="flex gap-2 mb-2">
          <input className="input w-40" placeholder="Name (e.g. GTM tag)" value={s.name}
            onChange={(e) => update(i, { name: e.target.value })} />
          <input className="input flex-1 font-mono text-xs" placeholder={s.isRegex ? 'GTM-[A-Z0-9]+' : 'gtag.js'}
            value={s.pattern} onChange={(e) => update(i, { pattern: e.target.value })} />
          <label className="flex items-center gap-1 text-xs text-slate-400">
            <input type="checkbox" checked={s.isRegex} onChange={(e) => update(i, { isRegex: e.target.checked })} />
            regex
          </label>
          <button className="btn btn-danger" onClick={() => remove(i)}>✕</button>
        </div>
      ))}
      <button className="btn btn-secondary" onClick={add}>+ Add search</button>
    </div>
  );
}
