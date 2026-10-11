# Mode: master-profile — Build and maintain a source-backed career profile

## Purpose

Create a reusable profile of candidate facts from `cv.md` without asking an AI
to invent, infer, or silently rewrite career history. The profile is user data
at `data/career-profile.yml`; it remains local and is protected by the updater's
existing `data/` user-layer rule.

## Initial CV import

1. Run `node career-profile.mjs import [cv.md]` to preview extracted candidates.
2. Review candidates with the user. For the interactive item-by-item gate, run
   `node career-profile.mjs import [cv.md] --review`; accept, edit, or skip each
   candidate. Nothing is written before this review.
3. The importer preserves the source quote and line number for each approved
   item. Approval marks the extracted statement `verified`; it does not verify
   claims beyond what the source actually says. Never embellish metrics,
   ownership, dates, skills, or outcomes.
4. Run `node career-profile.mjs validate` and report any errors. Import merges
   additively and keeps existing profile entries; it does not replace them.

The parser is intentionally conservative and heading-based. Tell the user
that unusual CV layouts may need manual additions/edits after import. Do not
discard or rewrite `cv.md`.

## Scope boundary

This first version provides profile schema, CV import, human confirmation, and
validation only. It does **not** select profile facts for a job description,
adapt the result into the PDF generator's payload, or run a CV re-analysis
loop. Until those integrations are implemented, the existing PDF workflow
continues to use its existing inputs; never imply this profile has already
changed generated CVs.

## Schema v1

- `candidate`: optional identity fields
- `summary`, `certifications`, `skills`: lists of fact records
- `experiences`, `projects`, `education`: entries with a label, evidence, and
  a `facts` list
- Each fact has a stable `id`, `text`, `evidence` (`source`, `line`, `quote`),
  and `review_status` (`needs_review` or `verified`)

The machine validator checks structure and evidence fields. It cannot establish
whether a claim is true; that responsibility stays with the user during review.
