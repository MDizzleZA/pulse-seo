// Tab -> SQL query builder, shared by the desktop reader (better-sqlite3)
// and the PWA viewer (sql.js). Pure string building: no driver imports.

export const INTERNAL_HTML_200 =
  "pages.is_internal = 1 AND pages.fetched = 1 AND pages.status = 200 AND pages.content_type LIKE '%html%'";

export const INLINKS_SUB = '(SELECT COUNT(*) FROM links l WHERE l.dst_id = pages.id) AS inlinks';
export const OUTLINKS_SUB = '(SELECT COUNT(*) FROM links l WHERE l.src_id = pages.id) AS outlinks';
export const INDEXABLE_CASE =
  "CASE WHEN pages.indexable = 1 THEN 'Yes' WHEN pages.indexable = 0 THEN 'No' ELSE '' END AS indexable";

export interface BuiltQuery {
  select: string;
  from: string;
  where: string[];
  params: unknown[];
  searchExpr: string; // column expression the free-text search applies to
}

export function buildTabQuery(tabId: string, filterId: string | null): BuiltQuery | null {
  const where: string[] = [];
  const params: unknown[] = [];
  let select = '';
  let from = 'pages';
  let searchExpr = 'pages.url';

  const dupSubquery = (col: string): string =>
    `pages.${col} IS NOT NULL AND pages.${col} <> '' AND pages.${col} IN (
      SELECT ${col} FROM pages WHERE ${INTERNAL_HTML_200} AND ${col} IS NOT NULL AND ${col} <> ''
      GROUP BY ${col} HAVING COUNT(*) > 1)`;

  // Generic issue-membership filter usable on any pages-based tab.
  const applyIssueFilter = (): boolean => {
    if (filterId && filterId.startsWith('issue:')) {
      where.push('pages.id IN (SELECT page_id FROM issues WHERE check_id = ?)');
      params.push(filterId.slice(6));
      return true;
    }
    return false;
  };

  switch (tabId) {
    case 'internal': {
      select = `pages.url, pages.status, pages.status_text, ${INDEXABLE_CASE},
        pages.indexability_reason, pages.content_type, pages.title, pages.segment,
        pages.word_count, pages.depth, ${INLINKS_SUB}, ${OUTLINKS_SUB},
        pages.response_ms, pages.size`;
      where.push('pages.is_internal = 1 AND pages.fetched >= 1');
      if (!applyIssueFilter()) {
        if (filterId === 'html') where.push("pages.content_type LIKE '%html%'");
        else if (filterId === 'indexable') where.push('pages.indexable = 1');
        else if (filterId === 'non-indexable')
          where.push('(pages.indexable = 0 OR pages.indexable IS NULL)');
        else if (filterId === 'rendered') where.push('pages.rendered = 1');
      }
      break;
    }
    case 'external': {
      select = `pages.url, pages.status, pages.status_text, pages.content_type,
        (SELECT COUNT(*) FROM links l WHERE l.dst_url = pages.url) AS inlinks, pages.crawl_source`;
      where.push('pages.is_internal = 0');
      if (!applyIssueFilter()) {
        if (filterId === 'broken') where.push('pages.status >= 400');
        else if (filterId === 'redirect') where.push('pages.status BETWEEN 300 AND 399');
        else if (filterId === 'error') where.push('pages.fetched = 2');
      }
      break;
    }
    case 'response_codes': {
      select = `pages.url, pages.status, pages.status_text,
        CASE pages.is_internal WHEN 1 THEN 'Yes' ELSE 'No' END AS is_internal,
        pages.redirect_target,
        json_array_length(COALESCE(pages.redirect_chain, '[]')) AS chain_length,
        pages.redirect_chain,
        pages.crawl_source`;
      where.push('pages.fetched >= 1');
      if (!applyIssueFilter()) {
        if (filterId === 'success') where.push('pages.status BETWEEN 200 AND 299');
        else if (filterId === 'redirect') where.push('pages.status BETWEEN 300 AND 399');
        else if (filterId === 'redirect-chain')
          where.push("json_array_length(COALESCE(pages.redirect_chain, '[]')) > 1");
        else if (filterId === 'client-error') where.push('pages.status BETWEEN 400 AND 499');
        else if (filterId === 'server-error') where.push('pages.status >= 500');
        else if (filterId === 'no-response') where.push('pages.fetched = 2');
        else if (filterId === 'blocked') where.push('pages.fetched = 3');
      }
      break;
    }
    case 'titles': {
      select = `pages.url, pages.title, LENGTH(COALESCE(pages.title,'')) AS title_chars,
        pages.title_px, pages.title_count, ${INDEXABLE_CASE}, pages.indexability_reason`;
      where.push(INTERNAL_HTML_200);
      if (!applyIssueFilter()) {
        if (filterId === 'missing') where.push("(pages.title IS NULL OR pages.title = '')");
        else if (filterId === 'duplicate') where.push(dupSubquery('title'));
        else if (filterId === 'over-chars') where.push('LENGTH(COALESCE(pages.title,"")) > 60');
        else if (filterId === 'under-chars')
          where.push("pages.title IS NOT NULL AND pages.title <> '' AND LENGTH(pages.title) < 30");
        else if (filterId === 'over-px') where.push('pages.title_px > 600');
        else if (filterId === 'multiple') where.push('pages.title_count > 1');
      }
      break;
    }
    case 'meta_descriptions': {
      select = `pages.url, pages.meta_description,
        LENGTH(COALESCE(pages.meta_description,'')) AS desc_chars,
        pages.meta_description_px, ${INDEXABLE_CASE}, pages.indexability_reason`;
      where.push(INTERNAL_HTML_200);
      if (!applyIssueFilter()) {
        if (filterId === 'missing')
          where.push("(pages.meta_description IS NULL OR pages.meta_description = '')");
        else if (filterId === 'duplicate') where.push(dupSubquery('meta_description'));
        else if (filterId === 'over-chars')
          where.push('LENGTH(COALESCE(pages.meta_description,"")) > 160');
        else if (filterId === 'under-chars')
          where.push(
            "pages.meta_description IS NOT NULL AND pages.meta_description <> '' AND LENGTH(pages.meta_description) < 70"
          );
        else if (filterId === 'over-px') where.push('pages.meta_description_px > 920');
        else if (filterId === 'multiple') where.push('pages.meta_description_count > 1');
      }
      break;
    }
    case 'h1': {
      select = `pages.url, json_extract(pages.h1, '$[0]') AS h1_1,
        json_extract(pages.h1, '$[1]') AS h1_2,
        json_array_length(COALESCE(pages.h1, '[]')) AS h1_count`;
      where.push(INTERNAL_HTML_200);
      if (!applyIssueFilter()) {
        if (filterId === 'missing')
          where.push("(pages.h1 IS NULL OR json_array_length(pages.h1) = 0)");
        else if (filterId === 'multiple')
          where.push("json_array_length(COALESCE(pages.h1, '[]')) > 1");
        else if (filterId === 'duplicate')
          where.push(`json_extract(pages.h1, '$[0]') IS NOT NULL AND json_extract(pages.h1, '$[0]') IN (
            SELECT json_extract(h1, '$[0]') FROM pages
            WHERE ${INTERNAL_HTML_200} AND h1 IS NOT NULL AND json_array_length(h1) > 0
            GROUP BY json_extract(h1, '$[0]') HAVING COUNT(*) > 1)`);
      }
      break;
    }
    case 'h2': {
      select = `pages.url, json_extract(pages.h2, '$[0]') AS h2_1,
        json_array_length(COALESCE(pages.h2, '[]')) AS h2_count`;
      where.push(INTERNAL_HTML_200);
      if (!applyIssueFilter()) {
        if (filterId === 'missing')
          where.push("(pages.h2 IS NULL OR json_array_length(pages.h2) = 0)");
      }
      break;
    }
    case 'content': {
      select = `pages.url, pages.word_count, ROUND(COALESCE(pages.text_ratio,0), 3) AS text_ratio,
        pages.content_hash, ${INDEXABLE_CASE}, pages.indexability_reason`;
      where.push(INTERNAL_HTML_200);
      if (!applyIssueFilter()) {
        if (filterId === 'thin')
          where.push("pages.id IN (SELECT page_id FROM issues WHERE check_id = 'content-thin')");
        else if (filterId === 'exact-duplicate')
          where.push(`pages.content_hash IS NOT NULL AND pages.content_hash IN (
            SELECT content_hash FROM pages WHERE ${INTERNAL_HTML_200} AND content_hash IS NOT NULL
            GROUP BY content_hash HAVING COUNT(*) > 1)`);
        else if (filterId === 'near-duplicate')
          where.push(
            "pages.id IN (SELECT page_id FROM issues WHERE check_id = 'content-near-duplicate')"
          );
      }
      break;
    }
    case 'images': {
      from = 'images';
      searchExpr = 'images.src';
      select = `images.src, images.status, images.bytes, images.content_type,
        (SELECT COUNT(*) FROM image_refs r WHERE r.image_id = images.id) AS refs,
        (SELECT COUNT(*) FROM image_refs r WHERE r.image_id = images.id
          AND (r.alt IS NULL OR r.alt = '')) AS missing_alt`;
      where.push('1 = 1');
      if (filterId === 'over-warn') where.push('images.bytes >= 204800');
      else if (filterId === 'over-critical') where.push('images.bytes >= 512000');
      else if (filterId === 'missing-alt')
        where.push(`(SELECT COUNT(*) FROM image_refs r WHERE r.image_id = images.id
          AND (r.alt IS NULL OR r.alt = '')) > 0`);
      else if (filterId === 'broken') where.push('images.status >= 400');
      break;
    }
    case 'canonicals': {
      select = `pages.url, pages.canonical, pages.canonical_header, ${INDEXABLE_CASE},
        pages.indexability_reason`;
      where.push(INTERNAL_HTML_200);
      if (!applyIssueFilter()) {
        if (filterId === 'missing')
          where.push('pages.canonical IS NULL AND pages.canonical_header IS NULL');
        else if (filterId === 'self') where.push('pages.canonical = pages.url');
        else if (filterId === 'canonicalised')
          where.push('pages.canonical IS NOT NULL AND pages.canonical <> pages.url');
        else if (filterId === 'multiple')
          where.push(`(pages.canonical_all IS NOT NULL OR
            (pages.canonical IS NOT NULL AND pages.canonical_header IS NOT NULL
             AND pages.canonical <> pages.canonical_header))`);
      }
      break;
    }
    case 'directives': {
      select = `pages.url, pages.meta_robots, pages.x_robots, ${INDEXABLE_CASE},
        pages.indexability_reason`;
      where.push('pages.is_internal = 1 AND pages.fetched >= 1');
      if (!applyIssueFilter()) {
        if (filterId === 'noindex')
          where.push(`(LOWER(COALESCE(pages.meta_robots,'')) LIKE '%noindex%'
            OR LOWER(COALESCE(pages.x_robots,'')) LIKE '%noindex%')`);
        else if (filterId === 'nofollow')
          where.push(`(LOWER(COALESCE(pages.meta_robots,'')) LIKE '%nofollow%'
            OR LOWER(COALESCE(pages.x_robots,'')) LIKE '%nofollow%')`);
        else if (filterId === 'blocked') where.push('pages.fetched = 3');
      }
      break;
    }
    case 'hreflang': {
      select = `pages.url,
        (SELECT COUNT(*) FROM hreflang h WHERE h.page_id = pages.id) AS hreflang_count,
        (SELECT GROUP_CONCAT(DISTINCT lang) FROM hreflang h WHERE h.page_id = pages.id) AS langs`;
      where.push(INTERNAL_HTML_200);
      if (!applyIssueFilter()) {
        if (filterId === 'with')
          where.push('(SELECT COUNT(*) FROM hreflang h WHERE h.page_id = pages.id) > 0');
      }
      break;
    }
    case 'structured_data': {
      select = `pages.url,
        (SELECT COUNT(*) FROM structured_data sd WHERE sd.page_id = pages.id) AS sd_count,
        (SELECT GROUP_CONCAT(DISTINCT type) FROM structured_data sd WHERE sd.page_id = pages.id) AS sd_types,
        (SELECT COALESCE(SUM(json_array_length(COALESCE(sd.errors,'[]'))),0)
          FROM structured_data sd WHERE sd.page_id = pages.id) AS sd_errors,
        (SELECT COALESCE(SUM(json_array_length(COALESCE(sd.warnings,'[]'))),0)
          FROM structured_data sd WHERE sd.page_id = pages.id) AS sd_warnings`;
      where.push(INTERNAL_HTML_200);
      if (!applyIssueFilter()) {
        if (filterId === 'with')
          where.push('(SELECT COUNT(*) FROM structured_data sd WHERE sd.page_id = pages.id) > 0');
        else if (filterId === 'missing')
          where.push('(SELECT COUNT(*) FROM structured_data sd WHERE sd.page_id = pages.id) = 0');
        else if (filterId === 'errors')
          where.push(`(SELECT COALESCE(SUM(json_array_length(COALESCE(sd.errors,'[]'))),0)
            FROM structured_data sd WHERE sd.page_id = pages.id) > 0`);
        else if (filterId === 'warnings')
          where.push(`(SELECT COALESCE(SUM(json_array_length(COALESCE(sd.warnings,'[]'))),0)
            FROM structured_data sd WHERE sd.page_id = pages.id) > 0`);
      }
      break;
    }
    case 'sitemaps': {
      if (filterId === 'not-in-sitemap') {
        select = `pages.url, '' AS sitemap, pages.status, ${INDEXABLE_CASE}`;
        from = 'pages';
        where.push(`${INTERNAL_HTML_200} AND pages.indexable = 1 AND pages.in_sitemap = 0`);
      } else if (filterId === 'orphan') {
        select = `su.url AS url, su.sitemap AS sitemap, p.status,
          CASE WHEN p.indexable = 1 THEN 'Yes' WHEN p.indexable = 0 THEN 'No' ELSE '' END AS indexable`;
        from = 'sitemap_urls su LEFT JOIN pages p ON p.url = su.url';
        searchExpr = 'su.url';
        where.push('(p.id IS NULL OR p.fetched = 0)');
      } else if (filterId === 'non-indexable') {
        select = `su.url AS url, su.sitemap AS sitemap, p.status,
          CASE WHEN p.indexable = 1 THEN 'Yes' ELSE 'No' END AS indexable`;
        from = 'sitemap_urls su JOIN pages p ON p.url = su.url';
        searchExpr = 'su.url';
        where.push('p.indexable = 0');
      } else {
        select = `su.url AS url, su.sitemap AS sitemap, p.status,
          CASE WHEN p.indexable = 1 THEN 'Yes' WHEN p.indexable = 0 THEN 'No' ELSE '' END AS indexable`;
        from = 'sitemap_urls su LEFT JOIN pages p ON p.url = su.url';
        searchExpr = 'su.url';
        where.push('1 = 1');
      }
      break;
    }
    case 'js_rendering': {
      const titleChanged = `(pages.rendered = 1 AND COALESCE(pages.rendered_title,'') <> COALESCE(pages.title,''))`;
      const canonChanged = `(pages.rendered = 1 AND COALESCE(pages.rendered_canonical,'') <> COALESCE(pages.canonical,''))`;
      const robotsChanged = `(pages.rendered = 1 AND COALESCE(pages.rendered_meta_robots,'') <> COALESCE(pages.meta_robots,''))`;
      select = `pages.url, pages.spa_framework,
        CASE WHEN ${titleChanged} THEN 'Yes' ELSE '' END AS title_changed,
        CASE WHEN ${canonChanged} THEN 'Yes' ELSE '' END AS canonical_changed,
        CASE WHEN ${robotsChanged} THEN 'Yes' ELSE '' END AS robots_changed,
        CASE WHEN pages.rendered = 1
          THEN COALESCE(pages.rendered_word_count,0) - COALESCE(pages.word_count,0)
          ELSE NULL END AS word_delta,
        (SELECT COUNT(*) FROM links l WHERE l.src_id = pages.id AND l.from_render = 1) AS render_links,
        json_array_length(COALESCE(pages.console_errors, '[]')) AS console_error_count,
        pages.render_error`;
      where.push(INTERNAL_HTML_200);
      if (!applyIssueFilter()) {
        if (filterId === 'rendered') where.push('pages.rendered = 1');
        else if (filterId === 'changed')
          where.push(`(${titleChanged} OR ${canonChanged} OR ${robotsChanged}
            OR (SELECT COUNT(*) FROM links l WHERE l.src_id = pages.id AND l.from_render = 1) > 0)`);
        else if (filterId === 'canonical-mismatch')
          where.push(`pages.rendered = 1 AND pages.rendered_canonical IS NOT NULL
            AND COALESCE(pages.canonical,'') <> pages.rendered_canonical`);
        else if (filterId === 'js-errors')
          where.push("json_array_length(COALESCE(pages.console_errors, '[]')) > 0");
        else if (filterId === 'spa') where.push('pages.spa_framework IS NOT NULL');
        else if (filterId === 'render-failed') where.push('pages.rendered = 2');
      }
      break;
    }
    case 'accessibility': {
      const impactCount = (impact: string): string =>
        `(SELECT COUNT(*) FROM json_each(COALESCE(pages.a11y_violations, '[]')) je
          WHERE json_extract(je.value, '$.impact') = '${impact}')`;
      select = `pages.url,
        json_array_length(COALESCE(pages.a11y_violations, '[]')) AS a11y_total,
        ${impactCount('critical')} AS a11y_critical,
        ${impactCount('serious')} AS a11y_serious,
        ${impactCount('moderate')} AS a11y_moderate,
        ${impactCount('minor')} AS a11y_minor`;
      where.push(`${INTERNAL_HTML_200} AND pages.rendered = 1`);
      if (!applyIssueFilter()) {
        if (filterId === 'with-violations')
          where.push("json_array_length(COALESCE(pages.a11y_violations, '[]')) > 0");
        else if (filterId === 'critical') where.push(`${impactCount('critical')} > 0`);
        else if (filterId === 'serious') where.push(`${impactCount('serious')} > 0`);
        else if (filterId === 'clean')
          where.push("json_array_length(COALESCE(pages.a11y_violations, '[]')) = 0");
      }
      break;
    }
    case 'extraction': {
      select = 'p.url AS url, e.extractor_id AS extractor, e.value AS value';
      from = 'extractions e JOIN pages p ON p.id = e.page_id';
      searchExpr = 'p.url';
      where.push('1 = 1');
      break;
    }
    case 'search': {
      select = 'p.url AS url, sh.search_id AS search_name, sh.hits AS hits';
      from = 'search_hits sh JOIN pages p ON p.id = sh.page_id';
      searchExpr = 'p.url';
      if (filterId === 'contains') where.push('sh.hits > 0');
      else if (filterId === 'not-contains') where.push('sh.hits = 0');
      else where.push('1 = 1');
      break;
    }
    case 'compare': {
      select = `c.old_url AS url, c.result, c.matched_url, c.old_status, c.new_status,
        c.redirect_target,
        CASE c.title_changed WHEN 1 THEN 'Yes' ELSE '' END AS title_changed,
        CASE c.canonical_changed WHEN 1 THEN 'Yes' ELSE '' END AS canonical_changed`;
      from = 'compare_results c';
      searchExpr = 'c.old_url';
      if (filterId === 'ok') where.push("c.result = 'ok'");
      else if (filterId === 'redirected') where.push("c.result = 'redirected'");
      else if (filterId === 'broken') where.push("c.result = 'broken'");
      else if (filterId === 'missing') where.push("c.result = 'missing'");
      else if (filterId === 'title-changed') where.push('c.title_changed = 1');
      else if (filterId === 'canonical-changed') where.push('c.canonical_changed = 1');
      else where.push('1 = 1');
      break;
    }
    case 'gsc': {
      if (filterId === 'orphan') {
        select = 'g.url AS url, g.clicks, g.impressions, g.ctr, g.position';
        from = 'api_gsc g LEFT JOIN pages p ON p.url = g.url';
        searchExpr = 'g.url';
        where.push('p.id IS NULL');
      } else {
        select = 'pages.url, g.clicks, g.impressions, g.ctr, g.position';
        from = 'pages LEFT JOIN api_gsc g ON g.url = pages.url';
        where.push('pages.is_internal = 1 AND pages.fetched = 1');
        if (filterId === 'with-data') where.push('g.url IS NOT NULL');
        else if (filterId === 'no-data') where.push('g.url IS NULL');
      }
      break;
    }
    case 'ga4': {
      select = `pages.url, a.sessions, a.engaged_sessions, a.engagement_rate,
        a.conversions, a.total_users`;
      from = 'pages LEFT JOIN api_ga4 a ON a.url = pages.url';
      where.push('pages.is_internal = 1 AND pages.fetched = 1');
      if (filterId === 'with-data') where.push('a.url IS NOT NULL');
      break;
    }
    case 'psi': {
      select = `pages.url, ps.performance, ps.lcp_ms, ps.cls, ps.field_lcp_ms,
        ps.field_inp_ms, ps.field_cls, ps.seo`;
      from = 'pages LEFT JOIN api_psi ps ON ps.url = pages.url';
      where.push('pages.is_internal = 1 AND pages.fetched = 1');
      if (filterId === 'with-data') where.push('ps.url IS NOT NULL');
      else if (filterId === 'poor-lcp') where.push('COALESCE(ps.field_lcp_ms, ps.lcp_ms) > 2500');
      else if (filterId === 'poor-inp') where.push('ps.field_inp_ms > 200');
      else if (filterId === 'poor-cls') where.push('COALESCE(ps.field_cls, ps.cls) > 0.1');
      break;
    }
    case 'backlinks': {
      select = `pages.url, b.provider, b.domain_rating, b.url_rating, b.ref_domains,
        b.backlinks`;
      from = 'pages LEFT JOIN backlinks b ON b.url = pages.url';
      where.push('pages.is_internal = 1 AND pages.fetched = 1');
      if (filterId === 'with-data') where.push('b.url IS NOT NULL');
      break;
    }
    default:
      return null;
  }

  return { select, from, where, params, searchExpr };
}
