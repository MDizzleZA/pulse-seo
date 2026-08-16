# Pulse SEO Viewer — Security Review (2026-07-15)

Scope: the static PWA in `site/` as deployed for **paid, logged-in users**. Reviewed
against the OWASP Top 10 categories that apply to a client-side, no-backend app.

## Architecture facts the review relies on

- **No backend, no accounts, no network writes.** The app makes no requests except
  fetching its own assets; `.pulse` files are opened locally via the File API and
  processed in-memory by SQLite compiled to WebAssembly (sql.js). User/crawl data
  never leaves the device — there is nothing server-side to breach and no PII in transit.
- **Authentication is out of scope by design** and MUST be provided by the hosting
  layer (see README-DEPLOY.md). The app is not safe to expose publicly only in the
  commercial sense — there is no user data on the server either way.

## Findings and mitigations

### Injection

- **XSS via crawl data** (the main attacker-influenced surface: crawled sites control
  titles, anchors, headers, URLs stored in the .pulse file): all rendering goes through
  React text nodes with automatic escaping. Verified the app source contains no
  raw-HTML rendering escape hatches and no dynamic code-evaluation APIs of any kind.
  **Pass.**
- **SQL injection**: view/filter identifiers come from fixed compile-time catalogs; the
  only free-text input (URL search) is bound as a **parameter**; the sort column is
  **allowlisted** against the column catalog before being interpolated into `ORDER BY`.
  Even a successful injection would only query the user's own local, read-only copy.
  **Pass.**
- **CSV formula injection** (exports opened in Excel): cells beginning with `=`, `+`,
  `@`, tab/CR, or a non-numeric `-` are neutralised with a leading `'` before quoting.
  **Fixed in this release.**

### Malicious input files

- A hostile `.pulse` file executes no code: sql.js runs inside the WASM sandbox; parse
  failures are caught and shown as an error. Stored HTML blobs (`raw_html`,
  `rendered_html`) are never rendered by the viewer. Worst case is memory exhaustion of
  the user's own tab — mitigated by a >300 MB confirmation prompt. **Acceptable.**

### Client-side platform hardening (shipped in `server/` configs — REQUIRED)

| Header | Why |
|---|---|
| `Content-Security-Policy` (self-only; `wasm-unsafe-eval` for sql.js; inline styles for React style attributes; `frame-ancestors 'none'`) | Blocks injected/third-party script even if a bug appears; no external calls are legitimate, so none are allowed |
| `X-Frame-Options: DENY` | Clickjacking |
| `X-Content-Type-Options: nosniff` | MIME confusion |
| `Referrer-Policy: no-referrer` | No leak of the (authenticated) viewer URL |
| `Strict-Transport-Security` | Downgrade protection; HTTPS is mandatory anyway for the service worker |
| `Permissions-Policy` | Camera/mic/geolocation denied outright |
| `*.pulse` denied at the server | Backstop so crawl data can never be published from the app folder |

### Service worker / caching

- Same-origin GET requests only; **network-first for HTML** so paying users always get
  the current app when online (no stale-shell lockout), cache-first only for
  content-hashed immutable assets.
- Caches contain the **app shell only — never crawl data**, so a shared or lab machine
  retains nothing sensitive after logout. Opened files live only in tab memory.

### Supply chain

- Shipped runtime dependencies: `react`, `react-dom`, `sql.js` (self-hosted wasm — no
  CDN). `npm audit --omit=dev` on 2026-07-15: **2 moderate advisories, both in `uuid`
  via `exceljs`** — a desktop-app dependency that is not part of the web bundle
  (verified absent from `site/assets`). **No known vulnerabilities ship in the viewer.**
- No sourcemaps, sample data, or `.pulse` files in the deployable (enforced by the
  packaging script, which fails the build if any are present).

## Residual risks / launch conditions

1. **The hosting gate is the product's only access control.** Deploy behind Cloudflare
   Access, HTTP basic auth, or WP membership path protection *before* the URL is shared.
2. HSTS is set to 6 months — raise after the first stable month.
3. If the app ever gains network features (license checks, telemetry), this review must
   be redone: `connect-src 'self'` in the CSP will intentionally break them until then.
4. Re-run `npm audit` at each release; bump the SW `CACHE` constant when `sw.js` changes.
