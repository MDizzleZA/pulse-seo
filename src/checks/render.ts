import type Database from 'better-sqlite3';
import { makeAddIssue, INTERNAL_HTML_200 } from './helpers';

// Raw-vs-rendered comparison checks. These only produce issues when JavaScript
// rendering was enabled for the crawl (rendered = 1 success, rendered = 2 error);
// with rendering off every page stays rendered = 0 and nothing fires.

function norm(s: string | null): string {
  return (s ?? '').trim();
}

/** Lowercase, split, trim, drop empties, sort — so token order/spacing don't cause false diffs. */
function normRobots(s: string | null): string {
  return (s ?? '')
    .toLowerCase()
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .sort()
    .join(',');
}

export function checkRender(db: Database.Database): void {
  const add = makeAddIssue(db);

  // Pages that failed to render (worker sets rendered = 2 with an error message).
  for (const p of db
    .prepare(`SELECT id, render_error FROM pages WHERE ${INTERNAL_HTML_200} AND rendered = 2`)
    .all() as { id: number; render_error: string | null }[]) {
    add('render-failed', p.id, p.render_error ?? undefined);
  }

  // JS console errors captured while rendering (stored as a JSON array).
  for (const p of db
    .prepare(
      `SELECT id, console_errors FROM pages WHERE ${INTERNAL_HTML_200}
       AND rendered = 1 AND console_errors IS NOT NULL`
    )
    .all() as { id: number; console_errors: string }[]) {
    try {
      const errs = JSON.parse(p.console_errors) as string[];
      if (errs.length > 0) {
        add('render-console-errors', p.id, `${errs.length} error(s): ${errs[0].slice(0, 200)}`);
      }
    } catch {
      // malformed JSON — skip
    }
  }

  // Successfully rendered pages: compare the raw HTML signals against the
  // post-JavaScript DOM to catch client-side changes search engines would see.
  const rows = db
    .prepare(
      `SELECT id, title, rendered_title, meta_robots, rendered_meta_robots,
        canonical, rendered_canonical, word_count, rendered_word_count
       FROM pages WHERE ${INTERNAL_HTML_200} AND rendered = 1`
    )
    .all() as {
    id: number;
    title: string | null;
    rendered_title: string | null;
    meta_robots: string | null;
    rendered_meta_robots: string | null;
    canonical: string | null;
    rendered_canonical: string | null;
    word_count: number | null;
    rendered_word_count: number | null;
  }[];

  for (const p of rows) {
    // Canonical rewritten (or dropped/added) by JavaScript.
    const rawCanon = norm(p.canonical);
    const renCanon = norm(p.rendered_canonical);
    if (rawCanon !== renCanon && (rawCanon !== '' || renCanon !== '')) {
      add(
        'render-canonical-mismatch',
        p.id,
        `raw=${rawCanon || '(none)'} rendered=${renCanon || '(none)'}`
      );
    }

    // Meta robots changed by JS — the dangerous case is a rendered noindex/nofollow
    // that isn't in the raw HTML, but any divergence is worth surfacing.
    if (normRobots(p.meta_robots) !== normRobots(p.rendered_meta_robots)) {
      add(
        'render-robots-changed',
        p.id,
        `raw=${norm(p.meta_robots) || '(none)'} rendered=${norm(p.rendered_meta_robots) || '(none)'}`
      );
    }

    // Title populated/changed by JS (common in SPAs; informational).
    const rawTitle = norm(p.title);
    const renTitle = norm(p.rendered_title);
    if (rawTitle !== renTitle && (rawTitle !== '' || renTitle !== '')) {
      add('render-title-changed', p.id, `raw=${rawTitle || '(none)'} rendered=${renTitle || '(none)'}`);
    }

    // Body copy that only appears after JavaScript executes.
    const raw = p.word_count ?? 0;
    const ren = p.rendered_word_count ?? 0;
    if (ren - raw > 100 && ren > raw * 1.5) {
      add('render-content-delta', p.id, `${raw} raw vs ${ren} rendered words`);
    }
  }
}
