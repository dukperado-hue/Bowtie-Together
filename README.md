# Bowtie Together — Collaborative BowTie Risk Analysis

**Version:** 1.0.0 · **Based on:** Bowtie888 v1.7.0 · **Stack:** HTML, CSS, JavaScript, Node.js (built-in modules only)

An independent, bilingual (English/Thai) collaborative edition of Bowtie888. Create a shared BowTie, invite team members using a 16-character code or link, and edit the same risk analysis in real time.

## Features

- Original Bowtie888 professional editor, five themes, responsive diagram, risk matrix (1–5 × A–E), automatic element numbers, escalation factors and controls, PDF, JSON import/export.
- Private analyses remain in the browser; shared rooms are saved by the server.
- **Create live room** for the currently selected BowTie; **Join room** by typing a code or opening a `#room=...` invitation link.
- Real-time fan-out via Server-Sent Events (SSE) and HTTP change requests; no third-party runtime dependencies.
- Independent changes to *different* elements/fields are merged by stable IDs, reducing lost edits during simultaneous work. A conflicting change to the *same field* is last-write-wins.
- Offline edits queue for retry while the tab remains open; the room reconnects automatically. Do not rely on offline queues as a backup: also export JSON.
- Room member count, automatic browser reconnection, retained drafts, and JSON file storage on the backend.

## Quick start (local computer)

Install Node.js 20+ and run:

```bash
npm start
```

Open **http://localhost:3000** in two tabs or computers able to reach that server. Press **Collaborate → Create live room** in the first browser and give your teammate the code. In the other browser press **Collaborate → Join room**. Each change is persisted to the server and broadcast to participants.

Run automated tests:

```bash
npm test
```

## Deploy to a website

### Recommended: one Node server

Deploy this repository to a Node.js host (a VPS, Railway, Render with persistent disk, Fly.io or equivalent). Use:

- Install/build: none (no external npm dependencies)
- Start command: `npm start`
- Service port: environment variable `PORT` (defaults to 3000)
- Data path: set `BOWTIE_DATA_DIR=/app/data` or another **persistent mounted volume**. The default `data/` directory is only for local development. **Without a persistent disk, room data may disappear when the host restarts or redeploys.**
- Serve over HTTPS with your hosting platform's reverse proxy.
- Expose a **single running instance**; this reference implementation uses on-disk JSON files plus in-process SSE subscriptions. Multiple replicas need a shared database and pub/sub service.

### Static frontend on Netlify + separate Node API

Upload **only** `public/` to Netlify. Netlify cannot run this long-lived Node/SSE backend as static hosting. Deploy the **same repository** as a separate backend Node service. In `public/config.js`, set:

```js
window.BOWTIE_TOGETHER_API = 'https://your-node-backend.example.com';
```

On the backend set `ALLOWED_ORIGIN=https://your-netlify-site.netlify.app` (your actual frontend origin, no trailing slash). Deploy over HTTPS. The frontend and backend must remain reachable; all shared projects are saved on the backend.

### Deploy with Docker

```bash
docker compose up -d --build
```

`docker-compose.yml` mounts a named persistent volume at `/app/data`.

## Files

```
public/
  index.html             Bowtie Together UI
  styles.css             Desktop, tablet, phone and theme styles
  app.js                 Original Bowtie888 analysis engine (adapted)
  merge.js               Browser-side ID-based changeset engine
  collab-client.js       Room management, sync and reconnection
  config.js              Optional external backend address
server/
  index.js               HTTP API, static hosting, SSE and persistence
  collaboration.js       Server-side change application/validation
 tests/                   Automated merge and HTTP/SSE tests
 data/                    Local room files (ignored by Git)
```

## How collaboration works

1. When a room is created, its snapshot is written to `BOWTIE_DATA_DIR/<ROOM_CODE>.json`.
2. Each browser obtains the snapshot via `GET /api/rooms/:code` and listens to `GET /api/rooms/:code/events` (SSE).
3. The editor emits changes to individual entities using stable IDs to `POST /api/rooms/:code/changes`.
4. The server merges and saves each changeset and broadcasts the current authoritative project to every connected browser.
5. Users can continue to export JSON and PDF exactly as in Bowtie888.

**Conflict rule:** Concurrent changes to independent paths, barriers or fields are merged. If two people save different values to the *same field*, the latest received server update wins. This is a working collaboration MVP, **not** a CRDT/OT solution. For stronger conflict-free, keystroke-by-keystroke editing, introduce Yjs or another CRDT plus authentication, version history and auditing.

## Security & operational limitations

- **Possession of the 16-character code grants read and edit access.** This version has **no login, roles, access revocation or audit trail**. Do not use for classified, confidential, regulatory or production safety data until authentication, authorisation, monitoring and backups are added.
- Room codes have ~80 bits of randomness and are not intended to be guessed; keep them secret. Invite links use URL fragments to avoid sending the room code to the page server as a URL path or query parameter.
- HTTPS is strongly recommended for any public deployment. Set `ALLOWED_ORIGIN` when splitting frontend/backend. Configure reverse proxy request limits, backups, uptime monitoring and a trusted persistent storage volume.
- Server storage is per room, no expiration or room deletion API. Restarting the server with a persistent disk retains room snapshots; without it they may be lost.
- File-based storage and memory SSE subscriptions support a small collaborative group on a single server. For production/multi-node, use a database, authentication, audit logging, and shared event distribution.

## Version history

- **v1.0.0 (28 Oct 2026)** First separate Bowtie Together collaborative project based on Bowtie888 v1.7.0.

### Optional browser-level test

Start the server with `npm start`; install Python Playwright (`pip install playwright` and `playwright install chromium`), then run `python tests/browser_collaboration.py`. It opens two independent browser contexts and verifies that edits appear across the room.
