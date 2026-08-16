// E2E for the MCP server: spawn over stdio, run the full handshake, call tools.
import { spawn } from 'node:child_process';

const pulseFile = process.argv[2];
if (!pulseFile) { console.error('usage: node mcp-e2e.mjs <file.pulse>'); process.exit(1); }

const proc = spawn('node', ['../out/main/mcp-server.js', pulseFile], {
  cwd: import.meta.dirname, stdio: ['pipe', 'pipe', 'inherit'],
});

let buf = '';
const pending = new Map();
proc.stdout.on('data', (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let seq = 0;
function rpc(method, params) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => { if (pending.has(id)) reject(new Error(`timeout: ${method}`)); }, 15000);
  });
}
function notify(method, params) {
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}
const text = (r) => JSON.parse(r.result.content[0].text);

const init = await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'e2e', version: '0' },
});
console.log('server:', init.result.serverInfo.name, init.result.serverInfo.version);
notify('notifications/initialized', {});

const tools = await rpc('tools/list', {});
console.log('tools:', tools.result.tools.map((t) => t.name).join(', '));

const overview = text(await rpc('tools/call', { name: 'pulse_overview', arguments: {} }));
console.log('crawl:', JSON.stringify(overview.crawl), '| issue kinds:', overview.issues.length);

const q = text(await rpc('tools/call', {
  name: 'pulse_query',
  arguments: { tab: 'response_codes', filter: 'client-error', limit: 3 },
}));
console.log('4xx total:', q.total, '| first:', q.rows[0]?.url ?? '(none)');

const sql = text(await rpc('tools/call', {
  name: 'pulse_sql',
  arguments: { query: 'SELECT COUNT(*) AS n, MAX(word_count) AS max_words FROM pages WHERE is_internal = 1' },
}));
console.log('sql:', JSON.stringify(sql.rows));

const homeRow = text(await rpc('tools/call', {
  name: 'pulse_sql',
  arguments: { query: "SELECT url FROM pages WHERE is_internal = 1 AND status = 200 AND content_type LIKE '%html%' LIMIT 1" },
}));
const detail = text(await rpc('tools/call', {
  name: 'pulse_page_detail', arguments: { url: homeRow.rows[0].url },
}));
console.log('detail:', detail.page.url, '| inlinks:', detail.inlinks.length, '| issues:', detail.issues.length, '| duplicates:', detail.duplicates.length);

// Write attempt must fail (readonly + SELECT guard).
const bad = await rpc('tools/call', { name: 'pulse_sql', arguments: { query: 'DELETE FROM pages' } });
console.log('write blocked:', bad.result.isError === true, '-', bad.result.content?.[0]?.text?.slice(0, 60));

// DOCX report generation.
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { readFileSync, rmSync } = await import('node:fs');
const reportPath = join(tmpdir(), `pulse-mcp-report-${Date.now()}.docx`);
const rep = text(await rpc('tools/call', { name: 'pulse_report', arguments: { out_path: reportPath } }));
const repBuf = readFileSync(reportPath);
const isDocx = repBuf.length > 1000 && repBuf[0] === 0x50 && repBuf[1] === 0x4b; // PK zip magic
console.log('report:', rep.bytes, 'bytes | valid docx:', isDocx);
rmSync(reportPath, { force: true });

const ok = init.result.serverInfo.name === 'pulseseo-pulse'
  && tools.result.tools.length === 9
  && overview.crawl.pages > 0
  && sql.rows[0].n > 0
  && detail.page
  && bad.result.isError === true
  && isDocx;
console.log(ok ? 'MCP E2E PASSED' : 'MCP E2E FAILED');
proc.kill();
process.exit(ok ? 0 : 1);
