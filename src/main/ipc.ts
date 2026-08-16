import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type Database from 'better-sqlite3';
import { DbReader } from './db-reader';
import { ProjectManager } from './project';
import { CrawlManager } from './crawl-manager';
import { exportView, exportAll } from './exporter';
import { CHECKS } from '../checks/registry';
import { openProjectDb } from '../db/schema';
import { ACCOUNTS, getSecret, setSecret, deleteSecret } from './credentials';
import { getApiConfig, setApiConfig } from './api/common';
import { runPsi, selectPsiUrls } from './api/psi';
import { listGscSites, fetchGscPages, writeGsc } from './api/gsc';
import { fetchGa4Pages, writeGa4 } from './api/ga4';
import { parseBacklinksCsv, writeBacklinks, parseCsv } from './api/backlinks-csv';
import { readOldCrawl, oldPagesFromUrls, runCompare } from './compare';
import { buildReport } from './report';
import { buildRedirectEntries, REDIRECT_FORMATS } from './redirect-map';
import {
  connectGoogle, disconnectGoogle, getAccessToken, googleAuthed, googleClientSet,
  psiKeySet, setGoogleClient,
} from './api/google-auth';
import Sqlite from 'better-sqlite3';
import type {
  ApiConfig, ApiProgress, ApiRunSummary, CompareRunResult, CrawlConfig, QueryRequest,
} from '../shared/types';

export interface AppServices {
  reader: DbReader;
  projects: ProjectManager;
  crawler: CrawlManager;
}

export function createServices(): AppServices {
  const reader = new DbReader();
  const projects = new ProjectManager(reader);
  const crawler = new CrawlManager(() => reader.invalidate());
  return { reader, projects, crawler };
}

function focusedWindow(): BrowserWindow {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!win) throw new Error('No window');
  return win;
}

/** Basic shape validation at the IPC trust boundary. */
function validateQueryRequest(req: unknown): QueryRequest {
  const r = req as Partial<QueryRequest>;
  if (typeof r !== 'object' || r === null || typeof r.tab !== 'string') {
    throw new Error('Invalid query request');
  }
  return {
    tab: r.tab,
    filterId: typeof r.filterId === 'string' ? r.filterId : null,
    search: typeof r.search === 'string' ? r.search : null,
    sortCol: typeof r.sortCol === 'string' ? r.sortCol : null,
    sortDir: r.sortDir === 'asc' || r.sortDir === 'desc' ? r.sortDir : null,
    offset: Number.isFinite(r.offset) ? Math.max(0, Number(r.offset)) : 0,
    limit: Number.isFinite(r.limit) ? Math.min(10000, Math.max(1, Number(r.limit))) : 100,
  };
}

export function registerIpc(services: AppServices): void {
  const { reader, projects, crawler } = services;

  // ---- Project lifecycle -------------------------------------------------
  ipcMain.handle('dialog:newProject', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(focusedWindow(), {
      title: 'New Project',
      defaultPath: 'crawl.pulse',
      filters: [{ name: 'Pulse SEO Project', extensions: ['pulse'] }],
    });
    if (canceled || !filePath) return null;
    return projects.open(filePath);
  });

  ipcMain.handle('dialog:openProject', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(focusedWindow(), {
      title: 'Open Project',
      filters: [{ name: 'Pulse SEO Project', extensions: ['pulse'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return null;
    return projects.open(filePaths[0]);
  });

  ipcMain.handle('project:current', () => projects.info());
  ipcMain.handle('project:close', () => {
    if (crawler.running) throw new Error('Stop the crawl before closing the project');
    projects.close();
    return true;
  });

  ipcMain.handle('config:get', () => projects.getConfig());
  ipcMain.handle('config:set', (_e, config: CrawlConfig) => {
    projects.setConfig(config);
    return true;
  });

  // ---- Crawl control -----------------------------------------------------
  ipcMain.handle('crawl:start', (_e, config: CrawlConfig) => {
    if (!projects.path) throw new Error('Open or create a project first');
    if (crawler.running) throw new Error('A crawl is already running');
    projects.setConfig(config);
    // Reader must not hold a snapshot while the worker rebuilds tables.
    crawler.start(projects.path, config);
    return true;
  });
  ipcMain.handle('crawl:pause', () => crawler.pause());
  ipcMain.handle('crawl:resume', () => crawler.resume());
  ipcMain.handle('crawl:stop', () => crawler.stop());
  ipcMain.handle('crawl:status', () => ({
    running: crawler.running,
    progress: crawler.progress,
  }));

  // ---- Queries -----------------------------------------------------------
  ipcMain.handle('query:rows', (_e, req: unknown) => {
    reader.invalidate();
    return reader.query(validateQueryRequest(req));
  });
  ipcMain.handle('query:rowsLive', (_e, req: unknown) => reader.query(validateQueryRequest(req)));
  ipcMain.handle('query:overview', () => {
    reader.invalidate();
    return reader.overview();
  });
  ipcMain.handle('query:detail', (_e, url: string) => {
    if (typeof url !== 'string') throw new Error('Invalid URL');
    return reader.detail(url);
  });
  ipcMain.handle('query:htmlSource', (_e, url: string, which: 'raw' | 'rendered') => {
    if (typeof url !== 'string' || (which !== 'raw' && which !== 'rendered')) {
      throw new Error('Invalid arguments');
    }
    return reader.htmlSource(url, which);
  });
  ipcMain.handle('checks:list', () => CHECKS);
  ipcMain.handle('query:graph', (_e, nodeCap: unknown) => {
    reader.invalidate();
    const cap = Number.isFinite(nodeCap) ? Math.min(5000, Math.max(50, Number(nodeCap))) : undefined;
    return reader.graph(cap);
  });

  // ---- Export ------------------------------------------------------------
  ipcMain.handle(
    'export:view',
    (_e, req: unknown, format: 'csv' | 'xlsx', name: string) => {
      const q = validateQueryRequest(req);
      const safeName = String(name).replace(/[^a-z0-9-_]/gi, '_').slice(0, 60) || 'export';
      if (format !== 'csv' && format !== 'xlsx') throw new Error('Invalid format');
      return exportView(focusedWindow(), reader, q, format, safeName);
    }
  );

  // ---- Sitemap generation ------------------------------------------------
  ipcMain.handle('sitemap:generate', async (_e, baseUrl: unknown) => {
    if (typeof baseUrl !== 'string' || !/^https?:\/\//i.test(baseUrl)) {
      return { ok: false, error: 'A valid site base URL is required' };
    }
    const built = reader.buildSitemaps(baseUrl);
    if (built.files.length === 0) return { ok: false, error: 'No indexable pages to include' };

    const { canceled, filePaths } = await dialog.showOpenDialog(focusedWindow(), {
      title: 'Choose a folder to write the sitemap files into',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || filePaths.length === 0) return { ok: false };

    const dir = filePaths[0];
    try {
      const written: string[] = [];
      for (const f of built.files) {
        const p = join(dir, f.name);
        await writeFile(p, f.xml, 'utf8');
        written.push(p);
      }
      return { ok: true, files: written, urlCount: built.urlCount, imageCount: built.imageCount };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('export:all', (_e, format: unknown) => {
    if (format !== 'csv' && format !== 'xlsx') throw new Error('Invalid format');
    reader.invalidate();
    const name = projects.info()?.name ?? 'crawl';
    return exportAll(focusedWindow(), reader, format, name);
  });

  // ---- Branded DOCX report -------------------------------------------------
  ipcMain.handle('report:generate', async () => {
    if (!projects.path) return { ok: false, error: 'Open or create a project first' };
    const name = projects.info()?.name ?? 'crawl';
    const { canceled, filePath } = await dialog.showSaveDialog(focusedWindow(), {
      title: 'Save crawl report',
      defaultPath: `${name}-report.docx`,
      filters: [{ name: 'Word document', extensions: ['docx'] }],
    });
    if (canceled || !filePath) return { ok: false };
    try {
      const db = new Sqlite(projects.path, { readonly: true, fileMustExist: true });
      try {
        const buf = await buildReport(db);
        await writeFile(filePath, buf);
      } finally {
        db.close();
      }
      return { ok: true, path: filePath };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ---- Migration redirect map ----------------------------------------------
  ipcMain.handle('redirects:export', async () => {
    if (!projects.path) return { ok: false, error: 'Open or create a project first' };
    try {
      const db = new Sqlite(projects.path, { readonly: true, fileMustExist: true });
      let entries;
      try {
        entries = buildRedirectEntries(db);
      } finally {
        db.close();
      }
      if (entries.length === 0) {
        return { ok: false, error: 'No missing/broken URLs in compare results — run Compare first' };
      }
      const { canceled, filePaths } = await dialog.showOpenDialog(focusedWindow(), {
        title: 'Choose a folder for the redirect files',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (canceled || filePaths.length === 0) return { ok: false };
      const written: string[] = [];
      for (const fmt of Object.values(REDIRECT_FORMATS)) {
        const p = join(filePaths[0], fmt.name);
        await writeFile(p, fmt.render(entries), 'utf8');
        written.push(p);
      }
      const withTarget = entries.filter((e) => e.target).length;
      return { ok: true, files: written, total: entries.length, withTarget };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  // ---- API integrations (Phase 7) ------------------------------------------
  // Imports run in main on a short-lived WRITE connection; the worker owns
  // writes only during a crawl, so refuse API imports while one is running.
  const withWriteDb = <T>(fn: (db: Database.Database) => T): T => {
    if (!projects.path) throw new Error('Open or create a project first');
    if (crawler.running) throw new Error('Wait for the crawl to finish first');
    const db = openProjectDb(projects.path);
    try {
      return fn(db);
    } finally {
      db.close();
      reader.invalidate();
    }
  };

  const sendApiProgress = (p: ApiProgress): void => {
    try {
      focusedWindow().webContents.send('api:progress', p);
    } catch {
      // no window — progress is cosmetic
    }
  };

  const asSummary = (err: unknown): ApiRunSummary => ({
    ok: false,
    written: 0,
    error: err instanceof Error ? err.message : String(err),
  });

  ipcMain.handle('api:status', () => {
    const g = googleAuthed();
    return {
      googleAuthed: g.authed,
      googleEmail: g.email,
      googleClientSet: googleClientSet(),
      psiKeySet: psiKeySet(),
    };
  });

  ipcMain.handle('api:config:get', () => withWriteDb((db) => getApiConfig(db)));
  ipcMain.handle('api:config:set', (_e, config: ApiConfig) => {
    withWriteDb((db) => setApiConfig(db, config));
    return true;
  });

  ipcMain.handle('api:psi:setKey', (_e, key: unknown) => {
    if (typeof key !== 'string') throw new Error('Invalid key');
    if (key.trim()) setSecret(ACCOUNTS.psiApiKey, key.trim());
    else deleteSecret(ACCOUNTS.psiApiKey);
    return true;
  });

  ipcMain.handle('api:google:setClient', (_e, clientId: unknown, clientSecret: unknown) => {
    if (typeof clientId !== 'string' || typeof clientSecret !== 'string') {
      throw new Error('Invalid client credentials');
    }
    setGoogleClient(clientId.trim(), clientSecret.trim());
    return true;
  });

  ipcMain.handle('api:google:connect', () => connectGoogle());
  ipcMain.handle('api:google:disconnect', () => {
    disconnectGoogle();
    return true;
  });

  ipcMain.handle('api:gsc:sites', async () => {
    const token = await getAccessToken();
    return listGscSites(fetch, token);
  });

  ipcMain.handle('api:gsc:run', async (_e, property: unknown, days: unknown): Promise<ApiRunSummary> => {
    try {
      if (typeof property !== 'string' || !property.trim()) {
        throw new Error('Choose a Search Console property first');
      }
      const d = Number.isFinite(days) ? Math.min(480, Math.max(1, Number(days))) : 90;
      const token = await getAccessToken();
      sendApiProgress({ kind: 'gsc', done: 0, total: 1, message: 'Querying Search Console…' });
      const rows = await fetchGscPages(fetch, token, property.trim(), d);
      const { written, orphans } = withWriteDb((db) => writeGsc(db, rows));
      sendApiProgress({ kind: 'gsc', done: 1, total: 1 });
      return { ok: true, written, unmatched: orphans };
    } catch (err) {
      return asSummary(err);
    }
  });

  ipcMain.handle('api:ga4:run', async (_e, property: unknown, days: unknown): Promise<ApiRunSummary> => {
    try {
      if (typeof property !== 'string' || !/\d/.test(property)) {
        throw new Error('Enter the numeric GA4 property ID first');
      }
      const d = Number.isFinite(days) ? Math.min(480, Math.max(1, Number(days))) : 90;
      const token = await getAccessToken();
      sendApiProgress({ kind: 'ga4', done: 0, total: 1, message: 'Querying GA4…' });
      const rows = await fetchGa4Pages(fetch, token, property.trim(), d);
      const { written, unmatched } = withWriteDb((db) => writeGa4(db, rows));
      sendApiProgress({ kind: 'ga4', done: 1, total: 1 });
      return { ok: true, written, unmatched };
    } catch (err) {
      return asSummary(err);
    }
  });

  ipcMain.handle(
    'api:psi:run',
    async (_e, strategy: unknown, maxUrls: unknown): Promise<ApiRunSummary> => {
      try {
        const apiKey = getSecret(ACCOUNTS.psiApiKey);
        if (!apiKey) throw new Error('Set a PageSpeed Insights API key first');
        const strat = strategy === 'desktop' ? 'desktop' : 'mobile';
        const max = Number.isFinite(maxUrls) ? Math.min(500, Math.max(1, Number(maxUrls))) : 25;
        if (!projects.path) throw new Error('Open or create a project first');
        if (crawler.running) throw new Error('Wait for the crawl to finish first');

        // Long-running: keep one write connection for the whole batch.
        const db = openProjectDb(projects.path);
        try {
          const urls = selectPsiUrls(db, max);
          if (urls.length === 0) throw new Error('No crawled HTML pages to test');
          const result = await runPsi(db, urls, {
            apiKey,
            strategy: strat,
            fetchImpl: fetch,
            onProgress: (done, total, url) =>
              sendApiProgress({ kind: 'psi', done, total, message: url }),
          });
          return {
            ok: result.written > 0,
            written: result.written,
            failed: result.failed,
            error: result.errors.length ? result.errors.slice(0, 3).join('; ') : undefined,
          };
        } finally {
          db.close();
          reader.invalidate();
        }
      } catch (err) {
        return asSummary(err);
      }
    }
  );

  // ---- Staging comparison (Phase 8) ----------------------------------------
  ipcMain.handle('compare:run', async (): Promise<CompareRunResult> => {
    try {
      if (!projects.path) throw new Error('Open or create a project first');
      const { canceled, filePaths } = await dialog.showOpenDialog(focusedWindow(), {
        title: 'Choose the "before" crawl (.pulse) or a CSV of old URLs',
        filters: [
          { name: 'Pulse project or CSV', extensions: ['pulse', 'csv'] },
          { name: 'Pulse SEO Project', extensions: ['pulse'] },
          { name: 'CSV', extensions: ['csv'] },
        ],
        properties: ['openFile'],
      });
      if (canceled || filePaths.length === 0) return { ok: false };
      const source = filePaths[0];
      if (source === projects.path) {
        return { ok: false, error: 'Choose a different file — that is the current project' };
      }

      let oldPages;
      if (/\.csv$/i.test(source)) {
        // Any cell that looks like a URL counts — handles headerless single-column
        // lists and multi-column exports alike.
        const cells = parseCsv(await readFile(source, 'utf8')).flat();
        oldPages = oldPagesFromUrls(cells);
      } else {
        const oldDb = new Sqlite(source, { readonly: true, fileMustExist: true });
        try {
          oldPages = readOldCrawl(oldDb);
        } finally {
          oldDb.close();
        }
      }
      if (oldPages.length === 0) {
        return { ok: false, error: 'No usable URLs found in the selected file' };
      }

      const summary = withWriteDb((db) => runCompare(db, oldPages));
      return { ok: true, source, summary };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('api:backlinks:import', async (): Promise<ApiRunSummary> => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(focusedWindow(), {
        title: 'Import backlinks CSV',
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        properties: ['openFile'],
      });
      if (canceled || filePaths.length === 0) return { ok: false, written: 0 };
      const text = await readFile(filePaths[0], 'utf8');
      const parsed = parseBacklinksCsv(text);
      if ('error' in parsed) return { ok: false, written: 0, error: parsed.error };
      const written = withWriteDb((db) => writeBacklinks(db, parsed.rows, parsed.provider));
      return { ok: true, written, unmatched: parsed.skipped, provider: parsed.provider };
    } catch (err) {
      return asSummary(err);
    }
  });
}
