# Bowtie Together — Changelog

## [1.1.0] — 2026-10-28
### Changed
- Replaced non-transactional room JSON saves with SQLite WAL transactions, full revision snapshots and automatic migration from v1.0.0 room files (legacy JSON retained).
- Added before-value preconditions to changes, conflicting-field/deletion detection (`409`), and explicit keep-mine/use-team resolution controls to avoid silent overwrites.
- Added durable change receipts for idempotent request replay after network interruption or backend restart.
- Added per-tab localStorage pending-change recovery; block leaving a shared room with unsynchronised edits.
- Split initial/residual risk updates into independent operations; preserved the existing editor, 5×5 matrix, PDF/JSON, themes and bilingual support.
- Added participant display names/initials, online count, and clearer synchronisation/conflict indicators.
- Hardened invalid payload/origin responses and added a consistent online SQLite backup helper.
- Expanded automated tests to validate concurrent commits, conflicts, durable retries, risk merges, migration and client/server merge parity.
- Updated deployment guidance and published the architecture/readiness assessment.
### Known limitations
- Invite code grants full read/write; no login, roles or revocation. Single-instance SSE only. Not approved for confidential or regulated safety data.
- End-to-end Chromium browser run was attempted but blocked by execution environment; not reported as passed.

## [1.0.0] — 2026-10-28
- Forked Bowtie888 v1.7.0 into the separate **Bowtie Together** project.
- Added room codes, collaborative shared edits, invitation links, presence count, live state updates, offline queue retry, and central room storage.
- Added HTTP/SSE server (Node.js built-in modules), per-entity merge operations, responsive collaboration modal, bilingual labels, deployment documentation and tests.
- Preserved Bowtie888 risk assessment, diagram, PDF/JSON, themes, automatic numbering, escalation controls and editing tools.
