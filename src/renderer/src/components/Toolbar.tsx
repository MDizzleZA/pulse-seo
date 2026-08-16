import { useEffect, useRef, useState } from 'react';
import type { CrawlConfig, CrawlProgress, ProjectInfo } from '../../../shared/types';

interface Props {
  project: ProjectInfo | null;
  config: CrawlConfig | null;
  running: boolean;
  progress: CrawlProgress | null;
  onProjectOpened: (p: ProjectInfo | null) => void;
  onStart: (url: string) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onOpenSettings: () => void;
  onOpenApis: () => void;
  onExport: (format: 'csv' | 'xlsx') => void;
  onCompared: () => void;
}

interface MenuItem {
  label: string;
  hint?: string;
  divider?: boolean;
  onClick?: () => void;
}

/** Simple dropdown menu button (click to open, click-away or Esc to close). */
function MenuButton(props: {
  label: string;
  disabled: boolean;
  items: MenuItem[];
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        className={'btn btn-secondary ' + (open ? 'bg-slate-700' : '')}
        disabled={props.disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {props.label} ▾
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 bg-slate-800 border border-slate-600 rounded-md shadow-xl py-1">
          {props.items.map((item, i) =>
            item.divider ? (
              <div key={i} className="my-1 border-t border-slate-700" />
            ) : (
              <button
                key={i}
                className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 cursor-pointer"
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
              >
                {item.label}
                {item.hint && <span className="block text-xs text-slate-500">{item.hint}</span>}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

export default function Toolbar(props: Props): React.JSX.Element {
  const [url, setUrl] = useState('');
  const paused = props.progress?.phase === 'paused';
  const hasProject = props.project !== null;

  const siteBase = (): string | null => {
    const src = url.trim() || props.config?.startUrls[0] || '';
    try {
      return new URL(src).origin;
    } catch {
      return null;
    }
  };

  const runCompare = async (): Promise<void> => {
    const r = await window.pulse.runCompare();
    if (r.ok && r.summary) {
      const s = r.summary;
      window.alert(
        `Compared ${s.total} old URLs:\n` +
          `  OK: ${s.ok}\n  Redirected: ${s.redirected}\n` +
          `  Broken: ${s.broken}\n  Missing (need redirects): ${s.missing}`
      );
      props.onCompared();
    } else if (r.error) {
      window.alert(`Comparison failed: ${r.error}`);
    }
  };

  const exportRedirects = async (): Promise<void> => {
    const r = await window.pulse.exportRedirects();
    if (r.ok) {
      window.alert(
        `Redirect map written (${r.withTarget}/${r.total} with suggested targets):\n\n` +
          (r.files ?? []).join('\n')
      );
    } else if (r.error) {
      window.alert(`Redirect export failed: ${r.error}`);
    }
  };

  const generateReport = async (): Promise<void> => {
    const r = await window.pulse.generateReport();
    if (r.ok && r.path) window.alert(`Report saved:\n${r.path}`);
    else if (r.error) window.alert(`Report failed: ${r.error}`);
  };

  const bulkExport = async (format: 'csv' | 'xlsx'): Promise<void> => {
    const r = await window.pulse.exportAll(format);
    if (r.ok && r.path) {
      window.alert(
        format === 'xlsx'
          ? `Workbook saved (${r.sheets} sheets):\n${r.path}`
          : `${r.sheets} CSV files written to:\n${r.path}`
      );
    } else if (r.error) {
      window.alert(`Bulk export failed: ${r.error}`);
    }
  };

  const generateSitemap = async (): Promise<void> => {
    const base = siteBase();
    if (!base) {
      window.alert('Enter a valid site URL first.');
      return;
    }
    const r = await window.pulse.generateSitemap(base);
    if (r.ok) {
      window.alert(
        `Sitemap written: ${r.urlCount} URLs, ${r.imageCount} images.\n\n${(r.files ?? []).join('\n')}`
      );
    } else if (r.error) {
      window.alert(`Sitemap generation failed: ${r.error}`);
    }
  };

  if (url === '' && props.config && props.config.startUrls.length > 0) {
    // initialize once from saved config
    setUrl(props.config.startUrls.join(' '));
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 border-b border-slate-700">
      <span className="text-emerald-400 font-bold text-base tracking-tight mr-1">
        Pulse SEO<span className="text-slate-300 font-medium"> Pulse</span>
      </span>
      <button
        className="btn btn-secondary"
        onClick={() => window.pulse.newProject().then(props.onProjectOpened)}
        disabled={props.running}
      >
        New
      </button>
      <button
        className="btn btn-secondary"
        onClick={() => window.pulse.openProject().then(props.onProjectOpened)}
        disabled={props.running}
      >
        Open
      </button>
      <input
        className="input flex-1 min-w-40"
        placeholder={hasProject ? 'Enter URL to crawl (e.g. https://example.com)' : 'Create or open a project first'}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hasProject && !props.running && url.trim()) {
            props.onStart(url.trim());
          }
        }}
        disabled={!hasProject || props.running}
      />
      {!props.running ? (
        <button
          className="btn btn-primary"
          disabled={!hasProject || !url.trim()}
          onClick={() => props.onStart(url.trim())}
        >
          Start
        </button>
      ) : (
        <>
          {paused ? (
            <button className="btn btn-primary" onClick={props.onResume}>
              Resume
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={props.onPause}>
              Pause
            </button>
          )}
          <button className="btn btn-danger" onClick={props.onStop}>
            Stop
          </button>
        </>
      )}
      <button className="btn btn-secondary" onClick={props.onOpenSettings} disabled={!hasProject}>
        Settings
      </button>
      <button
        className="btn btn-secondary"
        onClick={props.onOpenApis}
        disabled={!hasProject || props.running}
        title="Search Console, GA4, PageSpeed and backlink imports"
      >
        APIs
      </button>
      <button
        className="btn btn-secondary"
        onClick={runCompare}
        disabled={!hasProject || props.running}
        title="Compare this crawl against an older .pulse crawl or a CSV of old URLs"
      >
        Compare
      </button>
      <MenuButton
        label="Export"
        disabled={!hasProject || props.running}
        items={[
          { label: 'Current view → CSV', onClick: () => props.onExport('csv') },
          { label: 'Current view → Excel', onClick: () => props.onExport('xlsx') },
          { divider: true, label: '' },
          {
            label: 'Everything → Excel workbook',
            hint: 'One sheet per view + issues summary',
            onClick: () => bulkExport('xlsx'),
          },
          {
            label: 'Everything → CSV folder',
            hint: 'One file per view',
            onClick: () => bulkExport('csv'),
          },
          { divider: true, label: '' },
          { label: 'Client report (DOCX)', hint: 'Branded crawl report', onClick: generateReport },
          { label: 'XML sitemap', onClick: generateSitemap },
          {
            label: 'Redirect map (.htaccess / nginx / WP)',
            hint: 'From Compare results',
            onClick: exportRedirects,
          },
        ]}
      />
    </div>
  );
}
