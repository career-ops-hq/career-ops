# Customization Guide

## Profile (config/profile.yml)

This is the single source of truth for your identity. All modes read from here.

Key sections:
- **candidate**: Name, email, phone, location, LinkedIn, portfolio
- **target_roles**: Your North Star roles and archetypes
- **narrative**: Your headline, exit story, superpowers, proof points
- **compensation**: Target range, minimum, currency
- **location**: Country, timezone, visa status, on-site availability, and structured work authorization (`authorized_in`, `needs_sponsorship`) that drives the Work-Auth signal in job evaluation (flags an explicit no-sponsorship JD as a hard blocker)
- **culture_screen**: Structural criteria for team culture, such as team size, meeting load, or hiring process (the `deprioritize_if_absent` strict flag caps the culture score at 2/5 if evidence is entirely missing)

## Target Roles (modes/_profile.md)

The archetype table in `_profile.md` determines how offers are scored and CVs are framed. Edit the table to match YOUR career targets:

```markdown
| Archetype | Thematic axes | What they buy |
|-----------|---------------|---------------|
| **Your Role 1** | key skills | what they need |
| **Your Role 2** | key skills | what they need |
```

Also update the "Adaptive Framing" table to map YOUR specific projects to each archetype.

## Portals (portals.yml)

Copy from `templates/portals.example.yml` and customize:

1. **title_filter.positive**: Keywords matching your target roles
2. **title_filter.negative**: Tech stacks or domains to exclude
3. **search_queries**: WebSearch queries for job boards (Ashby, Greenhouse, Lever)
4. **tracked_companies**: Companies to check directly

Once you have a few scans behind you, `node filter-audit.mjs --summary` shows which `title_filter.positive` keywords actually bring offers, and `node coverage-check.mjs` explains why a posting you found by hand never reached you.

**Filtering on a field other than the title (optional).** When a board publishes a structured field that says more than the title does — an occupation code, a department — define a whitelist for it under `field_filters` and set `filter_on` on that target (`filter_on: noc`, or `filter_on: [title, noc]` to require both). The keywords use the same language as `title_filter`. Targets without `filter_on` keep gating on the title. The provider has to emit the field (for example a `local_parser` script); postings that lack it pass and are counted, and the scan warns when a target never supplies it. See the "Declared-field whitelists" section of `templates/portals.example.yml`.

`portals.yml` is meant to stay live, not be a static file — see [Keeping portals.yml live](KEEPING_PORTALS_LIVE.md) for the house rule that auto-adds companies as they come up, and the commands to validate the file after each change.

## CV Template (templates/cv-template.html)

The HTML template uses these design tokens:
- **Fonts**: Space Grotesk (headings) + DM Sans (body) -- self-hosted in `fonts/`
- **Colors**: Cyan primary (`hsl(187,74%,32%)`) + Purple accent (`hsl(270,70%,45%)`)
- **Layout**: Single-column, ATS-optimized

To customize fonts/colors, edit the CSS in the template. Update font files in `fonts/` if switching fonts.

## Negotiation Scripts (modes/_profile.md)

Your negotiation scripts live under "Your Negotiation Scripts" in `modes/_profile.md`, which onboarding copies from `modes/_profile.template.md` and updates never touch. Replace the example scripts with your own:
- Salary expectations (the range itself comes from `compensation` in `config/profile.yml`)
- Geographic discount pushback
- Responses to an offer below target

Comp research guidance sits just above them, under "Your Comp Targets". Don't put these in `modes/_shared.md`: it is a system file, and an update replaces it.

## Hooks (Optional)

Career-ops can integrate with external systems via Claude Code hooks. Example hooks:

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "echo 'Career-ops session started'"
      }]
    }]
  }
}
```

Save hooks in `.claude/settings.json` (Claude Code). OpenCode does not support hooks. For equivalent functionality, use custom commands (`.opencode/commands/`) or agents (`.opencode/agents/`) — see https://opencode.ai/docs/commands/.

## States (templates/states.yml)

`templates/states.yml` lists the tracker's canonical states and the aliases each one accepts (`aplicado` → `Applied`). The Node scripts read it at run time: `set-status.mjs` rejects a status it does not list, and `normalize-statuses.mjs`, `merge-tracker.mjs` and `dedup-tracker.mjs` resolve aliases through it.

It is a system-layer file (see [DATA_CONTRACT.md](../DATA_CONTRACT.md)), so an update replaces it, and no user-layer file adds states or aliases. A state you add only in your own copy is lost on the next update. Until then the scripts and the web app's status API accept it, but the Go dashboard and the web app's tabs, pills and funnel don't, because they keep their own copies of the list. For detail the states don't capture (ghosted, on hold, a referral), use the Notes column.

A new state is a change to career-ops itself, so open an issue first (see [CONTRIBUTING.md](../CONTRIBUTING.md)). The pull request touches more than `states.yml`, because the dashboard, the web app and the funnel keep their own copies of the list:

1. `templates/states.yml`: the entry (`id`, `label`, `aliases`, `description`, `dashboard_group`, plus `terminal: true` for an end state). A non-terminal state's position in the list is its lifecycle order.
2. Go dashboard: `NormalizeStatus` and `isCanonicalStatusName` in `dashboard/internal/data/career.go`, the pipeline groups, tabs and colors in `dashboard/internal/ui/screens/pipeline.go`, and the labels in `dashboard/internal/i18n/catalog.go`.
3. Web app: `web/src/lib/status-alias.mjs`, the status lists in `web/src/lib/format.ts`, `web/src/app/actions/registry.ts` and `web/src/lib/pipeline-navigation.mjs`, and the state lists in the assistant prompt in `web/src/app/api/assistant/route.ts`.
4. Funnel: where the state sits in the funnel and whether it counts as active, in `funnel-stages.mjs`, `stats.mjs`, `web/src/lib/analytics-metrics.mjs` and the dashboard's funnel in `career.go`.
5. Prose that lists the states: the Canonical States table in `AGENTS.md`, `modes/tracker.md`, `batch/batch-prompt.md` and `templates/README.md`. `git grep` for an existing label such as `Assessment` finds the rest.
6. Tests that classify every state: `tests/analytics-state-contract.test.mjs` and `tests/dedup-tracker-status-aliases.test.mjs`.

`node test-all.mjs` and `go test ./...` in `dashboard/` fail on most of the copies above when the new state is missing from them. A new alias for an existing state also needs `NormalizeStatus` and `status-alias.mjs`, which the same tests check.
