// Node ESM resolver hook that teaches `node --test` (no ts-node/tsx in this repo)
// to follow the "@/…" import alias web/src TS files use (mirrors web/tsconfig.json's
// `paths: { "@/*": ["./src/*"] }`, which only webpack/SWC understand natively).
// Node 22 already type-strips .ts on import — this hook is ONLY about specifier
// resolution, not transpilation.
//
// Usage: node --import ./test/helpers/web-ts-alias-loader.mjs --test test/some.test.mjs
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

// register() re-imports THIS file in a separate loader realm to install the
// resolve() hook below — guard so the --import preload only registers once.
if (!globalThis.__careerOpsWebAliasRegistered) {
  globalThis.__careerOpsWebAliasRegistered = true;
  register(import.meta.url, pathToFileURL(`${process.cwd()}/`));
}

const WEB_SRC = path.join(process.cwd(), "web", "src");
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
