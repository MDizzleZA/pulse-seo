import type { CrawlConfig } from '../shared/types';

/** Normalize a URL for dedupe: strip fragment, default ports, lowercase host/scheme. */
export function normalizeUrl(raw: string, base?: string): string | null {
  let u: URL;
  try {
    u = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  if (
    (u.protocol === 'http:' && u.port === '80') ||
    (u.protocol === 'https:' && u.port === '443')
  ) {
    u.port = '';
  }
  return u.href;
}

/** Apply query-parameter policy from config. */
export function applyParamPolicy(url: string, config: CrawlConfig): string {
  if (config.queryParams === 'crawl') return url;
  try {
    const u = new URL(url);
    if (config.queryParams === 'strip') {
      u.search = '';
    } else {
      for (const p of config.stripParams) u.searchParams.delete(p);
    }
    return u.href;
  } catch {
    return url;
  }
}

/** Base domain used for internal/subdomain scope, derived from the start URL host. */
export function baseDomainOf(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

export function isInternalUrl(url: string, baseDomain: string, crawlSubdomains: boolean): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const bare = host.replace(/^www\./, '');
  if (bare === baseDomain) return true;
  if (crawlSubdomains && bare.endsWith('.' + baseDomain)) return true;
  return false;
}

export interface ScopeRules {
  include: RegExp[];
  exclude: RegExp[];
}

export function compileScopeRules(config: CrawlConfig): ScopeRules {
  const compile = (patterns: string[]): RegExp[] => {
    const out: RegExp[] = [];
    for (const p of patterns) {
      if (!p.trim()) continue;
      try {
        out.push(new RegExp(p.trim(), 'i'));
      } catch {
        // invalid user regex: fall back to substring containment
        out.push(new RegExp(p.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      }
    }
    return out;
  };
  return { include: compile(config.includePatterns), exclude: compile(config.excludePatterns) };
}

export function inScope(url: string, rules: ScopeRules): boolean {
  if (rules.exclude.some((r) => r.test(url))) return false;
  if (rules.include.length > 0 && !rules.include.some((r) => r.test(url))) return false;
  return true;
}

const BINARY_EXT =
  /\.(zip|rar|7z|gz|tar|exe|dmg|pkg|msi|pdf|doc|docx|xls|xlsx|ppt|pptx|mp3|mp4|avi|mov|wmv|webm|ogg|wav|flv|swf|woff2?|ttf|otf|eot|ico)(\?|$)/i;

export function looksLikeBinary(url: string): boolean {
  return BINARY_EXT.test(url);
}

export function looksLikeImage(url: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif|svg|bmp)(\?|$)/i.test(url);
}
