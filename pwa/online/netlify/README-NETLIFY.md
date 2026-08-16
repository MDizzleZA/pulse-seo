# Pulse SEO Viewer — Netlify Deployment

This folder is a **ready-to-deploy Netlify site**. It's the static PWA viewer: users open
their own `.pulse` crawl files in the browser and can also create a blank project to crawl
in the desktop app. **No backend, no build step, nothing uploaded** — all processing is
client-side. Netlify serves it over HTTPS automatically (required for the service worker
and installability).

## Deploy (pick one)

**A. Drag & drop (fastest)**
1. Go to Netlify → *Add new site* → *Deploy manually*.
2. Drag **this entire folder** onto the drop zone.
3. Done — Netlify gives you a `*.netlify.app` URL. **Gate it before sharing** (below).

**B. Netlify CLI**
```
npm i -g netlify-cli
cd <this folder>
netlify deploy            # draft URL to preview
netlify deploy --prod     # publish
```

**C. Git-based**
Commit this folder to a repo, connect it in Netlify. `netlify.toml` sets publish to `.`
with no build command, so Netlify just serves the files.

## What's in here

| File | Purpose |
|---|---|
| `index.html`, `assets/`, `sql-wasm-browser.wasm`, `sw.js`, `manifest.webmanifest`, `icon-*.png` | the app |
| `_headers` | security headers (CSP, X-Frame-Options, etc.) + caching — **authoritative** |
| `_redirects` | single-page-app fallback to `index.html` |
| `netlify.toml` | publish dir + disables asset post-processing |
| `SECURITY.md` | the security review |

`_headers`/`_redirects` are applied by Netlify in every deploy method, so the security
headers travel with the site automatically — no dashboard config needed.

## Authentication — REQUIRED before launch

The app ships **no login**; it must not be publicly reachable (it's a paid product).
Choose one:

- **Netlify password protection** (Pro plan) — *Site settings → Access & security →
  Visitor access → Password protection*. One shared password, 2 minutes to set up.
  Good for a quick, low-friction gate.
- **Per-user access via an identity provider** — put the site behind **Cloudflare Access**
  or another SSO/IdP in front of the Netlify domain. Best for per-seat paid accounts:
  real logins, revocation, and access logs, with zero app changes. *Recommended for
  ongoing paid use.*
- **Netlify Identity + role gating** (native) — enable Identity, add a `paid` role, and
  gate with a role condition in `_redirects` (`/*  /index.html  200!  Role=paid`). Needs
  a login flow; heavier than the options above.

Also add `Disallow: /` in a robots.txt (or keep it on a `noindex` subdomain); the app
already sends a `noindex,nofollow` meta tag.

## Updating

Rebuild with `npm run pwa:package:netlify` in the desktop repo and redeploy this folder.
The service worker is **network-first for the page**, so online users get the new version
on their next load; offline users keep the last cached copy. If you change `sw.js`, bump
its `CACHE` constant (the packager prints the current value).

## Rule

**Never add a `.pulse` file to this folder.** They are client crawl data. The packaging
script refuses to build if one is present; don't defeat that by copying one in manually.
