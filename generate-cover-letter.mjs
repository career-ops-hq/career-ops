#!/usr/bin/env node
/**
 * generate-cover-letter.mjs — Renders a cover letter payload to PDF.
 *
 * Usage:
 *   node generate-cover-letter.mjs --payload payload.json
 *   node generate-cover-letter.mjs --payload payload.json --out output/slug-cover.pdf
 *
 * Fills templates/cover-letter-template.html with the payload, then renders
 * it to PDF via the same Playwright pipeline used for CVs (generate-pdf.mjs).
 */

import { readFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve, basename, join } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";
import { renderHtmlToPdf } from "./generate-pdf.mjs";

const { values: args } = parseArgs({
  options: {
    payload: { type: "string" },
    out:     { type: "string" },
    help:    { type: "boolean", short: "h" },
  },
  strict: false,
});

if (args.help || !args.payload) {
  console.log(`
Usage:
  node generate-cover-letter.mjs --payload payload.json [--out output/path.pdf]

  --payload   Path to the JSON payload file (required)
  --out       Override output path from payload (optional)
`);
  process.exit(args.help ? 0 : 1);
}

const payloadPath = resolve(args.payload);
if (!existsSync(payloadPath)) {
  console.error(`ERROR: payload file not found: ${payloadPath}`);
  process.exit(1);
}

const payload = JSON.parse(readFileSync(payloadPath, "utf-8"));

if (args.out) {
  payload.output_path = args.out;
}

const OUTPUT_ROOT = resolve("output");

function safeOutputPath(raw) {
  // Derive a sanitized filename from raw string (strip path separators and dots)
  const filename = basename(raw).replace(/[^a-zA-Z0-9._-]/g, "-").replace(/\.{2,}/g, "-");
  return join(OUTPUT_ROOT, filename);
}

if (!payload.output_path) {
  const company = (payload.letter?.company || "company").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const role    = (payload.letter?.role_title || "role").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);
  payload.output_path = join(OUTPUT_ROOT, `${company}-${role}-cover.pdf`);
} else {
  payload.output_path = safeOutputPath(payload.output_path);
}

if (!existsSync(OUTPUT_ROOT)) mkdirSync(OUTPUT_ROOT, { recursive: true });

function _require(obj, keys, context) {
  for (const key of keys) {
    if (!obj || typeof obj !== "object" || !(key in obj)) {
      throw new Error(`Missing required field: ${context}.${key}`);
    }
  }
}

function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function asUrl(value) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function buildContactLine(candidate) {
  const parts = [];
  if (candidate.location) parts.push(escapeHtml(candidate.location));
  if (candidate.email) {
    const email = escapeHtml(candidate.email);
    parts.push(`<a href="mailto:${email}">${email}</a>`);
  }
  if (candidate.phone) parts.push(escapeHtml(candidate.phone));
  if (candidate.linkedin) {
    parts.push(`<a href="${escapeHtml(asUrl(candidate.linkedin))}">LinkedIn</a>`);
  }
  if (candidate.github) {
    const display = candidate.github.replace(/^https?:\/\//, "");
    parts.push(`<a href="${escapeHtml(asUrl(candidate.github))}">${escapeHtml(display)}</a>`);
  }
  return parts.join(" &nbsp;|&nbsp; ");
}

function buildCredentialsBlock(candidate) {
  const credentials = candidate.credentials || [];
  if (!credentials.length) return "";
  return `<div class="credentials">${credentials.map(escapeHtml).join(" &nbsp;|&nbsp; ")}</div>`;
}

function buildDateline(letter) {
  const parts = [letter.company, letter.city, letter.date].filter(Boolean).map(escapeHtml);
  return parts.join(" &nbsp;&nbsp; ");
}

function buildAchievementsBlock(achievements) {
  if (!achievements || !achievements.length) return "";
  const items = achievements.map(ach => {
    const lead = escapeHtml(ach.lead || "");
    const impact = escapeHtml(ach.impact || "");
    return `    <li><b>${lead},</b> ${impact}</li>`;
  }).join("\n");
  return `<ul class="achievements">\n${items}\n  </ul>`;
}

function buildFootnotesBlock(footnotes) {
  if (!footnotes || !footnotes.length) return "";
  const lines = footnotes.map(fn => {
    if (typeof fn === "object" && fn !== null) {
      const marker = escapeHtml(fn.marker || "");
      const text = escapeHtml(fn.text || "");
      const url = fn.url
        ? ` <a href="${escapeHtml(fn.url)}">${escapeHtml(fn.url)}</a>`
        : "";
      return `    <p>${marker} ${text}${url}</p>`;
    }
    return `    <p>${escapeHtml(fn)}</p>`;
  }).join("\n");
  return `<div class="footnotes">\n${lines}\n  </div>`;
}

function buildHtml(payload) {
  _require(payload, ["candidate", "letter"], "payload");
  const candidate = payload.candidate;
  const letter = payload.letter;
  _require(candidate, ["name"], "candidate");
  _require(letter, ["role_title", "opening", "profile_intro"], "letter");

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const templatePath = resolve(scriptDir, "templates", "cover-letter-template.html");
  let html = readFileSync(templatePath, "utf-8");

  const closingBlock = letter.closing ? `<p>${escapeHtml(letter.closing)}</p>` : "";
  const languageClosingBlock = letter.language_closing
    ? `<p class="language-closing">${escapeHtml(letter.language_closing)}</p>`
    : "";
  const problemsBlock = letter.problems_section ? `<p>${escapeHtml(letter.problems_section)}</p>` : "";

  const replacements = {
    "{{NAME}}": escapeHtml(candidate.name),
    "{{CONTACT_LINE}}": buildContactLine(candidate),
    "{{CREDENTIALS_BLOCK}}": buildCredentialsBlock(candidate),
    "{{ROLE_TITLE}}": escapeHtml(letter.role_title),
    "{{DATELINE}}": buildDateline(letter),
    "{{OPENING}}": escapeHtml(letter.opening),
    "{{PROFILE_INTRO}}": escapeHtml(letter.profile_intro),
    "{{ACHIEVEMENTS_BLOCK}}": buildAchievementsBlock(letter.achievements),
    "{{PROBLEMS_BLOCK}}": problemsBlock,
    "{{CLOSING_BLOCK}}": closingBlock,
    "{{LANGUAGE_CLOSING_BLOCK}}": languageClosingBlock,
    "{{FOOTNOTES_BLOCK}}": buildFootnotesBlock(letter.footnotes),
  };

  for (const [token, value] of Object.entries(replacements)) {
    html = html.split(token).join(value);
  }

  return html;
}

try {
  const html = buildHtml(payload);
  const outputPath = resolve(payload.output_path);
  await renderHtmlToPdf(html, outputPath, { format: "a4" });
  console.log(`\nCover letter PDF: ${payload.output_path}`);
} catch (err) {
  console.error("ERROR generating cover letter PDF:");
  console.error(err.message);
  process.exit(1);
}
