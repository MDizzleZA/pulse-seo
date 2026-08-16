# Pulse SEO

A desktop SEO crawler and site auditor (a Screaming Frog–class tool) that runs
entirely on your machine. Crawl a site, store every response, and audit it across
dozens of checks — on-page, structured data, canonicals, hreflang, sitemaps,
redirects, duplicates, AI-crawler access, accessibility and more. Optionally
connect Google Search Console and GA4 to overlay real traffic on the crawl.

Built with Electron + React + TypeScript. Crawl projects are saved as portable
`.pulse` files (SQLite).

## Status

This repository is the source for the desktop app. It builds to a standalone
Windows installer and a portable `.exe` via electron-builder. See
[HANDOVER.md](HANDOVER.md) for the full engineering notes (architecture, build
steps, native-module notes, and the MCP server).

## Develop

```bash
npm install
npm run dev
```

## Build a distributable

```bash
npm run build      # compiles main, preload and renderer
npm run dist       # electron-builder → installer + portable .exe in release/
```

## Highlights

- Fast concurrent crawler with response storage and near-duplicate detection (simhash)
- Dozens of SEO/technical checks with severity grading
- SERP snippet preview, headers/cookies inspection, redirect-chain mapping
- Optional Google Search Console + GA4 integration (OAuth; refresh token stored
  in the OS keychain — never on disk)
- Companion PWA viewer (`pwa/`) to open `.pulse` projects in a browser, offline
- MCP server so an AI assistant can query a crawl (`src/mcp/`)

## Credentials

No secrets ship in this repo. Google OAuth client credentials and tokens are
stored in your operating system's keychain via the app's Settings → APIs screen.

## License

MIT — see [LICENSE](LICENSE).
