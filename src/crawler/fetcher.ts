import { request } from 'undici';
import { gunzipSync, inflateSync, inflateRawSync, brotliDecompressSync } from 'zlib';
import type { CrawlConfig } from '../shared/types';

/**
 * Extra request headers from crawl config: custom headers plus HTTP Basic auth.
 * An explicit custom `authorization` header wins over the basic-auth fields.
 */
export function headersFromConfig(
  config: Pick<CrawlConfig, 'basicAuthUser' | 'basicAuthPass' | 'customHeaders'>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of config.customHeaders ?? []) {
    const name = h.name.trim().toLowerCase();
    if (name) out[name] = h.value;
  }
  if (!out['authorization'] && config.basicAuthUser) {
    out['authorization'] =
      'Basic ' + Buffer.from(`${config.basicAuthUser}:${config.basicAuthPass}`).toString('base64');
  }
  return out;
}

export interface RedirectHop {
  url: string;
  status: number;
}

export interface FetchResult {
  ok: boolean;
  status: number;
  statusText: string;
  finalUrl: string;
  redirectChain: RedirectHop[]; // hops before the final response
  headers: Record<string, string>;
  contentType: string;
  body: Buffer | null;
  size: number;
  responseMs: number;
  error?: string;
}

const MAX_REDIRECTS = 10;
const MAX_BODY = 15 * 1024 * 1024;

const STATUS_TEXT: Record<number, string> = {
  200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently',
  302: 'Found', 303: 'See Other', 304: 'Not Modified', 307: 'Temporary Redirect',
  308: 'Permanent Redirect', 400: 'Bad Request', 401: 'Unauthorized',
  403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 410: 'Gone',
  429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway',
  503: 'Service Unavailable', 504: 'Gateway Timeout',
};

export function statusText(code: number): string {
  return STATUS_TEXT[code] ?? '';
}

/**
 * undici.request does NOT decompress bodies (unlike fetch), and we advertise
 * accept-encoding — so decode per Content-Encoding here. Encodings are applied
 * by servers left-to-right, so decode right-to-left. On any failure return the
 * bytes as-is rather than dropping the response.
 */
function decompressBody(body: Buffer, contentEncoding: string): Buffer {
  const encodings = contentEncoding
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e && e !== 'identity');
  let out = body;
  try {
    for (const enc of encodings.reverse()) {
      if (enc === 'gzip' || enc === 'x-gzip') out = gunzipSync(out);
      else if (enc === 'deflate') {
        try {
          out = inflateSync(out);
        } catch {
          out = inflateRawSync(out); // some servers send raw deflate
        }
      } else if (enc === 'br') out = brotliDecompressSync(out);
    }
  } catch {
    return body;
  }
  return out;
}

function flattenHeaders(h: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  return out;
}

/**
 * Fetch a URL following redirects manually so the full chain is recorded.
 * Body is only read when readBody is true (HTML pages we intend to parse).
 */
export async function fetchUrl(
  url: string,
  userAgent: string,
  readBody: boolean,
  timeoutMs = 30000,
  followRedirects = true,
  extraHeaders: Record<string, string> = {}
): Promise<FetchResult> {
  const started = Date.now();
  const chain: RedirectHop[] = [];
  let current = url;
  const maxHops = followRedirects ? MAX_REDIRECTS : 0;

  for (let hop = 0; hop <= maxHops; hop++) {
    let res;
    try {
      res = await request(current, {
        method: 'GET',
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
        headers: {
          'user-agent': userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          'accept-encoding': 'gzip, deflate, br',
          ...extraHeaders,
        },
      });
    } catch (err) {
      return {
        ok: false, status: 0, statusText: '', finalUrl: current, redirectChain: chain,
        headers: {}, contentType: '', body: null, size: 0,
        responseMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const headers = flattenHeaders(res.headers as Record<string, string | string[] | undefined>);
    const status = res.statusCode;

    if (status >= 300 && status < 400 && headers['location'] && hop < maxHops) {
      chain.push({ url: current, status });
      await res.body.dump().catch(() => undefined);
      let next: string;
      try {
        next = new URL(headers['location'], current).href;
      } catch {
        return {
          ok: false, status, statusText: statusText(status), finalUrl: current,
          redirectChain: chain, headers, contentType: '', body: null, size: 0,
          responseMs: Date.now() - started, error: 'Invalid redirect location',
        };
      }
      if (chain.some((h) => h.url === next) || next === current) {
        return {
          ok: false, status, statusText: 'Redirect Loop', finalUrl: current,
          redirectChain: chain, headers, contentType: '', body: null, size: 0,
          responseMs: Date.now() - started, error: 'Redirect loop detected',
        };
      }
      current = next;
      continue;
    }

    const contentType = (headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    let body: Buffer | null = null;
    let size = Number(headers['content-length'] ?? 0) || 0;

    const isTextual =
      contentType.includes('html') || contentType.includes('xml') || contentType.includes('text');
    const isRedirect = status >= 300 && status < 400;
    if (readBody && isTextual && !isRedirect) {
      try {
        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of res.body) {
          const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += b.length;
          if (total > MAX_BODY) break;
          chunks.push(b);
        }
        body = Buffer.concat(chunks);
        if (headers['content-encoding']) body = decompressBody(body, headers['content-encoding']);
        size = body.length;
      } catch (err) {
        return {
          ok: false, status, statusText: statusText(status), finalUrl: current,
          redirectChain: chain, headers, contentType, body: null, size: 0,
          responseMs: Date.now() - started,
          error: 'Body read failed: ' + (err instanceof Error ? err.message : String(err)),
        };
      }
    } else {
      await res.body.dump().catch(() => undefined);
    }

    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: statusText(status),
      finalUrl: current,
      redirectChain: chain,
      headers,
      contentType,
      body,
      size,
      responseMs: Date.now() - started,
    };
  }

  return {
    ok: false, status: 0, statusText: 'Too Many Redirects', finalUrl: current,
    redirectChain: chain, headers: {}, contentType: '', body: null, size: 0,
    responseMs: Date.now() - started, error: `More than ${MAX_REDIRECTS} redirects`,
  };
}

/** HEAD request (falling back to a 1-byte range GET) to get status + size of a resource. */
export async function probeResource(
  url: string,
  userAgent: string,
  timeoutMs = 15000,
  extraHeaders: Record<string, string> = {}
): Promise<{ status: number; bytes: number | null; contentType: string; error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': userAgent, ...extraHeaders },
    });
    if (res.status === 405 || res.status === 501) throw new Error('HEAD not allowed');
    const cl = res.headers.get('content-length');
    return {
      status: res.status,
      bytes: cl ? Number(cl) : null,
      contentType: (res.headers.get('content-type') ?? '').split(';')[0].trim(),
    };
  } catch {
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': userAgent, ...extraHeaders, range: 'bytes=0-0' },
      });
      await res.arrayBuffer().catch(() => undefined);
      let bytes: number | null = null;
      const cr = res.headers.get('content-range');
      if (cr) {
        const m = cr.match(/\/(\d+)$/);
        if (m) bytes = Number(m[1]);
      } else {
        const cl = res.headers.get('content-length');
        if (cl) bytes = Number(cl);
      }
      const status = res.status === 206 ? 200 : res.status;
      return {
        status,
        bytes,
        contentType: (res.headers.get('content-type') ?? '').split(';')[0].trim(),
      };
    } catch (err) {
      return {
        status: 0, bytes: null, contentType: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
