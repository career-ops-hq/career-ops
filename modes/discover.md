# Mode: discover -- Resolve companies to scannable ATS boards

## Purpose

Take a list of companies and resolve each to a scannable ATS board by probing
the public JSON APIs career-ops already supports — Greenhouse, Ashby, Lever, and
Workday — via the existing `providers/` layer. Zero LLM tokens, zero auth. A
company "resolves" when a vendor's board exists AND currently lists ≥1 job.
Confirmed entries are appended to `portals.yml` `tracked_companies` (deduped,
idempotent, comment-preserving). Companies that don't resolve — JS-rendered
portals or non-standard slugs — are flagged for manual follow-up instead of
being silently dropped.

**Greenhouse / Ashby / Lever** resolve from just a company name (or an explicit
slug). **Workday** is different: its board lives at
`<tenant>.<instance>.myworkdayjobs.com/<site>`, and the site name is not
derivable from a name (e.g. `NVIDIAExternalCareerSite` vs `External_Career_Site`).
So Workday resolves from a **hint** the user supplies — a full careers URL, or
`{tenant, site}` coordinates — which discover-ats then confirms live and adds. If
only the instance (`wd5`, `wd12`, …) is missing, it is auto-probed from a small
common-instance list.

This generalizes a one-off "which of these companies can I scan?" probe into a
reusable tool that feeds the scanner.

## Inputs

- A YAML file `companies: [{name, slug?, website?, workday?}]` passed via
  `--in`, and/or bare company names as positional CLI args. The `workday` field
  is either a full careers URL string or a `{tenant, site, instance?}` object:

  ```yaml
  companies:
    - name: Adyen                       # slug vendors, name only
    - name: Monzo
      slug: monzo-bank                  # explicit slug (camelCase Ashby boards)
    - name: Nvidia
      workday: https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite
    - name: Salesforce
      workday: { tenant: salesforce, site: External_Career_Site }  # instance auto-probed
  ```

- `portals.yml` — dedupe target and write destination (user layer). Honors the
  `CAREER_OPS_PORTALS` env override for scratch/testing.

## Step 1 — Run the script

Preview (the default — writes nothing, prints the entries it would add):

```bash
node discover-ats.mjs --in companies.yml
```

Write — the user must explicitly opt in with `--write` to modify `portals.yml`
(a user-layer file; it is never auto-touched). This updates the file on disk;
it does not create a Git commit:

```bash
node discover-ats.mjs --in companies.yml --write
```

Other forms:

```bash
node discover-ats.mjs Stripe Ramp Mollie          # names as positional args
node discover-ats.mjs --in companies.yml --summary # human-readable table
node discover-ats.mjs --in companies.yml --vendors gh,ashby  # restrict probes
node discover-ats.mjs --in companies.yml --vendors workday   # Workday only
```

Vendor keywords for `--vendors`: `gh`, `ashby`, `lever` (slug-resolvable) and
`workday` (fires only for companies carrying a hint). Default is all four.

Parse the JSON envelope:

| Key | Contents |
|-----|----------|
| `metadata` | Counts (`resolved`, `unresolved`, `duplicatesSkipped`, `fresh`, `freshWritten`), `written` flag, `previewOnly`, `portalsPath`, `warnings` |
| `resolved` | Per company: `name`, `vendor`, `slug`, `careers_url`, `api` (Greenhouse only), `provider` (Workday only), `jobCount` |
| `unresolved` | Per company: `name`, `triedVendors`, `reason`, and (when present) `emptyBoards`, `errors`, `skippedUnsafeSlug`, `website` |
| `pendingEntries` | The rendered YAML block — present whenever nothing was written (i.e. on a preview run, the default) so the user can paste it manually |

**Default is preview.** Always show the user the `pendingEntries` / resolved
table first, then let them decide; only re-run with `--write` once they confirm.

## Step 2 — Review resolved vs unresolved

Show the user a table of resolved boards (company · vendor · jobCount ·
careers_url) and the unresolved list with reasons. Call out:

- **Empty-but-live boards** (`emptyBoards`): the board exists but lists 0 jobs
  right now. Not written by default (the goal is boards with open roles). Offer
  to re-run later, or force-add if they want it tracked regardless.
- **Workday**: if a company you know uses Workday came back unresolved with the
  "add a hint" reason, grab its careers URL (one click from the company's jobs
  page → the `<tenant>.wd<N>.myworkdayjobs.com/<site>` address bar) and add it as
  a `workday:` hint, then re-run. discover-ats confirms it live and adds it — no
  manual portals.yml editing. If you have the tenant + site but not the instance,
  give `workday: {tenant, site}` and the instance is auto-probed.
- **camelCase Ashby slugs** (e.g. `DeepL`, `AlephAlpha`): if a company you know
  is on Ashby came back unresolved, its slug is likely mixed-case — re-run with
  an explicit `slug:` in the input file (derived slugs are lowercased).
- **Genuinely unknown**: for a JS-only portal with no ATS API, paste a specific
  JD into `data/pipeline.md` and run `/career-ops pipeline`.

## Step 3 — Handoff

After writing, tell the user to run `/career-ops scan` (or a regional preset
like `eu-fintech`) to pull matching roles from the newly tracked boards.

## Rules

- **Zero-token:** all probing goes through the `providers/` HTTP/JSON layer.
  Never spawn LLM workers to resolve a company.
- **Workday needs a hint, never a guess:** resolve Workday only from a
  user-supplied URL or `{tenant, site}` — never brute-force site names. The
  instance (and only the instance) may be auto-probed from a bounded list.
- **portals.yml is user-layer — never auto-written:** the run is preview-only by
  default and touches nothing; only an explicit `--write` appends entries (via a
  comment-preserving, atomic text splice). Show the user the preview and let them
  confirm before you ever pass `--write`.
- **Idempotent:** re-running with the same input adds nothing (dedupe by name +
  careers_url/api).
