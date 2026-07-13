#!/usr/bin/env node
/**
 * archive-posting.mjs — Save a live job posting as PDF before it disappears.
 *
 * Job postings vanish after they're filled, reposted, or companies reorganise.
 * This captures the fully-rendered page via Playwright so you always have the
 * original requirements for interview prep and salary negotiation evidence.
 *
 * Usage:
 *   node archive-posting.mjs <url>
 *   node archive-posting.mjs <url> --company=Anthropic --role=senior-ai-engineer
 *   node archive-posting.mjs --pipeline          Archive pending URLs in data/pipeline.md
 *   node archive-posting.mjs --dry-run <url>     Preview filename without saving
 *
 * Output:    jds/YYYY-MM-DD_company-slug_role-slug.pdf
 * Reference: local:jds/YYYY-MM-DD_company-slug_role-slug.pdf  (paste into pipeline.md)
 */

import { chromium } from 'playwright';
import { writeFile, readFile } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const JDS_DIR = join(ROOT, 'jds');
const PIPELINE_PATH = join(ROOT, 'data', 'pipeline.md');

// ── CLI parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║           career-ops — Job Posting Archiver                     ║
╚══════════════════════════════════════════════════════════════════╝

  Save a live job posting as PDF before it disappears.

  USAGE
    node archive-posting.mjs <url>
    node archive-posting.mjs <url> --company=Anthropic --role=senior-ai-engineer
    node archive-posting.mjs --pipeline     Archive all pending URLs in data/pipeline.md
    node archive-posting.mjs --dry-run <url>

  OPTIONS
    --company <name>   Override auto-detected company name
    --role <title>     Override auto-detected role title
    --pipeline         Archive all pending (- [ ]) entries in data/pipeline.md
    --dry-run          Preview filename without saving
    --help             Show this help

  OUTPUT
    jds/YYYY-MM-DD_company-slug_role-slug.pdf

  PIPELINE REFERENCE (paste into pipeline.md or reports/)
    local:jds/YYYY-MM-DD_company-slug_role-slug.pdf

  EXAMPLES
    node archive-posting.mjs "https://jobs.ashbyhq.com/anthropic/abc123"
    node archive-posting.mjs "https://boards.greenhouse.io/openai/jobs/456" --company=OpenAI
    node archive-posting.mjs --pipeline
    npm run archive -- "https://jobs.lever.co/elevenlabs/abc"
`);
  process.exit(0);
}

let targetUrl = null;
let overrideCompany = null;
let overrideRole = null;
let pipelineMode = false;
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--pipeline') {
    pipelineMode = true;
  } else if (arg === '--dry-run') {
    dryRun = true;
  } else if (arg.startsWith('--company=')) {
    overrideCompany = arg.slice('--company='.length).trim();
  } else if (arg === '--company' && args[i + 1]) {
    overrideCompany = args[++i].trim();
  } else if (arg.startsWith('--role=')) {
    overrideRole = arg.slice('--role='.length).trim();
  } else if (arg === '--role' && args[i + 1]) {
    overrideRole = args[++i].trim();
  } else if (!arg.startsWith('--') && !targetUrl) {
    targetUrl = arg;
  }
}

if (!pipelineMode && !targetUrl) {
  console.error('No URL provided. Run with --help for usage.');
  process.exit(1);
}

// ── Utilities ────────────────────────────────────────────────────────────────

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function today() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Try to extract company/role from the rendered page title.
 * Handles common ATS patterns:
 *   "Senior AI Engineer at Anthropic"   → role + company
 *   "Anthropic | Senior AI Engineer"    → company + role
 *   "Senior AI Engineer - Anthropic"    → role + company
 */
function parsePageTitle(title) {
  if (!title) return { company: null, role: null };

  // Strip common ATS platform suffixes
  const cleaned = title
    .replace(/\s*[|–-]\s*(greenhouse|lever|ashby|workday|linkedin|indeed|wellfound|angellist)\s*$/i, '')
    .trim();

  // "Role at Company"
  const atMatch = cleaned.match(/^(.+?)\s+at\s+(.+)$/i);
  if (atMatch) return { role: atMatch[1].trim(), company: atMatch[2].trim() };

  // "Company | Role" or "Company – Role"
  const pipeMatch = cleaned.match(/^([^|–]+?)\s*[|–]\s*(.+)$/);
  if (pipeMatch) {
    const left = pipeMatch[1].trim();
    const right = pipeMatch[2].trim();
    const roleKeywords = /engineer|manager|director|analyst|scientist|designer|developer|lead|head|vp|president|officer|specialist|architect/i;
    if (roleKeywords.test(right)) return { company: left, role: right };
    if (roleKeywords.test(left)) return { role: left, company: right };
    return { company: left, role: right };
  }

  // "Role - Company"
  const dashMatch = cleaned.match(/^(.+?)\s+-\s+(.+)$/);
  if (dashMatch) return { role: dashMatch[1].trim(), company: dashMatch[2].trim() };

  return { company: null, role: cleaned };
}

/**
 * Extract company from known ATS URL patterns as a fallback when the page
 * title doesn't yield a clear company name.
 */
function extractCompanyFromUrl(url) {
  try {
    const { hostname, pathname } = new URL(url);
    const parts = pathname.split('/').filter(Boolean);
    if (hostname === 'boards.greenhouse.io') return parts[0] || null;
    if (/^jobs\.(eu\.)?lever\.co$/.test(hostname)) return parts[0] || null;
    if (hostname === 'jobs.ashbyhq.com') return parts[0] || null;
    if (hostname === 'app.dover.io') return parts[0] || null;
    return null;
  } catch {
    return null;
  }
}

// ── Pipeline URL extraction ──────────────────────────────────────────────────

/**
 * Parse data/pipeline.md and return pending entries.
 * Handles both plain and annotated forms:
 *   - [ ] https://example.com/job/123
 *   - [ ] https://example.com/job/456 | Acme Corp | Senior PM
 */
async function extractPipelineEntries() {
  if (!existsSync(PIPELINE_PATH)) {
    console.error('data/pipeline.md not found. Add URLs there first.');
    process.exit(1);
  }

  const content = await readFile(PIPELINE_PATH, 'utf-8');
  const entries = [];

  for (const line of content.split('\n')) {
    if (!line.startsWith('- [ ]')) continue;

    const urlMatch = line.match(/https?:\/\/[^\s|)]+/);
    if (!urlMatch) continue;

    const url = urlMatch[0];
    const parts = line.split('|').map(s => s.trim());
    const company = parts[1] || null;
    const role = parts[2] || null;

    entries.push({ url, company, role });
  }

  return entries;
}

// ── Core archive function ────────────────────────────────────────────────────

async function archiveUrl(browser, url, { company: companyHint, role: roleHint } = {}) {
  console.log(`\n🔗  ${url}`);

  const page = await browser.newPage();

  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const httpStatus = response?.status() ?? 0;

    // Give SPAs (Ashby, Lever, Workday) time to hydrate
    await page.waitForTimeout(2000);

    const pageTitle = await page.title();
    const h1Text = await page.$eval('h1', el => el.innerText.trim()).catch(() => '');
    const urlCompany = extractCompanyFromUrl(url);

    // Parse page title first — it usually has "Role | Company" or "Company | Role".
    // Fall back to h1 for the role when the page title doesn't yield one cleanly.
    const detected = parsePageTitle(pageTitle);
    const resolvedCompany = overrideCompany || companyHint || detected.company || urlCompany || 'unknown';
    const resolvedRole = overrideRole || roleHint || detected.role || h1Text || 'job';

    // Strip noisy prefixes common on Greenhouse/Lever ("Job Application for …")
    const company = resolvedCompany.replace(/^job\s+application\s+for\s+/i, '').trim();
    const role = resolvedRole.replace(/^job\s+application\s+for\s+/i, '').trim();

    console.log(`   Company: ${company}`);
    console.log(`   Role:    ${role}`);
    if (httpStatus && httpStatus >= 400) {
      console.log(`HTTP ${httpStatus} — page may be closed, archiving anyway`);
    }

    const filename = `${today()}_${slugify(company)}_${slugify(role)}.pdf`;
    const outputPath = join(JDS_DIR, filename);
    const reference = `local:jds/${filename}`;

    console.log(`   Output:  jds/${filename}`);

    mkdirSync(JDS_DIR, { recursive: true });

    const pdfBuffer = await page.pdf({
      format: 'a4',
      printBackground: true,
      margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
      preferCSSPageSize: false,
    });

    await writeFile(outputPath, pdfBuffer);

    const sizeKb = (pdfBuffer.length / 1024).toFixed(1);
    console.log(`Saved (${sizeKb} KB)`);
    console.log(`Reference: ${reference}`);

    return { filename, reference, url, size: pdfBuffer.length };

  } finally {
    await page.close();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Build the list of targets upfront
  let targets;
  if (pipelineMode) {
    const entries = await extractPipelineEntries();
    if (entries.length === 0) {
      console.log('No pending (- [ ]) URLs found in data/pipeline.md.');
      return;
    }
    targets = entries;
  } else {
    targets = [{ url: targetUrl, company: null, role: null }];
  }

  if (dryRun) console.log('🔍  Dry-run mode — no files will be saved.\n');

  console.log(`Archiving ${targets.length} posting(s) to jds/`);

  const results = [];
  let failed = 0;

  if (dryRun) {
    // Dry-run: no browser needed — use URL-based detection only
    for (const { url, company, role } of targets) {
      const urlCompany = extractCompanyFromUrl(url);
      const resolvedCompany = overrideCompany || company || urlCompany || 'unknown';
      const resolvedRole = overrideRole || role || 'job';
      const filename = `${today()}_${slugify(resolvedCompany)}_${slugify(resolvedRole)}.pdf`;
      const reference = `local:jds/${filename}`;
      console.log(`\n🔗  ${url}`);
      console.log(`   Company: ${resolvedCompany}`);
      console.log(`   Role:    ${resolvedRole}`);
      console.log(`   Output:  jds/${filename}`);
      console.log('   (dry-run — not saved)');
      results.push({ url, filename, reference, skipped: true });
    }
  } else {
    // Sequential — project convention: never Playwright in parallel
    const browser = await chromium.launch({ headless: true });
    try {
      for (const { url, company, role } of targets) {
        try {
          const result = await archiveUrl(browser, url, { company, role });
          results.push(result);
        } catch (err) {
          console.error(`   ❌  Failed: ${err.message.split('\n')[0]}`);
          results.push({ url, error: err.message });
          failed++;
        }
      }
    } finally {
      await browser.close();
    }
  }

  // Summary
  const saved = results.filter(r => !r.error && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;

  console.log('\n' + '─'.repeat(62));
  if (dryRun) {
    console.log(`  Dry-run: ${skipped} file(s) would be saved to jds/`);
  } else {
    console.log(`  Archived: ${saved} saved  ${failed} failed`);
  }

  const references = results.filter(r => r.reference);
  if (references.length > 0) {
    console.log('\n  References (paste into pipeline.md or a report header):');
    for (const r of references) {
      console.log(`    ${r.reference}`);
    }
  }
  console.log('─'.repeat(62) + '\n');

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('❌  Fatal:', err.message);
  process.exit(1);
});
