#!/usr/bin/env node
// pii-workspace.mjs — redact and restore PII across local workspace files.

import fs from 'node:fs';
import path from 'node:path';
import {
  readPrivacyConfig,
  getPrivacyConfigPath,
  loadPrivacyGuard,
} from './lib/privacy-guard.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { acquireDirLock, releaseOrWarn } from './lib/dir-lock.mjs';
import {
  replaceUserFile,
  writeFileAtomic,
} from './tracker-utils.mjs';

const USER_FILES = ['cv.md', 'config/profile.yml', 'modes/_profile.md'];
const TOKEN_MAP_NAME = '.pii-token-map.json';

const USAGE = `Usage: node pii-workspace.mjs <scrub|restore|status>

Commands:
  scrub    Replace configured PII in user files with stable tokens,
           saving the reverse mapping to ${TOKEN_MAP_NAME}.
  restore  Restore real values from ${TOKEN_MAP_NAME} into user files
           and remove the map once restored.
  status   Report whether user files contain tokens or unredacted PII.
`;

const root = getCareerOpsRoot();
const tokenMapPath = path.join(root, TOKEN_MAP_NAME);

/** Escape a literal so it can be used inside a RegExp. */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const METADATA_KEYS = new Set(['__files__', '__restored__']);
const isTokenKey = (k) => !METADATA_KEYS.has(k);

function loadTokenMap(explicitPath) {
  const mapPath = explicitPath ?? tokenMapPath;
  if (!fs.existsSync(mapPath)) return {};
  try {
    const raw = fs.readFileSync(mapPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`invalid token map structure in ${mapPath}`);
    }
    return parsed;
  } catch (err) {
    throw new Error(`Error reading token map at ${mapPath}: ${err.message}`);
  }
}

function saveTokenMap(map, explicitPath) {
  const mapPath = explicitPath ?? tokenMapPath;
  writeFileAtomic(mapPath, JSON.stringify(map, null, 2), { mode: 0o600 });
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
      const n = Number(match[1]);
      if (n > maxIndex) maxIndex = n;
    }
  }
  for (const match of text.matchAll(/\bPRIVACY_VALUE_(\d+)\b/g)) {
    const n = Number(match[1]);
    if (n > maxIndex) maxIndex = n;
  }
  let index = maxIndex;

  // Every match is found in the original text, never in text an earlier value
  // already replaced, so a configured value cannot match inside a token
  // ("value" inside PRIVACY_VALUE_1). Spans taken by existing tokens and by
  // longer values are skipped; replacements are spliced in at the end.
  const taken = [];
  const overlaps = (start, end) => taken.some((s) => start < s.end && s.start < end);

  const legacyTokens = Object.keys(map)
    .filter((k) => isTokenKey(k) && !/^PRIVACY_VALUE_\d+$/.test(k))
    .sort((a, b) => b.length - a.length);
  const tokenRe = new RegExp([...legacyTokens.map(escapeRe), 'PRIVACY_VALUE_\\d+'].join('|'), 'g');
  for (const m of text.matchAll(tokenRe)) {
    taken.push({ start: m.index, end: m.index + m[0].length, token: null });
  }

  const sortedValues = [...guard.textValues].sort((a, b) => b.length - a.length);
  for (const value of sortedValues) {
    if (value.length < 5) continue;
    const re = new RegExp(escapeRe(value), 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (overlaps(start, end)) {
        // Resume searching after candidate start to find later non-overlapping occurrences.
        re.lastIndex = start + 1;
        continue;
      }
      const matched = m[0];
      // Reuse an existing token only when the spelling and casing match exactly.
      const existing = Object.entries(map).find(([k, v]) => isTokenKey(k) && v === matched);
      let token;
      if (existing) {
        token = existing[0];
      } else {
        if (!Number.isSafeInteger(index + 1)) {
          throw new RangeError(`Cannot allocate token ID: token index ${index + 1} exceeds Number.MAX_SAFE_INTEGER`);
        }
        // Use an identifier valid as an unquoted YAML scalar (no braces).
        token = `PRIVACY_VALUE_${++index}`;
        map[token] = matched;
      }
      taken.push({ start, end, token });
    }
  }

  for (const span of taken.filter((s) => s.token).sort((a, b) => b.start - a.start)) {
    out = out.slice(0, span.start) + span.token + out.slice(span.end);
  }
  return out;
}

function rehydrate(text, map, restoredTokens = null) {
  if (!map || Object.keys(map).length === 0) return text;

  // Match complete numeric tokens (PRIVACY_VALUE_\d+) and legacy tokens in a
  // single replacement pass over the original text, looking up each exact match
  // in map. Descending length order for legacy tokens prevents shorter tokens
  // corrupting longer ones, and a single pass ensures inserted values are not
  // processed again.
  const extraTokens = Object.keys(map)
    .filter((k) => !/^PRIVACY_VALUE_\d+$/.test(k) && isTokenKey(k))
    .sort((a, b) => b.length - a.length);

  const pattern = new RegExp(
    [...extraTokens.map(escapeRe), 'PRIVACY_VALUE_\\d+'].join('|'),
    'g'
  );

  return text.replace(pattern, (matched) => {
    if (Object.prototype.hasOwnProperty.call(map, matched)) {
      if (restoredTokens) {
        if (Array.isArray(restoredTokens)) {
          restoredTokens.push(matched);
        } else if (typeof restoredTokens.add === 'function') {
          restoredTokens.add(matched);
        }
      }
      return map[matched];
    }
    return matched;
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
    const restoredTokens = new Set();

    for (const file of USER_FILES) {
      const filePath = path.join(root, file);
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf8');

      if (mode === 'scrub') {
        const scrubbed = scrub(content, guard, map);
        if (scrubbed !== content) {
          if (!map.__files__) map.__files__ = [];
          if (!map.__files__.includes(file)) map.__files__.push(file);
          if (Array.isArray(map.__restored__)) {
            map.__restored__ = map.__restored__.filter(
              (t) => !new RegExp(`\\b${escapeRe(t)}\\b`).test(scrubbed)
            );
          }
          // Persist the token map immediately before each rewritten file loses its real values.
          saveTokenMap(map);
          replaceUserFile(filePath, scrubbed);
          console.log(`[privacy] ${file}: tokenized`);
        } else {
          console.log(`[privacy] ${file}: no configured text values found (unchanged)`);
        }
      } else if (mode === 'restore') {
        const restored = rehydrate(content, map, restoredTokens);
        if (restored !== content) replaceUserFile(filePath, restored);
        const unresolved = restored.match(/PRIVACY_VALUE_\d+/g);
        if (unresolved && unresolved.length > 0) {
          hasUnresolved = true;
          const unique = [...new Set(unresolved)];
          console.warn(
            `[privacy] WARNING: ${file} still contains ${unique.length} unresolved token(s): ${unique.join(', ')}`
          );
        } else {
          console.log(`[privacy] ${file}: real values restored`);
          let mapDirty = false;
          if (Array.isArray(map.__files__) && map.__files__.includes(file)) {
            map.__files__ = map.__files__.filter((f) => f !== file);
            mapDirty = true;
          }
          if (restoredTokens.size > 0) {
            const prevRestored = new Set(Array.isArray(map.__restored__) ? map.__restored__ : []);
            const beforeSize = prevRestored.size;
            for (const t of restoredTokens) prevRestored.add(t);
            if (prevRestored.size !== beforeSize) {
              map.__restored__ = [...prevRestored];
              mapDirty = true;
            }
          }
          if (mapDirty) saveTokenMap(map);
        }
      } else {
        const mapTokens = Object.keys(map).filter(isTokenKey);
        const hasMapToken = mapTokens.some((t) => new RegExp(`\\b${escapeRe(t)}\\b`).test(content));
        const hasTokens = hasMapToken || /PRIVACY_VALUE_|PRIVACY_REDACTED_|CANDIDATE_/.test(content);
        console.log(`[privacy] ${file}: ${hasTokens ? 'contains tokens' : 'no tokens detected'}`);
      }
    }

    if (mode === 'scrub' && Object.keys(map).filter(isTokenKey).length > 0) {
      saveTokenMap(map);
    } else if (mode === 'restore') {
      const tokenizedFiles = Array.isArray(map.__files__) ? map.__files__ : [];
      const absentTokenized = tokenizedFiles.filter((f) => !fs.existsSync(path.join(root, f)));
      const allRestored = new Set([
        ...(Array.isArray(map.__restored__) ? map.__restored__ : []),
        ...restoredTokens,
      ]);
      const mapTokens = Object.keys(map).filter(isTokenKey);
      const unrestored = mapTokens.filter((t) => !allRestored.has(t));
      if (unrestored.length > 0) {
        console.warn(
          `[privacy] WARNING: ${unrestored.length} token map entry(ies) not restored; retaining ${TOKEN_MAP_NAME}`
        );
      } else if (absentTokenized.length > 0) {
        console.warn(
          `[privacy] WARNING: ${absentTokenized.length} tokenized file(s) absent (${absentTokenized.join(', ')}); retaining ${TOKEN_MAP_NAME}`
        );
      } else if (!hasUnresolved) {
        try {
          if (fs.existsSync(tokenMapPath)) {
            fs.unlinkSync(tokenMapPath);
          }
        } catch (err) {
          if (err.code !== 'ENOENT') {
            console.error(`[privacy] Error removing token map at ${tokenMapPath}: ${err.message}`);
            process.exitCode = 1;
          }
        }
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
  replaceUserFile,
  saveTokenMap,
  scrub,
  rehydrate,
  isTokenKey,
  main,
};
