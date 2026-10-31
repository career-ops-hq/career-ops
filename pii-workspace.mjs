/**
 * pii-workspace.mjs — optional on-disk tokenization for interactive AI CLIs.
 *
 * WHAT THIS IS FOR
 * ----------------
 * `lib/privacy-guard.mjs` + `lib/pii-interceptor.mjs` guard the requests
 * career-ops itself makes. They cannot see a CLI agent — Claude Code, OpenCode,
 * Codex — reading `cv.md` and `config/profile.yml` from disk with its own file
 * tools. This tool is the manual companion for that gap: it rewrites the chosen
 * user-layer files with placeholder tokens before a CLI session, and puts the
 * real values back afterwards, so the files on disk hold no PII while the CLI
 * is reading them.
 *
 *   node pii-workspace.mjs status    # is each file tokenized or holding real PII?
 *   node pii-workspace.mjs scrub     # replace configured values with tokens
 *   node pii-workspace.mjs restore    # put the real values back
 *
 * CAVEATS — read before using scrub
 * ---------------------------------
 * `scrub` MUTATES YOUR CV AND PROFILE IN PLACE. A crash, a lost laptop or a
 * forgotten `restore` leaves those files tokenized, and the tokens are only
 * reversible while `.pii-token-map.json` exists. Run `restore` when the session
 * ends. Tokens are also only as good as the configured values: rename a value in
 * `config/privacy.yml` and the old tokens no longer map to it.
 *
 * The token map is written to the data root and gitignored; it holds your real
 * values, so treat it exactly as you treat `cv.md`. Warn AI agents not to read
 * the token map, or place `CAREER_OPS_ROOT` outside the agent workspace.
 */

import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import {
  loadPrivacyGuard,
  readPrivacyConfig,
  getPrivacyConfigPath,
} from './lib/privacy-guard.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { acquireDirLock, releaseOrWarn } from './lib/dir-lock.mjs';

const USER_FILES = ['cv.md', 'config/profile.yml', 'modes/_profile.md'];
const TOKEN_MAP_NAME = '.pii-token-map.json';

const USAGE = `Usage: node pii-workspace.mjs <scrub|restore|status>

Commands:
  status   Report whether user files are tokenized or contain real PII
  scrub    Replace configured PII values with placeholder tokens in user files
  restore  Restore original PII values from token map into user files

Options:
  -h, --help  Show this help message
`;

const root = getCareerOpsRoot();
const tokenMapPath = path.join(root, TOKEN_MAP_NAME);

/** Escape a literal so it can be used inside a RegExp. */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function loadTokenMap(explicitPath) {
  const mapPath = explicitPath ?? tokenMapPath;
  if (!fs.existsSync(mapPath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid token map structure');
    }
    return parsed;
  } catch (err) {
    throw new Error(`[privacy] Error reading token map at ${mapPath}: ${err.message}`);
  }
}

function atomicWriteFileSync(targetPath, content, options = {}) {
  let resolvedTarget = targetPath;
  try {
    const stat = fs.lstatSync(targetPath);
    if (stat.isSymbolicLink()) {
      resolvedTarget = fs.realpathSync(targetPath);
    }
  } catch {
    /* ignore if target does not exist or lstat/realpath fails */
  }

  const dir = path.dirname(resolvedTarget);
  fs.mkdirSync(dir, { recursive: true });

  const opts = typeof options === 'string' ? { encoding: options } : { ...options };

  let mode = opts.mode;
  if (mode === undefined && fs.existsSync(resolvedTarget)) {
    try {
      mode = fs.statSync(resolvedTarget).mode & 0o777;
    } catch {
      /* ignore */
    }
  }
  if (mode === undefined) {
    mode = 0o600;
  }

  const tempPath = path.join(
    dir,
    `.tmp-${path.basename(resolvedTarget)}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  let renamed = false;
  try {
    fs.writeFileSync(tempPath, content, { ...opts, mode });
    try {
      fs.chmodSync(tempPath, mode);
    } catch {
      /* on Windows chmod is limited, ignore chmod failures */
    }
    fs.renameSync(tempPath, resolvedTarget);
    renamed = true;
  } finally {
    if (!renamed) {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {
        /* ignore cleanup failures */
      }
    }
  }
}

function saveTokenMap(map, explicitPath) {
  const mapPath = explicitPath ?? tokenMapPath;
  atomicWriteFileSync(mapPath, JSON.stringify(map, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

/**
 * Replace each configured text value in `text` with a stable token.
 * `map` is token -> real value and is merged across files.
 */
function scrub(text, guard, map) {
  let out = text;
  let maxIndex = 0;
  for (const token of Object.keys(map)) {
    const match = token.match(/PRIVACY_VALUE_(\d+)/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxIndex) maxIndex = n;
    }
  }
  let index = maxIndex;

  const sortedValues = [...guard.textValues].sort((a, b) => b.length - a.length);
  for (const value of sortedValues) {
    if (value.length < 5) continue;
    const re = new RegExp(escapeRe(value), 'gi');
    out = out.replace(re, (matched) => {
      // Reuse an existing token only when the spelling and casing match exactly.
      const existing = Object.entries(map).find(([, v]) => v === matched);
      if (existing) return existing[0];
      // Use an identifier valid as an unquoted YAML scalar (no braces).
      const token = `PRIVACY_VALUE_${++index}`;
      map[token] = matched;
      return token;
    });
  }
  return out;
}

function rehydrate(text, map) {
  if (!map || Object.keys(map).length === 0) return text;

  // Match complete numeric tokens (PRIVACY_VALUE_\d+) and legacy tokens in a
  // single replacement pass over the original text, looking up each exact match
  // in map. Descending length order for legacy tokens prevents shorter tokens
  // corrupting longer ones, and a single pass ensures inserted values are not
  // processed again.
  const extraTokens = Object.keys(map)
    .filter((k) => !/^PRIVACY_VALUE_\d+$/.test(k))
    .sort((a, b) => b.length - a.length);

  const pattern = new RegExp(
    [...extraTokens.map(escapeRe), 'PRIVACY_VALUE_\\d+'].join('|'),
    'g'
  );

  return text.replace(pattern, (matched) => {
    return Object.prototype.hasOwnProperty.call(map, matched) ? map[matched] : matched;
  });
}

async function main() {
  if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
    console.log(USAGE);
    process.exit(0);
  }

  const mode = process.argv[2]; // 'scrub' | 'restore' | 'status'

  if (!mode || !['scrub', 'restore', 'status'].includes(mode)) {
    console.log(`Usage: node pii-workspace.mjs <scrub|restore|status>`);
    process.exit(1);
  }

  let guard = null;

  if (mode === 'scrub') {
    const config = readPrivacyConfig();
    if (config.source === 'empty' || config.source === 'absent') {
      console.log(
        `[privacy] No configured values found (${config.source === 'absent' ? 'config/privacy.yml is absent' : 'config/privacy.yml is empty'}).\n` +
          `          Copy config/privacy.example.yml to config/privacy.yml and fill it in first.\n` +
          `          Path checked: ${getPrivacyConfigPath()}`
      );
      process.exit(1);
    }

    // Use an empty env so scrub mode is never disabled by an outbound LLM bypass.
    guard = loadPrivacyGuard({ config, env: {} });
    const numericCount = (guard.digitStrings?.size ?? 0) + (guard.digitRuns?.size ?? 0);
    const textCount = guard.textValues?.size ?? 0;
    if (textCount === 0 && numericCount === 0) {
      console.error(
        `[privacy] No guardable values loaded. Check config/privacy.yml (minimum text length: 5 characters, 5 digits).`
      );
      process.exit(1);
    }
    if (numericCount > 0) {
      console.warn(
        `[privacy] WARNING: ${numericCount} configured numeric value(s) cannot be tokenized and remain readable.`
      );
    }
  }

  let lock = null;
  if (mode === 'scrub' || mode === 'restore') {
    lock = await acquireDirLock(`${tokenMapPath}.lock`, {
      timeoutMs: 10_000,
      retryMs: 50,
      staleMs: 30_000,
      createParent: true,
    });
  }

  try {
    const map = loadTokenMap();
    let hasUnresolved = false;

    for (const file of USER_FILES) {
      const filePath = path.join(root, file);
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf8');

      if (mode === 'scrub') {
        const scrubbed = scrub(content, guard, map);
        if (scrubbed !== content) {
          // Persist the token map immediately before each rewritten file loses its real values.
          saveTokenMap(map);
          atomicWriteFileSync(filePath, scrubbed, 'utf8');
          console.log(`[privacy] ${file}: tokenized`);
        } else {
          console.log(`[privacy] ${file}: no configured text values found (unchanged)`);
        }
      } else if (mode === 'restore') {
        const restored = rehydrate(content, map);
        if (restored !== content) atomicWriteFileSync(filePath, restored, 'utf8');
        const unresolved = restored.match(/PRIVACY_VALUE_\d+/g);
        if (unresolved && unresolved.length > 0) {
          hasUnresolved = true;
          const unique = [...new Set(unresolved)];
          console.warn(
            `[privacy] WARNING: ${file} still contains ${unique.length} unresolved token(s): ${unique.join(', ')}`
          );
        } else {
          console.log(`[privacy] ${file}: real values restored`);
        }
      } else {
        const hasTokens = /PRIVACY_VALUE_|PRIVACY_REDACTED_|CANDIDATE_/.test(content);
        console.log(`[privacy] ${file}: ${hasTokens ? 'contains tokens' : 'no tokens detected'}`);
      }
    }

    if (mode === 'scrub' && Object.keys(map).length > 0) {
      saveTokenMap(map);
    } else if (mode === 'restore' && !hasUnresolved) {
      try {
        if (fs.existsSync(tokenMapPath)) {
          fs.unlinkSync(tokenMapPath);
        }
      } catch {
        /* ignore error if token map could not be removed */
      }
    }
  } finally {
    if (lock) releaseOrWarn(lock);
  }
}

if (isMainModule(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

export {
  USER_FILES,
  TOKEN_MAP_NAME,
  loadTokenMap,
  atomicWriteFileSync,
  saveTokenMap,
  scrub,
  rehydrate,
  main,
};
