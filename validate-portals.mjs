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
import yaml from 'js-yaml';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PROVIDERS_DIR = join(ROOT, 'providers');
const DEFAULT_PORTALS_PATH = process.env.CAREER_OPS_PORTALS || 'portals.yml';

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
  if (!existsSync(PROVIDERS_DIR)) return ids;
  const files = readdirSync(PROVIDERS_DIR)
    .filter(f => f.endsWith('.mjs') && !f.startsWith('_'))
    .sort();
  for (const file of files) {
    const mod = await import(pathToFileURL(join(PROVIDERS_DIR, file)).href);
    if (mod.default?.id) ids.add(mod.default.id);
  }
  return ids;
}

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

  if (config.location_filter !== undefined) {
    if (!isObject(config.location_filter)) {
      add(errors, 'location_filter', 'location_filter must be an object');
    } else {
      validateKeywordList(config.location_filter.always_allow, 'location_filter.always_allow', errors);
      validateKeywordList(config.location_filter.allow, 'location_filter.allow', errors);
      validateKeywordList(config.location_filter.block, 'location_filter.block', errors);
    }
  }

  if (config.search_queries !== undefined && !Array.isArray(config.search_queries)) {
    add(errors, 'search_queries', 'search_queries must be an array when set');
  }

  const companies = config.tracked_companies;
  if (companies !== undefined && !Array.isArray(companies)) {
    add(errors, 'tracked_companies', 'tracked_companies must be an array when set');
  }

  const seenEnabledNames = new Map();
  if (Array.isArray(companies)) {
    for (const [idx, company] of companies.entries()) {
      const base = `tracked_companies[${idx}]`;
      if (!isObject(company)) {
        add(errors, base, 'company entry must be an object');
        continue;
      }
      if (company.enabled === false) continue;

      if (typeof company.name !== 'string' || company.name.trim() === '') {
        add(errors, `${base}.name`, 'enabled company must have a non-empty string name');
      } else {
        const normalized = normalizeName(company.name);
        if (seenEnabledNames.has(normalized)) {
          add(warnings, `${base}.name`, `duplicate enabled company name also seen at ${seenEnabledNames.get(normalized)}`);
        } else {
          seenEnabledNames.set(normalized, `${base}.name`);
        }
      }

      validateUrl(company.careers_url, `${base}.careers_url`, errors);
      validateUrl(company.api, `${base}.api`, errors);

      if (company.provider !== undefined) {
        if (typeof company.provider !== 'string' || company.provider.trim() === '') {
          add(errors, `${base}.provider`, 'provider must be a non-empty string when set');
        } else if (!providerIds.has(company.provider)) {
          add(errors, `${base}.provider`, `unknown provider "${company.provider}"`);
        }
      }

      validateParser(company.parser, `${base}.parser`, errors);
    }
  }

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

  const fileFlag = args.indexOf('--file');
  const filePath = resolve(fileFlag === -1 ? DEFAULT_PORTALS_PATH : args[fileFlag + 1] || '');
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
