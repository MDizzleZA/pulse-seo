import type Database from 'better-sqlite3';

const MAX_URLS_PER_FILE = 45000; // under the 50k / 50MB sitemap limits

export interface GeneratedFile {
  name: string;
  xml: string;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildUrlSitemap(entries: { loc: string; lastmod?: string | null }[]): string {
  const body = entries
    .map((e) => {
      const lm = e.lastmod ? `\n    <lastmod>${xmlEscape(e.lastmod)}</lastmod>` : '';
      return `  <url>\n    <loc>${xmlEscape(e.loc)}</loc>${lm}\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function buildImageSitemap(items: { loc: string; images: string[] }[]): string {
  const body = items
    .map((it) => {
      const imgs = it.images
        .map((src) => `    <image:image>\n      <image:loc>${xmlEscape(src)}</image:loc>\n    </image:image>`)
        .join('\n');
      return `  <url>\n    <loc>${xmlEscape(it.loc)}</loc>\n${imgs}\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${body}\n</urlset>\n`;
}

export function buildSitemapIndex(locs: string[]): string {
  const body = locs
    .map((loc) => `  <sitemap>\n    <loc>${xmlEscape(loc)}</loc>\n  </sitemap>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Build XML sitemap file(s) from crawl data: indexable, self-canonical 200 HTML
 * pages. Chunks into multiple files with an index when over the per-file limit,
 * and emits a separate image sitemap when images are present.
 *
 * `baseUrl` is where the sitemaps will be hosted (used for index <loc>s).
 */
export function generateSitemaps(
  db: Database.Database,
  baseUrl: string
): { files: GeneratedFile[]; urlCount: number; imageCount: number } {
  const pages = db
    .prepare(
      `SELECT url, canonical FROM pages
       WHERE is_internal = 1 AND fetched = 1 AND status = 200
         AND content_type LIKE '%html%' AND indexable = 1
       ORDER BY url`
    )
    .all() as { url: string; canonical: string | null }[];

  // Only include pages that are self-canonical (or have no canonical).
  const entries = pages
    .filter((p) => !p.canonical || p.canonical === p.url)
    .map((p) => ({ loc: p.url, lastmod: null as string | null }));

  const files: GeneratedFile[] = [];
  const base = baseUrl.replace(/\/$/, '');
  const urlChunks = chunk(entries, MAX_URLS_PER_FILE);

  if (urlChunks.length <= 1) {
    files.push({ name: 'sitemap.xml', xml: buildUrlSitemap(entries) });
  } else {
    const childNames: string[] = [];
    urlChunks.forEach((c, i) => {
      const name = `sitemap-${i + 1}.xml`;
      childNames.push(name);
      files.push({ name, xml: buildUrlSitemap(c) });
    });
    files.push({
      name: 'sitemap.xml',
      xml: buildSitemapIndex(childNames.map((n) => `${base}/${n}`)),
    });
  }

  // Image sitemap from internal images referenced by included pages.
  const includedUrls = new Set(entries.map((e) => e.loc));
  const imageRows = db
    .prepare(
      `SELECT p.url AS pageUrl, i.src AS src FROM image_refs r
       JOIN pages p ON p.id = r.page_id
       JOIN images i ON i.id = r.image_id
       WHERE i.is_internal = 1
       ORDER BY p.url`
    )
    .all() as { pageUrl: string; src: string }[];

  const imagesByPage = new Map<string, string[]>();
  let imageCount = 0;
  for (const r of imageRows) {
    if (!includedUrls.has(r.pageUrl)) continue;
    let arr = imagesByPage.get(r.pageUrl);
    if (!arr) {
      arr = [];
      imagesByPage.set(r.pageUrl, arr);
    }
    if (arr.length < 1000 && !arr.includes(r.src)) {
      arr.push(r.src);
      imageCount++;
    }
  }
  if (imagesByPage.size > 0) {
    const items = [...imagesByPage.entries()].map(([loc, images]) => ({ loc, images }));
    files.push({ name: 'image-sitemap.xml', xml: buildImageSitemap(items) });
  }

  return { files, urlCount: entries.length, imageCount };
}
