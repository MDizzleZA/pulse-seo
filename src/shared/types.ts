// Shared types across main, crawler worker, and renderer.

export interface Extractor {
  id: string;
  name: string;
  type: 'css' | 'xpath' | 'regex';
  expression: string;
  /** For css/xpath: which part to extract. */
  extract: 'text' | 'html' | 'attr';
  attribute?: string;
}

export interface CustomSearch {
  id: string;
  name: string;
  pattern: string;
  isRegex: boolean;
}

export interface CustomHeader {
  name: string;
  value: string;
}

/** URL pattern group (blog vs product vs landing pages). First match wins. */
export interface Segment {
  id: string;
  name: string;
  pattern: string; // regex tested against the full URL
}

export interface CrawlConfig {
  startUrls: string[];
  mode: 'spider' | 'list';
  listUrls: string[];
  maxUrls: number; // 0 = unlimited
  maxDepth: number; // 0 = unlimited
  includePatterns: string[]; // regex; if non-empty a URL must match at least one
  excludePatterns: string[]; // regex; URL matching any is skipped
  crawlSubdomains: boolean;
  queryParams: 'crawl' | 'strip' | 'stripSelected';
  stripParams: string[];
  respectRobots: boolean;
  respectNofollow: boolean;
  concurrency: number;
  delayMs: number;
  userAgent: string;
  /** HTTP Basic auth for the crawl (staging sites). Empty = off. */
  basicAuthUser: string;
  basicAuthPass: string;
  /** Extra request headers sent with every request (WAF bypass tokens, cookies, etc.). */
  customHeaders: CustomHeader[];
  renderJs: boolean;
  renderWaitMs: number;
  renderConcurrency: number;
  /** Run an axe-core accessibility audit on each rendered page (needs renderJs). */
  a11yAudit: boolean;
  checkExternalLinks: boolean;
  checkImages: boolean;
  storeHtml: boolean;
  wordCountMin: number;
  nearDupThreshold: number; // 0..1 similarity above which pages are near-duplicates
  imgWarnBytes: number;
  imgCriticalBytes: number;
  maxTitleChars: number;
  minTitleChars: number;
  maxTitlePx: number;
  maxDescChars: number;
  minDescChars: number;
  maxDescPx: number;
  maxUrlLength: number;
  extractors: Extractor[];
  customSearches: CustomSearch[];
  segments: Segment[];
  /** Canvas-measured character widths keyed by font spec, sent from renderer. */
  charWidths?: Record<string, Record<string, number>>;
}

export const DEFAULT_CONFIG: CrawlConfig = {
  startUrls: [],
  mode: 'spider',
  listUrls: [],
  maxUrls: 10000,
  maxDepth: 0,
  includePatterns: [],
  excludePatterns: [],
  crawlSubdomains: false,
  queryParams: 'crawl',
  stripParams: [],
  respectRobots: true,
  respectNofollow: true,
  concurrency: 5,
  delayMs: 0,
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 pulse-seo/1.0',
  basicAuthUser: '',
  basicAuthPass: '',
  customHeaders: [],
  renderJs: false,
  renderWaitMs: 2000,
  renderConcurrency: 3,
  a11yAudit: false,
  checkExternalLinks: true,
  checkImages: true,
  storeHtml: true,
  wordCountMin: 200,
  nearDupThreshold: 0.9,
  imgWarnBytes: 200 * 1024,
  imgCriticalBytes: 500 * 1024,
  maxTitleChars: 60,
  minTitleChars: 30,
  maxTitlePx: 600,
  maxDescChars: 160,
  minDescChars: 70,
  maxDescPx: 920,
  maxUrlLength: 100,
  extractors: [],
  customSearches: [],
  segments: [],
};

export type CrawlPhase =
  | 'idle'
  | 'crawling'
  | 'rendering'
  | 'analysis'
  | 'done'
  | 'paused'
  | 'stopped'
  | 'error';

export interface CrawlProgress {
  phase: CrawlPhase;
  crawled: number;
  queued: number;
  errors: number;
  total: number;
  urlsPerSec: number;
  currentUrl: string;
  message?: string;
}

export interface PageRow {
  id: number;
  url: string;
  is_internal: number;
  fetched: number;
  status: number | null;
  status_text: string | null;
  error: string | null;
  content_type: string | null;
  depth: number | null;
  size: number | null;
  response_ms: number | null;
  redirect_target: string | null;
  redirect_chain: string | null;
  title: string | null;
  title_px: number | null;
  title_count: number | null;
  meta_description: string | null;
  meta_description_px: number | null;
  meta_robots: string | null;
  x_robots: string | null;
  canonical: string | null;
  canonical_header: string | null;
  h1: string | null;
  h2: string | null;
  word_count: number | null;
  indexable: number | null;
  indexability_reason: string | null;
  inlinks: number;
  outlinks: number;
  spa_framework: string | null;
  in_sitemap: number | null;
  crawl_source: string | null;
  headers: string | null;
  rel_next: string | null;
  rel_prev: string | null;
  content_hash: string | null;
  segment: string | null;
  console_errors: string | null;
  a11y_violations: string | null;
}

export interface IssueSummaryRow {
  check_id: string;
  name: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  count: number;
}

export interface QueryRequest {
  tab: string;
  filterId: string | null;
  search: string | null;
  sortCol: string | null;
  sortDir: 'asc' | 'desc' | null;
  offset: number;
  limit: number;
}

export interface QueryResponse {
  rows: Record<string, unknown>[];
  total: number;
}

export interface GraphNode {
  id: number;
  url: string;
  path: string;
  depth: number | null;
  status: number | null;
  indexable: number | null;
  inlinks: number;
  outlinks: number;
  sourceUrl: string | null;
}

export interface GraphEdge {
  source: number;
  target: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

export interface PageDetail {
  page: PageRow | null;
  inlinks: { src: string; anchor: string; rel: string; follow: number }[];
  outlinks: { dst: string; anchor: string; rel: string; follow: number; is_internal: number }[];
  images: { src: string; alt: string | null; bytes: number | null; status: number | null }[];
  hreflang: { lang: string; href: string; source: string }[];
  structured: { format: string; type: string; errors: string; warnings: string; json: string }[];
  issues: { check_id: string; name: string; severity: string; detail: string }[];
  duplicates: { url: string; kind: 'exact' | 'near'; similarity: number | null }[];
  extractions: { extractor_id: string; name: string; value: string }[];
  searchHits: { search_id: string; name: string; hits: number }[];
  gsc?: Record<string, unknown> | null;
  ga4?: Record<string, unknown> | null;
  psi?: Record<string, unknown> | null;
}

export interface OverviewCounts {
  tabs: Record<string, { total: number; filters: Record<string, number> }>;
  issues: IssueSummaryRow[];
  health: { category: string; score: number }[];
  crawlInfo: { pages: number; internal: number; external: number; indexable: number };
}

export interface ProjectInfo {
  path: string;
  name: string;
  config: CrawlConfig;
  lastCrawl: string | null;
  pageCount: number;
}

export interface A11yViolation {
  id: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
  help: string;
  nodes: number;
  sample: string; // first offending CSS selector
}

export interface RenderResult {
  ok: boolean;
  html: string;
  error?: string;
  /** JS console errors captured while the page rendered (capped). */
  consoleErrors?: string[];
  /** axe-core violations, when the accessibility audit is enabled. */
  a11y?: A11yViolation[];
}

export interface CompareSummary {
  total: number;
  ok: number;
  redirected: number;
  broken: number;
  missing: number;
}

export interface CompareRunResult {
  ok: boolean;
  source?: string;
  summary?: CompareSummary;
  error?: string;
}

export interface GscConfig {
  property: string;
  days: number;
}

export interface IntegrationStatus {
  googleAuthed: boolean;
  googleEmail?: string;
  googleClientSet: boolean;
  psiKeySet: boolean;
}

/** Non-secret API settings, persisted in the project's meta table. */
export interface ApiConfig {
  gscProperty: string;
  gscDays: number;
  ga4Property: string;
  ga4Days: number;
  psiStrategy: 'mobile' | 'desktop';
  psiMaxUrls: number;
}

export const DEFAULT_API_CONFIG: ApiConfig = {
  gscProperty: '',
  gscDays: 90,
  ga4Property: '',
  ga4Days: 90,
  psiStrategy: 'mobile',
  psiMaxUrls: 25,
};

export interface ApiRunSummary {
  ok: boolean;
  written: number;
  /** GSC URLs with no crawled page / GA4 paths with no URL match. */
  unmatched?: number;
  failed?: number;
  provider?: string;
  error?: string;
}

export interface ApiProgress {
  kind: 'psi' | 'gsc' | 'ga4';
  done: number;
  total: number;
  message?: string;
}

// SERP pixel measurement font specs
export const TITLE_FONT = '20px Arial';
export const DESC_FONT = '14px Arial';
