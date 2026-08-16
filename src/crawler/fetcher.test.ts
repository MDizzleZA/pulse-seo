import { describe, it, expect, afterAll } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchUrl, headersFromConfig } from './fetcher';

describe('headersFromConfig', () => {
  it('builds basic auth and lowercases custom header names', () => {
    const h = headersFromConfig({
      basicAuthUser: 'marcos',
      basicAuthPass: 's3cret',
      customHeaders: [
        { name: 'X-Bypass-Token', value: 'abc' },
        { name: '  ', value: 'ignored' },
      ],
    });
    expect(h['x-bypass-token']).toBe('abc');
    expect(h['authorization']).toBe('Basic ' + Buffer.from('marcos:s3cret').toString('base64'));
    expect(Object.keys(h)).toHaveLength(2);
  });

  it('lets an explicit Authorization custom header win over basic auth fields', () => {
    const h = headersFromConfig({
      basicAuthUser: 'ignored',
      basicAuthPass: 'ignored',
      customHeaders: [{ name: 'Authorization', value: 'Bearer tok' }],
    });
    expect(h['authorization']).toBe('Bearer tok');
  });

  it('returns an empty record when nothing is configured', () => {
    expect(headersFromConfig({ basicAuthUser: '', basicAuthPass: '', customHeaders: [] })).toEqual({});
  });
});

describe('fetchUrl header injection', () => {
  let server: Server | null = null;

  afterAll(() => {
    server?.close();
  });

  it('sends custom headers and auth on the actual request', async () => {
    let seen: IncomingMessage['headers'] = {};
    server = createServer((req, res) => {
      seen = req.headers;
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><head><title>ok</title></head><body>hi</body></html>');
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;

    const extra = headersFromConfig({
      basicAuthUser: 'u',
      basicAuthPass: 'p',
      customHeaders: [{ name: 'X-Test', value: 'pulse' }],
    });
    const res = await fetchUrl(
      `http://127.0.0.1:${port}/`, 'TestAgent/1.0', true, 5000, true, extra
    );

    expect(res.status).toBe(200);
    expect(seen['x-test']).toBe('pulse');
    expect(seen['authorization']).toBe('Basic ' + Buffer.from('u:p').toString('base64'));
    expect(seen['user-agent']).toBe('TestAgent/1.0');
  });
});
