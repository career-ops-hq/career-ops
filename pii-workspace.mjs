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
 * values, so treat it exactly as you treat `cv.md`.
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

const USER_FILES = ['cv.md', 'config/profile.yml', 'modes/_profile.md'];
const TOKEN_MAP_NAME = '.pii-token-map.json';

const root = getCareerOpsRoot();
const tokenMapPath = path.join(root, TOKEN_MAP_NAME);

const mode = process.argv[2]; // 'scrub' | 'restore' | 'status'

if (!mode || !['scrub', 'restore', 'status'].includes(mode)) {
  console.log(`Usage: node pii-workspace.mjs <scrub|restore|status>`);
  process.exit(1);
}

/** Escape a literal so it can be used inside a RegExp. */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function loadTokenMap() {
  if (!fs.existsSync(tokenMapPath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(tokenMapPath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid token map structure');
    }
    return parsed;
  } catch (err) {
    console.error(`[privacy] Error reading token map at ${tokenMapPath}: ${err.message}`);
    process.exit(1);
  }
}

function atomicWriteFileSync(targetPath, content, options = {}) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });

  const opts = typeof options === 'string' ? { encoding: options } : { ...options };

  let mode = opts.mode;
  if (mode === undefined && fs.existsSync(targetPath)) {
    try {
      mode = fs.statSync(targetPath).mode & 0o777;
    } catch {
      /* ignore */
    }
  }
  if (mode === undefined) {
    mode = 0o600;
  }

  const tempPath = path.join(
    dir,
    `.tmp-${path.basename(targetPath)}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.writeFileSync(tempPath, content, { ...opts, mode });
  try {
    fs.chmodSync(tempPath, mode);
  } catch {
    /* on Windows chmod is limited, ignore chmod failures */
  }
  fs.renameSync(tempPath, targetPath);
}

function saveTokenMap(map) {
  atomicWriteFileSync(tokenMapPath, JSON.stringify(map, null, 2), { encoding: 'utf-8', mode: 0o600 });
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

  for (const value of guard.textValues) {
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
  let out = text;
  for (const [token, value] of Object.entries(map)) out = out.split(token).join(value);
  return out;
}

function main() {
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
    if (guard.textValues.size === 0) {
      console.error(
        `[privacy] No guardable text values loaded. Check config/privacy.yml (minimum text length: 5 characters).`
      );
      process.exit(1);
    }
  }

  const map = loadTokenMap();

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
      }
      console.log(`[privacy] ${file}: tokenized (${Object.keys(map).length} token(s) mapped)`);
    } else if (mode === 'restore') {
      const restored = rehydrate(content, map);
      if (restored !== content) atomicWriteFileSync(filePath, restored, 'utf8');
      console.log(`[privacy] ${file}: real values restored`);
    } else {
      const hasTokens = /PRIVACY_VALUE_|PRIVACY_REDACTED_|CANDIDATE_/.test(content);
      console.log(`[privacy] ${file}: ${hasTokens ? 'TOKENIZED (contains tokens)' : 'holds real PII'}`);
    }
  }

  if (mode === 'scrub' && Object.keys(map).length > 0) saveTokenMap(map);
}

main();
