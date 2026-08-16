# Pulse SEO — Engineering Handover

Desktop SEO crawler & site auditor (a Screaming Frog–class tool). Must ship as a
**standalone, distributable Windows .exe**. This document is the source of truth for
picking up the build.

_Last updated: 2026-07-14 (evening — quick-wins batch). **All phases (0–9) complete.**
Windows installer + portable .exe build in `release/`; live end-to-end crawl verified (see §6)._

**Quick-wins batch (2026-07-14):** Headers & Cookies detail tab (from stored response
headers), SERP snippet preview tab (Arial px-width truncation via `shared/serp-widths`),
Duplicates detail tab (exact via content_hash + near via simhash issue pairs),
redirect-chain column on Response Codes, pagination extraction (`rel_next`/`rel_prev`
columns, `SCHEMA_VERSION = 2` with in-place ALTER migration) + 2 pagination checks, and
the `site-ai-crawlers` check (robots.txt saved to meta `robots_txt`/`robots_origin` at
crawl start; GPTBot/ClaudeBot/PerplexityBot/etc. tested with `robots-parser`).

**Crawl auth batch (2026-07-14):** `basicAuthUser`/`basicAuthPass` + `customHeaders`
on `CrawlConfig` (new "Auth" section in ConfigDialog). `headersFromConfig()` in
`src/crawler/fetcher.ts` builds the record (custom headers lowercased; explicit
Authorization beats the basic-auth fields); the worker passes it to every `fetchUrl`/
`probeResource` (pages, robots.txt, sitemaps, image probes) and `CrawlManager` feeds
it to `RenderPool`, which injects via `session.webRequest.onBeforeSendHeaders` so JS
rendering works behind auth too. NOTE: values are stored in plain text in the .pulse
meta config (UI warns). E2E-verified against a local 401-gated server (zero
unauthorized hits across a full crawl).

**MCP server + perf batch (2026-07-14):** `src/mcp/server.ts` (bundled to
`out/main/mcp-server.js`, third main-config entry) exposes any .pulse file to MCP
clients over stdio, read-only: `pulse_open_project`, `pulse_overview`, `pulse_list_tabs`,
`pulse_query` (tab/filter/search — same engine as the UI grid), `pulse_page_detail`,
`pulse_list_checks`, `pulse_sql` (SELECT-only, readonly connection, blobs masked).
Register for Claude Code:
`claude mcp add pulse -- node path/to/pulse-seo/out/main/mcp-server.js "<path>.pulse"`
Runs under plain Node from the dev repo (needs node_modules — same dual-ABI note as the
smoke test; it is NOT usable from inside the packaged asar). E2E: `node scripts/mcp-e2e.mjs <file.pulse>`.
Perf (benchmarked on a synthetic 50k-page / 200k-link DB): `overview()` is ~90 aggregate
queries ≈ 570 ms → now memoised per DB snapshot (cleared on open/invalidate; repeats 0 ms);
COUNT wrappers no longer evaluate the select list's correlated subqueries; added
`idx_pages_desc` for the duplicate-description filter. Tab queries at 50k pages: 20–50 ms.
Renderer bundle is ~2.9 MB (ag-grid + d3) — deliberately not code-split; it loads once
from local disk in Electron, so splitting buys nothing.

**Segments + console capture batch (2026-07-14):** `CrawlConfig.segments` (regex on full
URL, first match wins; "Segments" section in ConfigDialog) → `src/crawler/segments.ts`
stamps `pages.segment` during the analysis phase (schema v3 adds `segment` and
`console_errors` columns via the migration list); Segment column on the Internal view and
in page detail. RenderPool now captures JS console errors per render (level=error, cap 20,
handles both modern event-object and legacy positional `console-message` shapes), stored
as JSON in `pages.console_errors`; surfaced as a "JS Errors" column + filter on the JS
Rendering view and the `render-console-errors` check. Segments verified live (a production-site
smoke crawl groups product/article pages correctly); console capture is unit-tested at the
DB/check layer — observing it end-to-end needs an in-app render-enabled crawl since the
render pool requires Electron windows.

**Branded reports batch (2026-07-15):** `src/main/report.ts` (pure Node — no Electron
imports) builds a Pulse SEO-branded DOCX (Montserrat, monochrome greys) from a crawl:
title page, crawl summary, per-category health scores, segments, full issue table by
severity, top-10 worst pages. Reached three ways: the **Report** toolbar button
(`report:generate` IPC, save dialog), the **`pulse_report` MCP tool** (writes to a given
path — Claude can produce the client deliverable directly), and `buildReport(db)` for
scripts. Uses the `docx` package (runtime dependency — ships in the exe). Gotcha fixed
along the way: the MCP server now opens each project with a brief WRITE connection first
so schema migrations run on older .pulse files (readonly connections can't migrate, and
post-v1 columns like `segment` are referenced unconditionally).

**Redirect map batch (2026-07-15):** `src/main/redirect-map.ts` turns Compare results
(old URLs now missing/broken) into deployable 301 files: `.htaccess`, nginx `location`
blocks, and a WordPress-Redirection-plugin CSV. Targets are suggested from the current
crawl by slug/title token overlap (Jaccard, slug-weighted 0.7/0.3); confidence tiers
high (≥0.6) / medium (≥0.3, emitted with a REVIEW comment) / none (commented TODO —
never deploys blind). Reached via the **Redirects** toolbar button (`redirects:export`
IPC, writes all three files to a chosen folder) and the **`pulse_redirect_map` MCP tool**
(returns file text). Workflow: Compare against the old crawl/CSV first, then export.

**Accessibility batch (2026-07-15):** axe-core audit during the JS-render pass, gated by
`CrawlConfig.a11yAudit` (Rendering settings; requires renderJs). CrawlManager reads
`axe-core/axe.min.js` via `createRequire` (main bundle is ESM — plain `require` doesn't
exist) and hands it to RenderPool, which injects it post-settle and runs WCAG 2.1 A/AA +
best-practice rules; up to 100 violations stored as JSON in `pages.a11y_violations`
(schema v4). Surfaced as: an Accessibility view (per-impact counts via `json_each`,
filters incl. critical/serious), an Accessibility detail tab (rule, help, node count,
sample selector), and three checks (`a11y-critical`/`-serious`/`-minor`). Injection
verified under real Electron: `npx electron scripts/a11y-e2e.cjs` loads a deliberately
broken page and asserts image-alt + html-has-lang fire. axe-core is a runtime dependency
(~570 KB source, ships in the exe).

**PWA viewer batch (2026-07-15):** `pwa/` is a standalone Vite/React PWA ("Pulse SEO
Viewer") that opens .pulse files fully client-side via sql.js (SQLite WASM) — drag-drop
or file picker, nothing uploaded anywhere. Browsers can't crawl (CORS / no sockets), so
the PWA is deliberately the *viewer/companion*: all tabs+filters, URL search, issues
sidebar with health scores, site-health headline, per-page detail drawer. It reuses the
exact desktop query engine — `buildTabQuery` and constants were extracted from db-reader
into `src/shared/tab-queries.ts` (pure SQL-string building) and are imported by both.
Commands: `npm run pwa:build` → static site in `pwa-dist/` (deploy anywhere);
`npm run pwa:dev` for dev. Installable (manifest + icons) and offline after first load
(cache-first service worker `pwa/public/sw.js` — bump its CACHE version when deploying
updates). GOTCHAS: sql.js's browser build requests `sql-wasm-browser.wasm` (NOT
sql-wasm.wasm) — it lives in `pwa/public/`; and `locateFile` must return an absolute URL
pinned to `document.baseURI`, else Emscripten resolves against /assets/ and the SPA
fallback feeds HTML to WebAssembly.instantiate. Verified in-browser against a production
crawl (422 URLs: tab counts, 4xx filter = 66, search, detail drawer all match the
desktop reader). Each view has an **Export CSV** button (pwa/src/export.ts): full
result set with current filter+search applied, paged 5k, BOM for Excel, downloaded
as a Blob; sets window.__lastExport metadata for tests.

**PWA launch-ready + online package batch (2026-07-15):** service worker is now
network-first for navigations (cache-first HTML would have frozen paying users on v1
forever), cache-first only for hashed assets; React ErrorBoundary around the app;
clickable column sorting (sortCol allowlisted against the tab catalog); CSV
formula-injection guard in export (leading ' for =,+,@,tab/CR and non-numeric '-';
unit-tested in pwa/src/export.test.ts); >300 MB open confirmation; version stamp via
vite define __APP_VERSION__. **`npm run pwa:package`** (scripts/package-online.mjs)
builds and assembles the deployable at `dist/viewer-online/`
(site/ + server/apache.htaccess + server/nginx.conf + README-DEPLOY.md + SECURITY.md,
templates in pwa/online/). The packager REFUSES to ship .pulse/.map files or bundles
containing desktop-only deps (exceljs/better-sqlite3) — guard verified by planting a
leak file. Security review in pwa/online/SECURITY.md: no raw-HTML APIs, parameterized
search, WASM-sandboxed input files, CSP/XFO/nosniff/HSTS in the server configs
(CSP needs 'wasm-unsafe-eval' for sql.js), SW caches app shell only; npm audit: 2
moderate advisories are desktop-only (uuid via exceljs), zero in the shipped bundle.
LAUNCH CONDITION: the app ships NO auth — the hosting layer must gate the path
(Cloudflare Access / basic auth / WP membership; see README-DEPLOY.md).

**PWA new-project batch (2026-07-15):** the viewer landing page now has **Start new
project** beside Open .pulse — it creates a blank, schema-only .pulse in-browser
(sql.js) and downloads it for the user to open and crawl in the desktop app, then bring
back. Schema constants were extracted to `src/db/schema-constants.ts` (pure data, no
better-sqlite3) so the PWA and desktop share one source of truth; `schema.ts` re-exports
them. `createEmptyProject()` in pwa/src/db.ts runs SCHEMA_STATEMENTS + writes
schema_version/config meta, copies out of the WASM heap into a plain ArrayBuffer before
close. Cross-engine round-trip is proven by `src/db/new-project.test.ts` (sql.js builds
the file → better-sqlite3 + openProjectDb open it: 17 tables, 0 pages, schema v4, valid
config) AND verified live in-browser (192 KB file, `SQLite format 3\0` header, opened
with desktop better-sqlite3 = CROSS-ENGINE OK). 74 tests green.

**Netlify package batch (2026-07-19):** `npm run pwa:package:netlify`
(scripts/package-netlify.mjs) assembles a ready-to-deploy Netlify site at
`dist/viewer-netlify/` — a **flat** publish folder (app + `_headers` +
`_redirects` + `netlify.toml` + README-NETLIFY.md + SECURITY.md) that works via drag-drop,
`netlify deploy`, or Git. Security headers/CSP live in `_headers` (authoritative, honored
in every deploy method); `_redirects` is the SPA fallback; `netlify.toml` sets `publish="."`
and `skip_processing=true` so Netlify doesn't mutate the hashed bundle. Templates in
`pwa/online/netlify/`. Shared build+hygiene logic extracted to `scripts/lib/build-pwa.mjs`
(used by both packagers); it invokes vite via `node node_modules/vite/bin/vite.js` directly
— NOT `npm.cmd` (Node 20+ refuses to spawn .cmd without a shell, and shells are avoided).
Same hygiene gate: no .pulse/.map, no exceljs/better-sqlite3 in the bundle. Smoke-tested by
serving the folder and creating a blank project (WASM loads, 192 KB SQLite produced). Auth
is still the host's job — Netlify password protection (Pro), Cloudflare Access/SSO
(recommended for per-seat), or Identity role-gating; see README-NETLIFY.md.

**Bulk export + GUI batch (2026-07-15):** `src/main/exporter-core.ts` (dialog-free, no
Electron imports — unit-testable) provides `buildWorkbook` (one XLSX: Summary + Issues
sheets, then a sheet per populated view) and `writeCsvFolder` (one CSV per view +
issues-summary.csv); `exportAll` in exporter.ts wraps them with dialogs (`export:all`
IPC). GUI: the six trailing toolbar buttons collapsed into one **Export ▾** dropdown
(current view CSV/XLSX, bulk XLSX/CSV, DOCX report, sitemap, redirect map — Compare
stays a button since it's an action); welcome screen when no project is open; Escape
closes the details pane; site-health headline number in the Issues sidebar; crawl
progress % label in the status bar; Pagination/Accessibility issue categories now route
to the right views from the sidebar. Welcome screen + new toolbar verified visually in
the dev app.

---

## 1. Quick facts

- **Location:** `path/to/pulse-seo`
- **Stack:** Electron 42 (pinned — see §2 native notes) + React 19 + TypeScript (strict) +
  Vite (via `electron-vite`), SQLite through `better-sqlite3`, `ag-grid` for tables,
  `d3` for visualizations.
- **Process model:**
  - **main** (`src/main/`) — Electron main process: project/window lifecycle, IPC, the
    read-only DB connection (`DbReader`), exporters, sitemap/graph generation.
  - **preload** (`src/preload/index.ts`) — exposes `window.pulse.*` to the renderer.
    Its `PulseApi = typeof api` type flows to the renderer via `src/renderer/src/pulse.d.ts`.
  - **renderer** (`src/renderer/`) — React UI.
  - **crawler worker** (`src/crawler/worker.ts`) — runs in a `worker_threads` worker,
    owns the **write** DB connection and the crawl loop. Bundled as `crawler-worker.js`.
  - **render pool** (`src/main/render-pool.ts`) — pool of hidden Electron `BrowserWindow`s
    for JS rendering. The worker requests renders over `postMessage`; `CrawlManager`
    (`src/main/crawl-manager.ts`) bridges worker ↔ pool.
- **Project file:** a `.pulse` file is a SQLite DB. Schema in `src/db/schema.ts`
  (`SCHEMA_STATEMENTS`, `SCHEMA_VERSION = 2`; post-v1 columns are added via the
  `PAGES_MIGRATIONS` ALTER list in `openProjectDb`, so old files upgrade in place).

## 2. Commands (run from the project dir)

```bash
npm run typecheck   # tsc for node + web projects — MUST stay clean
npm test            # vitest run — currently 72 tests / 18 files, all green
npm run build       # electron-vite build (main + preload + renderer bundles)
npm run dev         # launches the Electron app (dev)
npm run dist        # packages Windows NSIS installer + portable exe into release/
                    # KNOWN FLAKE: first run after code changes often fails with EPERM
                    # renaming win-unpacked.tmp (AV scan lock). Delete release/win-unpacked*
                    # and re-run — the retry reliably succeeds.
node scripts/smoke-crawl.mjs [url] [maxUrls]   # live crawl via the BUILT worker, plain Node
node scripts/mcp-e2e.mjs <file.pulse>          # MCP server E2E (handshake + all tools)
npx electron scripts/a11y-e2e.cjs              # axe-core injection E2E under Electron
npx electron scripts/verify-packaged.cjs       # native modules + worker-from-asar under Electron
```

**Native module setup (important — this machine has NO Visual Studio toolchain):**
- Electron is pinned to **^42** because better-sqlite3 publishes prebuilt Windows binaries
  only up to Electron ABI 146 (= Electron 42); ABI 148 (Electron 43) has none and would
  require a local C++ build. Do not bump Electron past 42 until a prebuild exists.
- `postinstall` runs `scripts/fix-native.mjs`, which downloads better-sqlite3 prebuilds for
  BOTH ABIs and lays them out as `lib/binding/node-v137-win32-x64/` (plain Node → vitest)
  and `lib/binding/node-v146-win32-x64/` (Electron → app). `build/Release` is deliberately
  removed — a binary there would shadow the per-runtime paths and break one runtime.
- electron-builder has `npmRebuild: false` so packaging never re-triggers node-gyp; the
  dual-ABI layout ships as-is and is `asarUnpack`ed. `@napi-rs/keyring` is N-API
  (ABI-stable) and needs no special handling beyond its asarUnpack entry.

## 3. Working conventions (follow these — the codebase is consistent)

- **Checks engine:** each check is a module in `src/checks/` exporting
  `checkX(db[, config])`. All are registered in `src/checks/run-all.ts` inside a single
  transaction, each wrapped in try/catch so one failure can't abort the audit. Every
  check id is declared in `src/checks/registry.ts` (id/name/category/severity) and
  drives the Overview sidebar + counts. Issues are rows in the `issues` table
  (`check_id`, `page_id` nullable, `detail`). Use `makeAddIssue(db)` and the
  `INTERNAL_HTML_200` predicate from `src/checks/helpers.ts`.
- **Testable-core pattern:** heavy/pure logic is extracted into modules that take a
  `Database` so vitest can seed an in-memory DB and assert. See `src/main/sitemap-gen.ts`,
  `src/main/graph.ts`, `src/crawler/sitemaps.ts`. **Do the same for Phase 7/8.**
- **Tabs are the contract between UI and SQL:** `src/shared/tabs.ts` defines each tab's
  columns (renderer) AND the `db-reader` `case` builds a SELECT whose aliases must match
  those column `key`s. When you add a tab, update both, in lockstep.
- **Exposing a new main capability to the UI:** add IPC handler in `src/main/ipc.ts`
  → method in `src/preload/index.ts` → call as `window.pulse.x()`. Types propagate
  automatically via `PulseApi`.
- **DB connections:** `DbReader` is **read-only** and must be `invalidate()`d after a
  crawl (the worker rebuilds tables; a held snapshot would be stale/locked). The worker
  is the only writer (`DbWriter` in `src/crawler/db-writer.ts`).
- **Data gotchas already baked in:** `h1`/`h2` are stored as JSON arrays
  (`json_array_length`, `json_extract`). `content-thin` and other quality checks exclude
  `indexable = 0` pages on purpose. `indexable`/`indexability_reason` are computed in
  `worker.ts::computeIndexability`.
- **Style:** 2-space indent, single quotes, semicolons, TS strict, no `any`. Comments
  explain _why_, matching existing density.

## 4. What's DONE (Phases 0–6) — verified by typecheck + build + vitest

- **P0 Scaffold** — Electron/Vite/React shell, project lifecycle, IPC, schema.
- **P1 Crawl engine (HTTP)** — `worker.ts` crawl loop: frontier, robots.txt, scope rules
  (`url-utils.ts`), single-hop redirect capture, param policy, `fetcher.ts` (undici,
  manual redirect chain), `parse.ts` (cheerio: titles/meta/canonical/hreflang/JSON-LD/
  microdata/links/images/OG/word-count/simhash), image probe phase, results grid + tabs +
  overview sidebar + details pane.
- **P2 Checks engine** — `response, directives, canonicals, onpage, media, content,
  url-security` modules. Tests: `src/checks/run-all.test.ts`.
- **P3 JS rendering** — `RenderPool`, worker render phase (raw vs rendered columns,
  render-only links), and `src/checks/render.ts` (canonical/robots/title/content-delta/
  failed). Config UI (Rendering section). Tests: `src/checks/render.test.ts`.
- **P4 Sitemaps / hreflang / structured data** — sitemap fetch+parse (`src/crawler/sitemaps.ts`:
  index recursion, gzip, plain-text), worker sitemap phase + `writeSitemapUrls`/`markInSitemap`,
  check modules `sitemaps.ts`, `hreflang.ts`, `structured-data.ts`, and **sitemap generation**
  (`src/main/sitemap-gen.ts` + `sitemap:generate` IPC + Toolbar "Sitemap" button).
  Tests: `src/crawler/sitemaps.test.ts`, `src/checks/phase4.test.ts`.
- **P5 Architecture visualizations** — `src/main/graph.ts` (internal-link graph, node cap
  by depth→inlinks, edge cap) + `query:graph` IPC + `src/renderer/src/components/Visualization.tsx`
  (d3 force graph + crawl tree via first-discoverer `crawl_source`, zoom/pan/click-to-select).
  New "Visualisation" tab. Tests: `src/main/graph.test.ts`.
- **P6 Custom extraction + search** — ALL already implemented (engine
  `src/crawler/extract-custom.ts`: CSS/XPath/regex + literal/regex search; ConfigDialog
  editors; Extraction/Search tabs; db-reader). This phase only added the missing tests:
  `src/crawler/extract-custom.test.ts`.
- **P7 API integrations (GSC, GA4, PageSpeed, backlinks)** — `src/main/credentials.ts`
  (keychain wrapper, service "Pulse SEO"; secrets NEVER in the `.pulse` file) and
  `src/main/api/`: `common.ts` (injected `FetchLike`, concurrency helper, `api_config`
  meta persistence), `psi.ts` (lab+field CWV, category scores, most-linked-first URL
  selection), `gsc.ts` (paginated page query; full-replace write; orphan counting for the
  gsc tab's orphan filter), `ga4.ts` (runReport by pagePath, `keyEvents`→conversions,
  trailing-slash-tolerant path→URL join, session-weighted aggregation), `backlinks-csv.ts`
  (RFC-4180 parser, Ahrefs/Moz/Majestic header detection), `google-auth.ts` (loopback
  OAuth for GSC+GA4, refresh token in keychain — main-only glue, deliberately untested).
  IPC `api:*` handlers guard against a running crawl and use short-lived write connections
  + `reader.invalidate()`. UI: Toolbar "APIs" button → `ApiDialog.tsx` (Google / PageSpeed /
  Backlinks sections). Tests: `src/main/api/{psi,gsc,ga4,backlinks-csv}.test.ts`.
  NOTE: like the crawler, the API clients are verified against mocked HTTP only — no live
  Google API call has been made yet (needs the user's OAuth client + keys).
- **P8 Staging comparison / migration mapping** — `compare_results` table (schema),
  pure `src/main/compare.ts` (`readOldCrawl` from a second read-only `.pulse`,
  `oldPagesFromUrls` from a CSV, `runCompare`: exact-URL match → path match across hosts
  (trailing-slash tolerant) → classify ok/redirected(3xx chain followed to 200)/broken/
  missing, title+canonical diffs). "Compare" tab (group `data`) + db-reader case +
  `compare:run` IPC (file dialog accepts `.pulse` or `.csv`; any URL-shaped CSV cell counts)
  + Toolbar "Compare" button that navigates to the tab. Tests: `src/main/compare.test.ts`.
- **P9 Packaging** — electron-builder config in `package.json` `"build"`: appId
  `com.pulseseo.app`, win targets nsis + portable, output `release/`, generated
  `build/icon.png` (emerald pulse on slate), `asarUnpack` for better-sqlite3 + @napi-rs,
  `npmRebuild: false` (see §2 native notes). Output: `Pulse SEO-Setup-0.1.0.exe` and
  `Pulse SEO-Portable-0.1.0.exe` (~112 MB each).

## 5. Follow-ups (nothing blocking)

- **APIs live test** — PSI/GSC/GA4 clients have never hit real Google endpoints; needs the
  user's OAuth desktop client + PSI key via Toolbar → APIs.
- **RenderPool / JS rendering live** — still only unit-tested; needs a JS-heavy site crawl
  with Rendering enabled in the running app.
- **d3 Visualisation tab** — data layer tested + UI boots, but the force/tree drawing has
  not been interactively exercised on a big crawl.
- pulseseo.com's WAF serves the crawler a 403 (handled correctly, recorded as
  `response-broken-internal`). If Marcos wants to crawl it, allowlist the crawler UA/IP.
- Optional: `manualChunks` to split d3/ag-grid and silence the Vite >500 kB warning.

## 6. ✅ Live end-to-end verification (2026-07-14)

The "never run live" gap is closed. Verified against real targets:
- **Crawl loop over the network** — `scripts/smoke-crawl.mjs` drives the BUILT worker under
  plain Node. books.toscrape.com (15-URL cap): 15 pages, 1,347 links, 220 images, titles/
  depth/indexability populated, 16 distinct checks incl. near/exact-duplicate (simhash).
- **Found + fixed a live-only bug**: `fetcher.ts` advertised `accept-encoding: gzip, deflate,
  br` but `undici.request` does NOT auto-decompress (unlike fetch) — every compressed
  response parsed as binary garbage (no titles/links). Fixed with per-Content-Encoding
  decompression (gzip/deflate/raw-deflate/br) in `fetcher.ts::decompressBody`. This is why
  live smoke tests matter; unit fixtures never compress.
- **Packaged app** — installer + portable built; `win-unpacked` app boots with the full UI
  (all tabs incl. Compare, APIs button, grid, sidebar). `scripts/verify-packaged.cjs`
  (run via `npx electron`) proves better-sqlite3 + keyring load under Electron ABI 146 and
  the crawler worker spawns FROM INSIDE `app.asar`, crawls a live page and writes the DB.

## 7. Minor known gaps / cleanups

- `site-ai-crawlers` is declared in `registry.ts` but **not implemented** — either implement
  (parse robots.txt for GPTBot/ClaudeBot/PerplexityBot allow/deny) or remove from the registry.
- Extraction/Search require **Store HTML** enabled (config hint already says so).
- Sitemap-URL ↔ page matching is exact-string; param-policy differences could cause a few
  misses in `in_sitemap`. Fine for v1.

## 8. Test inventory (all green: 49 tests / 11 files)

`src/checks/run-all.test.ts`, `src/checks/render.test.ts`, `src/checks/phase4.test.ts`,
`src/crawler/sitemaps.test.ts`, `src/main/graph.test.ts`, `src/crawler/extract-custom.test.ts`,
`src/main/api/psi.test.ts`, `src/main/api/gsc.test.ts`, `src/main/api/ga4.test.ts`,
`src/main/api/backlinks-csv.test.ts`, `src/main/compare.test.ts`.
Keep the one-test-file-per-feature cadence for future work. Live smoke harnesses:
`scripts/smoke-crawl.mjs` (crawl a real site with the built worker) and
`scripts/verify-packaged.cjs` (native modules + worker-from-asar under Electron).
