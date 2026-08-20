# Plugins Trust & Security Model

## Overview

The `career-ops` plugin system extends pipeline capabilities (e.g. integrations with Gmail, Notion, Apify). Plugins run directly within the Node.js process context as ES modules (`.mjs`).

---

## Security Invariants & Containment Limits

1. **Process Isolation Notice**
   - Plain ESM imports cannot execute in an isolated VM sandbox without build-step overhead.
   - Any loaded plugin has full read/write access to `process.env` and the local file system available to the host process.

2. **`RESERVED_ENV` Guard**
   - The plugin engine enforces a static restriction (`RESERVED_ENV`) preventing plugins from declaring core keys in their manifests (e.g. `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `PATH`).
   - *Note:* This is a convenience boundary for declaration safety, not a sandbox.

3. **Forbidden Hook Kinds**
   - Action hooks that auto-submit applications (`apply/submit`) are strictly forbidden by core engine design.
   - Permitted hooks: `provider`, `ingest`, `search`, `notify`, `export`.

---

## Guidelines for Community Plugins

- **Source Code Audit**: Always inspect plugin source code in `plugins-registry/` before installing or enabling a plugin.
- **Environment Isolation**: Never store master production credentials in environment variables if running unverified third-party code.
- **Fail-Open Guarantees**: Core pipeline execution skips failing/malformed plugins gracefully without crashing.
