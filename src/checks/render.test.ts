import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_STATEMENTS } from '../db/schema';
import { checkRender } from './render';

function db(): Database.Database {
  const d = new Database(':memory:');
  for (const s of SCHEMA_STATEMENTS) d.prepare(s).run();
  return d;
}

const insPage = `INSERT INTO pages
  (url, is_internal, fetched, status, content_type,
   title, meta_robots, canonical, word_count,
   rendered, render_error, rendered_title, rendered_meta_robots,
   rendered_canonical, rendered_word_count)
  VALUES (@url,1,1,200,'text/html',
   @title,@meta_robots,@canonical,@word_count,
   @rendered,@render_error,@rendered_title,@rendered_meta_robots,
   @rendered_canonical,@rendered_word_count)`;

function count(d: Database.Database, checkId: string): number {
  return (d.prepare('SELECT COUNT(*) n FROM issues WHERE check_id = ?').get(checkId) as { n: number }).n;
}

describe('checkRender', () => {
  it('flags each raw-vs-rendered divergence and render failures', () => {
    const d = db();
    const ins = d.prepare(insPage);

    // Clean SPA page: raw and rendered agree entirely.
    ins.run({
      url: 'https://ex.com/clean', title: 'Home', meta_robots: null, canonical: 'https://ex.com/clean',
      word_count: 500, rendered: 1, render_error: null, rendered_title: 'Home',
      rendered_meta_robots: null, rendered_canonical: 'https://ex.com/clean', rendered_word_count: 500,
    });

    // JS rewrites the canonical.
    ins.run({
      url: 'https://ex.com/canon', title: 'P', meta_robots: null, canonical: 'https://ex.com/canon',
      word_count: 400, rendered: 1, render_error: null, rendered_title: 'P',
      rendered_meta_robots: null, rendered_canonical: 'https://ex.com/other', rendered_word_count: 400,
    });

    // JS injects a noindex not present in raw HTML (the dangerous case).
    ins.run({
      url: 'https://ex.com/robots', title: 'R', meta_robots: null, canonical: null,
      word_count: 300, rendered: 1, render_error: null, rendered_title: 'R',
      rendered_meta_robots: 'noindex, nofollow', rendered_canonical: null, rendered_word_count: 300,
    });

    // SPA: title only set client-side, and body copy appears only after JS.
    ins.run({
      url: 'https://ex.com/spa', title: null, meta_robots: null, canonical: null,
      word_count: 5, rendered: 1, render_error: null, rendered_title: 'Loaded Title',
      rendered_meta_robots: null, rendered_canonical: null, rendered_word_count: 900,
    });

    // Page that failed to render.
    ins.run({
      url: 'https://ex.com/fail', title: 'F', meta_robots: null, canonical: null,
      word_count: 100, rendered: 2, render_error: 'Navigation timeout', rendered_title: null,
      rendered_meta_robots: null, rendered_canonical: null, rendered_word_count: null,
    });

    checkRender(d);

    expect(count(d, 'render-canonical-mismatch')).toBe(1); // /canon
    expect(count(d, 'render-robots-changed')).toBe(1); // /robots
    expect(count(d, 'render-title-changed')).toBe(1); // /spa (null -> "Loaded Title")
    expect(count(d, 'render-content-delta')).toBe(1); // /spa (5 -> 900)
    expect(count(d, 'render-failed')).toBe(1); // /fail

    // The clean page contributes nothing.
    const cleanId = (d.prepare("SELECT id FROM pages WHERE url = 'https://ex.com/clean'").get() as { id: number }).id;
    expect((d.prepare('SELECT COUNT(*) n FROM issues WHERE page_id = ?').get(cleanId) as { n: number }).n).toBe(0);

    d.close();
  });

  it('does not treat equivalent meta-robots token ordering as a change', () => {
    const d = db();
    d.prepare(insPage).run({
      url: 'https://ex.com/order', title: 'T', meta_robots: 'noindex, follow', canonical: null,
      word_count: 200, rendered: 1, render_error: null, rendered_title: 'T',
      rendered_meta_robots: 'follow,noindex', rendered_canonical: null, rendered_word_count: 200,
    });
    checkRender(d);
    expect(count(d, 'render-robots-changed')).toBe(0);
    d.close();
  });

  it('produces nothing when rendering was disabled (all pages rendered = 0)', () => {
    const d = db();
    d.prepare(insPage).run({
      url: 'https://ex.com/norender', title: 'T', meta_robots: null, canonical: 'https://ex.com/norender',
      word_count: 300, rendered: 0, render_error: null, rendered_title: null,
      rendered_meta_robots: null, rendered_canonical: null, rendered_word_count: null,
    });
    checkRender(d);
    expect((d.prepare('SELECT COUNT(*) n FROM issues').get() as { n: number }).n).toBe(0);
    d.close();
  });
});
