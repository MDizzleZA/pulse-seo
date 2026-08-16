import { TABS, tabById } from '../../../shared/tabs';

interface Props {
  activeTab: string;
  activeFilter: string | null;
  search: string;
  onNavigate: (tab: string, filter: string | null) => void;
  onSearch: (s: string) => void;
}

export default function TabBar(props: Props): React.JSX.Element {
  const tab = tabById(props.activeTab);
  const isIssueFilter = props.activeFilter?.startsWith('issue:') ?? false;

  return (
    <div className="bg-slate-900 border-b border-slate-700">
      <div className="flex items-center overflow-x-auto whitespace-nowrap px-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={
              'px-3 py-1.5 text-sm border-b-2 transition-colors cursor-pointer ' +
              (t.id === props.activeTab
                ? 'border-emerald-500 text-emerald-300'
                : 'border-transparent text-slate-400 hover:text-slate-200')
            }
            onClick={() => props.onNavigate(t.id, null)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <select
          className="input py-1"
          value={isIssueFilter ? '' : (props.activeFilter ?? '')}
          onChange={(e) => props.onNavigate(props.activeTab, e.target.value || null)}
        >
          <option value="">All</option>
          {tab?.filters.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        {isIssueFilter && (
          <span className="text-xs px-2 py-1 rounded bg-amber-900/60 text-amber-200">
            Issue filter: {props.activeFilter!.slice(6)}
            <button
              className="ml-2 text-amber-400 hover:text-amber-100 cursor-pointer"
              onClick={() => props.onNavigate(props.activeTab, null)}
            >
              ✕
            </button>
          </span>
        )}
        <input
          className="input flex-1 max-w-md py-1"
          placeholder="Filter URLs contains…"
          value={props.search}
          onChange={(e) => props.onSearch(e.target.value)}
        />
      </div>
    </div>
  );
}
