import type Database from 'better-sqlite3';
import { gzipSync } from 'zlib';
import type { FetchResult } from './fetcher';
import type { ParsedPage } from './parse';

/** Prepared-statement layer used by the crawler worker (write connection). */
export class DbWriter {
  private db: Database.Database;
  private insertPageStmt: Database.Statement;
  private updateFetchedStmt: Database.Statement;
  private updateErrorStmt: Database.Statement;
  private updateSkippedStmt: Database.Statement;
  private insertLinkStmt: Database.Statement;
  private insertImageStmt: Database.Statement;
  private getImageIdStmt: Database.Statement;
  private insertImageRefStmt: Database.Statement;
  private insertHreflangStmt: Database.Statement;
  private insertSdStmt: Database.Statement;
  private insertSitemapUrlStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;
    this.insertPageStmt = db.prepare(
      `INSERT INTO pages (url, is_internal, fetched, depth, crawl_source)
       VALUES (?, ?, 0, ?, ?)
       ON CONFLICT(url) DO NOTHING`
    );
    this.updateFetchedStmt = db.prepare(
      `UPDATE pages SET
        fetched = 1, status = ?, status_text = ?, error = NULL, content_type = ?,
        size = ?, response_ms = ?, redirect_target = ?, redirect_chain = ?,
        title = ?, title_px = ?, title_count = ?,
        meta_description = ?, meta_description_px = ?, meta_description_count = ?,
        meta_robots = ?, x_robots = ?, canonical = ?, canonical_all = ?, canonical_header = ?,
        viewport = ?, h1 = ?, h2 = ?, word_count = ?, text_ratio = ?,
        indexable = ?, indexability_reason = ?, content_hash = ?, simhash = ?,
        headers = ?, og = ?, spa_framework = ?, rel_next = ?, rel_prev = ?, raw_html = ?
       WHERE id = ?`
    );
    this.updateErrorStmt = db.prepare(
      `UPDATE pages SET fetched = 2, error = ?, status = ?, status_text = ?,
        redirect_chain = ?, redirect_target = ?, response_ms = ? WHERE id = ?`
    );
    this.updateSkippedStmt = db.prepare(
      `UPDATE pages SET fetched = 3, robots_blocked = 1, indexable = 0,
        indexability_reason = 'Blocked by robots.txt' WHERE id = ?`
    );
    this.insertLinkStmt = db.prepare(
      `INSERT INTO links (src_id, dst_url, anchor, rel, follow, link_type, is_internal, from_render)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this.insertImageStmt = db.prepare(
      `INSERT INTO images (src, is_internal) VALUES (?, ?) ON CONFLICT(src) DO NOTHING`
    );
    this.getImageIdStmt = db.prepare('SELECT id FROM images WHERE src = ?');
    this.insertImageRefStmt = db.prepare(
      `INSERT INTO image_refs (page_id, image_id, alt, has_dimensions, loading)
       VALUES (?, ?, ?, ?, ?)`
    );
    this.insertHreflangStmt = db.prepare(
      `INSERT INTO hreflang (page_id, lang, href, source) VALUES (?, ?, ?, ?)`
    );
    this.insertSdStmt = db.prepare(
      `INSERT INTO structured_data (page_id, format, type, json) VALUES (?, ?, ?, ?)`
    );
    this.insertSitemapUrlStmt = db.prepare(
      `INSERT INTO sitemap_urls (url, sitemap, lastmod) VALUES (?, ?, ?)
       ON CONFLICT(url, sitemap) DO NOTHING`
    );
  }

  /** Insert a discovered URL if new; returns its page id. */
  ensurePage(url: string, isInternal: boolean, depth: number, source: string | null): number {
    this.insertPageStmt.run(url, isInternal ? 1 : 0, depth, source);
    const row = this.db.prepare('SELECT id FROM pages WHERE url = ?').get(url) as { id: number };
    return row.id;
  }

  pageIdOf(url: string): number | null {
    const row = this.db.prepare('SELECT id FROM pages WHERE url = ?').get(url) as
      | { id: number }
      | undefined;
    return row?.id ?? null;
  }

  writeFetchedPage(
    pageId: number,
    fetch: FetchResult,
    parsed: ParsedPage | null,
    indexable: boolean,
    indexabilityReason: string | null,
    storeHtml: boolean
  ): void {
    const rawHtml =
      storeHtml && fetch.body && fetch.contentType.includes('html')
        ? gzipSync(fetch.body)
        : null;
    this.updateFetchedStmt.run(
      fetch.status,
      fetch.statusText,
      fetch.contentType || null,
      fetch.size,
      fetch.responseMs,
      fetch.redirectChain.length > 0 ? fetch.finalUrl : null,
      fetch.redirectChain.length > 0 ? JSON.stringify(fetch.redirectChain) : null,
      parsed?.title ?? null,
      parsed?.titlePx ?? null,
      parsed?.titleCount ?? null,
      parsed?.metaDescription ?? null,
      parsed?.metaDescriptionPx ?? null,
      parsed?.metaDescriptionCount ?? null,
      parsed?.metaRobots ?? null,
      fetch.headers['x-robots-tag'] ?? null,
      parsed?.canonical ?? null,
      parsed && parsed.canonicalAll.length > 1 ? JSON.stringify(parsed.canonicalAll) : null,
      null, // canonical_header (from Link header, set below if present)
      parsed?.viewport ?? null,
      parsed ? JSON.stringify(parsed.h1) : null,
      parsed ? JSON.stringify(parsed.h2) : null,
      parsed?.wordCount ?? null,
      parsed?.textRatio ?? null,
      indexable ? 1 : 0,
      indexabilityReason,
      parsed?.contentHash ?? null,
      parsed?.simhash ?? null,
      JSON.stringify(fetch.headers),
      parsed && Object.keys(parsed.og).length > 0 ? JSON.stringify(parsed.og) : null,
      parsed?.spaFramework ?? null,
      parsed?.relNext ?? null,
      parsed?.relPrev ?? null,
      rawHtml,
      pageId
    );
    // canonical from HTTP Link header
    const linkHeader = fetch.headers['link'];
    if (linkHeader && /rel=["']?canonical["']?/i.test(linkHeader)) {
      const m = linkHeader.match(/<([^>]+)>\s*;[^,]*rel=["']?canonical/i);
      if (m) {
        this.db
          .prepare('UPDATE pages SET canonical_header = ? WHERE id = ?')
          .run(m[1], pageId);
      }
    }
  }

  writeError(pageId: number, fetch: FetchResult): void {
    this.updateErrorStmt.run(
      fetch.error ?? 'Unknown error',
      fetch.status || null,
      fetch.statusText || null,
      fetch.redirectChain.length > 0 ? JSON.stringify(fetch.redirectChain) : null,
      fetch.redirectChain.length > 0 ? fetch.finalUrl : null,
      fetch.responseMs,
      pageId
    );
  }

  writeRobotsSkipped(pageId: number): void {
    this.updateSkippedStmt.run(pageId);
  }

  writeLinks(
    srcId: number,
    links: { dst: string; anchor: string; rel: string; follow: boolean; isInternal: boolean }[],
    fromRender: boolean
  ): void {
    const tx = this.db.transaction(() => {
      for (const l of links) {
        this.insertLinkStmt.run(
          srcId, l.dst, l.anchor, l.rel, l.follow ? 1 : 0, 'ahref',
          l.isInternal ? 1 : 0, fromRender ? 1 : 0
        );
      }
    });
    tx();
  }

  writeImages(
    pageId: number,
    images: {
      src: string; alt: string | null; hasDimensions: boolean;
      loading: string | null; isInternal: boolean;
    }[]
  ): void {
    const tx = this.db.transaction(() => {
      for (const img of images) {
        this.insertImageStmt.run(img.src, img.isInternal ? 1 : 0);
        const row = this.getImageIdStmt.get(img.src) as { id: number };
        this.insertImageRefStmt.run(
          pageId, row.id, img.alt, img.hasDimensions ? 1 : 0, img.loading
        );
      }
    });
    tx();
  }

  writeHreflang(pageId: number, entries: { lang: string; href: string }[], source: string): void {
    const tx = this.db.transaction(() => {
      for (const h of entries) this.insertHreflangStmt.run(pageId, h.lang, h.href, source);
    });
    tx();
  }

  writeStructuredData(
    pageId: number,
    items: { format: string; type: string; json: string }[]
  ): void {
    const tx = this.db.transaction(() => {
      for (const sd of items) this.insertSdStmt.run(pageId, sd.format, sd.type, sd.json);
    });
    tx();
  }

  writeSitemapUrls(entries: { url: string; sitemap: string; lastmod: string | null }[]): void {
    const tx = this.db.transaction(() => {
      for (const e of entries) this.insertSitemapUrlStmt.run(e.url, e.sitemap, e.lastmod);
    });
    tx();
  }

  /** Flag crawled pages whose URL appears in a sitemap. Run after sitemaps are recorded. */
  markInSitemap(): void {
    this.db
      .prepare('UPDATE pages SET in_sitemap = 1 WHERE url IN (SELECT url FROM sitemap_urls)')
      .run();
  }

  updateImageProbe(src: string, status: number, bytes: number | null, contentType: string): void {
    this.db
      .prepare('UPDATE images SET checked = 1, status = ?, bytes = ?, content_type = ? WHERE src = ?')
      .run(status, bytes, contentType, src);
  }

  /** Link dst_url -> pages.id resolution, run after the crawl completes. */
  resolveLinkTargets(): void {
    this.db
      .prepare(
        'UPDATE links SET dst_id = (SELECT p.id FROM pages p WHERE p.url = links.dst_url) WHERE dst_id IS NULL'
      )
      .run();
  }

  clearCrawlData(): void {
    const tables = [
      'pages', 'links', 'images', 'image_refs', 'hreflang', 'structured_data',
      'issues', 'extractions', 'search_hits', 'sitemap_urls', 'queue',
    ];
    const tx = this.db.transaction(() => {
      for (const t of tables) this.db.prepare(`DELETE FROM ${t}`).run();
    });
    tx();
  }
}
