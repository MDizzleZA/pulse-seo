# Pulse SEO Viewer — Deployment Guide

The viewer is a **static, fully client-side PWA**. Users open `.pulse` crawl files from
their own machine; the app never uploads or phones home. There is **no server code and
no built-in authentication** — access control is the hosting layer's job.

## What's in this package

| Path | Purpose |
|---|---|
| `site/` | The deployable webroot (upload its *contents* to the app directory) |
| `server/apache.htaccess` | Security headers + auth placeholder for Apache hosts (rename to `.htaccess` inside the app directory) |
| `server/nginx.conf` | Equivalent nginx `location` fragment |
| `SECURITY.md` | Security review and the assumptions this deployment must uphold |

## Deploy steps (Apache / typical WP hosting)

1. Create the app directory, e.g. `viewer.example.com` docroot or
   `/pulse-viewer/` under an existing site. **HTTPS is mandatory** (service worker and
   installability both require it).
2. Upload the **contents of `site/`** into that directory.
3. Copy `server/apache.htaccess` into the same directory as `.htaccess`.
4. **Gate the path before sharing the URL** (see below). The app must never be publicly
   reachable — it is a paid product.
5. Add `Disallow: /pulse-viewer/` (or the subdomain) to robots.txt. The app also ships a
   `noindex,nofollow` meta as a belt-and-braces measure.
6. Load the URL, open a `.pulse` file, and confirm the headers with
   `curl -sI https://…/ | grep -iE 'content-security|frame|nosniff'`.

## Authentication options (pick one, required)

- **Cloudflare Access** (recommended): put the subdomain behind Access with per-customer
  email policies. Gives SSO, seat revocation, and access logs with zero app changes.
- **HTTP Basic auth**: quickest — uncomment the block in `.htaccess`, create users with
  `htpasswd`. Fine for a handful of customers.
- **WordPress membership**: if the viewer lives under the WP site, protect the path with
  the membership plugin's rule (MemberPress / RCP directory protection) so paid accounts
  map to viewer access.

## Updating the app

Re-run `npm run pwa:package` in the desktop repo and re-upload `site/`. The service
worker is **network-first for HTML**, so online users get the new version on next load;
offline users keep the last cached version. If you change the service worker itself,
bump the `CACHE` version constant in `sw.js` (the packager warns about this).

## Rules

- **Never place `.pulse` files inside the app directory.** They are client crawl data;
  the server configs deny `*.pulse` as a backstop, but don't rely on it.
- Don't serve the app over plain HTTP, and don't disable the CSP "to fix something" —
  see SECURITY.md for what each header protects against.
- Support contact baked into the app's error screen: support@pulseseo.com — make sure that
  mailbox exists before launch.
