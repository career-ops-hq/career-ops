#!/usr/bin/env node

/**
 * verify-cv-facts.mjs — Guard generated CVs against invented metrics.
 *
 * Usage:
 *   node verify-cv-facts.mjs <generated-cv.html|md|tex>
 *   node verify-cv-facts.mjs <generated-cv> --source cv.md --source article-digest.md
 */

import { existsSync, readFileSync } from 'fs';
import { isAbsolute, join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCES = ['cv.md', 'article-digest.md'];
const DEFAULT_CONFIG = join(ROOT, 'config', 'cv-facts.json');

const args = process.argv.slice(2);
const sourceArgs = [];
let targetArg = '';
let configPath = DEFAULT_CONFIG;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--source') {
    if (!args[i + 1]) {
      console.error('ERROR: --source requires a path');
      process.exit(1);
    }
    sourceArgs.push(args[++i]);
  } else if (arg === '--config') {
    if (!args[i + 1]) {
      console.error('ERROR: --config requires a path');
      process.exit(1);
    }
    configPath = args[++i];
  } else if (arg === '--help' || arg === '-h') {
    // handled by usage block below
  } else if (arg.startsWith('--')) {
    console.error(`ERROR: unknown option: ${arg}`);
    process.exit(1);
  } else if (!targetArg) {
    targetArg = arg;
  } else {
    console.error(`ERROR: unexpected extra positional argument: ${arg}`);
    process.exit(1);
  }
}

if (!targetArg || args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: node verify-cv-facts.mjs <generated-cv> [--source path] [--config path]

Checks generated CV text for metric-like claims that are absent from source files.
Default sources: cv.md, article-digest.md
Default config:  config/cv-facts.json (optional)`);
  process.exit(targetArg ? 0 : 1);
}

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf-8') : '';
}

function stripMarkup(text) {
  return text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{([^}]*)\})?/g, ' $1 ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeClaim(claim) {
  return claim.toLowerCase().replace(/[,\s]+/g, ' ').trim();
}

function metricClaims(text) {
  const clean = stripMarkup(text);
  const patterns = [
    /\b\d+(?:\.\d+)?\s?%/g,
    /\b[$€£]\s?\d[\d,.]*(?:\s?[kKmMbB])?/g,
    /\b\d+(?:\.\d+)?\s?x\b/gi,
    /\b\d[\d,.]*\+?\s?(?:users|customers|clients|employees|engineers|teams|companies|hours|days|weeks|months|years|minutes|seconds|requests|tokens|documents|workflows|pipelines|agents|interviews|applications|offers|reports|cvs|resumes)\b/gi,
  ];
  const claims = new Set();
  for (const pattern of patterns) {
    for (const match of clean.matchAll(pattern)) {
      claims.add(normalizeClaim(match[0]));
    }
  }
  return claims;
}

function loadConfig(path) {
  if (!existsSync(path)) return { allow_metrics: [], forbidden_phrases: [] };
  const config = JSON.parse(readFileSync(path, 'utf-8'));
  for (const key of ['allow_metrics', 'forbidden_phrases']) {
    if (config[key] == null) {
      config[key] = [];
    } else if (!Array.isArray(config[key])) {
      throw new Error(`${key} must be an array in ${path}`);
    }
  }
  return config;
}

function resolveInputPath(path) {
  return isAbsolute(path) ? path : join(process.cwd(), path);
}

const targetPath = resolveInputPath(targetArg);
if (!existsSync(targetPath)) {
  console.error(`ERROR: target file not found: ${targetArg}`);
  process.exit(1);
}

const sources = sourceArgs.length > 0 ? sourceArgs : DEFAULT_SOURCES;
const sourceText = sources.map(path => readIfExists(resolveInputPath(path))).join('\n');
const targetText = readFileSync(targetPath, 'utf-8');
let config;
try {
  config = loadConfig(resolveInputPath(configPath));
} catch (err) {
  console.error(`ERROR: invalid config: ${err.message}`);
  process.exit(1);
}

const allowed = new Set([
  ...metricClaims(sourceText),
  ...(config.allow_metrics || []).map(normalizeClaim),
]);
const targetClaims = metricClaims(targetText);
const invented = [...targetClaims].filter(claim => !allowed.has(claim));
const forbidden = (config.forbidden_phrases || [])
  .filter(Boolean)
  .filter(phrase => stripMarkup(targetText).toLowerCase().includes(String(phrase).toLowerCase()));

if (invented.length === 0 && forbidden.length === 0) {
  console.log(`CV fact check passed: ${basename(targetPath)}`);
  process.exit(0);
}

console.error(`CV fact check failed: ${basename(targetPath)}`);
if (invented.length > 0) {
  console.error('\nMetric-like claims absent from sources:');
  for (const claim of invented) console.error(`  - ${claim}`);
}
if (forbidden.length > 0) {
  console.error('\nForbidden phrases found:');
  for (const phrase of forbidden) console.error(`  - ${phrase}`);
}
console.error('\nAdd real evidence to cv.md/article-digest.md, or allow a verified exception in config/cv-facts.json.');
process.exit(1);
