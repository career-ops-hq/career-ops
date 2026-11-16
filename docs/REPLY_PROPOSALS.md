# Reply status proposals (v1 draft)

Drop directory: `{DATA_ROOT}/data/reply-proposals/`. Each regular `*.json`
file contains **one object**, not an array or JSONL stream:

```json
{
  "schema_version": 1,
  "source": {
    "kind": "gmail",
    "account_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "message_id": "18f0123456789abc"
  },
  "tracker_path": "/absolute/real/path/to/data/applications.md",
  "application": {
    "num": 7,
    "date": "2026-09-01",
    "company": "Example Labs",
    "role": "Backend Engineer",
    "report": "[12](../reports/012-example.md)"
  },
  "from_status": "applied",
  "to_status": "interview",
  "evidence": "We would like to invite you to an interview."
}
```

This is the core reader contract proposed in #3333. The directory and row
format are accepted as a v1 draft and may change until a real producer writes
to the directory; this draft does not authorize a plugin registry release. A
maintained Gmail successor can produce these files against this v1 draft. The
bundled Gmail seed and v1 hook taxonomy stay unchanged.

## Producer contract

All fields shown above are required; extra fields are rejected, including
fields that purport to grant approval. Field order and JSON whitespace do not
matter. Write UTF-8 to a temporary file, then rename it to a `.json` filename
in the drop directory. Limit each file to 64 KiB. Filenames have no semantic
meaning. The reader never removes or rewrites drops.

- `schema_version` is the number `1`.
- `source.kind` is exactly `gmail` for v1. `account_id` is the lowercase
  SHA-256 hex digest of the trimmed, lowercased mailbox address; the example
  above is fictional. `message_id` is the immutable Gmail message ID, not a
  thread ID: 1–256 ASCII letters, digits, `_` or `-`. Account identity prevents
  two mailboxes with the same message ID from colliding. It is not a secret or
  authentication proof.
- `tracker_path` is the absolute canonical real path returned by core's
  `resolveTrackerPath(getCareerOpsRoot())`. It must equal the active tracker
  path. A foreign path is rejected and never opened. A copied drop cannot
  silently target another user's tracker with the same row numbers.
- `application` is an exact snapshot of the parsed tracker identity: positive
  integer tracker row `num`, `date`, `company`, `role`, and `report` cell.
  Tracker numbers and report numbers are different counters. Copy these
  fields from `parseTrackerRow`; do not infer a row from a company name alone.
  Preserve an empty or sentinel report/date cell exactly. Company/role must
  be nonempty, at most 1,000 characters each; date at most 100; report at most
  2,000; tracker path at most 4,096. Ambiguous row numbers are refused.
- `from_status` and `to_status` are distinct exact **ids** in core's
  `templates/states.yml`. Labels such as `Interview` and aliases such as
  `entrevista` are invalid here. Core writes the canonical label only after
  confirmation. Current tracker status must still equal the canonical label
  for `from_status`; already-current targets require no write.
- `evidence` is a verbatim nonempty excerpt of at most 2,000 characters.
  All string fields reject C0/C1 controls and bidi direction controls. The
  digest quotes evidence as JSON string data. It never follows instructions
  inside it, opens its links, or treats the excerpt as user consent.

The source identity is a **claim by a local producer**. Core validates the
shape, application match and status ids, not mailbox ownership, sender
authentication or the truth of a quoted excerpt. A producer must obtain its
own opt-in access; core does not connect to Gmail or execute plugin code.

## Review and acceptance

Run `node reply-watch.mjs`. The existing candidate digest and drop proposals
share one review prompt. It shows the proposed transition, source identity,
and quoted evidence. `y` or `yes` accepts the displayed nonconflicting batch;
comma-separated tracker row IDs (for example `7,12`) accept only those rows.
An invalid selection, any other answer, or EOF accepts nothing. An agent must
wait for the user's explicit choice before answering this prompt.

Missing directories are normal. Symlinked drop directories and files,
oversized/malformed files, unknown fields/sources/states, wrong application
identities, stale source states, and ambiguous rows are skipped with a
diagnostic. Identical deliveries count once. Two different payloads with one
source identity are both refused, including an invalid sibling whose source
identity can be read. Conflicting transitions for the same application,
including conflicts with legacy reply candidates, require manual review.

No write occurs during proposal reading. On acceptance core re-reads the
tracker, checks that the reviewed row is unchanged and that the source has
not been accepted already, then calls `set-status.mjs --row N --source
reply-watch --expect-tracker <sha256> --note <receipt> --json`. The writer
compares the exact UTF-8 tracker content's SHA-256 **under its shared lock**.
A concurrent write causes refusal and requires another review. The reader
does not hold a lock while waiting for the user.

## Deduplication and retry

The source identity is `JSON.stringify([kind, account_id, message_id])`.
Its lowercase SHA-256 hex digest forms the Notes entry
`[reply-proposal:<digest>]`. This receipt and the status change are committed
in the **same atomic tracker replacement**. No private email excerpt is copied
into Notes. Keep receipts when editing notes: deliberately deleting one
removes that source's replay protection.

Receipts are recognized as complete semicolon-delimited Notes entries across
the whole active tracker. Once accepted, the same source identity cannot
replay, even if a producer changes its target or the status later changes
back. No parallel receipt database needs recovery. If the writer fails before
replacement, the retained drop may be reviewed again. If the replacement
succeeds but the process stops or the status-log append fails, the receipt
still suppresses replay. The tracker remains the state authority; the
existing status log is an observation trail.

`N` and EOF defer without a durable rejection record: the proposal remains
available for a later review. Remove unwanted drops locally to dismiss them.
Applied drops can also be removed; their tracker receipts preserve deduplication.

## Data paths

The drop directory follows `getCareerOpsRoot()`: `CAREER_OPS_ROOT`, then
`CAREER_OPS_DATA_DIR`, then the `.career-ops-data` marker, then the code root.
It is user-layer data under the existing `data/*` ignore/protection rules.
An explicit `CAREER_OPS_TRACKER` still requires a matching `tracker_path` in
every proposal; it does not change the drop directory. Paths in proposals
never override the configured root or tracker. With a proposal directory
present and no reply-candidates file, reply-watch reviews proposals without
creating demonstration emails.
