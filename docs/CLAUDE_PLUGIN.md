# Running career-ops as a Claude Code plugin

career-ops ships a Claude Code plugin manifest (`.claude-plugin/`), so you can install it once and use it from any folder: the Claude Code CLI, or the Code tab of the Claude desktop app. You don't need to open the career-ops checkout as your project.

If you already work inside a career-ops checkout, you don't need the plugin: the checkout's own `.claude/skills/career-ops` gives you `/career-ops` there.

## Install

**From the Claude desktop app (Customize):**

1. Open **Customize → Plugins**.
2. Select **Add → Add marketplace** and enter `career-ops-hq/career-ops`.
3. Open **Discover**, find **career-ops**, and select **Add**.

The plugin is saved to your claude.ai account. The Code tab downloads it as a synced plugin the next time a session starts.

**From a Claude Code session:**

```text
/plugin marketplace add career-ops-hq/career-ops
/plugin install career-ops@career-ops
```

For a fork, replace `career-ops-hq/career-ops` with your fork's `owner/repo`.

Then start a new session. The first start takes a few seconds longer while the plugin installs its Node packages. Run `/career-ops:career-ops` to open the command menu, or paste a job URL. On a fresh setup the agent walks you through onboarding.

## Where your files live

| What | Where | Survives a plugin update? |
|------|-------|---------------------------|
| career-ops code | `~/.claude/plugins/cache/career-ops/career-ops/<version>/` (Customize installs: `~/.claude/plugins/synced/`) | No, it is replaced |
| Node packages | `${CLAUDE_PLUGIN_DATA}/node_modules`: `~/.claude/plugins/data/career-ops-career-ops/` for a `/plugin` install, `~/.claude/plugins/data/career-ops-synced/` for a Customize install | Yes |
| Your CV, profile, tracker, reports | `~/career-ops-data` | Yes, Claude Code never touches it |

Claude Code replaces the code folder on every plugin update, so career-ops never keeps your files there. `path-resolver.mjs` detects a plugin install and uses `~/career-ops-data` when nothing else names a data folder.

To use another folder, set `CAREER_OPS_ROOT` (or `CAREER_OPS_DATA_DIR`) to an absolute path in `~/.claude/settings.json`. A folder inside `~/.claude/plugins/` is refused: career-ops scripts stop with an error that names the variable, and `node doctor.mjs` reports it.

```json
{
  "env": {
    "CAREER_OPS_ROOT": "/absolute/path/to/job-search"
  }
}
```

That setting applies to every Claude Code session, including one you open in a career-ops checkout, where it moves the checkout's data root too.

To keep using the files in a checkout you already have, point `CAREER_OPS_ROOT` at that checkout. Alternatively, add the checkout itself as a local marketplace (`/plugin marketplace add ~/career-ops`). Claude Code then loads the plugin in place from the checkout, nothing is copied, and the checkout keeps its own data and `node_modules`.

Uninstalling the plugin deletes the Node packages folder, not `~/career-ops-data`.

## What the plugin adds at session start

`hooks/hooks.json` runs `scripts/claude-plugin-session-start.mjs` when a session starts. For a plugin install it does two things:

1. **Installs the runtime packages.** It runs `npm install --omit=dev --ignore-scripts` into the plugin's data folder, then links that `node_modules` into the code folder. It reinstalls only when `package.json` changes, so later sessions start silently. Sessions that start together take turns: the check, the install and the link run under a lock in the data folder, so two of them never run `npm install` there at once. An install that runs past 3 minutes is stopped and reported, so the lock is released before the hook's own 5-minute limit. On Windows, stopping it ends the shell that started npm, and npm itself may keep running. Claude Code's own dependency install needs a committed `package-lock.json`, which this repository doesn't keep.
2. **Creates the data folder** if it is missing.

For a checkout loaded in place, the hook does nothing. Its packages and data are yours to manage.

The hook skips Playwright's browser download because it takes minutes. `node doctor.mjs` reports when Chromium is missing. Install it from the plugin's code folder with `npx playwright install chromium`; Chromium is shared per user, so an existing career-ops checkout may already have it.

## Updating

Claude updates the plugin, not `update-system.mjs`. Inside a plugin install, `node update-system.mjs check` reports `managed-by-plugin`, and `apply` and `rollback` refuse.

- **Customize installs:** open the marketplace under **Customize → Plugins** and turn on **Sync automatically**, or select **Check for updates** to pull now.
- **`/plugin` installs:** open `/plugin`, find career-ops under **Installed** and update it, or turn on auto-update for its marketplace on the **Marketplaces** tab.

The manifest pins `version`, so an install stays on that version until `version` changes. If you ship changes from a fork, bump `version` in `.claude-plugin/plugin.json`, then copy that file verbatim to `.codex-plugin/plugin.json` and `.github/plugin/plugin.json`.

## Known limits

- **Two skills inside a checkout.** In a session opened in a career-ops checkout with the plugin enabled, both `/career-ops` (the checkout's) and `/career-ops:career-ops` (the plugin's) appear. They read different data roots unless `CAREER_OPS_ROOT` is set, so pick one.
- **Windows.** The hook links `node_modules` with a directory junction. This hasn't been verified on Windows yet.
- **Chat and Cowork.** A Customize install also appears in Chat and Cowork, but career-ops only runs in Claude Code. Chat has no access to your files, and Cowork's shell can't install the plugin's packages. For Cowork, mount a checkout instead: see [COWORK.md](COWORK.md).
