import type Database from 'better-sqlite3';
import type { CrawlConfig } from '../shared/types';
import { checkResponse } from './response';
import { checkDirectives } from './directives';
import { checkCanonicals } from './canonicals';
import { checkOnPage } from './onpage';
import { checkImages } from './media';
import { checkContent } from './content';
import { checkUrlAndSecurity } from './url-security';
import { checkRender } from './render';
import { checkSitemaps } from './sitemaps';
import { checkHreflang } from './hreflang';
import { checkStructuredData } from './structured-data';
import { checkPagination } from './pagination';
import { checkAiCrawlers } from './ai-crawlers';
import { checkA11y } from './a11y';

/**
 * Run every registered check against the crawl database, replacing prior issues.
 * Each check is isolated: a failure in one is logged and skipped rather than
 * aborting the whole audit. Later phases (hreflang, structured data, sitemaps,
 * rendering) register their checks here as they land.
 */
export function runAllChecks(db: Database.Database, config: CrawlConfig): void {
  const checks: [string, () => void][] = [
    ['response', () => checkResponse(db)],
    ['directives', () => checkDirectives(db)],
    ['canonicals', () => checkCanonicals(db)],
    ['onpage', () => checkOnPage(db, config)],
    ['images', () => checkImages(db, config)],
    ['content', () => checkContent(db, config)],
    ['url-security', () => checkUrlAndSecurity(db, config)],
    ['render', () => checkRender(db)],
    ['sitemaps', () => checkSitemaps(db)],
    ['hreflang', () => checkHreflang(db)],
    ['structured-data', () => checkStructuredData(db)],
    ['pagination', () => checkPagination(db)],
    ['ai-crawlers', () => checkAiCrawlers(db)],
    ['a11y', () => checkA11y(db)],
  ];

  const run = db.transaction(() => {
    db.prepare('DELETE FROM issues').run();
    for (const [name, fn] of checks) {
      try {
        fn();
      } catch (err) {
        console.error(`[checks] "${name}" failed:`, err);
      }
    }
  });

  run();
}
