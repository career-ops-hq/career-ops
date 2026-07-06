// @ts-check
/**
 * plugins/_engine.mjs — the career-ops plugin engine.
 *
 * Generalizes the proven providers/ auto-loader (scan.mjs `loadProviders`) into
 * a sibling `plugins/` layer for integrations that need a KEY or talk to an
 * EXTERNAL service. The zero-key providers/ dir is untouched and stays pure.
 *
 * Design invariants (every one is asserted by test-all.mjs section 49):
 *  - ZERO module-level side effects. Importing this file reads no config, loads
 *    no dotenv, and mutates no process.env. scan.mjs imports `mergeProviderPlugins`
 *    on every run, and that import must be free — so a plain `node scan.mjs` with
 *    no config/plugins.yml behaves byte-identically to before this feature.
 *  - Fail-open everywhere. A malformed manifest, a throwing import, a missing
 *    key, or a hung hook logs a `⚠️` and is SKIPPED — never crashes the core.
 *  - Opt-in. Nothing loads unless config/plugins.yml enables it AND every
 *    declared requiredEnv var is present.
 *  - Least-privilege ctx is a CONVENIENCE, not a sandbox. Plain ESM can't
 *    VM-isolate a module's imports without a build step (forbidden). Containment
 *    is code review (bundled plugins, same gate as providers/) + user trust
 *    (plugins.local/). See plugins/README.md "Trust model".
 *
 * Pure + side-effect-free so scan.mjs, plugins.mjs, doctor.mjs and test-all.mjs
 * all reuse it with no prod-vs-test drift.
 */

import { existsSync, readdirSync, readFileSync, realpathSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { resolveAndValidate } from './_net.mjs';
import { readLock, writeLockEntry, diffPlugin, hashPluginTree, consentSurface } from './_lock.mjs';
import { loadRegistry } from './_registry.mjs';

/** The complete, closed set of hook kinds. Anything else (apply/submit/…) is rejected. */
export const HOOK_KINDS = ['provider', 'ingest', 'search', 'notify', 'export'];

/**
 * Env var names a plugin may NOT declare in requiredEnv/optionalEnv: core-owned
 * secrets (so a plugin can't smuggle out GEMINI/OPENAI/… keys and have doctor
 * render it as a legitimate ✓), plus process-shaping vars. AWS_* is matched by
 * prefix below. This is a manifest-review backstop, not a runtime isolation
 * boundary (process.env stays globally reachable — see the trust note).
 */
export const RESERVED_ENV = new Set([
  'GEMINI_API_KEY', 'GEMINI_MODEL',
  'OPENROUTER_API_KEY', 'CAREER_OPS_MODEL',
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL',
  'ANTHROPIC_API_KEY',
  'CAREER_OPS_PORTALS', 'CAREER_OPS_PROFILE',
  'PATH', 'HOME', 'NODE_OPTIONS', 'LD_PRELOAD', 'NODE_EXTRA_CA_CERTS',
]);

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const DEFAULT_HOOK_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

function isReservedEnv(name) {
  return RESERVED_ENV.has(name) || /^AWS_/.test(name);
}

function warnSkip(label, reason) {
  console.warn(`⚠️  ${label}: skipping — ${reason}`);
}

function isWithinDirectory(rootAbs, candidateAbs) {
  const rel = path.relative(rootAbs, candidateAbs);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

function nearestExistingPath(absPath) {
  let current = path.resolve(absPath);
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

function isSafePluginPath(rootAbs, candidateAbs) {
  const rootResolved = path.resolve(rootAbs);
  const candidateResolved = path.resolve(candidateAbs);
  if (!isWithinDirectory(rootResolved, candidateResolved)) return false;

  const nearestExisting = nearestExistingPath(candidateResolved);
  if (!nearestExisting) return false;
  try {
    return isWithinDirectory(realpathSync(rootResolved), realpathSync(nearestExisting));
  } catch {
    return false;
  }
}

/**
 * Resolve the config/plugins.yml path for a given project root.
 * @param {string} root
 */
function pluginsConfigPath(root) {
  return path.join(root, 'config', 'plugins.yml');
}

/**
 * Read config/plugins.yml. Fail-open to {} if absent or malformed — exactly the
 * graceful posture scan.mjs uses for its own config. js-yaml is imported lazily
 * so this module stays side-effect-free at import time.
 * @param {string} root
 * @returns {Promise<object>}
 */
export async function loadPluginConfig(root) {
  const file = pluginsConfigPath(root);
  if (!existsSync(file)) return {};
  try {
    const yaml = (await import('js-yaml')).default;
    const parsed = yaml.load(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    warnSkip('config/plugins.yml', `unreadable, ignoring — ${err.message}`);
    return {};
  }
}

/**
 * Validate a parsed manifest object. Returns a normalized manifest on success,
 * or null (with a ⚠️) on any violation. NEVER throws — identical fail-open to
 * scan.mjs loadProviders.
 *
 * @param {any} m   Parsed manifest.json.
 * @param {string} dir   Absolute plugin directory.
 * @param {string} dirName   Basename of dir (must equal m.id).
 * @returns {(PluginManifestNormalized|null)}
 * @typedef {object} PluginManifestNormalized
 * @property {string} id
 * @property {number} apiVersion
 * @property {string} description
 * @property {string[]} hooks
 * @property {string[]} requiredEnv
 * @property {string[]} optionalEnv
 * @property {string[]} allowedHosts
 * @property {string} entry
 * @property {boolean} humanInTheLoop
 * @property {string} [name]
 * @property {string} [version]
 * @property {string} [homepage]
 * @property {string} dir
 */
export function validateManifest(m, dir, dirName) {
  const label = dirName;
  if (!m || typeof m !== 'object') { warnSkip(label, 'manifest.json is not an object'); return null; }

  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) { warnSkip(label, `invalid id ${JSON.stringify(m.id)} (need ^[a-z0-9][a-z0-9-]*$)`); return null; }
  if (m.id !== dirName) { warnSkip(label, `id "${m.id}" must equal directory name "${dirName}"`); return null; }
  if (m.apiVersion !== 1) { warnSkip(label, `unsupported apiVersion ${JSON.stringify(m.apiVersion)} (engine supports 1)`); return null; }
  if (typeof m.description !== 'string' || !m.description.trim() || /[\r\n]/.test(m.description)) { warnSkip(label, 'description must be a non-empty single line'); return null; }
  if (m.humanInTheLoop !== true) { warnSkip(label, 'humanInTheLoop must be true (no auto-submit plugins)'); return null; }

  if (!Array.isArray(m.hooks) || m.hooks.length === 0) { warnSkip(label, 'hooks must be a non-empty array'); return null; }
  for (const h of m.hooks) {
    if (!HOOK_KINDS.includes(h)) { warnSkip(label, `unknown hook "${h}" (allowed: ${HOOK_KINDS.join(', ')})`); return null; }
  }

  const requiredEnv = m.requiredEnv === undefined ? [] : m.requiredEnv;
  const optionalEnv = m.optionalEnv === undefined ? [] : m.optionalEnv;
  if (!Array.isArray(requiredEnv) || requiredEnv.some(x => typeof x !== 'string')) { warnSkip(label, 'requiredEnv must be an array of strings'); return null; }
  if (!Array.isArray(optionalEnv) || optionalEnv.some(x => typeof x !== 'string')) { warnSkip(label, 'optionalEnv must be an array of strings'); return null; }
  for (const name of [...requiredEnv, ...optionalEnv]) {
    if (isReservedEnv(name)) { warnSkip(label, `requiredEnv/optionalEnv may not declare reserved var "${name}" (core-owned or process-shaping)`); return null; }
  }

  const allowedHosts = m.allowedHosts === undefined ? [] : m.allowedHosts;
  if (!Array.isArray(allowedHosts) || allowedHosts.some(x => typeof x !== 'string')) { warnSkip(label, 'allowedHosts must be an array of strings'); return null; }
  // A keyed plugin (reads a secret) MUST declare an egress allowlist.
  if (requiredEnv.length > 0 && allowedHosts.length === 0) { warnSkip(label, 'a plugin with requiredEnv must declare a non-empty allowedHosts egress allowlist'); return null; }

  const allowsLocalhost = m.allowsLocalhost === true;
  if (allowsLocalhost && allowedHosts.length === 0) { warnSkip(label, 'allowsLocalhost requires a non-empty allowedHosts'); return null; }
  // Reject SSRF-shaped hosts in the allowlist (IP literals, cloud-metadata,
  // *.internal, loopback) unless the plugin explicitly opted into localhost.
  for (const h of allowedHosts) {
    const isLoopback = /^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\])$/i.test(h);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) && !(allowsLocalhost && isLoopback)) { warnSkip(label, `allowedHosts must be hostnames, not IP literals: ${h}`); return null; }
    if (/(^169\.254\.)|(^metadata\.google\.internal$)|(\.internal$)/i.test(h)) { warnSkip(label, `allowedHosts may not target metadata/internal hosts: ${h}`); return null; }
    if (isLoopback && !allowsLocalhost) { warnSkip(label, `allowedHosts contains a loopback host without allowsLocalhost: ${h}`); return null; }
  }

  const entry = typeof m.entry === 'string' && m.entry.trim() ? m.entry : 'index.mjs';
  if (!entry.endsWith('.mjs')) { warnSkip(label, `entry "${entry}" must be a .mjs file`); return null; }
  const entryAbs = path.resolve(dir, entry);
  if (!isSafePluginPath(dir, entryAbs)) { warnSkip(label, `entry "${entry}" escapes the plugin directory`); return null; }

  // Optional companion skill (Open-Agent-Skill-Standard SKILL.md). Traversal-
  // guarded like entry. Surfaced on-demand via `plugins.mjs skill <id>`; never
  // auto-injected into AGENTS.md/modes (the data-vs-brain firewall).
  let skill = null;
  if (m.skill !== undefined) {
    if (typeof m.skill !== 'string' || !m.skill.endsWith('.md')) { warnSkip(label, 'skill must be a relative .md path'); return null; }
    const skillAbs = path.resolve(dir, m.skill);
    if (!isSafePluginPath(dir, skillAbs)) { warnSkip(label, `skill "${m.skill}" escapes the plugin directory`); return null; }
    if (!existsSync(skillAbs)) { warnSkip(label, `skill file not found: ${m.skill}`); return null; }
    skill = m.skill;
  }

  return {
    id: m.id,
    apiVersion: 1,
    description: m.description.trim(),
    hooks: [...m.hooks],
    requiredEnv,
    optionalEnv,
    allowedHosts,
    allowsLocalhost,
    entry,
    skill,
    humanInTheLoop: true,
    name: typeof m.name === 'string' ? m.name : undefined,
    version: typeof m.version === 'string' ? m.version : undefined,
    homepage: typeof m.homepage === 'string' ? m.homepage : undefined,
    dir,
  };
}

/**
 * Discover plugin directories across roots. Roots are scanned in order; the
 * FIRST occurrence of an id wins (so bundled plugins/ shadow a same-id
 * plugins.local/). existsSync-guarded (never mkdir — a fresh, plugin-free
 * install stays filesystem-inert). Alphabetical within a root for determinism.
 *
 * `overrideIds` is the ONE controlled exception to first-root-wins: an id in
 * this set lets a LATER root (plugins.local/) override an earlier one
 * (bundled plugins/). It is computed ONLY by resolveSuccessorIds() — i.e. a
 * community plugin the maintainer registered as the bundled plugin's
 * `supersedesBundled` successor AND that the user installed at its exact
 * pinned sha. A plain, unverified plugins.local/<id> is never in the set, so
 * it can NEVER shadow a reviewed bundled plugin (the no-downgrade invariant).
 * Default empty → identical to the original bundled-always-wins behavior.
 *
 * @param {string[]} roots          Absolute directories to scan (e.g. [plugins/, plugins.local/]).
 * @param {Set<string>} [overrideIds]  ids whose later-root copy may override an earlier-root one.
 * @returns {PluginManifestNormalized[]}
 */
export function discoverPlugins(roots, overrideIds = new Set()) {
  const found = new Map();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let entries;
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch (err) {
      warnSkip(root, `unreadable — ${err.message}`);
      continue;
    }
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort();
    for (const name of dirs) {
      const dir = path.join(root, name);
      const manifestFile = path.join(dir, 'manifest.json');
      if (!existsSync(manifestFile)) continue; // not a plugin dir (no manifest)
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(manifestFile, 'utf8'));
      } catch (err) {
        warnSkip(name, `manifest.json is invalid JSON — ${err.message}`);
        continue;
      }
      const manifest = validateManifest(parsed, dir, name);
      if (!manifest) continue;
      if (found.has(manifest.id)) {
        // earlier root wins (bundled > local) — EXCEPT an approved successor.
        if (overrideIds.has(manifest.id)) found.set(manifest.id, manifest);
        continue;
      }
      found.set(manifest.id, manifest);
    }
  }
  return [...found.values()];
}

/**
 * Compute the set of bundled ids that an APPROVED community successor should
 * override. A successor qualifies only when ALL hold:
 *   (a) a registry entry declares `supersedesBundled: true` for that id
 *       (registry = SYSTEM file → a maintainer reviewed + merged it), AND
 *   (b) plugins.local/<id> is actually installed, AND
 *   (c) the installed sha === the registry's pinned sha (the user has the
 *       exact reviewed commit — the same bar classifySource() calls 'approved').
 * Anything short of (c) — off-registry drift, unverified, not installed —
 * leaves the bundled reference in charge. This is the trust hinge of the whole
 * seed/successor model: only a reviewed, pinned, installed successor wins.
 * @param {string} root
 * @returns {Set<string>}
 */
export function resolveSuccessorIds(root) {
  const ids = new Set();
  try {
    const reg = loadRegistry(root);
    const lock = readLock(root);
    for (const e of reg.plugins) {
      if (e.supersedesBundled !== true || typeof e.id !== 'string') continue;
      const localManifest = path.join(root, 'plugins.local', e.id, 'manifest.json');
      const installedSha = lock?.plugins?.[e.id]?.sha;
      if (existsSync(localManifest) && installedSha && installedSha === e.sha) ids.add(e.id);
    }
  } catch {
    // Any registry/lock read problem → no overrides (bundled references stay in charge).
  }
  return ids;
}

/**
 * The standard pair of roots for a project: bundled plugins/ then user
 * plugins.local/ (the latter only matters when it exists).
 * @param {string} root
 */
export function pluginRoots(root) {
  return [path.join(root, 'plugins'), path.join(root, 'plugins.local')];
}

/**
 * Is a plugin enabled? Requires config/plugins.yml { plugins: { <id>: { enabled: true } } }
 * AND every requiredEnv var present in process.env.
 * @param {PluginManifestNormalized} manifest
 * @param {object} cfg   Parsed config/plugins.yml.
 * @returns {{ enabled: boolean, configured: boolean, missingEnv: string[] }}
 */
export function pluginStatus(manifest, cfg) {
  const entry = cfg?.plugins?.[manifest.id];
  const configured = entry?.enabled === true;
  const missingEnv = manifest.requiredEnv.filter(name => !process.env[name]);
  return { enabled: configured && missingEnv.length === 0, configured, missingEnv };
}

/**
 * Per-plugin non-secret settings block from config/plugins.yml (e.g.
 * { actor: "...", database_id: "..." }). Secrets never live here.
 * @param {string} id
 * @param {object} cfg
 */
export function pluginSettings(id, cfg) {
  const entry = cfg?.plugins?.[id];
  if (!entry || typeof entry !== 'object') return {};
  const { enabled, ...rest } = entry;
  return rest;
}

/**
 * Build a guarded fetch that enforces HTTPS, an optional host allowlist, and
 * manual redirect handling that re-validates EVERY hop's host and strips
 * credential headers when a hop changes hostname. Returns a Response.
 *
 * Posture note: core providers use redirect:'error' (reject ANY redirect). This
 * is the deliberately looser plugin posture — allowlist-pinned FOLLOW — because
 * keyed APIs (Notion/Google/Apify) legitimately 30x within their own host set;
 * the allowlist + per-hop re-validation + cross-host credential strip bound it.
 *
 * ADVISORY only: this binds a plugin that routes through ctx.fetch*, not one
 * that calls global fetch directly (see the trust note in README.md).
 *
 * @param {string[]} allowedHosts
 */
function makeGuardedFetch(allowedHosts, { allowsLocalhost = false } = {}) {
  const allow = new Set(allowedHosts);
  const isLoopbackHost = (h) => /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/i.test(h);
  const hostOk = (u) => {
    if (u.protocol !== 'https:') {
      // Plain HTTP is allowed ONLY for an opted-in loopback host (local-AI
      // providers like Ollama/LM Studio serve http://localhost:11434).
      if (!(allowsLocalhost && u.protocol === 'http:' && isLoopbackHost(u.hostname))) {
        throw new Error(`plugin egress must use HTTPS: ${u.href}`);
      }
    }
    if (allow.size > 0 && !allow.has(u.hostname)) throw new Error(`plugin egress to "${u.hostname}" is not in allowedHosts [${[...allow].join(', ')}]`);
  };
  return async function guardedFetch(url, opts = {}) {
    const { timeoutMs = 10_000, headers = {}, method = 'GET', body = null } = opts;
    let current = new URL(url);
    hostOk(current);
    // SSRF: reject a host that resolves to a private/loopback/metadata address
    // (re-checked on every redirect hop). Loopback allowed only when opted in.
    await resolveAndValidate(current.hostname, { allowsLocalhost });
    let reqHeaders = { ...headers };
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      try {
        res = await fetch(current.href, {
          method, headers: reqHeaders, body, redirect: 'manual', signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        const next = new URL(res.headers.get('location'), current);
        hostOk(next); // re-validate the redirect target before following it
        await resolveAndValidate(next.hostname, { allowsLocalhost });
        if (next.hostname !== current.hostname) {
          // Don't forward credentials across a hostname change (what the
          // platform fetch does for cross-origin redirects; we do it manually).
          reqHeaders = Object.fromEntries(Object.entries(reqHeaders).filter(([k]) => !/^(authorization|cookie)$/i.test(k)));
        }
        current = next;
        continue;
      }
      if (!res.ok) {
        const snippet = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 300);
        const err = new Error(snippet ? `HTTP ${res.status}: ${snippet}` : `HTTP ${res.status}`);
        // @ts-ignore
        err.status = res.status;
        throw err;
      }
      return res;
    }
    throw new Error(`too many redirects (>${MAX_REDIRECTS}) for ${url}`);
  };
}

/**
 * Build the least-privilege ctx for a plugin. The scoped frozen env is a
 * CONVENIENCE (process.env is still globally reachable from any module) — the
 * real boundary is code review + trust.
 * @param {PluginManifestNormalized} manifest
 * @param {{ dryRun?: boolean, settings?: object }} [opts]
 * @returns {PluginContext}
 */
export function buildCtx(manifest, opts = {}) {
  const scoped = {};
  for (const name of [...manifest.requiredEnv, ...manifest.optionalEnv]) {
    if (process.env[name] !== undefined) scoped[name] = process.env[name];
  }
  const env = Object.freeze({ ...scoped });
  // Secret values long enough to be worth redacting (avoid no-op/over-redaction
  // on empty or trivially short strings).
  const secrets = manifest.requiredEnv
    .map(n => process.env[n])
    .filter(v => typeof v === 'string' && v.length >= 6);
  const guarded = makeGuardedFetch(manifest.allowedHosts, { allowsLocalhost: manifest.allowsLocalhost === true });
  const log = (...args) => {
    const redact = (s) => {
      let out = typeof s === 'string' ? s : String(s);
      for (const sec of secrets) out = out.split(sec).join('«redacted»');
      return out;
    };
    console.log(...args.map(redact));
  };
  return /** @type {PluginContext} */ ({
    transport: 'http',
    // The guarded primitive (HTTPS + allowedHosts + redirect re-validation).
    // Bundled plugins should route their HTTP through this so the egress guard
    // actually runs; fetchText/fetchJson are conveniences over it.
    fetch: guarded,
    fetchText: async (u, o) => (await guarded(u, o)).text(),
    fetchJson: async (u, o) => (await guarded(u, o)).json(),
    env,
    settings: Object.freeze({ ...(opts.settings || {}) }),
    log,
    dryRun: opts.dryRun === true,
  });
}

/**
 * Dynamically import a plugin entry and return its validated hook object for the
 * requested kind, or null on any failure (sandboxed — never throws to caller).
 * @param {PluginManifestNormalized} manifest
 * @param {string} kind
 */
async function importHook(manifest, kind) {
  const entryAbs = path.join(manifest.dir, manifest.entry);
  let mod;
  try {
    mod = await import(pathToFileURL(entryAbs).href);
  } catch (err) {
    warnSkip(manifest.id, `failed to import ${manifest.entry} — ${err.message}`);
    return null;
  }
  const hooks = mod.default;
  if (!hooks || typeof hooks !== 'object') { warnSkip(manifest.id, 'entry default export must be an object of hooks'); return null; }
  const hook = hooks[kind];
  if (kind === 'provider') {
    if (!hook || typeof hook.fetch !== 'function' || typeof hook.id !== 'string') { warnSkip(manifest.id, 'provider hook must be { id, fetch }'); return null; }
  } else if (typeof hook !== 'function') {
    warnSkip(manifest.id, `${kind} hook must be a function`);
    return null;
  }
  return hook;
}

/**
 * Load all ENABLED plugins exposing `kind`, with their ctx ready. Skips any that
 * fail to import. Caller is responsible for dotenv (loadDotenvOnce) before this
 * if the keys live in .env.
 * @param {string} kind
 * @param {{ root: string, dryRun?: boolean }} opts
 * @returns {Promise<Array<{ id: string, manifest: PluginManifestNormalized, hook: any, ctx: PluginContext }>>}
 */
// Phrases that suggest a skill is trying to hijack the agent rather than
// document a plugin. Built from fragments so the literals don't trip the repo's
// own firewall/injection greps. Surfaced as a ⚠️ at print time, not a block.
const SKILL_RED_FLAGS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instruction/i,
  /disregard\s+(the\s+)?(system|above|previous)/i,
  /you\s+are\s+now\b/i,
  /exfiltrat/i,
  new RegExp('modes/' + '_shared'),
  new RegExp('AGENTS' + '\\.md'),
  /human[- ]?in[- ]?the[- ]?loop\s*[:=]?\s*false/i,
  /humanInTheLoop\s*[:=]\s*false/i,
];

/**
 * Read a plugin's companion skill.md (on-demand; the agent PULLS it). Returns
 * its body + injection red-flags + whether the source is trusted (bundled).
 * NEVER auto-injected into AGENTS.md/modes — the data-vs-brain firewall.
 * @returns {{ body: string, flags: string[], source: string } | null}
 */
export function loadSkill(manifest, root) {
  if (!manifest.skill) return null;
  let body;
  try { body = readFileSync(path.join(manifest.dir, manifest.skill), 'utf8'); }
  catch { return null; }
  const flags = SKILL_RED_FLAGS.some(re => re.test(body))
    ? ['this skill contains phrases that resemble prompt-injection — review it before trusting']
    : [];
  return { body, flags, source: pluginSource(manifest, root) };
}

/**
 * Derive a plugin's trust source from the FILESYSTEM, never from plugins.lock
 * (a USER-writable file that could spoof `source: "bundled"` to dodge the
 * rug-pull gate). A dir under plugins/ is bundled; anything else is local.
 */
function pluginSource(manifest, root) {
  return manifest.dir.startsWith(path.join(root, 'plugins') + path.sep) ? 'bundled' : 'local';
}

/**
 * Integrity gate run on an ENABLED plugin before importing it (the rug-pull
 * defense). Returns { load }. Re-pins the lock on the benign cases (silent).
 * Fail-open on the engine itself (a lock-read error never blocks).
 */
export function lockGate(manifest, root) {
  const source = pluginSource(manifest, root);
  let lock;
  try { lock = readLock(root); } catch { return { load: true }; }
  const entry = lock.plugins?.[manifest.id];
  let d;
  try { d = diffPlugin(manifest, entry); }
  catch (err) { warnSkip(manifest.id, `integrity check failed — ${err.message}`); return { load: false }; }

  const repin = () => {
    try {
      const tree = hashPluginTree(manifest.dir);
      writeLockEntry(root, manifest.id, {
        source, version: manifest.version || '0.0.0',
        integrity: tree.integrity, files: tree.files, consent: consentSurface(manifest),
      });
    } catch { /* best-effort; never block load on a write failure */ }
  };

  switch (d.status) {
    case 'unpinned': repin(); return { load: true };            // grandfathered hand-enable → pin so future tampering is caught
    case 'match': return { load: true };
    case 'legit-update': repin(); return { load: true };        // version bumped → honest update, re-pin quietly
    case 'drift-nobump':
      if (source === 'bundled') { repin(); return { load: true }; } // reviewed-by-construction (branch-protected checkout) → re-pin
      warnSkip(manifest.id, `files changed since you trusted it without a version bump — possible tampering (${d.changedFiles.slice(0, 5).join(', ')}). Review, then \`node plugins.mjs trust ${manifest.id}\``);
      return { load: false };
    case 'surface-widened':
      warnSkip(manifest.id, `capability surface expanded since you consented (${[...d.addedHosts, ...d.addedEnv].join(', ')}${manifest.allowsLocalhost ? ', localhost' : ''}) — re-consent: \`node plugins.mjs enable ${manifest.id}\``);
      return { load: false };
    default: return { load: true };
  }
}

export async function loadPlugins(kind, { root, dryRun = false }) {
  const cfg = await loadPluginConfig(root);
  const manifests = discoverPlugins(pluginRoots(root), resolveSuccessorIds(root)).filter(m => m.hooks.includes(kind));
  const out = [];
  for (const manifest of manifests) {
    if (!pluginStatus(manifest, cfg).enabled) continue;
    if (!lockGate(manifest, root).load) continue;
    const hook = await importHook(manifest, kind);
    if (!hook) continue;
    out.push({ id: manifest.id, manifest, hook, ctx: buildCtx(manifest, { dryRun, settings: pluginSettings(manifest.id, cfg) }) });
  }
  return out;
}

/** Lazily load dotenv exactly once (mirrors gemini-eval.mjs). Idempotent. */
let dotenvLoaded = false;
export async function loadDotenvOnce() {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  try {
    const { config } = await import('dotenv');
    config();
  } catch {
    // dotenv optional — fall back to ambient process.env (CI, exported vars).
  }
}

/**
 * Run one hook across all enabled plugins, each call try/caught + timed out.
 * Cooperative timeout only: Promise.race resolves the wait but does NOT abort a
 * synchronous-hung or process.exit-ing plugin (plain ESM can't preempt without a
 * worker — stated plainly in README). One throwing/slow plugin can't sink the
 * batch; a sync-hang or a process.exit can. Bundled plugins are reviewed to
 * avoid both, exactly like providers/.
 *
 * @param {string} kind
 * @param {*} payload   For provider this is unused; for ingest none; search a query; export a snapshot; notify a payload.
 * @param {{ root: string, dryRun?: boolean, timeoutMs?: number }} opts
 * @returns {Promise<Array<{ id: string, ok: boolean, result?: any, error?: string }>>}
 */
export async function runHook(kind, payload, { root, dryRun = false, timeoutMs = DEFAULT_HOOK_TIMEOUT_MS }) {
  await loadDotenvOnce();
  const loaded = await loadPlugins(kind, { root, dryRun });
  const results = [];
  for (const { id, hook, ctx } of loaded) {
    const invoke = kind === 'search'
      ? Promise.resolve().then(() => hook(payload, ctx))
      : kind === 'export' || kind === 'notify'
        ? Promise.resolve().then(() => hook(payload, ctx))
        : Promise.resolve().then(() => hook(ctx)); // ingest
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs); });
    try {
      const result = await Promise.race([invoke, timeout]);
      results.push({ id, ok: true, result });
    } catch (err) {
      warnSkip(id, `${kind} hook failed — ${err.message}`);
      results.push({ id, ok: false, error: err.message });
    } finally {
      clearTimeout(timer);
    }
  }
  return results;
}

/**
 * Merge enabled provider-plugins into the core providers Map. THE one hot-path
 * hook (scan.mjs calls this right after loadProviders). Critical guarantees:
 *
 *  1. BYTE-IDENTICAL when opted out: returns IMMEDIATELY if config/plugins.yml
 *     is absent — no discovery, no dotenv, no process.env mutation.
 *  2. dotenv is loaded LAZILY and only after at least one enabled provider
 *     plugin is found, so a present-but-provider-less plugins.yml still touches
 *     no env.
 *  3. Core providers ALWAYS win an id collision (a plugin can never shadow a
 *     bundled zero-key provider).
 *  4. detect-EXEMPT: a merged provider's detect() is forced to null, so it fires
 *     ONLY on an explicit `provider: <id>` portals.yml entry — never via
 *     auto-detection (no surprise paid/keyed network during a plain scan).
 *  5. A known-but-inactive provider plugin registers a STUB whose fetch throws
 *     an actionable message (disabled / missing key) — so `provider: apify` with
 *     the plugin off yields a helpful error, not a confusing "unknown provider".
 *
 * @param {Map<string, any>} providersMap   The Map returned by scan.mjs loadProviders.
 * @param {{ root: string }} opts
 */
// A detect-exempt provider whose fetch throws an actionable message — used when
// a known provider plugin is inactive (disabled / missing key / failed import)
// so an explicit `provider: <id>` portals.yml entry stays self-explaining.
function inactiveProviderStub(id, reason) {
  return {
    id,
    detect: () => null,
    fetch: async () => { throw new Error(`plugin "${id}" inactive: ${reason}. Run \`node doctor.mjs\` for setup.`); },
  };
}

export async function mergeProviderPlugins(providersMap, { root }) {
  if (!existsSync(pluginsConfigPath(root))) return; // (1) opted out → inert (no work, no env read)

  // Everything past the opt-out gate is wrapped so an UNANTICIPATED throw
  // (a callee regression) degrades to a ⚠️ and leaves the core providers Map
  // untouched — fail-open is enforced structurally here, not just emergently.
  try {
    const cfg = await loadPluginConfig(root);
    const providerManifests = discoverPlugins(pluginRoots(root), resolveSuccessorIds(root)).filter(m => m.hooks.includes('provider'));
    if (providerManifests.length === 0) return;

    // Only the plugins the user actually switched on in plugins.yml matter.
    const configuredOn = providerManifests.filter(m => cfg?.plugins?.[m.id]?.enabled === true);
    if (configuredOn.length === 0) return;

    await loadDotenvOnce(); // (2) lazy, only now that an enabled provider plugin exists

    for (const manifest of configuredOn) {
      if (providersMap.has(manifest.id)) {
        warnSkip(manifest.id, 'a core provider already owns this id — plugin not merged');
        continue;
      }
      const { enabled, missingEnv } = pluginStatus(manifest, cfg);
      if (!enabled) {
        const reason = missingEnv.length ? `missing env ${missingEnv.join(', ')} — add to .env` : 'disabled in config/plugins.yml';
        providersMap.set(manifest.id, inactiveProviderStub(manifest.id, reason)); // (5)
        continue;
      }
      if (!lockGate(manifest, root).load) {
        providersMap.set(manifest.id, inactiveProviderStub(manifest.id, 'integrity/consent check failed — see ⚠️ above; run `node plugins.mjs trust ' + manifest.id + '` or `enable ' + manifest.id + '`'));
        continue;
      }
      const hook = await importHook(manifest, 'provider');
      if (!hook) {
        // enabled + keyed but the entry failed to import — keep the path self-explaining.
        providersMap.set(manifest.id, inactiveProviderStub(manifest.id, 'failed to load — see ⚠️ above'));
        continue;
      }
      const ctx = buildCtx(manifest, { settings: pluginSettings(manifest.id, cfg) });
      providersMap.set(manifest.id, {
        id: manifest.id,
        detect: () => null, // (4) keyed providers never auto-detect
        fetch: (entry) => hook.fetch(entry, ctx), // (3) ctx injection
      });
    }
  } catch (err) {
    warnSkip('plugins', `provider-plugin merge skipped this run — ${err.message}`);
  }
}
