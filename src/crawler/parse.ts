import * as cheerio from 'cheerio';
import { createHash } from 'crypto';
import { simhash } from './simhash';
import { titlePx, descPx } from '../shared/serp-widths';
import { normalizeUrl } from './url-utils';

export interface ParsedLink {
  href: string;
  anchor: string;
  rel: string;
  follow: boolean;
}

export interface ParsedImage {
  src: string;
  alt: string | null; // null = attribute missing entirely
  hasDimensions: boolean;
  loading: string | null;
}

export interface ParsedHreflang {
  lang: string;
  href: string;
}

export interface ParsedStructuredData {
  format: 'jsonld' | 'microdata';
  type: string;
  json: string;
}

export interface ParsedPage {
  title: string | null;
  titleCount: number;
  titlePx: number | null;
  metaDescription: string | null;
  metaDescriptionCount: number;
  metaDescriptionPx: number | null;
  metaRobots: string | null;
  canonical: string | null;
  canonicalAll: string[];
  viewport: string | null;
  h1: string[];
  h2: string[];
  links: ParsedLink[];
  images: ParsedImage[];
  hreflang: ParsedHreflang[];
  structuredData: ParsedStructuredData[];
  og: Record<string, string>;
  relNext: string | null;
  relPrev: string | null;
  wordCount: number;
  textRatio: number;
  contentHash: string;
  simhash: string;
  visibleText: string;
  spaFramework: string | null;
  baseHref: string | null;
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function detectSpa(html: string): string | null {
  if (html.includes('__NEXT_DATA__') || html.includes('id="__next"')) return 'Next.js (React)';
  if (html.includes('data-reactroot') || html.includes('data-reactid')) return 'React';
  if (/ng-version="/.test(html)) return 'Angular';
  if (html.includes('__NUXT__') || html.includes('id="__nuxt"')) return 'Nuxt (Vue)';
  if (html.includes('data-v-app') || /\bnew Vue\(/.test(html)) return 'Vue.js';
  if (html.includes('__sveltekit')) return 'SvelteKit';
  if (html.includes('id="___gatsby"')) return 'Gatsby (React)';
  return null;
}

/** Parse an HTML document and extract all SEO-relevant elements. */
export function parsePage(html: string, pageUrl: string): ParsedPage {
  const $ = cheerio.load(html);

  const base = $('base[href]').first().attr('href') ?? null;
  const resolveBase = base ? (normalizeUrl(base, pageUrl) ?? pageUrl) : pageUrl;

  // Titles
  const titleEls = $('head title');
  const titleCount = titleEls.length;
  const title = titleCount > 0 ? cleanText(titleEls.first().text()) : null;

  // Meta description
  const descEls = $('head meta[name]').filter(
    (_, el) => ($(el).attr('name') ?? '').toLowerCase() === 'description'
  );
  const metaDescriptionCount = descEls.length;
  const metaDescription =
    metaDescriptionCount > 0 ? cleanText(descEls.first().attr('content') ?? '') : null;

  // Meta robots (robots + googlebot)
  const robotsParts: string[] = [];
  $('meta[name]').each((_, el) => {
    const name = ($(el).attr('name') ?? '').toLowerCase();
    if (name === 'robots' || name === 'googlebot') {
      const content = $(el).attr('content');
      if (content) robotsParts.push(content.toLowerCase().trim());
    }
  });
  const metaRobots = robotsParts.length ? robotsParts.join(', ') : null;

  // Canonical(s)
  const canonicalAll: string[] = [];
  $('link[rel]').each((_, el) => {
    if (($(el).attr('rel') ?? '').toLowerCase().trim() !== 'canonical') return;
    const href = $(el).attr('href');
    if (href) {
      const abs = normalizeUrl(href.trim(), resolveBase);
      if (abs) canonicalAll.push(abs);
    }
  });
  const canonical = canonicalAll[0] ?? null;

  const viewport = $('meta[name="viewport"]').first().attr('content') ?? null;

  // Pagination hints (rel=next/prev link tags)
  let relNext: string | null = null;
  let relPrev: string | null = null;
  $('head link[rel]').each((_, el) => {
    const rel = ($(el).attr('rel') ?? '').toLowerCase().trim();
    if (rel !== 'next' && rel !== 'prev') return;
    const href = $(el).attr('href');
    if (!href) return;
    const abs = normalizeUrl(href.trim(), resolveBase);
    if (!abs) return;
    if (rel === 'next' && relNext === null) relNext = abs;
    if (rel === 'prev' && relPrev === null) relPrev = abs;
  });

  // Headings
  const h1: string[] = [];
  $('h1').each((_, el) => {
    h1.push(cleanText($(el).text()).slice(0, 300));
  });
  const h2: string[] = [];
  $('h2').each((_, el) => {
    h2.push(cleanText($(el).text()).slice(0, 300));
  });

  // Links
  const links: ParsedLink[] = [];
  $('a[href]').each((_, el) => {
    const rawHref = ($(el).attr('href') ?? '').trim();
    if (!rawHref || rawHref.startsWith('#') || /^(javascript|mailto|tel|data):/i.test(rawHref))
      return;
    const abs = normalizeUrl(rawHref, resolveBase);
    if (!abs) return;
    const rel = ($(el).attr('rel') ?? '').toLowerCase();
    links.push({
      href: abs,
      anchor: cleanText($(el).text()).slice(0, 200),
      rel,
      follow: !/\bnofollow\b/.test(rel),
    });
  });

  // Images
  const images: ParsedImage[] = [];
  $('img').each((_, el) => {
    const src = ($(el).attr('src') ?? $(el).attr('data-src') ?? '').trim();
    if (!src || src.startsWith('data:')) return;
    const abs = normalizeUrl(src, resolveBase);
    if (!abs) return;
    const altAttr = $(el).attr('alt');
    images.push({
      src: abs,
      alt: altAttr === undefined ? null : cleanText(altAttr),
      hasDimensions: $(el).attr('width') !== undefined && $(el).attr('height') !== undefined,
      loading: $(el).attr('loading') ?? null,
    });
  });

  // hreflang
  const hreflang: ParsedHreflang[] = [];
  $('link[rel]').each((_, el) => {
    if (($(el).attr('rel') ?? '').toLowerCase().trim() !== 'alternate') return;
    const lang = $(el).attr('hreflang');
    const href = $(el).attr('href');
    if (lang && href) {
      const abs = normalizeUrl(href.trim(), resolveBase);
      if (abs) hreflang.push({ lang: lang.trim(), href: abs });
    }
  });

  // Structured data: JSON-LD
  const structuredData: ParsedStructuredData[] = [];
  $('script[type]').each((_, el) => {
    if (($(el).attr('type') ?? '').toLowerCase().trim() !== 'application/ld+json') return;
    const raw = $(el).text().trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : parsed['@graph'] ?? [parsed];
      for (const item of Array.isArray(items) ? items : [items]) {
        if (item && typeof item === 'object') {
          const t = item['@type'];
          structuredData.push({
            format: 'jsonld',
            type: Array.isArray(t) ? t.join(',') : String(t ?? 'Unknown'),
            json: JSON.stringify(item),
          });
        }
      }
    } catch {
      structuredData.push({ format: 'jsonld', type: 'PARSE_ERROR', json: raw.slice(0, 5000) });
    }
  });

  // Structured data: Microdata (top-level itemscopes)
  $('[itemscope]').each((_, el) => {
    const $el = $(el);
    if ($el.parents('[itemscope]').length > 0) return; // only top-level
    const itemtype = ($el.attr('itemtype') ?? '').trim();
    const typeName = itemtype.split('/').pop() ?? 'Unknown';
    const props: Record<string, string[]> = {};
    $el.find('[itemprop]').each((_, p) => {
      const $p = $(p);
      const name = ($p.attr('itemprop') ?? '').trim();
      if (!name) return;
      const value =
        $p.attr('content') ?? $p.attr('href') ?? $p.attr('src') ?? cleanText($p.text());
      if (!props[name]) props[name] = [];
      props[name].push(value.slice(0, 500));
    });
    structuredData.push({
      format: 'microdata',
      type: typeName,
      json: JSON.stringify({ '@type': typeName, itemtype, properties: props }),
    });
  });

  // Open Graph / Twitter cards
  const og: Record<string, string> = {};
  $('meta').each((_, el) => {
    const prop = ($(el).attr('property') ?? $(el).attr('name') ?? '').toLowerCase();
    if (prop.startsWith('og:') || prop.startsWith('twitter:')) {
      const content = $(el).attr('content');
      if (content && !(prop in og)) og[prop] = content.slice(0, 500);
    }
  });

  // Visible text / word count
  const $body = $('body').clone();
  $body.find('script, style, noscript, template, svg, iframe').remove();
  const visibleText = cleanText($body.text());
  const wordCount = visibleText ? visibleText.split(/\s+/).length : 0;
  const textRatio = html.length > 0 ? visibleText.length / html.length : 0;

  const contentHash = createHash('sha1').update(visibleText).digest('hex');

  return {
    title,
    titleCount,
    titlePx: title ? titlePx(title) : null,
    metaDescription,
    metaDescriptionCount,
    metaDescriptionPx: metaDescription ? descPx(metaDescription) : null,
    metaRobots,
    canonical,
    canonicalAll,
    viewport,
    h1,
    h2,
    links,
    images,
    hreflang,
    structuredData,
    og,
    relNext,
    relPrev,
    wordCount,
    textRatio,
    contentHash,
    simhash: simhash(visibleText),
    visibleText,
    spaFramework: detectSpa(html),
    baseHref: base,
  };
}
