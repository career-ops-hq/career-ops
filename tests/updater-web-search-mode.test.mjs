import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractArrayFromSource } from "../update-system.mjs";
import { pass, fail, ROOT } from "./helpers.mjs";

console.log("\nupdate-system.mjs — web-search mode delivery");

const paths = extractArrayFromSource(readFileSync(join(ROOT, "update-system.mjs"), "utf8"), "SYSTEM_PATHS");
if (paths.includes("modes/web-search.md")) pass("SYSTEM_PATHS ships the canonical web-search mode");
else fail("SYSTEM_PATHS omits modes/web-search.md, so updates prune or fail to install AI offer search");
