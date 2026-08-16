// Catalog of all SEO checks. Implementations live in sibling modules (run-all.ts
// wires them); this registry is also consumed by the UI for names/severities.

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface CheckDef {
  id: string;
  name: string;
  category: string;
  severity: Severity;
}

export const CHECKS: CheckDef[] = [
  // Response codes
  { id: 'response-broken-internal', name: 'Broken internal links (4xx)', category: 'Response', severity: 'high' },
  { id: 'response-broken-external', name: 'Broken external links (4xx)', category: 'Response', severity: 'medium' },
  { id: 'response-5xx', name: 'Server errors (5xx)', category: 'Response', severity: 'critical' },
  { id: 'response-no-response', name: 'Connection errors', category: 'Response', severity: 'high' },
  { id: 'response-redirect-chain', name: 'Redirect chains (>1 hop)', category: 'Response', severity: 'medium' },
  { id: 'response-redirect-loop', name: 'Redirect loops', category: 'Response', severity: 'high' },
  { id: 'response-302-internal', name: 'Internal temporary redirects (302/307)', category: 'Response', severity: 'low' },

  // Directives
  { id: 'directives-noindex', name: 'Noindex pages', category: 'Directives', severity: 'medium' },
  { id: 'directives-nofollow-page', name: 'Nofollow page directive', category: 'Directives', severity: 'medium' },
  { id: 'directives-robots-blocked', name: 'Blocked by robots.txt', category: 'Directives', severity: 'medium' },
  { id: 'directives-noindex-in-sitemap', name: 'Noindex URLs in sitemap', category: 'Directives', severity: 'high' },

  // Canonicals
  { id: 'canonical-missing', name: 'Missing canonical', category: 'Canonicals', severity: 'low' },
  { id: 'canonical-multiple-conflicting', name: 'Multiple conflicting canonicals', category: 'Canonicals', severity: 'high' },
  { id: 'canonical-conflict-header', name: 'HTML vs HTTP header canonical conflict', category: 'Canonicals', severity: 'high' },
  { id: 'canonical-to-non200', name: 'Canonical points to non-200 URL', category: 'Canonicals', severity: 'high' },
  { id: 'canonical-to-redirect', name: 'Canonical points to redirect', category: 'Canonicals', severity: 'medium' },
  { id: 'canonical-to-noindex', name: 'Canonical points to noindex URL', category: 'Canonicals', severity: 'high' },
  { id: 'canonical-unlinked', name: 'Canonical target not linked internally', category: 'Canonicals', severity: 'low' },

  // Titles
  { id: 'title-missing', name: 'Missing page title', category: 'Titles', severity: 'high' },
  { id: 'title-duplicate', name: 'Duplicate page titles', category: 'Titles', severity: 'medium' },
  { id: 'title-over-chars', name: 'Title over max characters', category: 'Titles', severity: 'low' },
  { id: 'title-under-chars', name: 'Title below min characters', category: 'Titles', severity: 'low' },
  { id: 'title-over-px', name: 'Title over max pixel width', category: 'Titles', severity: 'low' },
  { id: 'title-multiple', name: 'Multiple title tags', category: 'Titles', severity: 'medium' },

  // Meta descriptions
  { id: 'desc-missing', name: 'Missing meta description', category: 'Descriptions', severity: 'medium' },
  { id: 'desc-duplicate', name: 'Duplicate meta descriptions', category: 'Descriptions', severity: 'low' },
  { id: 'desc-over-chars', name: 'Description over max characters', category: 'Descriptions', severity: 'low' },
  { id: 'desc-under-chars', name: 'Description below min characters', category: 'Descriptions', severity: 'low' },
  { id: 'desc-over-px', name: 'Description over max pixel width', category: 'Descriptions', severity: 'low' },
  { id: 'desc-multiple', name: 'Multiple meta descriptions', category: 'Descriptions', severity: 'low' },

  // Headings
  { id: 'h1-missing', name: 'Missing H1', category: 'Headings', severity: 'medium' },
  { id: 'h1-multiple', name: 'Multiple H1s', category: 'Headings', severity: 'low' },
  { id: 'h1-duplicate', name: 'Duplicate H1s across pages', category: 'Headings', severity: 'low' },
  { id: 'h2-missing', name: 'Missing H2', category: 'Headings', severity: 'low' },

  // Images
  { id: 'img-missing-alt', name: 'Images missing alt text', category: 'Images', severity: 'medium' },
  { id: 'img-alt-long', name: 'Alt text over 100 characters', category: 'Images', severity: 'low' },
  { id: 'img-over-warn', name: 'Images over size warning threshold', category: 'Images', severity: 'low' },
  { id: 'img-over-critical', name: 'Images over critical size', category: 'Images', severity: 'medium' },
  { id: 'img-broken', name: 'Broken images', category: 'Images', severity: 'high' },
  { id: 'img-no-dimensions', name: 'Images missing width/height (CLS)', category: 'Images', severity: 'low' },

  // Content
  { id: 'content-thin', name: 'Thin content', category: 'Content', severity: 'medium' },
  { id: 'content-exact-duplicate', name: 'Exact duplicate pages', category: 'Content', severity: 'high' },
  { id: 'content-near-duplicate', name: 'Near-duplicate pages', category: 'Content', severity: 'medium' },
  { id: 'content-low-text-ratio', name: 'Low text-to-HTML ratio', category: 'Content', severity: 'low' },

  // URL structure
  { id: 'url-too-long', name: 'URL over max length', category: 'URL', severity: 'low' },
  { id: 'url-uppercase', name: 'Uppercase characters in URL', category: 'URL', severity: 'low' },
  { id: 'url-underscores', name: 'Underscores in URL', category: 'URL', severity: 'low' },
  { id: 'url-params', name: 'Parameters in indexable URLs', category: 'URL', severity: 'low' },
  { id: 'url-non-ascii', name: 'Non-ASCII characters in URL', category: 'URL', severity: 'low' },

  // Security
  { id: 'security-not-https', name: 'Pages served over HTTP', category: 'Security', severity: 'critical' },
  { id: 'security-http-links', name: 'HTTP links on HTTPS pages', category: 'Security', severity: 'medium' },
  { id: 'security-mixed-content', name: 'Mixed content (HTTP images)', category: 'Security', severity: 'high' },
  { id: 'security-missing-hsts', name: 'Missing HSTS header', category: 'Security', severity: 'low' },
  { id: 'security-missing-xcto', name: 'Missing X-Content-Type-Options', category: 'Security', severity: 'low' },
  { id: 'security-missing-xfo', name: 'Missing X-Frame-Options/frame-ancestors', category: 'Security', severity: 'low' },
  { id: 'security-missing-csp', name: 'Missing Content-Security-Policy', category: 'Security', severity: 'low' },
  { id: 'security-missing-referrer', name: 'Missing Referrer-Policy', category: 'Security', severity: 'low' },

  // Mobile / site
  { id: 'mobile-viewport-missing', name: 'Missing viewport meta tag', category: 'Mobile', severity: 'medium' },
  { id: 'site-deep-pages', name: 'Pages deeper than 3 clicks', category: 'Site', severity: 'low' },
  { id: 'site-ai-crawlers', name: 'AI crawler robots.txt status', category: 'Site', severity: 'info' },

  // Pagination
  { id: 'pagination-to-non200', name: 'Pagination link to non-200 URL', category: 'Pagination', severity: 'medium' },
  { id: 'pagination-canonicalised', name: 'Paginated page canonicalised elsewhere', category: 'Pagination', severity: 'low' },

  // Hreflang
  { id: 'hreflang-missing-return', name: 'Hreflang missing return links', category: 'Hreflang', severity: 'high' },
  { id: 'hreflang-invalid-code', name: 'Invalid hreflang language/region codes', category: 'Hreflang', severity: 'medium' },
  { id: 'hreflang-no-self', name: 'Hreflang missing self-reference', category: 'Hreflang', severity: 'low' },
  { id: 'hreflang-no-xdefault', name: 'Hreflang without x-default', category: 'Hreflang', severity: 'low' },
  { id: 'hreflang-to-broken', name: 'Hreflang points to non-200 URL', category: 'Hreflang', severity: 'medium' },

  // Structured data
  { id: 'sd-parse-error', name: 'Structured data parse errors', category: 'Structured Data', severity: 'high' },
  { id: 'sd-missing-required', name: 'Schema missing required properties', category: 'Structured Data', severity: 'high' },
  { id: 'sd-missing-recommended', name: 'Schema missing recommended properties', category: 'Structured Data', severity: 'low' },
  { id: 'sd-deprecated-type', name: 'Deprecated/restricted rich result types', category: 'Structured Data', severity: 'medium' },

  // Sitemaps
  { id: 'sitemap-non200', name: 'Non-200 URLs in sitemap', category: 'Sitemap', severity: 'medium' },
  { id: 'sitemap-noindex', name: 'Noindex URLs in sitemap', category: 'Sitemap', severity: 'medium' },
  { id: 'sitemap-canonicalised', name: 'Canonicalised URLs in sitemap', category: 'Sitemap', severity: 'low' },
  { id: 'sitemap-orphan', name: 'Orphan URLs (sitemap only)', category: 'Sitemap', severity: 'medium' },
  { id: 'sitemap-missing-indexable', name: 'Indexable pages missing from sitemap', category: 'Sitemap', severity: 'low' },

  // JS rendering
  { id: 'render-canonical-mismatch', name: 'Raw vs rendered canonical mismatch', category: 'Rendering', severity: 'high' },
  { id: 'render-robots-changed', name: 'JS modifies meta robots', category: 'Rendering', severity: 'high' },
  { id: 'render-title-changed', name: 'JS modifies page title', category: 'Rendering', severity: 'low' },
  { id: 'render-content-delta', name: 'Content only visible after JS', category: 'Rendering', severity: 'info' },
  { id: 'render-failed', name: 'Pages that failed to render', category: 'Rendering', severity: 'medium' },
  { id: 'render-console-errors', name: 'JS console errors during render', category: 'Rendering', severity: 'low' },

  // Accessibility (axe-core, only when the audit is enabled with JS rendering)
  { id: 'a11y-critical', name: 'Critical accessibility violations', category: 'Accessibility', severity: 'high' },
  { id: 'a11y-serious', name: 'Serious accessibility violations', category: 'Accessibility', severity: 'medium' },
  { id: 'a11y-minor', name: 'Moderate/minor accessibility violations', category: 'Accessibility', severity: 'low' },
];

export const CHECK_MAP: Record<string, CheckDef> = Object.fromEntries(
  CHECKS.map((c) => [c.id, c])
);

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 5,
  high: 3,
  medium: 1,
  low: 0.4,
  info: 0,
};
