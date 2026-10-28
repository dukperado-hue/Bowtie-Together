# Bowtie Together — v1.0.0 assessment and v1.1.0 release review

**Date:** 28 October 2026  
**Application:** Bowtie Together (separate from Bowtie888)  
**Scope:** uploaded v1.0.0 source, Node backend, browser collaboration layer, tests and deployment files; evaluated and modified in place.

## Current architecture (v1.1.0)

```text
Browser A (BowTie editor)                   Browser B (same BowTie)
  | browser localStorage                       | browser localStorage
  | queued changes, tab ID                     | queued changes, tab ID
  +-- POST changes (with prior values) --------+-- POST changes
  |                                            |
  +-- EventSource -----------------------------+-- EventSource
                       HTTPS
                         |
                    Node 22 API
                  (single instance)
                     |        |
                SSE/presence  SQLite WAL
                                | rooms
                                | receipts (idempotency)
                                | history (snapshots)
                         persistent volume
```

**Data flow:** Clients calculate stable-ID operations from the last locally represented project, queue changes in localStorage and send them in order. Every request includes a per-tab client ID and per-change ID. The server runs the change in a SQLite transaction and validates the previous value of every edited field. On success, the server commits one authoritative revision, saves history, remembers the change ID and broadcasts the new snapshot via SSE. On stale-field or conflicting deletion, the server returns HTTP 409 with the authoritative snapshot and conflict locations. The client keeps its queued edits and displays a resolution choice. Independent edits merge automatically. Duplicate deliveries are recognised after a restart.

## Findings and actions

| Severity | v1.0.0 finding | v1.1.0 action / status |
| --- | --- | --- |
| Critical | Two simultaneous HTTP requests could read the same JSON file **before** awaiting their bodies; the second then wrote a stale snapshot and silently lost the first commit. | **Addressed in v1.1.0:** SQLite `BEGIN IMMEDIATE` transactions; parse request before transaction/read; concurrency test. |
| Critical | Same-field concurrent changes were last-write-wins, with no conflict review. | **Addressed:** before-value preconditions, HTTP 409, explicit keep-local / use-team choice. |
| High | No idempotency: an ACK loss followed by POST retry could increment the revision or reapply a change. | **Addressed:** durable `(room,client,change)` receipts with payload hash. |
| High | Offline queue existed only in browser memory and was lost on reload. | **Improved:** per-tab queue in localStorage, replay on refresh and automatic retry. **Limitation:** another/new tab doesn't automatically recover a terminated tab's queue. |
| High | File-based room data required manual handling and had no revision history. | **Improved:** SQLite WAL, full per-revision snapshots, migration from old JSON files, backup helper. Operational backup restore is administrator-driven. |
| Medium | Initial/residual risk lived under one `risk` field; separate edits could overwrite one another. | **Addressed:** initial, residual and rationale diff separately. |
| Medium | Presence was a number only. | **Improved:** online count, display names/initials. Display names are not identity-verified. |
| High | Browser SSE and client UI were unverified end-to-end in automated CI. | **Still open:** unit/API tests pass, but headless Chromium navigation was blocked in this execution environment (`ERR_BLOCKED_BY_ADMINISTRATOR`). Run Playwright tests on an unrestricted development host before shipping. |
| Critical | No user login, roles, invite expiry or code revocation; code = full edit access. | **Still open:** room-code bearer access, rate limits/CORS and HTTPS guidance; do **not** use regulated/confidential data yet. |
| High | Multi-instance deployment would not broadcast updates across instances. | **Still open:** one Node process only; introduce Postgres + Redis/pub-sub or managed service before horizontal scaling. |
| High | No security assessment, data deletion / retention policy, monitoring, disaster-recovery drill or access/audit identity. | **Still open:** require documented operational and security controls before production. |

## Integrity and conflict model

- Stable IDs merge edits to *different* elements. For identical field changes based on the same previous value, the later writer gets a **409** instead of overwriting the previous value. A user can explicitly choose their edit or the team's. Conflict resolution itself is a new versioned transaction.
- Risk assessments can independently change **initial**, **residual** and **rationale** fields. Each rating pair (likelihood + severity) is treated as one atomic field. This is **not** character-level CRDT/OT collaborative typing.
- Deleting an element that a teammate changed is also treated as a conflict. Deleting an already deleted ID is idempotent. Nested structures are validated and capped at 80 items per list; max request is 1 MiB, max project ~900 KB JSON.
- On a transient disconnection, pending changes remain in the same browser tab's persistent queue. A server-side commit and a lost acknowledgement do not create a duplicate revision because the client retries with the same change ID. A new session, browser storage clearing, or shared-device localStorage policies can still destroy unsent changes.
- History stores full snapshots per revision; create an admin-only revision viewer/restore workflow with permissions before opening this history to broader audiences.

## Security/readiness decision

**Current assessment: suitable for controlled pilot use with non-sensitive sample data on a single private HTTPS server; not certified or ready for confidential/regulated operational use.** The remaining blockers include authentication (e.g. organisation SSO), authorisation (owner/editor/viewer), invitation expiry and revocation, access logging with verified identity, security review (including XSS/CSRF/DoS), availability monitoring, tested backup restores, data retention/deletion, operational recovery, and a deployment-scale decision. Do not infer regulatory acceptance from software functionality or test status.

## Tests performed in this environment

- `npm test`: automated Node unit/API/integration checks **17 passed**, including concurrent changes, conflict checks, deduplication, restart persistence, migration, invalid operations and browser/server merge parity.
- `node --check`: browser collaboration and merge JS parse checks passed.
- `npm run backup -- /tmp/...`: SQLite backup successfully created and inspected for existence.
- Optional browser automation: **attempted, not passed**. Chromium attempted navigation to local server and local file but the environment responded `ERR_BLOCKED_BY_ADMINISTRATOR`. The Playwright script remains available in `tests/browser_collaboration.py` for execution on a normal development system.

## Next release priorities

1. Organisation authentication, role-based room access and time-limited/revocable invites.
2. Browser-level regression suite in CI: simultaneous editing, conflict prompt, offline/reconnect, duplicate ACK, all themes, Thai/English, tablet/mobile, PDF and JSON.
3. Database governance: retention/deletion, authenticated history/rollback, backups/restore drills, monitoring, log redaction, traffic limits and room quotas.
4. Multi-node design, if needed: shared PostgreSQL database with durable pub/sub or broker and consistent auth/session validation.
5. Formal threat modelling, penetration testing, accessibility checks, load/performance tests and deployment observability.
