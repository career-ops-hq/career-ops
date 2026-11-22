/**
 * handoff-hosts.mjs — application sites the user signs in to themselves.
 *
 * Some application forms sit behind the candidate's own login, often a social
 * or Google sign-in: every *.gupy.io tenant, LinkedIn Easy Apply, Workable's
 * apply pages. The in-app Apply browser deliberately never carries the user's
 * session (apply-scope.mjs refuses a user-data-dir, CDP attach and cookie
 * transfer), so on those hosts it always ends at a login wall after a wasted
 * browser launch, and Google refuses sign-in from an automated browser anyway.
 *
 * The user lists such hosts in config/profile.yml:
 *
 *   apply:
 *     handoff_hosts: ["gupy.io", "linkedin.com", "apply.workable.com"]
 *
 * and Apply treats them like the ATSs it cannot fill (unsupported-ats.mjs): no
 * browser is opened, and the existing refusal panel offers the posting link
 * (opened in the user's own browser, where they are signed in) and the CV path
 * and answers. A host matches itself and any subdomain. No list → no change.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as yaml from "js-yaml";
import { resolveCodeRoot } from "../core/code-root.mjs";
import { resolveDataRoot } from "../core/data-root.mjs";
import { getProfilePath } from "../core/profile-path.mjs";

const MAX_HOSTS = 200;

/**
 * True when `text` holds anything besides blank lines and comments. The same
 * rule as hasYamlContent() in lib/yaml-document.mjs.
 *
 * @param {string | null | undefined} text
 * @returns {boolean}
 */
function hasYamlContent(text) {
  return String(text ?? "").split("\n").some((line) => {
    const t = line.trim();
    return t !== "" && !t.startsWith("#");
  });
}

/**
 * @param {string | null} profileText Raw config/profile.yml.
 * @returns {string[]} Lower-cased hosts, without a scheme, a path, or a leading or trailing dot.
 * @throws {Error} When the profile is not valid YAML: a typo must not silently switch every handoff rule off.
 */
export function handoffHostsFrom(profileText) {
  // Empty or comment-only text is an empty document: no hosts. js-yaml 5
  // throws on it, so it is caught here, the way loadYaml() in
  // lib/yaml-document.mjs does for the core scripts.
  if (!hasYamlContent(profileText)) return [];
  const doc = yaml.load(String(profileText));
  const apply = doc && typeof doc === "object" ? /** @type {Record<string, unknown>} */ (doc).apply : null;
  const list = apply && typeof apply === "object" ? /** @type {Record<string, unknown>} */ (apply).handoff_hosts : null;
  if (!Array.isArray(list)) return [];
  const hosts = [];
  for (const entry of list.slice(0, MAX_HOSTS)) {
    if (typeof entry !== "string") continue;
    const host = entry
      .trim()
      .toLowerCase()
      .replace(/^[a-z]+:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/^\.+|\.+$/g, "");
    if (host && /^[a-z0-9.-]+$/.test(host) && host.includes(".")) hosts.push(host);
  }
  return hosts;
}

/**
 * @param {unknown} url
 * @param {string[]} hosts
 * @returns {string | null} The configured host the URL falls under, or null.
 */
export function matchHandoffHost(url, hosts) {
  if (!hosts.length) return null;
  let host;
  try {
    host = new URL(String(url).trim()).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
  return hosts.find((h) => host === h || host.endsWith(`.${h}`)) ?? null;
}

/**
 * The hosts from the user's profile. A missing profile states no hosts; a
 * broken or unreadable one throws with the file path, the way
 * readApplyProfile() (blank-unknown.mjs) does, so a typo cannot quietly turn
 * every handoff rule off and send Apply back into a login wall.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function readHandoffHosts(env = process.env) {
  const root = resolveDataRoot(
    resolveCodeRoot(process.cwd(), env),
    (p) => {
      try {
        return fs.readFileSync(p, "utf8");
      } catch {
        return null;
      }
    },
    env,
    path.resolve,
    path.join,
    { homedir: os.homedir, realpath: fs.realpathSync, platform: process.platform },
  );
  const file = getProfilePath(root, { env });
  try {
    return handoffHostsFrom(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err)?.code === "ENOENT") return [];
    const message = err instanceof Error ? err.message : "could not read the profile";
    throw new Error(`${file}: ${message}`);
  }
}
