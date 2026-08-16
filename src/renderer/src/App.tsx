import { useCallback, useEffect, useRef, useState } from 'react';
import type { CrawlConfig, CrawlProgress, OverviewCounts, ProjectInfo } from '../../shared/types';
import Toolbar from './components/Toolbar';
import TabBar from './components/TabBar';
import ResultsGrid from './components/ResultsGrid';
import Visualization from './components/Visualization';
import OverviewSidebar from './components/OverviewSidebar';
import DetailsPane from './components/DetailsPane';
import StatusBar from './components/StatusBar';
import ConfigDialog from './components/ConfigDialog';
import ApiDialog from './components/ApiDialog';

export default function App(): React.JSX.Element {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [config, setConfig] = useState<CrawlConfig | null>(null);
  const [progress, setProgress] = useState<CrawlProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [activeTab, setActiveTab] = useState('internal');
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [overview, setOverview] = useState<OverviewCounts | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showConfig, setShowConfig] = useState(false);
  const [showApis, setShowApis] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const lastLiveRefresh = useRef(0);

  const refreshOverview = useCallback(async () => {
    try {
      setOverview(await window.pulse.overview());
    } catch {
      setOverview(null);
    }
  }, []);

  // Restore any project + crawl state on mount.
  useEffect(() => {
    (async () => {
      const p = await window.pulse.currentProject();
      if (p) {
        setProject(p);
        setConfig(p.config);
        await refreshOverview();
      }
      const status = await window.pulse.crawlStatus();
      setRunning(status.running);
      if (status.running) setProgress(status.progress);
    })().catch(() => undefined);
  }, [refreshOverview]);

  // Crawl event subscriptions.
  useEffect(() => {
    const offProgress = window.pulse.onCrawlProgress((p) => {
      setProgress(p);
      // Live-refresh the grid periodically while crawling.
      const now = Date.now();
      if (now - lastLiveRefresh.current > 4000) {
        lastLiveRefresh.current = now;
        setRefreshKey((k) => k + 1);
      }
    });
    const offDone = window.pulse.onCrawlDone((p) => {
      setProgress(p);
      setRunning(false);
      setRefreshKey((k) => k + 1);
      refreshOverview().catch(() => undefined);
    });
    return () => {
      offProgress();
      offDone();
    };
  }, [refreshOverview]);

  const handleProjectOpened = useCallback(
    async (p: ProjectInfo | null) => {
      if (!p) return;
      setProject(p);
      setConfig(p.config);
      setSelectedUrl(null);
      setRefreshKey((k) => k + 1);
      await refreshOverview();
    },
    [refreshOverview]
  );

  const startCrawl = useCallback(
    async (startUrl: string) => {
      if (!project || !config) return;
      const urls = startUrl
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (/^https?:\/\//i.test(s) ? s : 'https://' + s));
      if (urls.length === 0) return;
      const cfg: CrawlConfig = { ...config, startUrls: urls };
      setConfig(cfg);
      try {
        await window.pulse.startCrawl(cfg);
        setRunning(true);
        setSelectedUrl(null);
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      }
    },
    [project, config]
  );

  const navigate = useCallback((tab: string, filter: string | null) => {
    setActiveTab(tab);
    setActiveFilter(filter);
    setSelectedUrl(null);
  }, []);

  // Escape closes the details pane.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSelectedUrl(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <Toolbar
        project={project}
        config={config}
        running={running}
        progress={progress}
        onProjectOpened={handleProjectOpened}
        onStart={startCrawl}
        onPause={() => window.pulse.pauseCrawl()}
        onResume={() => window.pulse.resumeCrawl()}
        onStop={() => window.pulse.stopCrawl()}
        onOpenSettings={() => setShowConfig(true)}
        onOpenApis={() => setShowApis(true)}
        onCompared={() => {
          setRefreshKey((k) => k + 1);
          navigate('compare', null);
        }}
        onExport={(format) =>
          window.pulse
            .exportView(
              { tab: activeTab, filterId: activeFilter, search: search || null, sortCol: null, sortDir: null },
              format,
              `${activeTab}${activeFilter ? '-' + activeFilter : ''}`
            )
            .then((r) => {
              if (r.ok && r.path) alert(`Exported to ${r.path}`);
              else if (r.error) alert(`Export failed: ${r.error}`);
            })
        }
      />
      {!project && (
        <div className="flex-1 flex items-center justify-center bg-slate-950">
          <div className="text-center max-w-md">
            <div className="text-3xl font-bold tracking-tight mb-1">
              <span className="text-emerald-400">Pulse SEO</span>
              <span className="text-slate-300"> Pulse</span>
            </div>
            <div className="text-slate-500 mb-6">Desktop SEO crawler &amp; site auditor</div>
            <div className="flex gap-3 justify-center">
              <button
                className="btn btn-primary px-6 py-2"
                onClick={() => window.pulse.newProject().then(handleProjectOpened)}
              >
                New project
              </button>
              <button
                className="btn btn-secondary px-6 py-2"
                onClick={() => window.pulse.openProject().then(handleProjectOpened)}
              >
                Open project
              </button>
            </div>
            <div className="text-xs text-slate-600 mt-6">
              A project is a single <span className="font-mono">.pulse</span> file — crawl data,
              config and API imports all live inside it.
            </div>
          </div>
        </div>
      )}
      {project && (
      <div className="flex flex-1 min-h-0">
        <div className="flex flex-col flex-1 min-w-0">
          <TabBar
            activeTab={activeTab}
            activeFilter={activeFilter}
            search={search}
            onNavigate={navigate}
            onSearch={setSearch}
          />
          <div className="flex-1 min-h-0">
            {activeTab === 'visualization' ? (
              <Visualization refreshKey={refreshKey} onSelectUrl={setSelectedUrl} />
            ) : (
              <ResultsGrid
                tab={activeTab}
                filterId={activeFilter}
                search={search}
                refreshKey={refreshKey}
                onSelectUrl={setSelectedUrl}
              />
            )}
          </div>
          {detailsOpen && selectedUrl && (
            <DetailsPane url={selectedUrl} onClose={() => setSelectedUrl(null)} />
          )}
        </div>
        <OverviewSidebar
          overview={overview}
          onNavigate={navigate}
          onRefresh={refreshOverview}
        />
      </div>
      )}
      <StatusBar project={project} progress={progress} running={running} />
      {showConfig && config && (
        <ConfigDialog
          config={config}
          onClose={() => setShowConfig(false)}
          onSave={async (c) => {
            setConfig(c);
            await window.pulse.setConfig(c);
            setShowConfig(false);
          }}
        />
      )}
      {showApis && (
        <ApiDialog
          onClose={() => setShowApis(false)}
          onDataChanged={() => {
            setRefreshKey((k) => k + 1);
            refreshOverview().catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}
