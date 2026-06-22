# Mode: update — Interactive System Update

When the user runs `/career-ops update`, execute this interactive update flow.

## Step 1 — Check for Updates

Run `node update-system.mjs check` and parse the JSON output.

- If `up-to-date`: Tell the user "career-ops is up to date (v{version})." and stop.
- If `offline`: Tell the user "Cannot reach GitHub to check for updates. Try again later." and stop.
- If `dismissed`: Tell the user "Update check was previously dismissed. Clearing the dismissal and re-checking now." Remove `.update-dismissed`, then re-run `node update-system.mjs check` and branch on the new status.
- If `update-available`: Continue to Step 2.

## Step 2 — Show What Changed

Show the user what will change. Run:

```bash
git fetch https://github.com/santifer/career-ops.git main || {
  echo "Failed to fetch latest changes. Cannot generate an accurate diff preview."
  exit 1
}
```

If the fetch fails, stop Step 2 and tell the user you couldn't preview the changes — don't proceed with a stale `FETCH_HEAD`.

Then, only if the fetch succeeded, for each System Layer file category show a summary:

```bash
git diff HEAD..FETCH_HEAD --stat -- modes/ CLAUDE.md AGENTS.md *.mjs batch/ dashboard/ templates/ docs/ VERSION DATA_CONTRACT.md
```

Present to the user as a clear summary:

> **Update available: v{local} → v{remote}**
>
> **Changes summary:**
> - Modes: {N} files changed (list which ones)
> - Scripts: {N} files changed
> - Dashboard: {N} files changed
> - Templates: {N} files changed
> - Other: {N} files changed
>
> **Changelog:**
> {changelog from update-system.mjs check output}
>
> Your personal files (CV, profile, tracker, reports) will NOT be touched.

If the user wants details on specific files, show the actual diff for those files using `git diff HEAD..FETCH_HEAD -- {path}`.

## Step 3 — Compatibility Check

Before applying, check if the update might affect the user's customizations:

1. **Read `modes/_profile.md`** (if it exists)
2. **Diff `modes/_shared.md`**: Run `git diff HEAD..FETCH_HEAD -- modes/_shared.md`
3. **Check for archetype changes**: If `_shared.md` has changes in the "Archetype Detection" section, and `_profile.md` references archetype names, warn the user:
   > "⚠️ The scoring system or archetypes were updated. Your customizations in `_profile.md` may reference outdated archetype names. I'll review them after the update."
4. **Check for scoring changes**: If the "Scoring System" section changed, note it:
   > "ℹ️ The scoring system was updated. Scores in future evaluations may differ slightly from previous ones."
5. **Check for new mode files**: If new modes were added (files in `modes/` that don't exist locally), mention them:
   > "✨ New modes available: {list}. Run `/career-ops` to see all commands."

## Step 4 — Confirm and Apply

Ask the user for confirmation:
> "Ready to update. Apply changes? (This can be rolled back with `/career-ops update rollback`)"

If yes:
1. Capture the current commit as a run-specific pre-update baseline before apply runs, e.g. `PRE_UPDATE_REF=$(git rev-parse HEAD)`. Don't rely on `backup-pre-update-{local}` alone — `update-system.mjs apply` reuses that branch if it already exists, so it may point at an older snapshot.
2. Run `node update-system.mjs apply`
   - If the command exits with a non-zero code, treat apply as failed. Show the captured output and offer:
     > "⚠️ Update apply failed. Want me to show the full error, or try `/career-ops update rollback`?"
   - Stop the flow here if apply failed — do not run doctor or reconciliation on a partially-applied update.
3. Run `node doctor.mjs` to validate the installation
   - If the command exits with a non-zero code, treat validation as failed. Show the captured output and offer:
     > "⚠️ Validation failed after update. Want me to show the full error, or roll back with `/career-ops update rollback`?"
   - Stop the flow here if validation failed — do not run reconciliation or show the success message.
4. If Step 3 flagged archetype/scoring changes, reconcile `modes/_profile.md` against the new `modes/_shared.md`:
   - Read both the pre-update version (`git show $PRE_UPDATE_REF:modes/_shared.md`) and the post-update version of `modes/_shared.md`.
   - Extract the canonical archetype identifiers from each version (archetype headings/definitions, plus any slug/alias fields).
   - Read `modes/_profile.md` and look for tokens that match archetype names (inline text, Markdown links, YAML keys, code spans).
   - Classify each reference:
     - **Unchanged**: exact match in the new `_shared.md` → no action.
     - **Renamed**: no exact match, but a single strong fuzzy match in the new `_shared.md` (e.g. Levenshtein similarity ≥ 0.7) → offer to rename.
     - **Removed**: no match at all → offer to delete or replace.
   - When a rename or removal is detected, ask before editing:
     - For renames:
       > "Your _profile.md references archetype '{old_name}' which was renamed to '{new_name}'. Want me to update it?"
     - For removals:
       > "Your _profile.md references archetype '{old_name}' which was removed in the new _shared.md. Want me to delete the reference or replace it with another archetype?"
5. Show final status:
   > "✅ Updated to v{version}. Run `node doctor.mjs` anytime to verify setup."

If no:
1. Run `node update-system.mjs dismiss`
2. Tell the user they can run `/career-ops update` anytime to check again.

## Step 5 — Rollback (if requested)

If the user says "rollback" or runs `/career-ops update rollback`:
1. Run `node update-system.mjs rollback`
2. Show what was restored.

## Rules

- NEVER auto-modify User Layer files during update (cv.md, config/profile.yml, data/, reports/, output/, interview-prep/, jds/, article-digest.md, portals.yml)
- `modes/_profile.md` is User Layer too: the compatibility check in Step 3 reads it strictly read-only
- Exception: `modes/_profile.md` may be edited **only** in Step 4.3, and **only** after the user explicitly confirms each individual rename/removal. Never batch-edit without per-change consent.
- User-specific customizations (archetypes, scoring weights, narrative) belong in `modes/_profile.md` or `config/profile.yml`, never in `modes/_shared.md`
- If anything goes wrong, tell the user to run `node update-system.mjs rollback`
- Keep the output concise — users don't want walls of text during an update
