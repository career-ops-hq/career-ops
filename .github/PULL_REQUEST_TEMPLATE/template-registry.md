<!--
Use this template for a PR that adds or updates ONE templates-registry/<id>.json file.
Select it by appending ?template=template-registry.md to the PR-compare URL.
ONE pack per PR. Change ONLY that pack's entry.
-->

## Template registry change

Home issue: #____

Paste the registry entry (one object), pinned to the exact reviewed commit:

```json
{
  "name": "career-ops-template-<name>",
  "id": "<name>",
  "repo": "https://github.com/<you>/career-ops-template-<name>",
  "kind": ["cv", "cover"],
  "themes": 1,
  "ats": true,
  "license": "MIT",
  "version": "1.0.0",
  "sha": "<40-hex-commit>"
}
```

### Maintainer review checklist

- [ ] Naming `career-ops-template-<name>`; `id` == name minus the prefix
- [ ] `pack.json` present and valid; `kind`, `themes` and `ats` match what the pack declares
- [ ] MIT-compatible LICENSE; attribution kept for any ported design; no personal data in the repo
- [ ] Every template is placeholder-complete for its kind
- [ ] A pack that claims `ats: true` passes `atsLint`; a design-forward layout carries an `atsRisk` note
- [ ] No `<script>`, `<iframe>`, `<object>`, `<embed>`, `on*` handlers, `javascript:` URLs or remote subresources (`node cv-templates.mjs lint cv <name> --render` is clean)
- [ ] Every `src`, `href` and `url()` resolves inside the pack; fonts and images are shipped or inlined
- [ ] No commercial / hosted-service / monetization wording (the project is free and local-first)
- [ ] `sha` is pinned to the exact reviewed commit
- [ ] CI (`template-registry-validate`) is green
