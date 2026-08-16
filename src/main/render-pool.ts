import { BrowserWindow, session } from 'electron';
import type { A11yViolation, RenderResult } from '../shared/types';

/** Injected after the settle delay when the accessibility audit is enabled. */
const AXE_RUN_SNIPPET = `
  (async () => {
    if (typeof window.axe === 'undefined') return { error: 'axe not loaded' };
    try {
      const r = await window.axe.run(document, {
        resultTypes: ['violations'],
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
      });
      return {
        violations: r.violations.slice(0, 100).map((v) => ({
          id: v.id,
          impact: v.impact || 'minor',
          help: String(v.help).slice(0, 200),
          nodes: v.nodes.length,
          sample: v.nodes[0] && v.nodes[0].target ? String(v.nodes[0].target[0]).slice(0, 200) : '',
        })),
      };
    } catch (e) {
      return { error: String(e && e.message || e) };
    }
  })()
`;

const RENDER_PARTITION = 'render-pool';
const HARD_TIMEOUT_MS = 45000;

interface PoolTask {
  url: string;
  waitMs: number;
  resolve: (r: RenderResult) => void;
}

/**
 * Pool of hidden BrowserWindows that execute JavaScript for crawled pages
 * using Electron's bundled Chromium, then return the rendered DOM.
 */
export class RenderPool {
  private size: number;
  private userAgent: string;
  private windows: BrowserWindow[] = [];
  private busy = new Set<BrowserWindow>();
  private queue: PoolTask[] = [];
  private destroyed = false;
  /** axe-core source to inject per page; audit disabled when null. */
  private axeSource: string | null;

  constructor(
    size: number,
    userAgent: string,
    extraHeaders: Record<string, string> = {},
    axeSource: string | null = null
  ) {
    this.size = Math.max(1, Math.min(size, 8));
    this.userAgent = userAgent;
    this.axeSource = axeSource;
    const ses = session.fromPartition(RENDER_PARTITION);
    ses.setUserAgent(this.userAgent);
    // Inject crawl auth / custom headers into every request the hidden windows
    // make (documents and subresources), mirroring the worker's fetch headers.
    const entries = Object.entries(extraHeaders);
    if (entries.length > 0) {
      ses.webRequest.onBeforeSendHeaders((details, callback) => {
        for (const [name, value] of entries) details.requestHeaders[name] = value;
        callback({ requestHeaders: details.requestHeaders });
      });
    }
  }

  private createWindow(): BrowserWindow {
    const win = new BrowserWindow({
      show: false,
      width: 1366,
      height: 900,
      webPreferences: {
        partition: RENDER_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        images: true,
        webgl: false,
        backgroundThrottling: false,
      },
    });
    win.webContents.setAudioMuted(true);
    return win;
  }

  render(url: string, waitMs: number): Promise<RenderResult> {
    if (this.destroyed) {
      return Promise.resolve({ ok: false, html: '', error: 'Render pool destroyed' });
    }
    return new Promise((resolve) => {
      this.queue.push({ url, waitMs, resolve });
      this.pump();
    });
  }

  private pump(): void {
    if (this.destroyed) return;
    while (this.queue.length > 0) {
      let win = this.windows.find((w) => !this.busy.has(w) && !w.isDestroyed());
      if (!win && this.windows.filter((w) => !w.isDestroyed()).length < this.size) {
        win = this.createWindow();
        this.windows.push(win);
      }
      if (!win) return; // all busy
      const task = this.queue.shift()!;
      this.busy.add(win);
      this.renderInWindow(win, task).finally(() => {
        this.busy.delete(win!);
        this.pump();
      });
    }
  }

  private async renderInWindow(win: BrowserWindow, task: PoolTask): Promise<void> {
    const done = (r: RenderResult): void => task.resolve(r);
    const timeout = setTimeout(() => {
      try {
        win.webContents.stop();
      } catch {
        // ignore
      }
    }, HARD_TIMEOUT_MS);

    // Capture JS console errors emitted while this page renders (capped at 20).
    // Handles both the modern event-object shape and the legacy positional args.
    const consoleErrors: string[] = [];
    const onConsole = (...args: unknown[]): void => {
      if (consoleErrors.length >= 20) return;
      const e = args[0] as { level?: string | number; message?: string; sourceId?: string; lineNumber?: number };
      const isError = e?.level === 'error' || args[1] === 3;
      if (!isError) return;
      const message = String(e?.message ?? args[2] ?? '');
      const source = e?.sourceId ?? (args[4] as string | undefined);
      const line = e?.lineNumber ?? (args[3] as number | undefined);
      consoleErrors.push(`${message}${source ? ` (${source}:${line ?? 0})` : ''}`.slice(0, 500));
    };
    type ConsoleListenable = {
      on(event: 'console-message', listener: (...args: unknown[]) => void): void;
      removeListener(event: 'console-message', listener: (...args: unknown[]) => void): void;
    };
    (win.webContents as unknown as ConsoleListenable).on('console-message', onConsole);

    try {
      await win.loadURL(task.url, { userAgent: this.userAgent });
      // settle delay for late JS mutations / XHR content
      await new Promise((r) => setTimeout(r, task.waitMs));
      if (win.isDestroyed()) {
        done({ ok: false, html: '', error: 'Window destroyed' });
        return;
      }
      const html = (await win.webContents.executeJavaScript(
        'document.documentElement ? document.documentElement.outerHTML : ""',
        true
      )) as string;
      let a11y: A11yViolation[] | undefined;
      if (this.axeSource) {
        try {
          await win.webContents.executeJavaScript(this.axeSource, true);
          const res = (await win.webContents.executeJavaScript(AXE_RUN_SNIPPET, true)) as
            | { violations?: A11yViolation[]; error?: string }
            | null;
          if (res?.violations) a11y = res.violations;
        } catch {
          // audit failure shouldn't fail the render
        }
      }
      done({ ok: true, html: '<!DOCTYPE html>' + html, consoleErrors, a11y });
    } catch (err) {
      // loadURL rejects on http errors too (did-fail-load); try to grab whatever rendered.
      try {
        const html = (await win.webContents.executeJavaScript(
          'document.documentElement ? document.documentElement.outerHTML : ""',
          true
        )) as string;
        if (html && html.length > 100) {
          done({ ok: true, html: '<!DOCTYPE html>' + html, consoleErrors });
          return;
        }
      } catch {
        // fall through
      }
      done({ ok: false, html: '', error: err instanceof Error ? err.message : String(err) });
    } finally {
      clearTimeout(timeout);
      if (!win.isDestroyed()) {
        (win.webContents as unknown as ConsoleListenable).removeListener(
          'console-message', onConsole
        );
        win.loadURL('about:blank').catch(() => undefined);
      }
    }
  }

  destroy(): void {
    this.destroyed = true;
    for (const t of this.queue) t.resolve({ ok: false, html: '', error: 'Cancelled' });
    this.queue = [];
    for (const w of this.windows) {
      if (!w.isDestroyed()) w.destroy();
    }
    this.windows = [];
  }
}
