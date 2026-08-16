// Browser-safe schema constants: pure data, no better-sqlite3 import, so the
// PWA (sql.js) and the desktop app share one source of truth.

export const SCHEMA_VERSION = 4;

// Columns added after v1; applied via ALTER TABLE so existing .pulse files upgrade in place.
export const PAGES_MIGRATIONS: [column: string, ddl: string][] = [
  ['rel_next', 'ALTER TABLE pages ADD COLUMN rel_next TEXT'],
  ['rel_prev', 'ALTER TABLE pages ADD COLUMN rel_prev TEXT'],
  ['segment', 'ALTER TABLE pages ADD COLUMN segment TEXT'],
  ['console_errors', 'ALTER TABLE pages ADD COLUMN console_errors TEXT'],
  ['a11y_violations', 'ALTER TABLE pages ADD COLUMN a11y_violations TEXT'],
];

export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    is_internal INTEGER NOT NULL DEFAULT 1,
    fetched INTEGER NOT NULL DEFAULT 0,
    status INTEGER,
    status_text TEXT,
    error TEXT,
    content_type TEXT,
    depth INTEGER,
    size INTEGER,
    response_ms INTEGER,
    redirect_target TEXT,
    redirect_chain TEXT,
    title TEXT,
    title_px INTEGER,
    title_count INTEGER,
    meta_description TEXT,
    meta_description_px INTEGER,
    meta_description_count INTEGER,
    meta_robots TEXT,
    x_robots TEXT,
    canonical TEXT,
    canonical_all TEXT,
    canonical_header TEXT,
    viewport TEXT,
    h1 TEXT,
    h2 TEXT,
    word_count INTEGER,
    text_ratio REAL,
    indexable INTEGER,
    indexability_reason TEXT,
    content_hash TEXT,
    simhash TEXT,
    headers TEXT,
    og TEXT,
    spa_framework TEXT,
    in_sitemap INTEGER DEFAULT 0,
    crawl_source TEXT,
    raw_html BLOB,
    rendered_html BLOB,
    rendered INTEGER NOT NULL DEFAULT 0,
    render_error TEXT,
    rendered_title TEXT,
    rendered_meta_description TEXT,
    rendered_canonical TEXT,
    rendered_meta_robots TEXT,
    rendered_h1 TEXT,
    rendered_word_count INTEGER,
    robots_blocked INTEGER DEFAULT 0,
    rel_next TEXT,
    rel_prev TEXT,
    segment TEXT,
    console_errors TEXT,
    a11y_violations TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS idx_pages_status ON pages(status)',
  'CREATE INDEX IF NOT EXISTS idx_pages_internal ON pages(is_internal, fetched)',
  'CREATE INDEX IF NOT EXISTS idx_pages_title ON pages(title)',
  'CREATE INDEX IF NOT EXISTS idx_pages_hash ON pages(content_hash)',
  'CREATE INDEX IF NOT EXISTS idx_pages_desc ON pages(meta_description)',
  `CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY,
    src_id INTEGER NOT NULL,
    dst_url TEXT NOT NULL,
    dst_id INTEGER,
    anchor TEXT,
    rel TEXT,
    follow INTEGER NOT NULL DEFAULT 1,
    link_type TEXT NOT NULL DEFAULT 'ahref',
    is_internal INTEGER NOT NULL DEFAULT 1,
    from_render INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS idx_links_src ON links(src_id)',
  'CREATE INDEX IF NOT EXISTS idx_links_dst ON links(dst_id)',
  'CREATE INDEX IF NOT EXISTS idx_links_dsturl ON links(dst_url)',
  `CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY,
    src TEXT NOT NULL UNIQUE,
    is_internal INTEGER NOT NULL DEFAULT 1,
    bytes INTEGER,
    status INTEGER,
    content_type TEXT,
    checked INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS image_refs (
    id INTEGER PRIMARY KEY,
    page_id INTEGER NOT NULL,
    image_id INTEGER NOT NULL,
    alt TEXT,
    has_dimensions INTEGER DEFAULT 0,
    loading TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS idx_imgrefs_page ON image_refs(page_id)',
  'CREATE INDEX IF NOT EXISTS idx_imgrefs_img ON image_refs(image_id)',
  `CREATE TABLE IF NOT EXISTS hreflang (
    id INTEGER PRIMARY KEY,
    page_id INTEGER NOT NULL,
    lang TEXT NOT NULL,
    href TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'link'
  )`,
  'CREATE INDEX IF NOT EXISTS idx_hreflang_page ON hreflang(page_id)',
  `CREATE TABLE IF NOT EXISTS structured_data (
    id INTEGER PRIMARY KEY,
    page_id INTEGER NOT NULL,
    format TEXT NOT NULL,
    type TEXT,
    json TEXT,
    errors TEXT,
    warnings TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS idx_sd_page ON structured_data(page_id)',
  `CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY,
    check_id TEXT NOT NULL,
    page_id INTEGER,
    detail TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS idx_issues_check ON issues(check_id)',
  'CREATE INDEX IF NOT EXISTS idx_issues_page ON issues(page_id)',
  `CREATE TABLE IF NOT EXISTS extractions (
    id INTEGER PRIMARY KEY,
    page_id INTEGER NOT NULL,
    extractor_id TEXT NOT NULL,
    value TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS idx_extract_page ON extractions(page_id)',
  `CREATE TABLE IF NOT EXISTS search_hits (
    id INTEGER PRIMARY KEY,
    page_id INTEGER NOT NULL,
    search_id TEXT NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS idx_search_page ON search_hits(page_id)',
  `CREATE TABLE IF NOT EXISTS sitemap_urls (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL,
    sitemap TEXT NOT NULL,
    lastmod TEXT,
    UNIQUE(url, sitemap)
  )`,
  `CREATE TABLE IF NOT EXISTS queue (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    depth INTEGER NOT NULL DEFAULT 0,
    source TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS api_gsc (
    url TEXT PRIMARY KEY,
    clicks INTEGER, impressions INTEGER, ctr REAL, position REAL,
    fetched_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS api_ga4 (
    url TEXT PRIMARY KEY,
    sessions INTEGER, engaged_sessions INTEGER, engagement_rate REAL,
    conversions REAL, total_users INTEGER,
    fetched_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS api_psi (
    url TEXT PRIMARY KEY,
    strategy TEXT,
    performance INTEGER, seo INTEGER, accessibility INTEGER, best_practices INTEGER,
    lcp_ms REAL, inp_ms REAL, cls REAL,
    field_lcp_ms REAL, field_inp_ms REAL, field_cls REAL,
    fetched_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS backlinks (
    url TEXT PRIMARY KEY,
    provider TEXT,
    domain_rating REAL, url_rating REAL, ref_domains INTEGER, backlinks INTEGER,
    imported_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS compare_results (
    id INTEGER PRIMARY KEY,
    old_url TEXT NOT NULL UNIQUE,
    old_status INTEGER,
    old_title TEXT,
    matched_url TEXT,
    match_type TEXT NOT NULL,
    new_status INTEGER,
    new_title TEXT,
    redirect_target TEXT,
    redirect_ok INTEGER NOT NULL DEFAULT 0,
    result TEXT NOT NULL,
    title_changed INTEGER NOT NULL DEFAULT 0,
    canonical_changed INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS idx_compare_result ON compare_results(result)',
];
