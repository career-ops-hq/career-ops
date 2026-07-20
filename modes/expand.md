# Mode: expand — Auto-discover and add missing competencies

Fetch public sources linked in the user's `config/profile.yml` (e.g., GitHub username, portfolio URL) to discover competencies, projects, and work history. Merge missing items into their `cv.md` / `article-digest.md` using the existing `add-entry.mjs` engine. 

> **Non-negotiables (from the project's source-of-truth rules in `_shared.md`):**
> - **Confirm before write.** Present all deduped additions to the user and halt until explicit approval is given.
> - **Additive Only.** Under no circumstances should existing CV sections be deleted or overwritten.
> - **No Unlinked URLs.** Strictly read URLs/usernames from `config/profile.yml` (e.g. `github.com/<username>`, portfolio link). Never accept raw URLs as arguments at invocation and never fetch unlinked URLs.
> - **Never fabricate.** Every bullet, metric, and date must be backed by the fetched page. Treat fetched evidence text as literal.
> - **Payload Identity.** The exact same JSON payload used in the `--dry-run` phase must be passed verbatim to the final write phase via safe serialization (`JSON.stringify`), rather than hand-quoting.

## Input

`$mode` after `expand` should be empty. Do not parse raw URLs or usernames from the prompt.
1. Read `config/profile.yml` to locate the user's GitHub username (`candidate.github`) or portfolio URL (`candidate.portfolio_url`).
2. If neither is present, prompt the user to add them to their profile config first.

## Pipeline

1. **Load context.** Read `cv.md` (its existing section names and formatting are the template to match) and `article-digest.md` if present.
2. **Fetch the sources (zero-key):**
   - **GitHub** → the profile page, the public REST API (`https://api.github.com/users/<username>/repos` for repositories list) **plus** the READMEs via WebFetch.
   - **Portfolio** → WebFetch. Only fall back to Playwright if the page is JS-rendered and WebFetch returns nothing useful.
   - **Kaggle / Google Scholar** (if linked) → WebFetch to identify publications, preprints, or datasets.
3. **Extract structured facts** actually present in the source: name, dates, tech stack, role, concrete outcomes. Leave anything unstated **blank**.
4. **Build and Dry-Run Dedup.** For each payload, safely serialize the unstructured text and capture it in a bash variable to guarantee payload identity between the dry-run and write phases. Pipe a quoted, collision-resistant heredoc (e.g., `'EOF_EXPAND_PAYLOAD'`) into `node -e`:
   ```bash
   PAYLOAD=$(node -e '
     const entry = require("fs").readFileSync(0, "utf-8");
     process.stdout.write(JSON.stringify({
       cv: { section: "Projects", dedupKey: "...", entry: entry }
     }));
   ' << 'EOF_EXPAND_PAYLOAD'
   ... unstructured text with "quotes", $vars, and `backticks` ...
   EOF_EXPAND_PAYLOAD
   )

   printf '%s' "$PAYLOAD" | node add-entry.mjs --stdin --dry-run
   ```
   Filter out any items that return `"status": "duplicate"`.
5. **Preview & Confirm Gate.** Show the user the newly discovered, non-duplicate entries. You MUST output your final proposal as a Markdown table containing exactly three columns: | skill | evidence | section |. You **must halt** and ask the user to approve, edit, or cancel. Do **not** proceed without an explicit yes.
6. **Write via the helper.** For each approved entry, pass the exactly identical stored payload to the final write, avoiding re-derivation:
   ```bash
   printf '%s' "$PAYLOAD" | node add-entry.mjs --stdin
   ```

## Section inference

| Source is… | CV section |
|------------|------------|
| a code project / repo / tool | `Projects` |
| a paper / publication / preprint | `Publications` (create if absent) |
| an internship / job / role | `Work Experience` |
| a talk / course / certification | `Education` (or ask if unclear) |

## Payload schema (input to `add-entry.mjs`)

Both keys optional; provide at least one. `articleDigest` is for projects only.

```json
{
  "cv": {
    "section": "Projects",
    "dedupKey": "<short canonical name>",
    "entry": "<exact markdown to insert>"
  },
  "articleDigest": {
    "dedupKey": "<same canonical name>",
    "entry": "## <Name> — <tagline>\n\n**Hero metrics:** ...\n\n**Architecture:** ...\n\n**Key decisions:**\n- ...\n\n**Proof points:**\n- ..."
  }
}
```

`dedupKey` is normalized (case- and punctuation-insensitive) to detect an entry that's already there.

## Rules

- Match the existing `cv.md` formatting exactly.
- If the fetch fails or the page has no usable content, skip it — never synthesize an entry from nothing.
