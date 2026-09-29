#!/usr/bin/env node

/**
 * validate-portals.mjs — schema/shape validator for portals.yml.
 *
 * Usage:
 *   node validate-portals.mjs
 *   node validate-portals.mjs --file templates/portals.example.yml
 *   node validate-portals.mjs --self-test
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import * as yaml from 'js-yaml';
import { flagValue, hasFlag } from './lib/cli-flags.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PROVIDERS_DIR = join(ROOT, 'providers');
// providers/ ships with the checkout, but portals.yml is user data: it lives in
// the data root, where scan.mjs reads it. A bare 'portals.yml' resolved against
// the cwd instead, so `npm run validate:portals` (npm always runs it from the
// checkout) could not find an external data root's file, and a run from any
// other directory validated whatever copy sat there.
const DEFAULT_PORTALS_PATH = process.env.CAREER_OPS_PORTALS || join(getCareerOpsRoot(), 'portals.yml');

// Providers that narrow a huge shared board with a config block named after
// themselves, read as `entry[provider]`. Seventeen providers use that block
// shape; these four are the ones that degrade a missing or unusable block to
// `{}` SILENTLY (providers/amazon.mjs, ibm.mjs, phenom.mjs, builtin.mjs), so a
// key written with NOTHING under it behaves exactly like no key at all — and on
// a global board that means the whole board. The others are excluded on purpose:
// arbeitsagentur and wttj throw when the block carries no keywords/filters, and
// thehub falls back to a real default country, so none of them can fail this way.
//
// Hand-maintained: providers/_types.js declares no capability metadata and
// providers/_registry.mjs has no notion of a provider's config shape, so there
// is nothing to derive this list from. A new provider with the same silent
// degradation has to be added here by hand.
//
// Measured: `provider: amazon` with a bare `amazon:` scans the unfiltered
// amazon.jobs board (100k+ postings) sorted by recency, because buildQuery()
// defaults base_query and loc_query to ''. The entry reads as coverage while
// returning whatever the employer posted worldwide in the last hour, with no
// relation to the role or location the entry was meant to track.
// providers/amazon.mjs says it outright: "a location and/or keyword filter is
// effectively required".
//
// A WARNING, not an error: the entry does still scan, so erroring would fail
// configs that work today, and verify-pipeline.mjs check 15 cannot catch this
// either — a provider does claim the entry.
const PROVIDER_NARROWING_BLOCKS = new Set(['amazon', 'builtin', 'ibm', 'phenom']);

function add(list, path, message) {
  list.push({ path, message });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function validateUrl(value, path, errors) {
  if (value === undefined || value === null || value === '') return;
  if (typeof value !== 'string') {
    add(errors, path, 'must be a string URL');
    return;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    add(errors, path, `invalid URL: ${value}`);
    return;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    add(errors, path, `unsupported URL protocol: ${parsed.protocol}`);
  }
}

function validateKeywordList(value, path, errors) {
  if (value === undefined || value === null) return;
  const arr = Array.isArray(value) ? value : [value];
  for (const [idx, item] of arr.entries()) {
    if (typeof item !== 'string') {
      add(errors, `${path}[${idx}]`, 'keyword must be a string');
      continue;
    }
    if (item.trim() === '') {
      add(errors, `${path}[${idx}]`, 'keyword must not be empty');
    }
  }
}

function validateParser(parser, path, errors) {
  if (parser === undefined || parser === null) return;
  if (!isObject(parser)) {
    add(errors, path, 'parser must be an object');
    return;
  }
  if (typeof parser.command !== 'string' || parser.command.trim() === '') {
    add(errors, `${path}.command`, 'parser.command must be a non-empty string');
  }
  if (parser.script !== undefined && (typeof parser.script !== 'string' || parser.script.trim() === '')) {
    add(errors, `${path}.script`, 'parser.script must be a non-empty string when set');
  }
  if (parser.args !== undefined && !Array.isArray(parser.args)) {
    add(errors, `${path}.args`, 'parser.args must be an array when set');
  }
  if (parser.timeout_ms !== undefined && (!Number.isFinite(Number(parser.timeout_ms)) || Number(parser.timeout_ms) <= 0)) {
    add(errors, `${path}.timeout_ms`, 'parser.timeout_ms must be a positive number when set');
  }
  if (parser.max_buffer_bytes !== undefined && (!Number.isFinite(Number(parser.max_buffer_bytes)) || Number(parser.max_buffer_bytes) <= 0)) {
    add(errors, `${path}.max_buffer_bytes`, 'parser.max_buffer_bytes must be a positive number when set');
  }
}

async function loadProviderIds() {
  const ids = new Set();
  if (existsSync(PROVIDERS_DIR)) {
    const files = readdirSync(PROVIDERS_DIR)
      .filter(f => f.endsWith('.mjs') && !f.startsWith('_'))
      .sort();
    for (const file of files) {
      const mod = await import(pathToFileURL(join(PROVIDERS_DIR, file)).href);
      if (mod.default?.id) ids.add(mod.default.id);
    }
  }

  // scan.mjs accepts explicit provider-plugin ids even when a plugin is
  // disabled or missing credentials (the runtime installs an actionable
  // inactive-provider stub). Keep validation aligned with that contract.
  try {
    const { discoverPlugins, pluginRoots, resolveSuccessorIds } = await import('./plugins/_engine.mjs');
    const manifests = discoverPlugins(pluginRoots(ROOT), resolveSuccessorIds(ROOT));
    for (const manifest of manifests) {
      if (manifest.hooks.includes('provider')) ids.add(manifest.id);
    }
  } catch (err) {
    // A stripped-down checkout may not include plugin infrastructure. Core
    // provider validation should continue to work in that environment.
    if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
  }
  return ids;
}

const TITLE_FILTER_FIELDS = ['positive', 'negative', 'seniority_boost'];

export async function validatePortalsConfig(config, { providerIds = new Set() } = {}) {
  const errors = [];
  const warnings = [];

  if (!isObject(config)) {
    add(errors, '<root>', 'portals config must be a YAML object');
    return { errors, warnings };
  }

  if (config.title_filter !== undefined) {
    if (!isObject(config.title_filter)) {
      add(errors, 'title_filter', 'title_filter must be an object');
    } else {
      validateKeywordList(config.title_filter.positive, 'title_filter.positive', errors);
      validateKeywordList(config.title_filter.negative, 'title_filter.negative', errors);
      validateKeywordList(config.title_filter.seniority_boost, 'title_filter.seniority_boost', errors);
    }
  }

  // Optional per-scanner override consumed only by scan-ats-full.mjs. Same
  // shape as title_filter, so it gets the same structural checks — an
  // unvalidated key would let a typo ("positve") silently resolve to a
  // profile with no positive keywords, which matches every posting.
  if (config.title_filter_full !== undefined) {
    if (!isObject(config.title_filter_full)) {
      add(errors, 'title_filter_full', 'title_filter_full must be an object');
    } else {
      // A misspelled field is the dangerous case, not a missing one:
      // `positve:` leaves `positive` undefined, buildTitleFilter treats an
      // empty positive list as "no positive constraint", and the sweep then
      // matches every title on every board — the exact outcome this key
      // exists to prevent. An unknown field is therefore an error, while
      // `positive: []` stays valid as a deliberate choice.
      for (const key of Object.keys(config.title_filter_full)) {
        if (!TITLE_FILTER_FIELDS.includes(key)) {
          add(errors, `title_filter_full.${key}`, `unknown title_filter_full field - expected one of ${TITLE_FILTER_FIELDS.join(', ')}`);
        }
      }
      validateKeywordList(config.title_filter_full.positive, 'title_filter_full.positive', errors);
      validateKeywordList(config.title_filter_full.negative, 'title_filter_full.negative', errors);
      validateKeywordList(config.title_filter_full.seniority_boost, 'title_filter_full.seniority_boost', errors);
    }
  }

  if (config.location_filter !== undefined) {
    if (!isObject(config.location_filter)) {
      add(errors, 'location_filter', 'location_filter must be an object');
    } else {
      validateKeywordList(config.location_filter.always_allow, 'location_filter.always_allow', errors);
      validateKeywordList(config.location_filter.allow, 'location_filter.allow', errors);
      validateKeywordList(config.location_filter.block, 'location_filter.block', errors);
      validateKeywordList(config.location_filter.block_hard, 'location_filter.block_hard', errors);
      if (config.location_filter.strict !== undefined && typeof config.location_filter.strict !== 'boolean') {
        add(errors, 'location_filter.strict', 'must be a boolean when set');
      }
    }
  }

  if (config.content_filter !== undefined) {
    if (!isObject(config.content_filter)) {
      add(errors, 'content_filter', 'content_filter must be an object');
    } else {
      validateKeywordList(config.content_filter.positive, 'content_filter.positive', errors);
      validateKeywordList(config.content_filter.negative, 'content_filter.negative', errors);
      if (config.content_filter.by_title_keyword !== undefined) {
        if (!isObject(config.content_filter.by_title_keyword)) {
          add(errors, 'content_filter.by_title_keyword', 'by_title_keyword must be an object keyed by title_filter.positive keyword');
        } else {
          const titlePositive = new Set(
            (Array.isArray(config.title_filter?.positive) ? config.title_filter.positive : [])
              .filter(k => typeof k === 'string')
              .map(k => k.trim().toLowerCase())
          );
          for (const [kw, rule] of Object.entries(config.content_filter.by_title_keyword)) {
            const path = `content_filter.by_title_keyword.${kw}`;
            if (!titlePositive.has(kw.trim().toLowerCase())) {
              add(warnings, path, `"${kw}" does not match any title_filter.positive keyword and will never apply`);
            }
            if (!isObject(rule)) {
              add(errors, path, 'must be an object with positive/negative keyword lists');
              continue;
            }
            validateKeywordList(rule.positive, `${path}.positive`, errors);
            validateKeywordList(rule.negative, `${path}.negative`, errors);
          }
        }
      }
    }
  }

  if (config.visa_filter !== undefined) {
    if (!isObject(config.visa_filter)) {
      add(errors, 'visa_filter', 'visa_filter must be an object');
    } else {
      if (config.visa_filter.enabled !== undefined && typeof config.visa_filter.enabled !== 'boolean') {
        add(errors, 'visa_filter.enabled', 'must be a boolean when set');
      }
      if (config.visa_filter.require_mention !== undefined && typeof config.visa_filter.require_mention !== 'boolean') {
        add(errors, 'visa_filter.require_mention', 'must be a boolean when set');
      }
      validateKeywordList(config.visa_filter.positive, 'visa_filter.positive', errors);
      validateKeywordList(config.visa_filter.negative, 'visa_filter.negative', errors);
    }
  }

  if (config.search_queries !== undefined && !Array.isArray(config.search_queries)) {
    add(errors, 'search_queries', 'search_queries must be an array when set');
  }

  // tracked_companies and job_boards share one entry schema (name / careers_url /
  // api / provider / parser) and one dedup namespace downstream, so validate them
  // in a single pass. seenEnabledNames spans both lists: a board and a company
  // that share a name would still collide in the scanner's reporting.
  const seenEnabledNames = new Map();
  const validateEntryList = (list, key, noun) => {
    if (list === undefined) return;
    if (!Array.isArray(list)) {
      add(errors, key, `${key} must be an array when set`);
      return;
    }
    for (const [idx, entry] of list.entries()) {
      const base = `${key}[${idx}]`;
      if (!isObject(entry)) {
        add(errors, base, `${noun} entry must be an object`);
        continue;
      }
      if (entry.enabled === false) continue;

      if (typeof entry.name !== 'string' || entry.name.trim() === '') {
        add(errors, `${base}.name`, `enabled ${noun} must have a non-empty string name`);
      } else {
        const normalized = normalizeName(entry.name);
        if (seenEnabledNames.has(normalized)) {
          add(warnings, `${base}.name`, `duplicate enabled ${noun} name also seen at ${seenEnabledNames.get(normalized)}`);
        } else {
          seenEnabledNames.set(normalized, `${base}.name`);
        }
      }

      validateUrl(entry.careers_url, `${base}.careers_url`, errors);
      validateUrl(entry.api, `${base}.api`, errors);

      if (entry.provider !== undefined) {
        if (typeof entry.provider !== 'string' || entry.provider.trim() === '') {
          add(errors, `${base}.provider`, 'provider must be a non-empty string when set');
        } else if (!providerIds.has(entry.provider)) {
          add(errors, `${base}.provider`, `unknown provider "${entry.provider}"`);
        }
      }

      // Only meaningful once the provider name is known and recognized; an
      // unknown provider already errored above and its block is unreadable.
      if (typeof entry.provider === 'string' && PROVIDER_NARROWING_BLOCKS.has(entry.provider)) {
        const block = entry[entry.provider];
        // A block narrows only if it is a mapping with at least one key. Every
        // other spelling — null, {}, [], "", 0, false, or a bare scalar like
        // `amazon: DEU` written instead of a nested key — is read as `{}` by all
        // four providers and scans the whole board just the same, so they all
        // warn rather than only the two that look empty.
        const narrows = isObject(block) && Object.keys(block).length > 0;
        if (block !== undefined && !narrows) {
          add(
            warnings,
            `${base}.${entry.provider}`,
            `${entry.provider} config block is present but narrows nothing — the scan reads the provider's entire board. Give it a filter key or remove the block`
          );
        }
      }

      validateParser(entry.parser, `${base}.parser`, errors);
    }
  };

  validateEntryList(config.tracked_companies, 'tracked_companies', 'company');
  validateEntryList(config.job_boards, 'job_boards', 'job board');

  return { errors, warnings };
}

function formatIssue(issue) {
  return `${issue.path}: ${issue.message}`;
}

async function validateFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`file not found: ${filePath}`);
  }
  const providerIds = await loadProviderIds();
  const parsed = yaml.load(readFileSync(filePath, 'utf-8'));
  return validatePortalsConfig(parsed, { providerIds });
}

async function runSelfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'career-ops-validate-portals-self-test-'));
  try {
    const file = join(tmp, 'bad.yml');
    writeFileSync(file, `
title_filter:
  positive: ["AI", ""]
tracked_companies:
  - name: "Acme"
    provider: "not-real"
    careers_url: "https://jobs.lever.co/acme"
`, 'utf-8');
    const result = await validateFile(file);
    if (result.errors.length !== 2) {
      throw new Error(`expected 2 errors, got ${result.errors.length}`);
    }
    console.log('validate-portals self-test OK');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    await runSelfTest();
    return;
  }

  // An explicit but empty `--file=` must reach the usage error below. Passing
  // '' to resolve() would return the CURRENT DIRECTORY, and the script would
  // then try to validate a directory and report a filesystem error instead.
  const fileFlag = hasFlag(args, '--file') ? (flagValue(args, '--file') ?? '') : undefined;
  const filePath = fileFlag === undefined ? resolve(DEFAULT_PORTALS_PATH) : (fileFlag ? resolve(fileFlag) : '');
  if (!filePath) {
    console.error('Usage: node validate-portals.mjs [--file portals.yml] [--self-test]');
    process.exit(1);
  }

  let result;
  try {
    result = await validateFile(filePath);
  } catch (err) {
    console.error(`validate-portals failed: ${err.message}`);
    process.exit(1);
  }

  console.log(`validate-portals: ${filePath}`);
  for (const warning of result.warnings) console.log(`warning: ${formatIssue(warning)}`);
  for (const error of result.errors) console.log(`error: ${formatIssue(error)}`);
  console.log(`${result.errors.length} errors, ${result.warnings.length} warnings`);

  if (result.errors.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`validate-portals failed: ${err.message}`);
  process.exit(1);
});
