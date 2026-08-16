import type { CrawlProgress, ProjectInfo } from '../../../shared/types';

interface Props {
  project: ProjectInfo | null;
  progress: CrawlProgress | null;
  running: boolean;
}

const PHASE_LABEL: Record<string, string> = {
  idle: 'Idle',
  crawling: 'Crawling',
  rendering: 'Rendering JavaScript',
  analysis: 'Analysing',
  done: 'Crawl complete',
  paused: 'Paused',
  stopped: 'Stopped',
  error: 'Error',
};

export default function StatusBar(props: Props): React.JSX.Element {
  const p = props.progress;
  const pct = p && p.total > 0 ? Math.min(100, Math.round((p.crawled / p.total) * 100)) : 0;

  return (
    <div className="flex items-center gap-3 px-3 py-1 bg-slate-900 border-t border-slate-700 text-xs text-slate-400">
      <span
        className={
          p?.phase === 'error'
            ? 'text-red-400'
            : props.running
              ? 'text-emerald-400'
              : 'text-slate-400'
        }
      >
        {p ? PHASE_LABEL[p.phase] ?? p.phase : 'Ready'}
      </span>
      {p && (
        <>
          <span>
            {p.crawled} crawled · {p.queued} queued · {p.errors} errors · {p.urlsPerSec}/s
          </span>
          <div className="w-40 h-1.5 bg-slate-800 rounded">
            <div className="h-1.5 bg-emerald-600 rounded" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-slate-500 w-9">{pct}%</span>
          {p.message && <span className="text-slate-500">{p.message}</span>}
          {p.currentUrl && props.running && (
            <span className="truncate max-w-96 text-slate-600">{p.currentUrl}</span>
          )}
        </>
      )}
      <div className="flex-1" />
      <span className="text-slate-500 truncate max-w-96">
        {props.project ? props.project.path : 'No project open'}
      </span>
    </div>
  );
}
