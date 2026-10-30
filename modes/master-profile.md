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

## Prepare selected experience bullets (opt-in)

Use this only when the user explicitly asks to prepare a CV from selected
Profile facts. Start with a valid **HTML** CV JSON payload and let the user
choose the experience bindings and ordered fact IDs. Do not infer a binding
from company/role labels: two entries may share the same label. The target is
an exact zero-based experience slot in the original payload, anchored by its
content digest. Keep the original payload and selection for later verification.

```mermaid
flowchart LR
  A[Reviewed Profile + original HTML payload] --> B[Explicit bindings and ordered fact IDs]
  B --> C[prepare-cv: payload + mapping]
  C --> D[verify-cv against current Profile and originals]
  D -. Future integration .-> E[Existing CV checks and PDF workflow]
```

The shared APIs live in `lib/career-profile.mjs` and
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

## Scope boundary

Preparation is not PDF generation. There is no automatic JD fact selection,
rewriting, translation, new evidence ingestion or CV re-analysis loop. The
existing PDF workflow continues to use its existing inputs; these commands do
not automatically connect the prepared bundle to it. Full opt-in generation
integration remains follow-up work in #5494.

Treat the Profile as a reviewed selection index, not an additional primary
source. `verified` and the consistency hashes prove neither factual truth nor
human consent, and do not replace existing title, structure or fact checks.
Do not pass Profile text/evidence as a new source to make a failing fact gate
pass. Evidence paths are metadata here and are never opened by the adapter.
The mapping covers a JSON payload, not arbitrary edited HTML. A future rendering
integration must verify and render the same payload, retain the existing gates,
and reject missing primary sources for the new opt-in path.

## Schema v1

- `candidate`: optional identity fields
- `summary`, `certifications`, `skills`: lists of fact records
- `experiences`, `projects`, `education`: entries with a label, evidence, and
  a `facts` list
- Each fact has a stable `id`, `text`, `evidence` (`source`, `line`, `quote`),
  and `review_status` (`needs_review` or `verified`)

The machine validator checks structure and evidence fields. It cannot establish
whether a claim is true; that responsibility stays with the user during review.
