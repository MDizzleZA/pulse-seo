import { Worker } from 'worker_threads';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';
import { BrowserWindow } from 'electron';

const nodeRequire = createRequire(import.meta.url);
import { RenderPool } from './render-pool';
import { headersFromConfig } from '../crawler/fetcher';
import type { CrawlConfig, CrawlProgress } from '../shared/types';

/** Spawns and controls the crawler worker; bridges render requests to the pool. */
export class CrawlManager {
  private worker: Worker | null = null;
  private renderPool: RenderPool | null = null;
  private lastProgress: CrawlProgress = {
    phase: 'idle', crawled: 0, queued: 0, errors: 0, total: 0, urlsPerSec: 0, currentUrl: '',
  };
  private onInvalidateRead: () => void;

  constructor(onInvalidateRead: () => void) {
    this.onInvalidateRead = onInvalidateRead;
  }

  get running(): boolean {
    return this.worker !== null;
  }

  get progress(): CrawlProgress {
    return this.lastProgress;
  }

  start(projectPath: string, config: CrawlConfig): void {
    if (this.worker) throw new Error('A crawl is already running');

    if (config.renderJs) {
      let axeSource: string | null = null;
      if (config.a11yAudit) {
        try {
          axeSource = readFileSync(nodeRequire.resolve('axe-core/axe.min.js'), 'utf8');
        } catch (err) {
          console.error('[crawl] axe-core unavailable, accessibility audit skipped:', err);
        }
      }
      this.renderPool = new RenderPool(
        config.renderConcurrency,
        config.userAgent,
        headersFromConfig(config),
        axeSource
      );
    }

    this.lastProgress = {
      phase: 'crawling', crawled: 0, queued: 0, errors: 0, total: 0, urlsPerSec: 0, currentUrl: '',
    };

    const workerPath = join(__dirname, 'crawler-worker.js');
    this.worker = new Worker(workerPath, { workerData: { projectPath, config } });

    this.worker.on('message', (msg: { type: string; [k: string]: unknown }) => {
      if (msg.type === 'progress') {
        this.lastProgress = msg.progress as CrawlProgress;
        this.broadcast('crawl:progress', this.lastProgress);
      } else if (msg.type === 'render-request') {
        const { id, url, waitMs } = msg as unknown as { id: number; url: string; waitMs: number };
        const pool = this.renderPool;
        if (!pool) {
          this.worker?.postMessage({
            type: 'render-result', id,
            result: { ok: false, html: '', error: 'No render pool' },
          });
          return;
        }
        pool.render(url, waitMs).then((result) => {
          this.worker?.postMessage({ type: 'render-result', id, result });
        });
      } else if (msg.type === 'done') {
        this.lastProgress = { ...this.lastProgress, phase: msg.stopped ? 'stopped' : 'done' };
        this.finish();
        this.broadcast('crawl:done', this.lastProgress);
      } else if (msg.type === 'error') {
        this.lastProgress = {
          ...this.lastProgress, phase: 'error', message: String(msg.message),
        };
        this.finish();
        this.broadcast('crawl:done', this.lastProgress);
      } else if (msg.type === 'log') {
        this.broadcast('crawl:log', String(msg.message));
      }
    });

    this.worker.on('error', (err: Error) => {
      this.lastProgress = { ...this.lastProgress, phase: 'error', message: err.message };
      this.finish();
      this.broadcast('crawl:done', this.lastProgress);
    });
  }

  pause(): void {
    this.worker?.postMessage({ type: 'pause' });
    this.lastProgress = { ...this.lastProgress, phase: 'paused' };
    this.broadcast('crawl:progress', this.lastProgress);
  }

  resume(): void {
    this.worker?.postMessage({ type: 'resume' });
    this.lastProgress = { ...this.lastProgress, phase: 'crawling' };
    this.broadcast('crawl:progress', this.lastProgress);
  }

  stop(): void {
    this.worker?.postMessage({ type: 'stop' });
  }

  private finish(): void {
    const w = this.worker;
    this.worker = null;
    if (w) {
      w.terminate().catch(() => undefined);
    }
    if (this.renderPool) {
      this.renderPool.destroy();
      this.renderPool = null;
    }
    this.onInvalidateRead();
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }

  destroy(): void {
    if (this.worker) {
      this.worker.terminate().catch(() => undefined);
      this.worker = null;
    }
    this.renderPool?.destroy();
    this.renderPool = null;
  }
}
