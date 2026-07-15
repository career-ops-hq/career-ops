# Plugins

Plugins extend career-ops with integrations that need an API key or talk to an
external service — things the zero-keys, local-first core doesn't carry. They are
**opt-in**, sandboxed-by-convention, and additive: with no plugins enabled, the
core runs exactly as it always has.

> This is **not** the Claude Code plugin (`.claude-plugin/`). These plugins
> extend career-ops itself.

## Using plugins

```bash
node plugins.mjs list          # what's installed + its trust badge
node plugins.mjs available     # bundled + community plugins we've approved
node plugins.mjs add <name>    # install an approved community plugin
node plugins.mjs enable <id>   # show the capability card (then add --confirm)
node plugins.mjs skill <id>    # print a plugin's how-to (if it ships one)
```

Two gates must both be satisfied for a plugin to run: it must be **enabled**
(`node plugins.mjs enable <id> --confirm`, which records your consent) **and** its
keys must be in your `.env`. `node doctor.mjs` shows what's missing.

### Trust badges

| Badge | Meaning |
|-------|---------|
| `📦 bundled` | Shipped in `plugins/`, reviewed in-tree, auto-updated with the core. |
| `✓ approved` | A community plugin we reviewed at an exact pinned commit (in the registry). |
| `❓ community-unverified` | You installed it from a repo we haven't reviewed — you're trusting the author. |
| `⚠️ off-registry` | Installed commit differs from the approved one. |

If a plugin's files change without a version bump, career-ops **blocks it** and
asks you to review + `node plugins.mjs trust <id>` to re-pin (tamper detection).

## Writing a plugin

```bash
node plugins.mjs new my-plugin     # scaffolds plugins.local/my-plugin/
```

A plugin is a directory with a `manifest.json` (validated before any code is
imported), an `index.mjs` (default-exports your hooks), and optionally a
`skill.md` + `_helpers`. Hooks: **provider / ingest / search / notify / export**
— there is no auto-submit hook. Producers **return** `Job[]`; the engine writes
them. Reach the network **only** through `ctx.fetch` (your manifest
`allowedHosts` is enforced, with SSRF protection). Keys arrive via `ctx.env`,
non-secret settings via `ctx.settings`.

See `plugins/README.md` for the full contract + the honest trust model (plain
ESM has no hard sandbox — bundled plugins are code-reviewed; your own are your
trust).

## Publishing + getting approved

1. Develop locally, then publish your plugin as its **own public GitHub repo**
   named exactly `career-ops-plugin-<name>` (the template repo gives you the
   right shape + a release workflow). Minimum files: `manifest.json`,
   `index.mjs`, `README.md`, `LICENSE`, plus `skill.md` + `test/smoke.mjs` to be
   listable.
2. File a **Plugin registration** issue (becomes your plugin's home/changelog).
3. Open a **registry PR** (the `?template=plugin-registry.md` template — the
   template repo's release workflow can open it for you on a release tag) that
   adds your `plugins-registry/<id>.json` file, pinned to an exact commit. CI
   (`plugin-registry-validate`) checks the naming, manifest, min-files, license,
   egress, and a static audit before a maintainer reviews. Once merged, users can
   `node plugins.mjs add <name>` and your plugin ships to them via the normal
   update.
4. **Updates** = one more registry PR bumping your entry's `sha` + `version`
   (your release workflow opens it from your own fork). Users only ever get the
   commit we approved.

Broadly-useful, low/zero-key plugins may be shipped **bundled** in `plugins/`
(e.g. `apify`, `gmail`, `notion`). Bundled plugins are **reference seeds**:
reviewed in-tree, always present, and a working example to copy — kept minimal
and stable on purpose, **not** a home for ongoing feature work.

### Improving a bundled plugin → publish a maintained successor

We **don't take feature PRs against bundled plugins.** If you want to extend one
(more options, a richer mapping, new behavior), own it properly:

1. Publish `career-ops-plugin-<id>` with the **same `id`** as the bundled plugin
   (start from the bundled plugin's code — it's MIT and credits its origins).
2. In your registry PR, set **`"supersedesBundled": true`** on your entry.
3. Once approved + pinned, anyone who runs `node plugins.mjs add career-ops-plugin-<id>`
   installs your version, and the engine gives **your maintained successor
   precedence over the bundled reference** of the same id. `node plugins.mjs available`
   surfaces the link: *"gmail — 🔁 maintained version: career-ops-plugin-gmail"*.

This keeps the core lean and **puts the integration in your hands, with your name
on it** — while the bundled seed stays as the always-present fallback, so the
feature never breaks even if a successor goes quiet. Precedence is granted ONLY
to a registry-approved successor installed at its exact pinned commit — so an
unprompted, unreviewed community plugin can never shadow a bundled one.

**Trust boundary (plainly).** The thing this protects is the *supply chain*: the
registry is a reviewed system file and installs pin an exact commit, so no
upstream author can push code over a bundled plugin without a maintainer merging
their entry. It does **not** try to stop *you* from running your own modified
code on your own machine — career-ops is local-first and the source is yours; if
you edit `plugins.local/` or your `plugins.lock`, you're choosing to run your own
version, exactly as you always could. Removing a successor restores the bundled
reference.

## Community plugins

Every community plugin in the registry is reviewed and pinned to an exact commit (see [Trust badges](#trust-badges) and [Publishing + getting approved](#publishing--getting-approved)).

| Plugin | What it does | Hooks | Keys needed | Author |
| --- | --- | --- | --- | --- |
| [career-ops-plugin-tavily](https://github.com/Schlaflied/career-ops-plugin-tavily) | Tavily search/extract for job scanning, liveness checks, and company research. | search | `TAVILY_API_KEY` | @Schlaflied |
| [career-ops-plugin-google-calendar](https://github.com/Schlaflied/career-ops-plugin-google-calendar) | Google Calendar ingest — detect upcoming interview events and surface them in the career-ops pipeline. | ingest | `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REFRESH_TOKEN` | @Schlaflied |
| [career-ops-plugin-linkedin-alerts](https://github.com/Schlaflied/career-ops-plugin-linkedin-alerts) | LinkedIn job alert ingest — parse LinkedIn alert emails from your Gmail inbox, normalize tracking links to canonical job URLs, and surface them in the career-ops pipeline. | ingest | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | @Schlaflied |
| [career-ops-plugin-outlook-interviews](https://github.com/Schlaflied/career-ops-plugin-outlook-interviews) | Outlook interview ingest — detect interview invitation emails via Microsoft Graph, extract company / role / meeting link, and surface them in the career-ops pipeline. | ingest | `MSGRAPH_CLIENT_ID`, `MSGRAPH_REFRESH_TOKEN` (optional: `MSGRAPH_CLIENT_SECRET`) | @Schlaflied |
| [career-ops-plugin-obsidian](https://github.com/Schlaflied/career-ops-plugin-obsidian) | Obsidian export — mirror the tracker into your vault as frontmatter notes queryable by Dataview/Bases; frontmatter belongs to the machine, the note body belongs to you. | export | None | @Schlaflied |

To add your own plugin to the registry, follow the [Publishing + getting approved](#publishing--getting-approved) flow above.

## Not a plugin

- **Centralized infrastructure** the project would run (hosted aggregation,
  shared services, proxies) → a separate, opt-in service, see
  [Discussion #904](https://github.com/santifer/career-ops/discussions/904).
- **Auto-submitting / blind-applying** → out of the core everywhere. career-ops
  drafts for you to review and submit; it is a decision-support tool, not a bot.
