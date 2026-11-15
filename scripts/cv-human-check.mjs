#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BANNED_WORDS = [
  'spearheaded', 'orchestrated', 'leveraged', 'streamlined', 'synergized',
  'championed', 'pioneered', 'holistic', 'robust', 'cutting-edge',
  'best-in-class', 'results-driven', 'passionate', 'elevated', 'fostered',
  'delve', 'tapestry', 'testament', 'seamlessly',
];

const BANNED_REGEX = new RegExp(`\\b(${BANNED_WORDS.join('|')})\\b`, 'gi');
const CONNECTOR_REGEX = /\b(resulting in|thereby|by utilizing|by leveraging|enabling seamless)\b/i;
const VERB_ED_BULLET_REGEX = /^[-*]\s+[A-Z][a-z]+ed\b/;

/**
 * Reduces Markdown or HTML to the text a reader sees, one item per line.
 * <style>, <script> and comments are dropped first: the CV template's CSS
 * comments carry em-dashes that are not CV text. <li> becomes "- " so HTML
 * bullets are read the same way as Markdown bullets.
 * @param {string} raw
 * @returns {string}
 */
function visibleText(raw) {
  return raw
    .replace(/<style\b[\s\S]*?<\/style[^>]*>/gi, ' ')
    .replace(/<script\b[\s\S]*?<\/script[^>]*>/gi, ' ')
    .replace(/<!--[\s\S]*?--!?>/g, ' ')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ');
}

/**
 * Checks a tailored CV (Markdown or HTML) for common AI-writing tells.
 * @param {string} raw
 * @returns {{ passed: boolean, warnings: string[] }}
 */
export function checkCvHumanTone(raw) {
  const text = visibleText(raw);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const warnings = [];

  lines.forEach((line, idx) => {
    const hits = line.match(BANNED_REGEX);
    if (hits) {
      const unique = [...new Set(hits.map((h) => h.toLowerCase()))];
      warnings.push(`Line ${idx + 1}: banned phrasing [${unique.join(', ')}]`);
    }
  });

  const emDashes = (text.match(/—/g) || []).length;
  if (emDashes > 1) {
    warnings.push(`Em-dash count is ${emDashes} (max 1 recommended).`);
  }

  const connectorHits = lines.filter((l) => CONNECTOR_REGEX.test(l));
  if (connectorHits.length > 0) {
    warnings.push(`Found ${connectorHits.length} template connector(s) ("resulting in", "thereby", etc.).`);
  }

  let streak = 0;
  for (const line of lines) {
    if (VERB_ED_BULLET_REGEX.test(line)) {
      streak += 1;
      if (streak >= 4) {
        warnings.push('4+ consecutive bullets start with "<Verb>ed ..."; vary bullet structure.');
        break;
      }
    } else if (/^[-*]/.test(line)) {
      streak = 0;
    }
  }

  return { passed: warnings.length === 0, warnings };
}

function main() {
  const args = process.argv.slice(2);
  const jsonFlag = args.includes('--json');
  const filePath = args.find((a) => !a.startsWith('-'));

  if (!filePath) {
    console.error('Usage: node scripts/cv-human-check.mjs <cv.md|cv.html> [--json]');
    process.exit(2);
  }

  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(2);
  }

  const raw = readFileSync(filePath, 'utf8');
  const result = checkCvHumanTone(raw);

  if (jsonFlag) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.passed) {
    console.log('CV Human-Check passed.');
  } else {
    console.error('CV Human-Check failed:\n' + result.warnings.map((w) => `  - ${w}`).join('\n'));
  }

  process.exit(result.passed ? 0 : 1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
