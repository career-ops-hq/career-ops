#!/usr/bin/env node
/**
 * dedupe-pipeline.mjs — Remove duplicate and already-tracked rows from pipeline Pending.
 *
 * Drops:
 *   - duplicate URLs within Pending (keeps first)
 *   - duplicate company+role within Pending (keeps first)
 *   - rows whose URL or company+role already appear in applications.md, scan-history,
 *     or the Processed section of pipeline.md
 *
 *   node dedupe-pipeline.mjs [--dry-run] [--pipeline <path>]
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { flagValue, validateFlags } from './lib/cli-flags.mjs';
import { withPipelineLock } from './pipeline-lock.mjs';
import {
  atomicWriteFile,
  PIPELINE_PATH,
  SCAN_HISTORY_PATH,
  collectSeenUrls,
  collectSeenCompanyRoles,
  buildCompanyCanonicalizer,
  scanHistoryPolicy,
  resolveDedupIncludeLocation,
  normalizeUrlForDedup,
  companyRoleDedupKey,
} from './scan.mjs';
import * as yaml from 'js-yaml';

const CAREER_OPS = getCareerOpsRoot();
const APPLICATIONS_PATH = join(CAREER_OPS, 'data/applications.md');
const PORTALS_PATH = process.env.CAREER_OPS_PORTALS || join(CAREER_OPS, 'portals.yml');

const KNOWN_FLAGS = ['--dry-run', '--pipeline', '--help', '-h'];
const VALUE_FLAGS = ['--pipeline'];
const USAGE = `Usage: node dedupe-pipeline.mjs [--dry-run] [--pipeline <path>]`;

const args = process.argv.slice(2);
validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

const DRY_RUN = args.includes('--dry-run');
const pipelinePath = flagValue(args, '--pipeline') || PIPELINE_PATH;

const PENDING_RE = /^##\s+(Pendientes|Pending)\s*$/i;
const PROCESSED_RE = /^##\s+(Procesadas|Processed)\s*$/i;
const SECTION_RE = /^##\s+/;
const PENDING_ITEM_RE = /^- \[ \]\s+/;
const PIPELINE_URL_RE = /https?:\/\/[^\s|]+/;

function loadPortalsConfig() {
  if (!existsSync(PORTALS_PATH)) return {};
  try {
    const raw = yaml.load(readFileSync(PORTALS_PATH, 'utf-8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function lineUrl(body) {
  const match = body.match(PIPELINE_URL_RE);
  if (match) return match[0];
  const i = body.indexOf(' |');
  const raw = (i >= 0 ? body.slice(0, i) : body).trim();
  return /^https?:\/\//i.test(raw) ? raw : raw.startsWith('local:') ? raw : '';
}

function lineCompanyRole(body) {
  const parts = body.split('|').map((s) => s.trim());
  const urlIdx = parts.findIndex((p) => PIPELINE_URL_RE.test(p) || /^local:jds\//i.test(p));
  if (urlIdx < 0) return { company: '', role: '', location: '' };
  const company = parts[urlIdx + 1] || '';
  const role = parts[urlIdx + 2] || '';
  const third = parts[urlIdx + 3] || '';
  const location = /^(posted|trust|note|rank):/i.test(third) ? '' : third;
  return { company, role, location };
}

function sectionEnd(lines, start) {
  for (let i = start + 1; i < lines.length; i++) {
    if (SECTION_RE.test(lines[i])) return i;
  }
  return lines.length;
}

function splitSections(text) {
  const lines = text.split(/\r?\n/);
  let pendStart = -1;
  let procStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (pendStart < 0 && PENDING_RE.test(lines[i])) pendStart = i;
    else if (procStart < 0 && PROCESSED_RE.test(lines[i])) procStart = i;
  }
  const pendEnd = pendStart >= 0 ? sectionEnd(lines, pendStart) : -1;
  const procEnd = procStart >= 0 ? sectionEnd(lines, procStart) : -1;
  const processedText = procStart >= 0 ? lines.slice(procStart, procEnd).join('\n') : '';
  return { lines, pendStart, pendEnd, procStart, procEnd, processedText };
}

function loadBaselineSeen(processedText) {
  const config = loadPortalsConfig();
  const canonicalizeCompany = buildCompanyCanonicalizer(config.company_aliases);
  const dedupIncludeLocation = resolveDedupIncludeLocation(config);
  const historyPolicy = scanHistoryPolicy(config);
  const scanHistoryText = existsSync(SCAN_HISTORY_PATH) ? readFileSync(SCAN_HISTORY_PATH, 'utf-8') : '';
  const applicationsText = existsSync(APPLICATIONS_PATH) ? readFileSync(APPLICATIONS_PATH, 'utf-8') : '';
  const { seen } = collectSeenUrls({ scanHistoryText, applicationsText, pipelineText: processedText }, historyPolicy);
  const seenCompanyRoles = collectSeenCompanyRoles(
    { applicationsText, scanHistoryText, pipelineText: processedText },
    historyPolicy,
    canonicalizeCompany,
    { includeLocation: dedupIncludeLocation },
  );
  const seenCompanyRoleBases = new Set();
  collectSeenCompanyRoles(
    { applicationsText, scanHistoryText, pipelineText: processedText },
    historyPolicy,
    canonicalizeCompany,
    { includeLocation: dedupIncludeLocation, locatedBases: seenCompanyRoleBases },
  );
  return { seenUrls: seen, seenCompanyRoles, seenCompanyRoleBases, canonicalizeCompany, dedupIncludeLocation };
}

function markSeen(url, company, role, location, seenUrls, seenCompanyRoles, seenCompanyRoleBases, canonicalizeCompany, dedupIncludeLocation) {
  if (url) {
    const key = normalizeUrlForDedup(url);
    if (key) seenUrls.add(key);
  }
  if (company && role) {
    const baseKey = companyRoleDedupKey(company, role, canonicalizeCompany);
    const roleKey = dedupIncludeLocation
      ? companyRoleDedupKey(company, role, canonicalizeCompany, location)
      : baseKey;
    seenCompanyRoles.add(roleKey);
    if (roleKey !== baseKey) seenCompanyRoleBases.add(baseKey);
  }
}

async function main() {
  if (!existsSync(pipelinePath)) {
    console.error(`No pipeline at ${pipelinePath}`);
    process.exit(1);
  }

  await withPipelineLock(pipelinePath, async () => {
    const text = readFileSync(pipelinePath, 'utf-8');
    const { lines, pendStart, pendEnd, processedText } = splitSections(text);
    if (pendStart < 0 || pendEnd < 0) {
      console.log('No Pending section — nothing to dedupe.');
      return;
    }

    const {
      seenUrls,
      seenCompanyRoles,
      seenCompanyRoleBases,
      canonicalizeCompany,
      dedupIncludeLocation,
    } = loadBaselineSeen(processedText);

    const baselineUrls = new Set(seenUrls);
    const baselineRoles = new Set(seenCompanyRoles);
    const baselineRoleBases = new Set(seenCompanyRoleBases);
    const removeIdx = new Set();
    const stats = { urlDup: 0, roleDup: 0, trackedUrl: 0, trackedRole: 0 };

    for (let i = pendStart + 1; i < pendEnd; i++) {
      if (!PENDING_ITEM_RE.test(lines[i])) continue;
      const body = lines[i].replace(PENDING_ITEM_RE, '');
      const url = lineUrl(body);
      const { company, role, location } = lineCompanyRole(body);
      const dedupUrl = url ? normalizeUrlForDedup(url) : '';
      const baseKey = company && role ? companyRoleDedupKey(company, role, canonicalizeCompany) : '';
      const roleKey = company && role
        ? (dedupIncludeLocation
          ? companyRoleDedupKey(company, role, canonicalizeCompany, location)
          : baseKey)
        : '';

      if (dedupUrl && baselineUrls.has(dedupUrl)) {
        removeIdx.add(i);
        stats.trackedUrl++;
        continue;
      }
      if (
        baseKey && (
          baselineRoles.has(roleKey) ||
          baselineRoles.has(baseKey) ||
          (roleKey === baseKey && baselineRoleBases.has(baseKey))
        )
      ) {
        removeIdx.add(i);
        stats.trackedRole++;
        continue;
      }
      if (dedupUrl && seenUrls.has(dedupUrl)) {
        removeIdx.add(i);
        stats.urlDup++;
        continue;
      }
      if (
        baseKey && (
          seenCompanyRoles.has(roleKey) ||
          seenCompanyRoles.has(baseKey) ||
          (roleKey === baseKey && seenCompanyRoleBases.has(baseKey))
        )
      ) {
        removeIdx.add(i);
        stats.roleDup++;
        continue;
      }
      markSeen(url, company, role, location, seenUrls, seenCompanyRoles, seenCompanyRoleBases, canonicalizeCompany, dedupIncludeLocation);
    }

    if (removeIdx.size === 0) {
      console.log('Pending inbox is clean — no duplicates removed.');
      return;
    }

    const kept = lines.filter((_, idx) => !removeIdx.has(idx));
    const out = kept.join('\n');
    if (!DRY_RUN) atomicWriteFile(pipelinePath, out.endsWith('\n') ? out : out + '\n');

    console.log(`${DRY_RUN ? '(dry-run) Would remove' : 'Removed'} ${removeIdx.size} Pending row(s):`);
    console.log(`  ${stats.urlDup} duplicate URL(s) within inbox`);
    console.log(`  ${stats.roleDup} duplicate company+role within inbox`);
    console.log(`  ${stats.trackedUrl} URL(s) already tracked/processed`);
    console.log(`  ${stats.trackedRole} company+role already in tracker/processed`);
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
