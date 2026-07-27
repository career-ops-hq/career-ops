# Bug-report body format — v1

The contract between the web's in-app bug reporter and any downstream tooling
(the maintainer's triage Action pins to this document). Changes to section
names, the fingerprint line, or field semantics require a version bump here
(`v1` → `v2`) **and** an IPC heads-up to the maintainer — same discipline as
the core↔web data contract.

## Identification

- Issues are opened via `github.com/<repo>/issues/new` query params by the
  **user** (preview-then-confirm; nothing is auto-filed).
- Labels: `web-alpha, area:web`.
- Title: `[web <channel>] <first 70 chars of the user's description>`.
- The body's last line contains the literal marker `report-format: v1`.

## Body sections (stable order)

1. `## What happened` — the user's free text (PII-scrubbed).
2. `## Environment`
   - `- **Version:** \`<web version>\` · core \`<core version>\` · <channel> · \`<sha>\``
   - `- **CLI:** <cli id or —>`
   - `- **Screen:** \`<pathname+query, scrubbed>\``
   - `- **Browser:** <user agent>`
   - `- **Viewport:** <w×h>`
   - `- **Fingerprint:** \`co-web-<base36>\`` ← **the dedupe key** (see below)
3. `## Data shape (counts only — no contents)` — optional (absent if the
   shape endpoint failed):
   - `- **Setup:** <phase>[ · missing: <files>]`
   - `- **Inbox:** <parsed>/<candidates> rows parsed · **Tracker:** <parsed>/<candidates> rows parsed`
   - `- **Reports:** <n> · **PDFs:** <n> · **Follow-ups engine:** ok|DEGRADED|?`
   - `- **Core capabilities:** scan --json yes|no · tracker delete yes|no`
   - `- **Server:** node <version> · <platform>/<arch>`
4. `## Recent errors` — fenced block, most recent last, max 20 entries,
   each `[error]|[onerror]|[rejection]|[api]`-prefixed and scrubbed. `[api]`
   entries are `[api] <pathname> → <status>` (server-side failures).

## The fingerprint

`co-web-<djb2-base36>` computed client-side from:

- **route pathname** (no query), plus
- **newest error class** — the last ring entry with volatile parts stripped
  (urls → `<url>`, quoted values → `<v>`, digits → `<n>`), plus
- **structural flags** — any of `fu-degraded` (follow-ups engine down),
  `inbox-gap` / `tracker-gap` (parsed < candidate rows).

Properties tooling may rely on: deterministic, stable across sessions and
machines for the same underlying bug, extractable with
`/\bco-web-[a-z0-9]+\b/`, and searchable via GitHub issue search (`in:body`).
The reporter itself searches it on open to deflect duplicates at write time.

## Privacy floor (invariant across versions)

Counts, booleans, versions, system-file names and scrubbed error text only.
Never: CV content, profile values, application answers, job URLs, report
content, API keys. The user reviews the exact payload before anything opens.
