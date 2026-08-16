// Tab and filter catalog shared by renderer (columns) and main (SQL mapping).

export interface TabColumn {
  key: string;
  label: string;
  width?: number;
  numeric?: boolean;
}

export interface TabFilter {
  id: string;
  label: string;
}

export interface TabDef {
  id: string;
  label: string;
  group: 'crawl' | 'onpage' | 'technical' | 'data' | 'api';
  columns: TabColumn[];
  filters: TabFilter[];
}

const URL_COL: TabColumn = { key: 'url', label: 'URL', width: 420 };
const STATUS_COLS: TabColumn[] = [
  { key: 'status', label: 'Status', width: 80, numeric: true },
  { key: 'status_text', label: 'Status Text', width: 130 },
];
const INDEX_COLS: TabColumn[] = [
  { key: 'indexable', label: 'Indexable', width: 90 },
  { key: 'indexability_reason', label: 'Indexability Reason', width: 150 },
];

export const TABS: TabDef[] = [
  {
    id: 'internal',
    label: 'Internal',
    group: 'crawl',
    columns: [
      URL_COL, ...STATUS_COLS, ...INDEX_COLS,
      { key: 'content_type', label: 'Content Type', width: 130 },
      { key: 'title', label: 'Title', width: 260 },
      { key: 'segment', label: 'Segment', width: 120 },
      { key: 'word_count', label: 'Words', width: 80, numeric: true },
      { key: 'depth', label: 'Depth', width: 70, numeric: true },
      { key: 'inlinks', label: 'Inlinks', width: 80, numeric: true },
      { key: 'outlinks', label: 'Outlinks', width: 85, numeric: true },
      { key: 'response_ms', label: 'Time (ms)', width: 90, numeric: true },
      { key: 'size', label: 'Size (B)', width: 90, numeric: true },
    ],
    filters: [
      { id: 'html', label: 'HTML' },
      { id: 'indexable', label: 'Indexable' },
      { id: 'non-indexable', label: 'Non-Indexable' },
      { id: 'rendered', label: 'JS Rendered' },
    ],
  },
  {
    id: 'visualization',
    label: 'Visualisation',
    group: 'crawl',
    columns: [URL_COL],
    filters: [],
  },
  {
    id: 'external',
    label: 'External',
    group: 'crawl',
    columns: [
      URL_COL, ...STATUS_COLS,
      { key: 'content_type', label: 'Content Type', width: 140 },
      { key: 'inlinks', label: 'Inlinks', width: 80, numeric: true },
      { key: 'crawl_source', label: 'First Found On', width: 320 },
    ],
    filters: [
      { id: 'broken', label: 'Broken (4xx/5xx)' },
      { id: 'redirect', label: 'Redirects' },
      { id: 'error', label: 'Connection Errors' },
    ],
  },
  {
    id: 'response_codes',
    label: 'Response Codes',
    group: 'technical',
    columns: [
      URL_COL, ...STATUS_COLS,
      { key: 'is_internal', label: 'Internal', width: 80 },
      { key: 'redirect_target', label: 'Redirect Target', width: 320 },
      { key: 'chain_length', label: 'Chain', width: 70, numeric: true },
      { key: 'redirect_chain', label: 'Redirect Chain', width: 340 },
      { key: 'crawl_source', label: 'First Found On', width: 300 },
    ],
    filters: [
      { id: 'success', label: '2xx Success' },
      { id: 'redirect', label: '3xx Redirect' },
      { id: 'redirect-chain', label: 'Redirect Chains' },
      { id: 'client-error', label: '4xx Client Error' },
      { id: 'server-error', label: '5xx Server Error' },
      { id: 'no-response', label: 'No Response' },
      { id: 'blocked', label: 'Blocked by robots.txt' },
    ],
  },
  {
    id: 'titles',
    label: 'Page Titles',
    group: 'onpage',
    columns: [
      URL_COL,
      { key: 'title', label: 'Title', width: 340 },
      { key: 'title_chars', label: 'Chars', width: 70, numeric: true },
      { key: 'title_px', label: 'Pixels', width: 75, numeric: true },
      { key: 'title_count', label: 'Count', width: 70, numeric: true },
      ...INDEX_COLS,
    ],
    filters: [
      { id: 'missing', label: 'Missing' },
      { id: 'duplicate', label: 'Duplicate' },
      { id: 'over-chars', label: 'Over 60 Characters' },
      { id: 'under-chars', label: 'Below 30 Characters' },
      { id: 'over-px', label: 'Over 600 Pixels' },
      { id: 'multiple', label: 'Multiple Titles' },
    ],
  },
  {
    id: 'meta_descriptions',
    label: 'Meta Descriptions',
    group: 'onpage',
    columns: [
      URL_COL,
      { key: 'meta_description', label: 'Meta Description', width: 400 },
      { key: 'desc_chars', label: 'Chars', width: 70, numeric: true },
      { key: 'meta_description_px', label: 'Pixels', width: 75, numeric: true },
      ...INDEX_COLS,
    ],
    filters: [
      { id: 'missing', label: 'Missing' },
      { id: 'duplicate', label: 'Duplicate' },
      { id: 'over-chars', label: 'Over 160 Characters' },
      { id: 'under-chars', label: 'Below 70 Characters' },
      { id: 'over-px', label: 'Over 920 Pixels' },
      { id: 'multiple', label: 'Multiple' },
    ],
  },
  {
    id: 'h1',
    label: 'H1',
    group: 'onpage',
    columns: [
      URL_COL,
      { key: 'h1_1', label: 'H1-1', width: 300 },
      { key: 'h1_2', label: 'H1-2', width: 220 },
      { key: 'h1_count', label: 'Count', width: 70, numeric: true },
    ],
    filters: [
      { id: 'missing', label: 'Missing' },
      { id: 'multiple', label: 'Multiple' },
      { id: 'duplicate', label: 'Duplicate' },
    ],
  },
  {
    id: 'h2',
    label: 'H2',
    group: 'onpage',
    columns: [
      URL_COL,
      { key: 'h2_1', label: 'H2-1', width: 300 },
      { key: 'h2_count', label: 'Count', width: 70, numeric: true },
    ],
    filters: [{ id: 'missing', label: 'Missing' }],
  },
  {
    id: 'content',
    label: 'Content',
    group: 'onpage',
    columns: [
      URL_COL,
      { key: 'word_count', label: 'Words', width: 90, numeric: true },
      { key: 'text_ratio', label: 'Text Ratio', width: 95, numeric: true },
      { key: 'content_hash', label: 'Hash', width: 130 },
      ...INDEX_COLS,
    ],
    filters: [
      { id: 'thin', label: 'Thin Content' },
      { id: 'exact-duplicate', label: 'Exact Duplicates' },
      { id: 'near-duplicate', label: 'Near Duplicates' },
    ],
  },
  {
    id: 'images',
    label: 'Images',
    group: 'onpage',
    columns: [
      { key: 'src', label: 'Image URL', width: 420 },
      { key: 'status', label: 'Status', width: 80, numeric: true },
      { key: 'bytes', label: 'Size (B)', width: 100, numeric: true },
      { key: 'content_type', label: 'Type', width: 120 },
      { key: 'refs', label: 'Pages', width: 80, numeric: true },
      { key: 'missing_alt', label: 'Missing Alt Refs', width: 130, numeric: true },
    ],
    filters: [
      { id: 'over-warn', label: 'Over 200 KB' },
      { id: 'over-critical', label: 'Over 500 KB' },
      { id: 'missing-alt', label: 'Missing Alt Text' },
      { id: 'broken', label: 'Broken (4xx/5xx)' },
    ],
  },
  {
    id: 'canonicals',
    label: 'Canonicals',
    group: 'technical',
    columns: [
      URL_COL,
      { key: 'canonical', label: 'Canonical', width: 380 },
      { key: 'canonical_header', label: 'HTTP Canonical', width: 240 },
      ...INDEX_COLS,
    ],
    filters: [
      { id: 'missing', label: 'Missing' },
      { id: 'self', label: 'Self Referencing' },
      { id: 'canonicalised', label: 'Canonicalised' },
      { id: 'multiple', label: 'Multiple/Conflicting' },
    ],
  },
  {
    id: 'directives',
    label: 'Directives',
    group: 'technical',
    columns: [
      URL_COL,
      { key: 'meta_robots', label: 'Meta Robots', width: 220 },
      { key: 'x_robots', label: 'X-Robots-Tag', width: 180 },
      ...INDEX_COLS,
    ],
    filters: [
      { id: 'noindex', label: 'Noindex' },
      { id: 'nofollow', label: 'Nofollow' },
      { id: 'blocked', label: 'Blocked by robots.txt' },
    ],
  },
  {
    id: 'hreflang',
    label: 'Hreflang',
    group: 'technical',
    columns: [
      URL_COL,
      { key: 'hreflang_count', label: 'Hreflang Tags', width: 120, numeric: true },
      { key: 'langs', label: 'Languages', width: 300 },
    ],
    filters: [{ id: 'with', label: 'Contains Hreflang' }],
  },
  {
    id: 'structured_data',
    label: 'Structured Data',
    group: 'technical',
    columns: [
      URL_COL,
      { key: 'sd_count', label: 'Items', width: 75, numeric: true },
      { key: 'sd_types', label: 'Types', width: 300 },
      { key: 'sd_errors', label: 'Errors', width: 80, numeric: true },
      { key: 'sd_warnings', label: 'Warnings', width: 90, numeric: true },
    ],
    filters: [
      { id: 'with', label: 'Contains Structured Data' },
      { id: 'missing', label: 'Missing' },
      { id: 'errors', label: 'Validation Errors' },
      { id: 'warnings', label: 'Warnings' },
    ],
  },
  {
    id: 'sitemaps',
    label: 'Sitemaps',
    group: 'technical',
    columns: [
      URL_COL,
      { key: 'sitemap', label: 'In Sitemap', width: 300 },
      { key: 'status', label: 'Status', width: 80, numeric: true },
      { key: 'indexable', label: 'Indexable', width: 90 },
    ],
    filters: [
      { id: 'in-sitemap', label: 'URLs in Sitemap' },
      { id: 'orphan', label: 'Orphans (sitemap only)' },
      { id: 'not-in-sitemap', label: 'Indexable, Not in Sitemap' },
      { id: 'non-indexable', label: 'Non-Indexable in Sitemap' },
    ],
  },
  {
    id: 'js_rendering',
    label: 'JS Rendering',
    group: 'technical',
    columns: [
      URL_COL,
      { key: 'spa_framework', label: 'Framework', width: 140 },
      { key: 'title_changed', label: 'Title Changed', width: 110 },
      { key: 'canonical_changed', label: 'Canonical Changed', width: 140 },
      { key: 'robots_changed', label: 'Robots Changed', width: 130 },
      { key: 'word_delta', label: 'Word Δ', width: 90, numeric: true },
      { key: 'render_links', label: 'JS-only Links', width: 110, numeric: true },
      { key: 'console_error_count', label: 'JS Errors', width: 90, numeric: true },
      { key: 'render_error', label: 'Render Error', width: 200 },
    ],
    filters: [
      { id: 'rendered', label: 'Rendered' },
      { id: 'changed', label: 'JS Changed Content' },
      { id: 'canonical-mismatch', label: 'Canonical Mismatch' },
      { id: 'js-errors', label: 'JS Console Errors' },
      { id: 'spa', label: 'SPA Framework Detected' },
      { id: 'render-failed', label: 'Render Failed' },
    ],
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    group: 'technical',
    columns: [
      URL_COL,
      { key: 'a11y_total', label: 'Violations', width: 100, numeric: true },
      { key: 'a11y_critical', label: 'Critical', width: 85, numeric: true },
      { key: 'a11y_serious', label: 'Serious', width: 85, numeric: true },
      { key: 'a11y_moderate', label: 'Moderate', width: 90, numeric: true },
      { key: 'a11y_minor', label: 'Minor', width: 80, numeric: true },
    ],
    filters: [
      { id: 'with-violations', label: 'With Violations' },
      { id: 'critical', label: 'Critical' },
      { id: 'serious', label: 'Serious' },
      { id: 'clean', label: 'Audited, No Violations' },
    ],
  },
  {
    id: 'extraction',
    label: 'Extraction',
    group: 'data',
    columns: [
      URL_COL,
      { key: 'extractor', label: 'Extractor', width: 160 },
      { key: 'value', label: 'Value', width: 460 },
    ],
    filters: [],
  },
  {
    id: 'search',
    label: 'Search',
    group: 'data',
    columns: [
      URL_COL,
      { key: 'search_name', label: 'Search', width: 180 },
      { key: 'hits', label: 'Hits', width: 80, numeric: true },
    ],
    filters: [
      { id: 'contains', label: 'Contains' },
      { id: 'not-contains', label: 'Does Not Contain' },
    ],
  },
  {
    id: 'compare',
    label: 'Compare',
    group: 'data',
    columns: [
      { key: 'url', label: 'Old URL', width: 360 },
      { key: 'result', label: 'Result', width: 100 },
      { key: 'matched_url', label: 'New URL', width: 320 },
      { key: 'old_status', label: 'Old Status', width: 95, numeric: true },
      { key: 'new_status', label: 'New Status', width: 100, numeric: true },
      { key: 'redirect_target', label: 'Redirects To', width: 280 },
      { key: 'title_changed', label: 'Title Δ', width: 80 },
      { key: 'canonical_changed', label: 'Canonical Δ', width: 105 },
    ],
    filters: [
      { id: 'ok', label: 'OK (200)' },
      { id: 'redirected', label: 'Redirected (3xx → 200)' },
      { id: 'broken', label: 'Broken' },
      { id: 'missing', label: 'Missing (needs redirect)' },
      { id: 'title-changed', label: 'Title Changed' },
      { id: 'canonical-changed', label: 'Canonical Changed' },
    ],
  },
  {
    id: 'gsc',
    label: 'Search Console',
    group: 'api',
    columns: [
      URL_COL,
      { key: 'clicks', label: 'Clicks', width: 90, numeric: true },
      { key: 'impressions', label: 'Impressions', width: 110, numeric: true },
      { key: 'ctr', label: 'CTR %', width: 80, numeric: true },
      { key: 'position', label: 'Position', width: 90, numeric: true },
    ],
    filters: [
      { id: 'with-data', label: 'With GSC Data' },
      { id: 'orphan', label: 'GSC Orphans (not crawled)' },
      { id: 'no-data', label: 'Crawled, No GSC Data' },
    ],
  },
  {
    id: 'ga4',
    label: 'GA4',
    group: 'api',
    columns: [
      URL_COL,
      { key: 'sessions', label: 'Sessions', width: 95, numeric: true },
      { key: 'engaged_sessions', label: 'Engaged', width: 90, numeric: true },
      { key: 'engagement_rate', label: 'Eng. Rate', width: 95, numeric: true },
      { key: 'conversions', label: 'Conversions', width: 105, numeric: true },
      { key: 'total_users', label: 'Users', width: 85, numeric: true },
    ],
    filters: [{ id: 'with-data', label: 'With GA4 Data' }],
  },
  {
    id: 'psi',
    label: 'PageSpeed',
    group: 'api',
    columns: [
      URL_COL,
      { key: 'performance', label: 'Perf', width: 70, numeric: true },
      { key: 'lcp_ms', label: 'LCP (lab)', width: 95, numeric: true },
      { key: 'cls', label: 'CLS (lab)', width: 90, numeric: true },
      { key: 'field_lcp_ms', label: 'LCP (field)', width: 100, numeric: true },
      { key: 'field_inp_ms', label: 'INP (field)', width: 100, numeric: true },
      { key: 'field_cls', label: 'CLS (field)', width: 95, numeric: true },
      { key: 'seo', label: 'SEO', width: 65, numeric: true },
    ],
    filters: [
      { id: 'with-data', label: 'With PSI Data' },
      { id: 'poor-lcp', label: 'Poor LCP (>2.5s)' },
      { id: 'poor-inp', label: 'Poor INP (>200ms)' },
      { id: 'poor-cls', label: 'Poor CLS (>0.1)' },
    ],
  },
  {
    id: 'backlinks',
    label: 'Backlinks',
    group: 'api',
    columns: [
      URL_COL,
      { key: 'provider', label: 'Provider', width: 100 },
      { key: 'domain_rating', label: 'DR', width: 70, numeric: true },
      { key: 'url_rating', label: 'UR', width: 70, numeric: true },
      { key: 'ref_domains', label: 'Ref Domains', width: 110, numeric: true },
      { key: 'backlinks', label: 'Backlinks', width: 100, numeric: true },
    ],
    filters: [{ id: 'with-data', label: 'With Backlink Data' }],
  },
];

export function tabById(id: string): TabDef | undefined {
  return TABS.find((t) => t.id === id);
}
