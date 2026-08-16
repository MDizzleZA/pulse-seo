import type Database from 'better-sqlite3';

export type AddIssue = (checkId: string, pageId: number | null, detail?: string) => void;

export function makeAddIssue(db: Database.Database): AddIssue {
  const stmt = db.prepare('INSERT INTO issues (check_id, page_id, detail) VALUES (?, ?, ?)');
  return (checkId, pageId, detail) => {
    stmt.run(checkId, pageId, detail ?? null);
  };
}

export const INTERNAL_HTML_200 =
  "is_internal = 1 AND fetched = 1 AND status = 200 AND content_type LIKE '%html%'";

export interface PageLite {
  id: number;
  url: string;
}
