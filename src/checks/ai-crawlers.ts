import type Database from 'better-sqlite3';
import robotsParser from 'robots-parser';
import { makeAddIssue } from './helpers';
import { metaGet } from '../db/schema';

/** AI crawler user agents clients ask about, checked against the site's robots.txt. */
export const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'PerplexityBot',
  'Google-Extended',
  'CCBot',
] as const;

/** Site-level check: which AI crawlers does robots.txt block? One issue per blocked bot. */
export function checkAiCrawlers(db: Database.Database): void {
  const robotsTxt = metaGet(db, 'robots_txt');
  const origin = metaGet(db, 'robots_origin');
  if (!robotsTxt || !origin) return; // no robots.txt -> everything allowed, nothing to report

  const add = makeAddIssue(db);
  const parser = robotsParser(origin + '/robots.txt', robotsTxt);
  for (const bot of AI_CRAWLERS) {
    if (parser.isAllowed(origin + '/', bot) === false) {
      add('site-ai-crawlers', null, `${bot} blocked by robots.txt`);
    }
  }
}
