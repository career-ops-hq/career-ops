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

## Select experience bullets (opt-in)

Use this only when the user explicitly asks to prepare or generate a CV from selected
Profile facts. Start with a valid **HTML** CV JSON payload and let the user
choose the experience bindings and ordered fact IDs. Do not infer a binding
from company/role labels: two entries may share the same label. The target is
an exact zero-based experience slot in the original payload, anchored by its
content digest. Keep the original payload and selection for later verification.

```mermaid
flowchart LR
  A[Reviewed Profile + original HTML payload] --> B[Explicit bindings and ordered fact IDs]
  B --> C[prepare-cv: payload + mapping]
  C --> D[generate-cv: re-read Profile and verify originals]
  D --> E[Title and structure checks on the same payload]
  E --> F[Fresh HTML and existing PDF fact gate]
```

The selection APIs live in `lib/career-profile.mjs` and
`lib/profile-cv-selection.mjs`. A caller constructs a manifest like this
(the IDs and target slot below are illustrative; use the user's choices):

```js
import { loadValidatedProfile } from './lib/career-profile.mjs';
import { selectionDigest, prepareCvSelection, verifyCvSelection }
  from './lib/profile-cv-selection.mjs';

const profile = loadValidatedProfile(); // respects the Data Root override
// basePayload is the original HTML CV payload, read independently.
const selection = {
  schema: 'profile-selection.v1',
  base_payload_sha256: selectionDigest(basePayload),
  bindings: [{
    profile_entry_id: 'experience-id-chosen-by-user',
    target: {
      experience_index: 0,
      entry_sha256: selectionDigest(basePayload.experience[0]),
    },
    fact_ids: ['first-fact-id-chosen-by-user', 'second-fact-id-chosen-by-user'],
  }],
};
const prepared = prepareCvSelection({ profile, basePayload, selection });
verifyCvSelection({ profile, basePayload, selection }, prepared);
// prepared.payload is an ordinary HTML CV payload; prepared.mapping is separate.
```

`selectionDigest` hashes canonical JSON with sorted object keys and preserved
array order, using SHA-256. It rejects non-JSON values instead of silently
dropping them. Save the manifest only as part of the user's requested workflow.
The CLI reads JSON manifests and prints the prepared bundle to stdout:

```bash
node career-profile.mjs prepare-cv --payload base.json --selection selection.json > prepared.json
node career-profile.mjs verify-cv --payload base.json --selection selection.json --prepared prepared.json
```

All input paths resolve from the Data Root (absolute paths also work). Both
commands default to `data/career-profile.yml` and accept `--profile other.yml`.
They only read inputs; stdout redirection is the caller's choice and resolves
from the shell's working directory. Keep output paths distinct from inputs.
Missing or invalid profiles fail; preparation never initializes one.

Preparation validates the whole schema v1 Profile and the existing HTML payload
contract. Each binding replaces **only** that target's `bullets`, one selected
`fact.text` per bullet, verbatim and in the requested order. Company, role,
location, dates, unbound experiences and all other sections remain unchanged.
Missing IDs, globally duplicate IDs, duplicate targets/facts, empty selections,
wrongly bound facts, `needs_review` facts/entries and stale anchors fail with a
`SelectionError` (`code` plus entry/fact/target context where available).
Legacy entries without a heading review status retain schema v1's implicit
verified heading status; individual facts still require explicit `verified`.

The separate `profile-mapping.v1` mapping records:

- `base_payload_sha256`, `selection_sha256`, `selected_profile_sha256`, and
  `payload_sha256` for consistency checks;
- `bullets`: the zero-based `experience_index`/`bullet_index`,
  `profile_entry_id`, `fact_id`, `text_sha256`, and evidence `source`/`quote`
  for each selected bullet. It makes no claim about unselected content.

`verify-cv` reconstructs the result from the **current** Profile and independently
supplied original payload/selection. It compares both the entire payload and
the mapping; simply updating a sidecar hash after editing the payload fails.
Changes to selected text, review state, entry label/evidence, fact evidence
source/quote, bindings/order or base payload require preparation again (base
edits also require a new manifest). Evidence line-only moves, Profile entry/fact
reordering and unrelated edits stay valid if the whole Profile remains valid.
The mapping intentionally excludes evidence line numbers from identity.

## Generate the selected CV

Once the user has reviewed the selection and the prepared payload, use the
opt-in generation entry point:

```bash
node career-profile.mjs generate-cv --payload base.json --selection selection.json --prepared prepared.json --html output/cv-v1.html --pdf output/cv-v1.pdf
```

It accepts `--profile other.yml`, `--template resolved-template.html` and
`--report 123`. Resolve the template using `node cv-templates.mjs resolve cv`
(or the user's named template) as in `modes/pdf.md`, then pass its path with
`--template`; omission resolves `cv.template` from `config/profile.yml`,
falling back to the base template. The main template must contain
`{{EXPERIENCE}}` outside comments; a sibling `sections/experience.html` partial,
when present, must contain `{{BULLETS}}` directly in its `ENTRY` block. This
token check does not prove rendered visibility or factual truth.

`generate-cv` re-reads the current Profile and reconstructs the expected payload
and mapping before writing output. It requires a non-empty Data Root `cv.md`
and aligned Data Root/tracker workspaces, so the builder and checks use the
same candidate's files. Output paths must be inside that workspace, end in
`.html` and `.pdf`, and not already exist, including directories or symlinks.
Choose a new versioned pair for each attempt. Inputs and source files are not
rewritten.

The entry point holds an open descriptor for the validated workspace and passes
it to the HTML builder and PDF generator with `--no-clobber`. A Python 3
standard-library helper traverses each output directory relative to that
descriptor with `O_DIRECTORY | O_NOFOLLOW`, including newly created directories.
It writes a temporary file exclusively, then atomically links it to the final
name without replacing any existing file or link. After the workspace descriptor
opens, swapping an ancestor for a symlink cannot redirect publication; a
directory already opened remains pinned. Ancestors above the workspace remain
trusted during the initial path checks and descriptor open.
Symlinks below the workspace root are rejected even if they point inside it;
a symlink used to name the workspace root itself is supported.
PDF index registration uses the same directory anchor and the existing manifest
lock convention. A redirected or external index path is refused with a warning;
the already generated PDF remains available. The protected writer waits for an
existing lock but does not reclaim stale locks.

This opt-in command and standalone `--no-clobber` require `python3` on PATH with
POSIX descriptor-relative filesystem APIs (Linux/macOS; use WSL on Windows).
Missing Python or unsupported APIs stop generation; there is no pathname-based
fallback. Renderer scratch HTML lives in a private OS temporary directory.
Default generation retains its existing runtime requirements and overwrite
behavior.

The command gives a private JSON snapshot of the verified payload to the real
title check, structure check and HTML builder, then invokes the existing PDF
generator. Title and structure findings keep their warning-only behavior;
apply the review policy in PDF Steps 17a/17b before invoking generation, and
surface any remaining warnings before delivering the result. CLI/input errors
stop generation. Section order, chronological experience order, locked sections
and the fact gate remain enforced by the existing generator, with no skip or
reordering override on this entry point. Page format and country come from the
payload and are resolved to the same paper size for HTML and PDF.

The PDF invocation requires `--require-cv-source`: at the actual fact gate,
`cv.md` must be readable and non-empty. The required-source check and claim
extraction share a single read, so an earlier successful preflight cannot
silently substitute for the source being available at the gate. This opt-in
cannot be combined with `--skip-fact-check` and is not a batch option.

If a gate fails, correct the source-backed payload or the user's reviewed
selection, then prepare again. Changes to the original payload also need a new
selection manifest. Never fix the prepared bundle or rendered HTML by hand.
A failed run can leave an HTML draft; it is not a successful PDF result.
For hiring-manager audits and ATS copies, follow the opt-in branch in
`modes/pdf.md` so any accepted edits are prepared and checked again.

## Scope boundary

`prepare-cv` and `verify-cv` only read inputs and print results; `generate-cv`
explicitly renders the selected result. There is no automatic JD fact
selection, rewriting, translation, new evidence ingestion or CV re-analysis
loop. The default PDF workflow and its inputs remain unchanged.

Treat the Profile as a reviewed selection index, not an additional primary
source. `verified` and the consistency hashes prove neither factual truth nor
human consent, and do not replace existing title, structure or fact checks.
Do not pass Profile text/evidence as a new source to make a failing fact gate
pass. Evidence paths are metadata here and are never opened by the adapter.
The mapping covers a JSON payload, not arbitrary edited HTML. `generate-cv`
verifies and renders that same payload and requires primary CV evidence; it
does not accept an existing HTML file as its input. Existing fact-checking
coverage is unchanged, including its language-specific limits.

## Schema v1

- `candidate`: optional identity fields
- `summary`, `certifications`, `skills`: lists of fact records
- `experiences`, `projects`, `education`: entries with a label, evidence, and
  a `facts` list
- Each fact has a stable `id`, `text`, `evidence` (`source`, `line`, `quote`),
  and `review_status` (`needs_review` or `verified`)

The machine validator checks structure and evidence fields. It cannot establish
whether a claim is true; that responsibility stays with the user during review.
