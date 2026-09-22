# Customization Guide

## Profile (config/profile.yml)

This is the single source of truth for your identity. All modes read from here.

Key sections:
- **candidate**: Name, email, phone, location, LinkedIn, portfolio
- **target_roles**: Your North Star roles and archetypes
- **narrative**: Your headline, exit story, superpowers, proof points
- **compensation**: Target range, minimum, currency
- **location**: Country, timezone, visa status, on-site availability, and structured work authorization (`authorized_in`, `needs_sponsorship`) that drives the Work-Auth signal in job evaluation (flags an explicit no-sponsorship JD as a hard blocker)
- **culture_screen**: Structural criteria for team culture (the `deprioritize_if_absent` strict flag caps the culture score at 2/5 if evidence is entirely missing)

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

**Filtering on a field other than the title (optional).** When a board publishes a structured field that says more than the title does — an occupation code, a department — define a whitelist for it under `field_filters` and set `filter_on` on that target (`filter_on: noc`, or `filter_on: [title, noc]` to require both). The keywords use the same language as `title_filter`. Targets without `filter_on` keep gating on the title. The provider has to emit the field (for example a `local_parser` script); postings that lack it pass and are counted, and the scan warns when a target never supplies it. See the "Declared-field whitelists" section of `templates/portals.example.yml`.

## CV Template (templates/cv-template.html)

The HTML template uses these design tokens:
- **Fonts**: Space Grotesk (headings) + DM Sans (body) -- self-hosted in `fonts/`
- **Colors**: Cyan primary (`hsl(187,74%,32%)`) + Purple accent (`hsl(270,70%,45%)`)
- **Layout**: Single-column, ATS-optimized

To customize fonts/colors, edit the CSS in the template. Update font files in `fonts/` if switching fonts.

## Negotiation Scripts (modes/_shared.md)

The negotiation section provides frameworks for salary discussions. Replace the example scripts with your own:
- Target ranges
- Geographic arbitrage strategy
- Pushback responses

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

The canonical states rarely need changing. If you add new states, update:
1. `templates/states.yml`
2. `normalize-statuses.mjs` (alias mappings)
3. `modes/_shared.md` (any references)
