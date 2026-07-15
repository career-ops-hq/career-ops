<!--
Use this template for a PR that adds or updates ONE plugins-registry/<id>.json file.
Select it by appending ?template=plugin-registry.md to the PR-compare URL, or
the plugin template's release workflow opens it for you on a release tag.
ONE plugin per PR. Change ONLY that plugin's entry.
-->

## Plugin registry change

Home issue: #____

Paste the registry entry (one object), pinned to the exact reviewed commit:

```json
{
  "name": "career-ops-plugin-<name>",
  "id": "<name>",
  "repo": "https://github.com/<you>/career-ops-plugin-<name>",
  "author": "<you>",
  "hooks": ["provider"],
  "description": "Mission-framed one-liner.",
  "requiredEnv": [],
  "allowedHosts": ["api.example.com"],
  "skill": true,
  "license": "MIT",
  "version": "1.0.0",
  "sha": "<40-hex-commit>"
}
```

### Maintainer review checklist

- [ ] Naming `career-ops-plugin-<name>`; `id` == name minus the prefix
- [ ] Minimum files present (manifest.json, index.mjs, README.md, LICENSE)
- [ ] Manifest valid: apiVersion 1, `humanInTheLoop: true`, hooks ⊆ {provider, ingest, search, notify, export} — **no apply/submit**
- [ ] MIT-compatible LICENSE; no personal data in the repo
- [ ] Egress: `allowedHosts` are real public hosts; no IP literals / metadata / `*.internal`; no localhost without `allowsLocalhost` + a reason
- [ ] Static audit clean: no `child_process`/`playwright`/raw sockets/global `fetch`/`eval`/bare-dependency imports (egress only via `ctx.fetch`)
- [ ] No core-owned secrets in `requiredEnv`
- [ ] Reads PUBLIC data or the user's OWN account only — no centralized infrastructure, no auto-submit, no blind-apply
- [ ] No commercial / hosted-service / monetization wording (the project is free and local-first)
- [ ] If it ships a skill: domain-scoped — does not instruct the agent to edit core files, change scoring, reveal secrets, or act outside its hooks
- [ ] `sha` is pinned to the exact reviewed commit
- [ ] CI (`plugin-registry-validate`) is green
