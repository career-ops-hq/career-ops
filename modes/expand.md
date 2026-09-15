# Mode: expand — Discover CV competencies without promoting guesses

Read only URLs already linked in `config/profile.yml`. Public pages, repos, and
portfolio material are external discovery evidence, not direct CV sources.

Create the sourced proposal schema in `modes/add.md` for each candidate, with
`source: "external-discovery"`, its URL as `sourceRef`, and verbatim evidence.
Do not mark an external claim verified unless it has a primary provenance
reference. Numbers, scope, and authorship without that reference remain out of
the proposal.

Deduplicate and preview every candidate through the shared command; show its
output and stop for explicit approval before applying:

```bash
node cv-maintenance.mjs preview proposal.json
node cv-maintenance.mjs apply proposal.json --confirm approved
```

The command is the only CV write path. Reactive Resume stays a one-way,
downstream consumer of `cv.md`.
