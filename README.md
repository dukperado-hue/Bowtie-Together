# Bowtie Together — Collaborative BowTie Analysis

**Website:** <https://coolunclelab.com/bowtie-together/>  
**Release:** 1.1.0 (28 October 2026)  
**Independent project:** based on Bowtie888 v1.7.0, with its **own** Git history and tags.  
**Stack:** HTML, CSS, vanilla JavaScript, Node.js 22.16+, built-in SQLite, HTTP + Server-Sent Events (SSE).

> **Release status: collaboration reliability upgrade, not certified production software.** Access is protected only by possession of the room code. For confidential or regulated aviation safety records, add user authentication, roles, access revocation, operational monitoring and independent security review before deployment. See `docs/ARCHITECTURE_AND_READINESS.md`.

## What the app does

- Keep Bowtie888's interactive editor: numbered hazards/top events/threats/consequences, preventive and recovery barriers, escalation factors and controls, connector layout, initial and residual 5×5 risk assessments, risk matrix, PDF/JSON export, Thai/English, themes and responsive sidebar.
- **Create a shared room** for the active BowTie. The server returns a random 16-character code; anyone with that code or a shared invitation link can **view and edit** the room. Keep codes private.
- **Join a shared room** in another browser. Other connected editors see additions and edits through SSE, without manually refreshing.
- **Presence** displays online count, name initials and individual connection state. Participants can enter a display name (not a verified identity).
- **Automatic server persistence:** commits and full revision snapshots are written in SQLite transactions, with WAL journaling. Every successfully committed change has a monotonically increasing revision.
- **Avoid lost edits:** independent changes to different fields/entities (including initial vs residual risk) can coexist. If two editors change the same field from an old value, the second request returns **409 Conflict**. The affected browser shows **Keep my changes / Use team changes**, instead of silently discarding a choice.
- **Resilient retries:** changes have per-tab client IDs and per-change IDs. The server durably recognises replays and won't apply the same request twice. Pending edits are saved locally and re-applied on the same tab after a refresh/reconnect. Leaving a shared room is blocked while edits remain pending.
- Read-only history metadata endpoint `GET /api/rooms/:code/history` (30 most recent revisions); full historical snapshots are stored in SQLite for later administration/recovery tooling.

## Run locally

Install **Node.js 22.16+** (Node 22's built-in `node:sqlite` API is experimental and may warn at startup; pin the tested Node runtime).

```bash
npm start
```

Visit `http://localhost:3000` and create a room with **Collaborate → Create live room**. Open the invitation link in a different browser to join the same analysis. To test across computers, make your backend accessible on your LAN over a trusted connection; public use should be HTTPS.

```bash
npm test
# Optional browser integration tests, if Chromium/Playwright is available:
# PORT=38151 npm start
# python tests/browser_collaboration.py
```

`npm test` runs server API/SQLite tests and merge-engine parity tests without downloading packages. The images under `docs/previews/` are archived **v1.0.0 previews**, not new screenshots of the v1.1.0 collaboration controls. The Playwright test is **optional** and requires Python Playwright plus a working Chromium executable/browser networking. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` if necessary. Its coverage is not implied by `npm test`.

## Hosting: all-in-one Node + persistent storage

You can deploy this project to a single persistent Node service (VPS, Railway, Render with a mounted disk, Fly.io with persistent volume, etc.).

| Variable | Meaning |
| --- | --- |
| `PORT` | HTTP server port; default `3000` |
| `BOWTIE_DATA_DIR` | **Persistent** directory for `bowtie-together.sqlite` and WAL; default `./data` |
| `ALLOWED_ORIGIN` | Exact Netlify frontend origin, e.g. `https://your-site.netlify.app`; no trailing slash. Leave blank when frontend and API share one origin. |

Requirements: **one instance**, a writable persistent disk, HTTPS/reverse proxy, backup scheduling, health checks and a secured deployment account. Do **not** run multiple backend replicas: snapshots persist in SQLite but SSE notifications are only shared within one Node process. Do **not** put a live SQLite file on an ephemeral deployment filesystem or a shared NFS mount.

Health check: `GET /health` (does not expose the database or room codes). Run `npm run backup` for an online-consistent SQLite snapshot; override the destination with `npm run backup -- /path/to/backup.sqlite`. Schedule backups and test restores on a separate machine. The backup destination must be outside publicly served `public/`.

### Docker

```bash
docker compose up -d --build
```

`docker-compose.yml` mounts a named persistent volume at `/app/data`. Keep backups separately from this volume. The repository's Dockerfile pins the Node 22 family; for strict repeatability, pin a tested image digest when promoting to production.

### Netlify static frontend + independent API

1. Publish **`public/`** on Netlify (`netlify.toml` sets the publish directory). Netlify serves static HTML/CSS/JS, not the long-lived SSE and SQLite backend.
2. Deploy the **same project** to a dedicated Node 22 service with a persistent volume for SQLite. Configure `PORT` and `BOWTIE_DATA_DIR` there.
3. In Netlify's deployed `public/config.js`, set `window.BOWTIE_TOGETHER_API = 'https://api.your-domain.example'` (public URL only; **never** put credentials here).
4. In your backend's environment variables set `ALLOWED_ORIGIN=https://your-site.netlify.app` (replace with the actual origin) and redeploy. Both URLs must use HTTPS. Configure the host/reverse proxy to leave `text/event-stream` unbuffered and support long connections.
5. In two browsers, create/join a test room; check the online count, edit from both browsers, refresh and verify persistence. Do this **before** inviting users.

A Netlify build is **not** a substitute for deploying the Node backend. Public hosting is **not** provided by this ZIP.

## Upgrade from v1.0.0

The first startup of v1.1.0 automatically imports valid `BOWTIE_DATA_DIR/ABCDEFGHIJKLMNOP.json` legacy rooms into SQLite, preserving the original room code and current revision. It **does not delete** the old JSON files, which can be kept as migration backups. Keep the whole data directory backed up before upgrading. After migration, the SQLite database is authoritative; do not edit the JSON files expecting changes to appear in the app. Room codes and invite links are unchanged.

## Key files

```
public/index.html           BowTie editor and collaboration controls
public/styles.css           All themes, desktop/tablet/mobile layout
public/app.js               Preserved Bowtie888 editor, PDF/JSON and risk UI
public/merge.js             Client-side ID operation/diff + conflict handling
public/collab-client.js     SSE, retry queue, presence and conflict banner
public/config.js            Public API base URL (not secrets)
server/index.js             API, SSE and static asset serving
server/collaboration.js     Server-side validation and optimistic concurrency
server/store.js             SQLite WAL transactions, receipts and migration
scripts/backup.js           Consistent SQLite backup helper
tests/                     Unit, API, concurrency, parity and optional browser tests
docs/ARCHITECTURE_AND_READINESS.md  Technical assessment and remaining blockers
```

## Security notes

- **Code possession = read + write access.** Codes are randomly generated, but this alone is **not account authentication**, role-based permissions or revocation.
- HTTPS is essential. Treat a room code like a password; do not put codes in public websites, screenshots or logs. Code links use `#room=...` browser fragments to reduce leakage from referral URLs.
- The API enforces code formats, request limits, strict allowed changes, per-IP rate limiting and an optional CORS allowlist. **CORS is not authorisation**. Logging, administrator accounts, access controls, alerting, session management, automated backup retention, and managed multi-replica pub/sub remain future work.
- Pending changes live in browser localStorage for recovery in the **same tab/session**; local copies and active editing sessions should be protected on shared computers. Export JSON regularly during pilot use.
- Before using data to support real-world safety decisions, validate it through your organisation's authorised safety review and approval process. The app does not approve risk acceptance automatically.

## Version history

- **v1.1.0** Transactional SQLite persistence, ID-based conflict review, idempotent retries, local pending-queue recovery, named presence, backup helper and concurrent-edit tests.
- **v1.0.0** Initial separate collaborative Bowtie Together edition.
