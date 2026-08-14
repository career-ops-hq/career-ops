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
 *   node archive-posting.mjs <url> --report=042    Key the capture to report #42
 *   node archive-posting.mjs --pipeline          Archive pending URLs in data/pipeline.md
 *   node archive-posting.mjs --dry-run <url>     Preview filename without saving
 *
 * Output:    jds/YYYY-MM-DD_company-slug_role-slug.pdf
 *            jds/NNN-YYYY-MM-DD_company-slug_role-slug.pdf   (with --report)
 * Reference: local:jds/{filename}  (paste into pipeline.md)
 *
 * Prefer --report. Without it the capture can only be found again by rebuilding
 * its filename from today's date and the scraped company and role, so it stops
 * resolving the next day. outcome.mjs looks captures up by report number.
 */

import { chromium } from 'playwright';
import { writeFile, readFile } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { reportPrefix } from './jd-capture.mjs';
import { rejectPrivateOrInvalid, validateUrlSecurity } from './liveness-browser.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const JDS_DIR = join(ROOT, 'jds');
const PIPELINE_PATH = join(ROOT, 'data', 'pipeline.md');

// ── CLI parsing ──────────────────────────────────────────────────────────────

const HELP_TEXT = `
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
    --report <num>     Key the capture to a report/tracker number (recommended)
    --pipeline         Archive all pending (- [ ]) entries in data/pipeline.md
    --dry-run          Preview filename without saving
    --help             Show this help

  OUTPUT
    jds/YYYY-MM-DD_company-slug_role-slug.pdf
    jds/NNN-YYYY-MM-DD_company-slug_role-slug.pdf     with --report

  WHY --report
    Without it, a capture is only findable by rebuilding its filename from
    today's date and the scraped company and role, so it stops resolving the
    next day. outcome.mjs looks captures up by report number.

  PIPELINE REFERENCE (paste into pipeline.md or reports/)
    local:jds/{filename}

  EXAMPLES
    node archive-posting.mjs "https://jobs.ashbyhq.com/anthropic/abc123"
    node archive-posting.mjs "https://boards.greenhouse.io/openai/jobs/456" --company=OpenAI
    node archive-posting.mjs "https://jobs.lever.co/acme/xyz" --report=42
    node archive-posting.mjs --pipeline
    npm run archive -- "https://jobs.lever.co/elevenlabs/abc"
`;

let targetUrl = null;
let overrideCompany = null;
let overrideRole = null;
let pipelineMode = false;
let dryRun = false;
let reportNum = null;

// Parsing lives in a function, not at module scope, so importing this file for
// its exports doesn't read process.argv or call process.exit — the repo's
// standard direct-run guard at the bottom is what invokes it.
function parseCliArgs(args) {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(HELP_TEXT);
    process.exit(0);
  }

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
    } else if (arg.startsWith('--report=')) {
      reportNum = arg.slice('--report='.length).trim();
    } else if (arg === '--report') {
      // Consume the value explicitly. Left unconsumed it would fall through to the
      // bare-argument branch below and be mistaken for the URL. Consume it even
      // when absent: a trailing `--report` used to be dropped silently, archiving
      // the posting with no report prefix — unfindable, which is the failure this
      // flag exists to prevent. The empty string reaches the validator below and
      // exits non-zero instead.
      reportNum = args[++i]?.trim() ?? '';
    } else if (!arg.startsWith('--') && !targetUrl) {
      targetUrl = arg;
    }
  }

  if (reportNum !== null) {
    if (!/^\d+$/.test(reportNum) || Number(reportNum) <= 0) {
      console.error(`Invalid --report value: "${reportNum}". Expected a positive report number.`);
      process.exit(1);
    }
    if (pipelineMode) {
      console.error('--report applies to a single posting; it cannot be combined with --pipeline.');
      process.exit(1);
    }
  }

  if (!pipelineMode && !targetUrl) {
    console.error('No URL provided. Run with --help for usage.');
    process.exit(1);
  }
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
 * Build the capture filename. With --report the name leads with the zero-padded
 * report number, which is what makes the capture findable later: the date and
 * the scraped company/role all change between runs, the report number does not.
 */
function captureFilename(company, role) {
  const base = `${today()}_${slugify(company)}_${slugify(role)}.pdf`;
  return reportNum ? `${reportPrefix(reportNum)}-${base}` : base;
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

/**
 * Register the egress guard on a Playwright context.
 *
 * Registered on the *context* rather than the page: a route bound to a single
 * page doesn't cover requests the flow makes outside it, and the context is
 * what owns the whole navigation. Both layers of the shared guard run here —
 * the literal-host check first (cheap, no network), then the DNS re-check that
 * catches a public hostname resolving into private space.
 *
 * @param {import('playwright').BrowserContext} context - Context to guard.
 */
export async function installEgressGuard(context) {
  await context.route('**/*', async (route) => {
    const requestUrl = route.request().url();

    const verdict = rejectPrivateOrInvalid(requestUrl);
    if (verdict) {
      console.warn(`   Blocked request to restricted destination: ${requestUrl} (${verdict.reason})`);
      return route.abort('blockedbyclient');
    }

    try {
      await validateUrlSecurity(requestUrl);
      return route.continue();
    } catch (err) {
      console.warn(`   Blocked request to restricted destination (DNS): ${requestUrl} - ${err.message}`);
      return route.abort('blockedbyclient');
    }
  });
}

export async function archiveUrl(browser, url, { company: companyHint, role: roleHint } = {}) {
  console.log(`\n🔗  ${url}`);

  // Refuse before launching any navigation, so an obviously-internal target
  // never reaches Playwright at all.
  const preGuard = rejectPrivateOrInvalid(url);
  if (preGuard) {
    throw new Error(`refusing to archive restricted destination: ${preGuard.reason}`);
  }

  const context = await browser.newContext();
  await installEgressGuard(context);
  const page = await context.newPage();

  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const httpStatus = response?.status() ?? 0;

    // Re-check where we actually landed. The route guard already inspects every
    // redirect hop, so this is defence-in-depth: a first-hop-only check is the
    // classic miss here, and asserting on the settled URL costs nothing.
    const landedUrl = page.url();
    const postGuard = rejectPrivateOrInvalid(landedUrl);
    if (postGuard) {
      throw new Error(`refusing to archive restricted destination after redirect: ${postGuard.reason}`);
    }

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

    const filename = captureFilename(company, role);
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
    await context.close();
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
      const filename = captureFilename(resolvedCompany, resolvedRole);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  parseCliArgs(process.argv.slice(2));
  main().catch(err => {
    console.error('❌  Fatal:', err.message);
    process.exit(1);
  });
}
