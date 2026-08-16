import type Database from 'better-sqlite3';
import { makeAddIssue, INTERNAL_HTML_200 } from './helpers';
import type { A11yViolation } from '../shared/types';

/** Accessibility issues from stored axe-core results (only when the audit ran). */
export function checkA11y(db: Database.Database): void {
  const add = makeAddIssue(db);
  const rows = db
    .prepare(
      `SELECT id, a11y_violations FROM pages WHERE ${INTERNAL_HTML_200}
       AND rendered = 1 AND a11y_violations IS NOT NULL`
    )
    .all() as { id: number; a11y_violations: string }[];

  for (const p of rows) {
    let violations: A11yViolation[];
    try {
      violations = JSON.parse(p.a11y_violations) as A11yViolation[];
    } catch {
      continue;
    }
    const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    let sample: { impact: string; help: string } | null = null;
    for (const v of violations) {
      if (v.impact in byImpact) byImpact[v.impact]++;
      if (!sample || v.impact === 'critical') sample = { impact: v.impact, help: v.help };
    }
    if (byImpact.critical > 0) {
      add('a11y-critical', p.id, `${byImpact.critical} critical: ${sample?.help ?? ''}`.slice(0, 250));
    }
    if (byImpact.serious > 0) add('a11y-serious', p.id, `${byImpact.serious} serious violation(s)`);
    if (byImpact.moderate + byImpact.minor > 0) {
      add('a11y-minor', p.id, `${byImpact.moderate + byImpact.minor} moderate/minor violation(s)`);
    }
  }
}
