# career-ops-plugin-{{NAME}}

A community plugin for [career-ops](https://github.com/santifer/career-ops).

## What it does

TODO: one paragraph.

## Install

```bash
# Once it's in the career-ops registry:
node plugins.mjs add {{NAME}}

# Before listing (install directly from your repo at a pinned commit):
node plugins.mjs add <your-github-user>/career-ops-plugin-{{NAME}} --sha <40-hex-commit>
```

Then enable + consent:

```bash
node plugins.mjs enable {{NAME}}            # shows the capability card
node plugins.mjs enable {{NAME}} --confirm  # grants it
```

## Configure

- Secrets go in your `.env` (the names are in `manifest.json` → `requiredEnv`).
- Non-secret options go in `config/plugins.yml` under `plugins.{{NAME}}`.

## Get it listed as approved

Open a registry PR against career-ops (see
[docs/PLUGINS.md](https://github.com/santifer/career-ops/blob/main/docs/PLUGINS.md)).

## License

MIT
