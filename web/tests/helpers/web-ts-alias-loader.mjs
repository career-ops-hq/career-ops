// Node ESM resolver hook that teaches `node --test` (no ts-node/tsx in this repo)
// to follow the "@/…" import alias web/src TS files use (mirrors web/tsconfig.json's
// `paths: { "@/*": ["./src/*"] }`, which only webpack/SWC understand natively).
// Node 22 already type-strips .ts on import — this hook is ONLY about specifier
// resolution, not transpilation.
//
// Usage: import this module for side effect, THEN reach the aliased module with a
// dynamic import, so the hook is installed before that specifier is resolved:
//
//   import "../helpers/web-ts-alias-loader.mjs";
//   const { thing } = await import("../../src/lib/thing.ts");
//
// A static `import … from "…/thing.ts"` would NOT work: ESM resolves every static
// specifier in a module before any of its bodies run, so the hook would still be
// uninstalled at the moment it is needed.
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

// register() re-imports THIS file in a separate loader realm to install the
// resolve() hook below — guard so repeated imports only register once.
if (!globalThis.__careerOpsWebAliasRegistered) {
  globalThis.__careerOpsWebAliasRegistered = true;
  register(import.meta.url, import.meta.url);
}

// Anchored to this file, not process.cwd(): `npm test` runs from web/ while a
// root-level `node --test web/tests/…` runs from the repo root, and the alias
// must resolve to the same web/src either way.
const WEB_SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const HAS_EXT = /\.(m?[jt]sx?|json)$/i;

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
  const base = path.join(WEB_SRC, specifier.slice(2));
  // Specifiers that already name an extension (e.g. "@/lib/tracker-table.mjs")
  // resolve as-is; extensionless ones (the TS convention) try .ts then .tsx.
  const candidates = HAS_EXT.test(specifier) ? [base] : [`${base}.ts`, `${base}.tsx`];
  const hit = candidates.find((c) => existsSync(c)) ?? candidates[0];
  return nextResolve(pathToFileURL(hit).href, context);
}
