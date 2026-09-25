# Company Blacklist

Your own do-not-apply list (user layer, opt-in). Copy this file to `data/blacklist.md` and edit it — the system never creates or populates it for you, and no update ever touches it.

When `data/blacklist.md` exists:

- `scan.mjs` skips postings from listed companies (matched case- and punctuation-insensitively) and reports the count in the run summary — `--include-blacklisted` bypasses the filter for auditing.
- The `auto-pipeline`, `oferta`, and `apply` modes stop on a match, quote your recorded reason, and ask for an explicit override before proceeding. Your call always wins.
- A blacklist entry never changes any score anywhere — it is a gate, not a signal.

`Scope` is either `company` (the default: match the feed-provided company label,
case- and punctuation-insensitively) or `domain` (match the posting URL's hostname
against the Company cell as a suffix). For `domain`, enter a hostname suffix without
a scheme or path, such as `ibm.com`: it matches `jobs.ibm.com`, not `notibm.com`.
Domain scope is explicit; the scanner never infers parent/subsidiary relationships.

| Company | Since | Scope | Reason |
|---------|-------|-------|--------|
| Acme Corp | 2026-01-15 | company | example: post-interview process signals |
| Globex | 2026-02-01 | company | example: repeated applications, zero conversion |
| ibm.com | 2026-03-01 | domain | example: avoid postings on IBM-owned ATS hosts |
