import { contextBridge, ipcRenderer } from 'electron';
import type {
  CrawlConfig, CrawlProgress, ProjectInfo, QueryRequest, QueryResponse,
  PageDetail, OverviewCounts, GraphData, IntegrationStatus, ApiConfig,
  ApiRunSummary, ApiProgress, CompareRunResult,
} from '../shared/types';

const api = {
  newProject: (): Promise<ProjectInfo | null> => ipcRenderer.invoke('dialog:newProject'),
  openProject: (): Promise<ProjectInfo | null> => ipcRenderer.invoke('dialog:openProject'),
  currentProject: (): Promise<ProjectInfo | null> => ipcRenderer.invoke('project:current'),
  closeProject: (): Promise<boolean> => ipcRenderer.invoke('project:close'),

  getConfig: (): Promise<CrawlConfig> => ipcRenderer.invoke('config:get'),
  setConfig: (config: CrawlConfig): Promise<boolean> => ipcRenderer.invoke('config:set', config),

  startCrawl: (config: CrawlConfig): Promise<boolean> => ipcRenderer.invoke('crawl:start', config),
  pauseCrawl: (): Promise<void> => ipcRenderer.invoke('crawl:pause'),
  resumeCrawl: (): Promise<void> => ipcRenderer.invoke('crawl:resume'),
  stopCrawl: (): Promise<void> => ipcRenderer.invoke('crawl:stop'),
  crawlStatus: (): Promise<{ running: boolean; progress: CrawlProgress }> =>
    ipcRenderer.invoke('crawl:status'),

  queryRows: (req: QueryRequest): Promise<QueryResponse> => ipcRenderer.invoke('query:rows', req),
  queryRowsLive: (req: QueryRequest): Promise<QueryResponse> =>
    ipcRenderer.invoke('query:rowsLive', req),
  overview: (): Promise<OverviewCounts> => ipcRenderer.invoke('query:overview'),
  graph: (nodeCap?: number): Promise<GraphData> => ipcRenderer.invoke('query:graph', nodeCap),
  pageDetail: (url: string): Promise<PageDetail> => ipcRenderer.invoke('query:detail', url),
  htmlSource: (url: string, which: 'raw' | 'rendered'): Promise<string | null> =>
    ipcRenderer.invoke('query:htmlSource', url, which),
  listChecks: (): Promise<{ id: string; name: string; category: string; severity: string }[]> =>
    ipcRenderer.invoke('checks:list'),

  exportView: (
    req: Omit<QueryRequest, 'offset' | 'limit'>,
    format: 'csv' | 'xlsx',
    name: string
  ): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('export:view', { ...req, offset: 0, limit: 100 }, format, name),

  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),

  exportAll: (
    format: 'csv' | 'xlsx'
  ): Promise<{ ok: boolean; path?: string; sheets?: number; error?: string }> =>
    ipcRenderer.invoke('export:all', format),

  generateReport: (): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('report:generate'),

  exportRedirects: (): Promise<{
    ok: boolean; files?: string[]; total?: number; withTarget?: number; error?: string;
  }> => ipcRenderer.invoke('redirects:export'),

  generateSitemap: (
    baseUrl: string
  ): Promise<{
    ok: boolean;
    files?: string[];
    urlCount?: number;
    imageCount?: number;
    error?: string;
  }> => ipcRenderer.invoke('sitemap:generate', baseUrl),

  onCrawlProgress: (cb: (p: CrawlProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: CrawlProgress): void => cb(p);
    ipcRenderer.on('crawl:progress', listener);
    return () => ipcRenderer.removeListener('crawl:progress', listener);
  },
  onCrawlDone: (cb: (p: CrawlProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: CrawlProgress): void => cb(p);
    ipcRenderer.on('crawl:done', listener);
    return () => ipcRenderer.removeListener('crawl:done', listener);
  },
  onCrawlLog: (cb: (line: string) => void): (() => void) => {
    const listener = (_e: unknown, line: string): void => cb(line);
    ipcRenderer.on('crawl:log', listener);
    return () => ipcRenderer.removeListener('crawl:log', listener);
  },

  // ---- API integrations ----------------------------------------------------
  apiStatus: (): Promise<IntegrationStatus> => ipcRenderer.invoke('api:status'),
  getApiConfig: (): Promise<ApiConfig> => ipcRenderer.invoke('api:config:get'),
  setApiConfig: (config: ApiConfig): Promise<boolean> =>
    ipcRenderer.invoke('api:config:set', config),
  setPsiKey: (key: string): Promise<boolean> => ipcRenderer.invoke('api:psi:setKey', key),
  setGoogleClient: (clientId: string, clientSecret: string): Promise<boolean> =>
    ipcRenderer.invoke('api:google:setClient', clientId, clientSecret),
  googleConnect: (): Promise<{ ok: boolean; email?: string; error?: string }> =>
    ipcRenderer.invoke('api:google:connect'),
  googleDisconnect: (): Promise<boolean> => ipcRenderer.invoke('api:google:disconnect'),
  gscSites: (): Promise<{ siteUrl: string; permissionLevel: string }[]> =>
    ipcRenderer.invoke('api:gsc:sites'),
  runGsc: (property: string, days: number): Promise<ApiRunSummary> =>
    ipcRenderer.invoke('api:gsc:run', property, days),
  runGa4: (property: string, days: number): Promise<ApiRunSummary> =>
    ipcRenderer.invoke('api:ga4:run', property, days),
  runPsi: (strategy: 'mobile' | 'desktop', maxUrls: number): Promise<ApiRunSummary> =>
    ipcRenderer.invoke('api:psi:run', strategy, maxUrls),
  importBacklinks: (): Promise<ApiRunSummary> => ipcRenderer.invoke('api:backlinks:import'),
  runCompare: (): Promise<CompareRunResult> => ipcRenderer.invoke('compare:run'),
  onApiProgress: (cb: (p: ApiProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: ApiProgress): void => cb(p);
    ipcRenderer.on('api:progress', listener);
    return () => ipcRenderer.removeListener('api:progress', listener);
  },
};

export type PulseApi = typeof api;

contextBridge.exposeInMainWorld('pulse', api);
