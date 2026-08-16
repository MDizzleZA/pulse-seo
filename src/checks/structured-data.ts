import type Database from 'better-sqlite3';
import { makeAddIssue } from './helpers';

// Pragmatic subset of Google rich-result requirements. `required` entries may be
// a string (must be present) or a string[] (at least one must be present).
interface Rule {
  required: (string | string[])[];
  recommended: string[];
}

const RULES: Record<string, Rule> = {
  article: { required: [], recommended: ['headline', 'image', 'datePublished', 'dateModified', 'author', 'publisher'] },
  newsarticle: { required: [], recommended: ['headline', 'image', 'datePublished', 'dateModified', 'author', 'publisher'] },
  blogposting: { required: [], recommended: ['headline', 'image', 'datePublished', 'dateModified', 'author', 'publisher'] },
  product: { required: ['name'], recommended: ['image', 'description', 'offers', 'aggregateRating', 'review', 'brand', 'sku'] },
  recipe: { required: ['name', 'image'], recommended: ['author', 'datePublished', 'description', 'prepTime', 'cookTime', 'totalTime', 'recipeYield', 'recipeIngredient', 'recipeInstructions', 'nutrition', 'aggregateRating'] },
  event: { required: ['name', 'startDate', 'location'], recommended: ['endDate', 'description', 'image', 'offers', 'performer', 'eventStatus', 'eventAttendanceMode'] },
  jobposting: { required: ['title', 'description', 'datePosted', 'hiringOrganization', 'jobLocation'], recommended: ['baseSalary', 'employmentType', 'validThrough'] },
  localbusiness: { required: ['name', 'address'], recommended: ['telephone', 'openingHours', 'geo', 'priceRange', 'image', 'url'] },
  organization: { required: ['name'], recommended: ['url', 'logo', 'sameAs', 'contactPoint'] },
  breadcrumblist: { required: ['itemListElement'], recommended: [] },
  videoobject: { required: ['name', 'thumbnailUrl', 'uploadDate'], recommended: ['description', 'duration', 'contentUrl', 'embedUrl'] },
  faqpage: { required: ['mainEntity'], recommended: [] },
  howto: { required: ['name', 'step'], recommended: [] },
  review: { required: ['itemReviewed', 'reviewRating', 'author'], recommended: [] },
  aggregaterating: { required: ['ratingValue', ['reviewCount', 'ratingCount']], recommended: [] },
  person: { required: ['name'], recommended: [] },
  website: { required: [], recommended: ['name', 'url', 'potentialAction'] },
};

// Rich result types Google has removed or restricted; presence is worth flagging.
const DEPRECATED = new Set(['howto', 'faqpage']);

function propKeys(format: string, json: string): Set<string> {
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    if (!o || typeof o !== 'object') return new Set();
    if (format === 'microdata' && o.properties && typeof o.properties === 'object') {
      return new Set(Object.keys(o.properties as Record<string, unknown>));
    }
    return new Set(Object.keys(o).filter((k) => !k.startsWith('@')));
  } catch {
    return new Set();
  }
}

function hasProp(keys: Set<string>, req: string | string[]): boolean {
  return Array.isArray(req) ? req.some((r) => keys.has(r)) : keys.has(req);
}

function labelOf(req: string | string[]): string {
  return Array.isArray(req) ? req.join('|') : req;
}

export function checkStructuredData(db: Database.Database): void {
  const add = makeAddIssue(db);

  const rows = db
    .prepare('SELECT id, page_id, format, type, json FROM structured_data')
    .all() as { id: number; page_id: number; format: string; type: string; json: string }[];
  if (rows.length === 0) return;

  const setErrors = db.prepare('UPDATE structured_data SET errors = ?, warnings = ? WHERE id = ?');

  // Aggregate findings per page so each check fires at most once per URL.
  const perPage = new Map<
    number,
    { parseError: boolean; missingReq: string[]; missingRec: string[]; deprecated: Set<string> }
  >();
  const get = (pid: number) => {
    let v = perPage.get(pid);
    if (!v) {
      v = { parseError: false, missingReq: [], missingRec: [], deprecated: new Set() };
      perPage.set(pid, v);
    }
    return v;
  };

  for (const row of rows) {
    const agg = get(row.page_id);
    const rowErrors: string[] = [];
    const rowWarnings: string[] = [];

    if (row.type === 'PARSE_ERROR') {
      agg.parseError = true;
      rowErrors.push('Invalid JSON-LD syntax');
      setErrors.run(JSON.stringify(rowErrors), JSON.stringify(rowWarnings), row.id);
      continue;
    }

    const keys = propKeys(row.format, row.json);
    const types = row.type
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    for (const t of types) {
      if (DEPRECATED.has(t)) agg.deprecated.add(row.type.split(',').find((x) => x.trim().toLowerCase() === t)?.trim() ?? t);
      const rule = RULES[t];
      if (!rule) continue;
      for (const req of rule.required) {
        if (!hasProp(keys, req)) {
          const detail = `${t}: ${labelOf(req)}`;
          agg.missingReq.push(detail);
          rowErrors.push(`Missing required property: ${labelOf(req)}`);
        }
      }
      for (const rec of rule.recommended) {
        if (!keys.has(rec)) {
          agg.missingRec.push(`${t}: ${rec}`);
          rowWarnings.push(`Missing recommended property: ${rec}`);
        }
      }
      break; // evaluate against the first recognised type only
    }

    setErrors.run(JSON.stringify(rowErrors), JSON.stringify(rowWarnings), row.id);
  }

  for (const [pid, v] of perPage) {
    if (v.parseError) add('sd-parse-error', pid);
    if (v.missingReq.length > 0)
      add('sd-missing-required', pid, [...new Set(v.missingReq)].join('; '));
    if (v.missingRec.length > 0)
      add('sd-missing-recommended', pid, [...new Set(v.missingRec)].slice(0, 12).join('; '));
    if (v.deprecated.size > 0) add('sd-deprecated-type', pid, [...v.deprecated].join(', '));
  }
}
