import fs from "node:fs";
import path from "node:path";

const LINE = /^\s*(?:export\s+)?CAREER_OPS_CLI\s*=\s*(.*?)\s*$/;

/** A .env value as dotenv reads it: the text inside matching quotes, else the text before a `#` comment. */
function unquote(raw) {
  const quoted = /^(['"`])(.*?)\1/.exec(raw);
  return quoted ? quoted[2] : raw.replace(/#.*$/, "").trim();
}

/**
 * The agent CLI the user chose: CAREER_OPS_CLI from the shell, else from the
 * data root's .env (written by `node remember-cli.mjs`). Null when unset.
 *
 * @param {string} root
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | null}
 */
export function readRememberedCli(root, env = process.env) {
  if (env.CAREER_OPS_CLI) return env.CAREER_OPS_CLI;
  let text;
  try {
    text = fs.readFileSync(path.join(root, ".env"), "utf8");
  } catch {
    return null;
  }
  let value = null;
  for (const line of text.split("\n")) {
    const m = LINE.exec(line);
    if (m) value = unquote(m[1]) || null;
  }
  return value;
}
