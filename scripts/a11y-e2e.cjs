// Verifies axe-core injection under real Electron Chromium: loads a page with
// known WCAG violations, injects axe.min.js, runs the same snippet RenderPool
// uses, and asserts the expected rules fire.  Run: npx electron scripts/a11y-e2e.cjs
const { app, BrowserWindow } = require('electron');
const { readFileSync } = require('fs');

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

const BAD_PAGE = `<!DOCTYPE html><html><head><title>t</title></head>
<body>
  <img src="x.png">
  <input type="text">
  <a href="#"></a>
</body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(BAD_PAGE));
  const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  await win.webContents.executeJavaScript(axeSource, true);
  const res = await win.webContents.executeJavaScript(AXE_RUN_SNIPPET, true);
  if (!res || res.error || !Array.isArray(res.violations)) {
    console.error('A11Y E2E FAILED:', res && res.error);
    app.exit(1);
    return;
  }
  const ids = res.violations.map((v) => v.id);
  console.log('violations:', JSON.stringify(res.violations.map((v) => `${v.impact}:${v.id}(${v.nodes})`)));
  const ok =
    ids.includes('image-alt') &&      // img without alt
    ids.includes('html-has-lang') &&  // missing lang attribute
    res.violations.every((v) => typeof v.help === 'string' && typeof v.nodes === 'number');
  console.log(ok ? 'A11Y E2E PASSED' : 'A11Y E2E FAILED — expected rules missing');
  app.exit(ok ? 0 : 1);
});
