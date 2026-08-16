import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_STATEMENTS } from '../db/schema';
import { checkSitemaps } from './sitemaps';
import { checkHreflang } from './hreflang';
import { checkStructuredData } from './structured-data';
import { generateSitemaps } from '../main/sitemap-gen';

function fresh(): Database.Database {
  const d = new Database(':memory:');
  for (const s of SCHEMA_STATEMENTS) d.prepare(s).run();
  return d;
}

interface PageOpts {
  url: string;
  status?: number;
  fetched?: number;
  content_type?: string;
  indexable?: number;
  reason?: string | null;
  meta_robots?: string | null;
  canonical?: string | null;
  in_sitemap?: number;
}

function insertPage(d: Database.Database, o: PageOpts): number {
  const info = d
    .prepare(
      `INSERT INTO pages (url, is_internal, fetched, status, content_type, meta_robots,
        canonical, indexable, indexability_reason, in_sitemap)
       VALUES (@url,1,@fetched,@status,@content_type,@meta_robots,@canonical,@indexable,@reason,@in_sitemap)`
    )
    .run({
      url: o.url,
      fetched: o.fetched ?? 1,
      status: o.status ?? 200,
      content_type: o.content_type ?? 'text/html',
      meta_robots: o.meta_robots ?? null,
      canonical: o.canonical ?? null,
      indexable: o.indexable ?? 1,
      reason: o.reason ?? null,
      in_sitemap: o.in_sitemap ?? 0,
    });
  return Number(info.lastInsertRowid);
}

function count(d: Database.Database, checkId: string): number {
  return (d.prepare('SELECT COUNT(*) n FROM issues WHERE check_id = ?').get(checkId) as { n: number }).n;
}

describe('checkSitemaps', () => {
  it('flags non-200, noindex, canonicalised, orphan, and missing-from-sitemap URLs', () => {
    const d = fresh();
    insertPage(d, { url: 'https://ex.com/', canonical: 'https://ex.com/' });
    insertPage(d, { url: 'https://ex.com/noindex', meta_robots: 'noindex', indexable: 0, reason: 'Noindex' });
    insertPage(d, { url: 'https://ex.com/canon', canonical: 'https://ex.com/other', indexable: 0, reason: 'Canonicalised' });
    insertPage(d, { url: 'https://ex.com/404', status: 404, indexable: 0, reason: 'Client Error' });
    insertPage(d, { url: 'https://ex.com/missing' }); // indexable, not in any sitemap

    // Sitemap lists five URLs; /orphan has no crawled page row.
    const sm = 'https://ex.com/sitemap.xml';
    const insSm = d.prepare('INSERT INTO sitemap_urls (url, sitemap, lastmod) VALUES (?, ?, NULL)');
    for (const u of ['https://ex.com/', 'https://ex.com/noindex', 'https://ex.com/canon', 'https://ex.com/404', 'https://ex.com/orphan']) {
      insSm.run(u, sm);
    }
    // Mimic the worker's markInSitemap step.
    d.prepare('UPDATE pages SET in_sitemap = 1 WHERE url IN (SELECT url FROM sitemap_urls)').run();

    checkSitemaps(d);

    expect(count(d, 'sitemap-non200')).toBe(1);
    expect(count(d, 'sitemap-noindex')).toBe(1);
    expect(count(d, 'sitemap-canonicalised')).toBe(1);
    expect(count(d, 'sitemap-orphan')).toBe(1);
    expect(count(d, 'sitemap-missing-indexable')).toBe(1);
    d.close();
  });

  it('does nothing when no sitemap exists (avoids flagging every page)', () => {
    const d = fresh();
    insertPage(d, { url: 'https://ex.com/a' });
    insertPage(d, { url: 'https://ex.com/b' });
    checkSitemaps(d);
    expect((d.prepare('SELECT COUNT(*) n FROM issues').get() as { n: number }).n).toBe(0);
    d.close();
  });
});

describe('checkHreflang', () => {
  it('validates codes, return links, self-reference, x-default, and broken targets', () => {
    const d = fresh();
    const en = insertPage(d, { url: 'https://ex.com/en' });
    const fr = insertPage(d, { url: 'https://ex.com/fr' });
    const de = insertPage(d, { url: 'https://ex.com/de' });
    insertPage(d, { url: 'https://ex.com/en-broken', status: 404, indexable: 0, reason: 'Client Error' });

    const insH = d.prepare('INSERT INTO hreflang (page_id, lang, href, source) VALUES (?, ?, ?, ?)');
    // Clean reciprocal cluster: /en and /fr reference each other, both with x-default + self.
    for (const [lang, href] of [['en', 'https://ex.com/en'], ['fr', 'https://ex.com/fr'], ['x-default', 'https://ex.com/en']] as const) {
      insH.run(en, lang, href, 'link');
      insH.run(fr, lang, href, 'link');
    }
    // /de: self ok, but invalid code (fr_FR), no x-default, missing return from /fr, and a broken target.
    insH.run(de, 'de', 'https://ex.com/de', 'link');
    insH.run(de, 'fr_FR', 'https://ex.com/fr', 'link');
    insH.run(de, 'en', 'https://ex.com/en-broken', 'link');

    checkHreflang(d);

    expect(count(d, 'hreflang-invalid-code')).toBe(1); // /de fr_FR
    expect(count(d, 'hreflang-no-self')).toBe(0); // all three self-reference
    expect(count(d, 'hreflang-no-xdefault')).toBe(1); // /de only
    expect(count(d, 'hreflang-missing-return')).toBe(1); // /de -> /fr, no return
    expect(count(d, 'hreflang-to-broken')).toBe(1); // /de -> /en-broken (404)
    d.close();
  });
});

describe('checkStructuredData', () => {
  it('flags parse errors, missing required/recommended props, and deprecated types', () => {
    const d = fresh();
    const pid = insertPage(d, { url: 'https://ex.com/sd' });
    const insSd = d.prepare('INSERT INTO structured_data (page_id, format, type, json) VALUES (?, ?, ?, ?)');
    insSd.run(pid, 'jsonld', 'Product', JSON.stringify({ '@type': 'Product', name: 'Widget' }));
    insSd.run(pid, 'jsonld', 'Recipe', JSON.stringify({ '@type': 'Recipe', name: 'Soup' })); // missing image
    insSd.run(pid, 'jsonld', 'FAQPage', JSON.stringify({ '@type': 'FAQPage', mainEntity: [] })); // deprecated
    insSd.run(pid, 'jsonld', 'PARSE_ERROR', '{bad json');

    checkStructuredData(d);

    expect(count(d, 'sd-parse-error')).toBe(1);
    expect(count(d, 'sd-missing-required')).toBe(1); // Recipe missing image
    expect(count(d, 'sd-missing-recommended')).toBe(1); // aggregated once for the page
    expect(count(d, 'sd-deprecated-type')).toBe(1); // FAQPage

    // Row-level errors/warnings are written back for the Structured Data tab filters.
    const recipeErrors = (
      d.prepare("SELECT errors FROM structured_data WHERE type = 'Recipe'").get() as { errors: string }
    ).errors;
    expect(recipeErrors).toContain('image');
    d.close();
  });
});

describe('generateSitemaps', () => {
  it('includes only self-canonical indexable pages and builds an image sitemap', () => {
    const d = fresh();
    insertPage(d, { url: 'https://ex.com/a', canonical: 'https://ex.com/a' });
    insertPage(d, { url: 'https://ex.com/b', canonical: 'https://ex.com/a' }); // canonicalised away
    insertPage(d, { url: 'https://ex.com/c', meta_robots: 'noindex', indexable: 0, reason: 'Noindex' });

    // Two internal images on /a.
    const aId = (d.prepare("SELECT id FROM pages WHERE url = 'https://ex.com/a'").get() as { id: number }).id;
    const img1 = d.prepare("INSERT INTO images (src, is_internal) VALUES ('https://ex.com/1.jpg', 1)").run().lastInsertRowid;
    const img2 = d.prepare("INSERT INTO images (src, is_internal) VALUES ('https://ex.com/2.jpg', 1)").run().lastInsertRowid;
    const insRef = d.prepare('INSERT INTO image_refs (page_id, image_id) VALUES (?, ?)');
    insRef.run(aId, img1);
    insRef.run(aId, img2);

    const { files, urlCount, imageCount } = generateSitemaps(d, 'https://ex.com');

    expect(urlCount).toBe(1);
    expect(imageCount).toBe(2);
    const urlXml = files.find((f) => f.name === 'sitemap.xml')!.xml;
    expect(urlXml).toContain('https://ex.com/a');
    expect(urlXml).not.toContain('https://ex.com/b');
    expect(urlXml).not.toContain('https://ex.com/c');
    const imgXml = files.find((f) => f.name === 'image-sitemap.xml')!.xml;
    expect(imgXml).toContain('https://ex.com/1.jpg');
    expect(imgXml).toContain('image:loc');
    d.close();
  });
});
