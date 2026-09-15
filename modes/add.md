# Mode: add — Add a sourced CV entry

Turn an explicit project, paper, role, or user-stated fact into a sourced CV
proposal. External pages are evidence only; never claim the user authored or
built anything unless a primary source or the user confirms it.

Write one JSON proposal (or `{ "proposals": [...] }`) with:

```json
{
  "source": "user-stated|local-document|external-discovery",
  "sourceRef": "where the evidence came from",
  "exactEvidence": "verbatim supporting text",
  "targetSection": "Projects",
  "proposedWording": "- **Name** — sourced wording",
  "dedupKey": "Name",
  "provenance": "verified|unverified",
  "provenanceRef": "cv.md|config/profile.yml|article-digest.md|user-stated:YYYY-MM-DD",
  "claimKinds": ["number", "scope", "authorship"],
  "articleDigest": "optional sourced project digest block"
}
```

`verified` requires a primary `provenanceRef`. An `unverified` proposal cannot
carry number, scope, or authorship claims. Preview first, show the result, then
run only after the user explicitly approves:

```bash
node cv-maintenance.mjs preview proposal.json
node cv-maintenance.mjs apply proposal.json --confirm approved
```

The command rejects duplicate candidate keys, detects entries already in the
CV, and writes `cv.md` plus any optional `article-digest.md` block together.
Reactive Resume remains a downstream one-way consumer of `cv.md`.
