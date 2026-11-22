// tests/employers-registry-helpers.mjs: what the employer registry suites share.
//
// The registry tests are four files, not one: each copies the real registry
// (employers/) into a scratch checkout per scenario, so a single file's run
// time grew with the registry until it outran test-all's per-suite budget on
// Windows CI (#7561). Each file now gets that budget of its own:
//   employers-registry.test.mjs             the real registry, the garbage
//                                           fixture, schema.json, Actions output
//   employers-registry-pr.test.mjs          --base rules, the size warning,
//                                           the CHANGELOG, the CLI
//   employers-registry-subdomain.test.mjs   Zoho Recruit and the subdomain ATS
//   employers-registry-own-domain.test.mjs  careers sites on a company's own domain
//
// Importing this module makes one scratch copy of the registry (COMMITTED) and
// removes it when the process exits.

import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, unlistedEmployerBoard, unusedEmployerContributionDay } from './helpers.mjs';
import { buildBoardUrl } from '../lib/ats-board-url.mjs';
import { compareRows } from '../seeds/employers-validate.mjs';

import greenhouse from '../providers/greenhouse.mjs';
import ashby from '../providers/ashby.mjs';
import lever from '../providers/lever.mjs';
import workable from '../providers/workable.mjs';
import smartrecruiters from '../providers/smartrecruiters.mjs';
import rippling from '../providers/rippling.mjs';
import joinProvider from '../providers/join.mjs';
import recruitee from '../providers/recruitee.mjs';
import breezy from '../providers/breezy.mjs';
import bamboohr from '../providers/bamboohr.mjs';
import pinpoint from '../providers/pinpoint.mjs';
import workday from '../providers/workday.mjs';
import applicantpro from '../providers/applicantpro.mjs';
import hibob from '../providers/hibob.mjs';
import hirehive from '../providers/hirehive.mjs';
import homerun from '../providers/homerun.mjs';
import jazzhr from '../providers/jazzhr.mjs';
import keka from '../providers/keka.mjs';
import personio from '../providers/personio.mjs';
import prevueaps from '../providers/prevueaps.mjs';
import schoolspring from '../providers/schoolspring.mjs';
import taleez from '../providers/taleez.mjs';
import teamtailor from '../providers/teamtailor.mjs';
import trakstar from '../providers/trakstar.mjs';
import turbohire from '../providers/turbohire.mjs';
import zohoRecruit from '../providers/zoho-recruit.mjs';
import avature from '../providers/avature.mjs';
import clearcompany from '../providers/clearcompany.mjs';
import jobvite from '../providers/jobvite.mjs';
import eightfold from '../providers/eightfold.mjs';
import adpMyjobs from '../providers/adp-myjobs.mjs';
import successfactorsClassic from '../providers/successfactors-classic.mjs';
import oraclecloud from '../providers/oraclecloud.mjs';
import phenom from '../providers/phenom.mjs';
import successfactors from '../providers/successfactors.mjs';
import peoplesoft from '../providers/peoplesoft.mjs';

export const PROVIDERS = {
  greenhouse, ashby, lever, workable, smartrecruiters, rippling, join: joinProvider,
  recruitee, breezy, bamboohr, pinpoint, applicantpro, hibob, hirehive, homerun, jazzhr, keka, personio,
  prevueaps, schoolspring, taleez, teamtailor, trakstar, turbohire, 'zoho-recruit': zohoRecruit, avature, clearcompany, jobvite, eightfold, 'adp-myjobs': adpMyjobs, 'successfactors-classic': successfactorsClassic, oraclecloud, phenom, successfactors, peoplesoft, workday,
};

const VALIDATOR = join(ROOT, 'seeds', 'employers-validate.mjs');
export const REGISTRY = join(ROOT, 'employers');
export const GARBAGE = join(ROOT, 'tests', 'fixtures', 'employers-garbage');

// The suite itself runs in GitHub Actions, so the validator's environment is
// set explicitly: plain output unless a case asks for the Actions one.
const { GITHUB_ACTIONS: _ga, GITHUB_STEP_SUMMARY: _gss, ...PLAIN_ENV } = process.env;
export const run = (cwd, args = [], env = {}) => spawnSync(process.execPath, [VALIDATOR, ...args], { cwd, encoding: 'utf8', env: { ...PLAIN_ENV, ...env } });

/** Every row in a registry directory, parsed. */
export function rowsOf(dir) {
  const out = [];
  for (const ats of readdirSync(join(dir, 'boards'))) {
    for (const f of readdirSync(join(dir, 'boards', ats))) {
      for (const line of readFileSync(join(dir, 'boards', ats, f), 'utf8').split('\n').filter(Boolean)) {
        out.push({ file: `${ats}/${f}`, row: JSON.parse(line) });
      }
    }
  }
  return out;
}

/**
 * A scratch checkout holding a copy of the real registry, without its inbox.
 * A pull request may add a file to employers/inbox/, and a board of it that the
 * registry already lists is a warning, not an error: the fold skips it. So the
 * tests of the registry read a copy without the inbox; the inbox has its own
 * tests, and one test in employers-registry.test.mjs runs the validator on the
 * tree as it is.
 */
const notTheInbox = (src) => relative(REGISTRY, src).split(sep)[0] !== 'inbox';
export function checkout() {
  const dir = mkdtempSync(join(tmpdir(), 'co-employers-'));
  cpSync(REGISTRY, join(dir, 'employers'), { recursive: true, filter: notTheInbox });
  return dir;
}
/** The committed registry, without its inbox: what the registry suites call "the registry". */
export const COMMITTED = checkout();
process.on('exit', () => rmSync(COMMITTED, { recursive: true, force: true }));
export const reg = (dir, ...p) => join(dir, 'employers', ...p);
export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
export const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

/** Replace one row (found by careers_url) in a registry copy. */
export function editRow(dir, careersUrl, edit) {
  const hit = rowsOf(reg(dir)).find((r) => r.row.careers_url === careersUrl);
  assert.ok(hit, `row ${careersUrl} not found`);
  const path = reg(dir, 'boards', hit.file);
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => {
    const row = JSON.parse(l);
    if (row.careers_url !== careersUrl) return l;
    const next = edit(row);
    return next === null ? null : JSON.stringify(next);
  }).filter((l) => l !== null);
  writeFileSync(path, lines.length ? `${lines.join('\n')}\n` : '');
}

// A pull request's new contribution: one manifest and the rows it adds.
export const NEW_DAY = unusedEmployerContributionDay();
export const NEW_MANIFEST = {
  id: `${NEW_DAY}-newcomer`, contributor: 'newcomer', signed_by: 'New Comer', rows: 1, source: 'community',
  origin: 'Typed in by hand from the employer careers page.', no_conflicting_contract: true, personal_data: false,
  exclusive: false, license: 'CC-BY-4.0', also_permits: ['ODbL-1.0', 'CC0-1.0'], attribution: 'Newcomer', date: NEW_DAY,
};
export const NEW_BOARD = unlistedEmployerBoard('breezy', 'fixture-co');
export const NEW_ROW = {
  ats: 'breezy', board: NEW_BOARD, careers_url: buildBoardUrl({ ats: 'breezy', board: NEW_BOARD }), name: 'Fixture Co',
  source: 'community', contribution: NEW_MANIFEST.id, added: NEW_DAY,
};
/** Insert a row into its board file in a registry copy, keeping the rows already there. */
export function insertRow(dir, row) {
  mkdirSync(reg(dir, 'boards', row.ats), { recursive: true });
  const path = reg(dir, 'boards', row.ats, `${row.board[0].toLowerCase()}.ndjson`);
  const rows = existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  writeFileSync(path, `${[...rows, row].sort(compareRows).map((r) => JSON.stringify(r)).join('\n')}\n`);
}

/** Run one PR scenario: base is the real registry, head is a copy changed by `change`. */
export function pr(change) {
  const head = checkout();
  try {
    change(head);
    return run(head, ['--base', COMMITTED]);
  } finally {
    rmSync(head, { recursive: true, force: true });
  }
}

/** Add rows under the new manifest, each into its board file next to the rows already there. */
export function addRows(dir, rows) {
  const path = reg(dir, 'contributions', `${NEW_MANIFEST.id}.json`);
  const before = existsSync(path) ? readJson(path).rows : 0;
  writeJson(path, { ...NEW_MANIFEST, rows: before + rows.length });
  for (const r of rows) {
    insertRow(dir, { ...r, careers_url: r.careers_url ?? buildBoardUrl(r), name: 'Fixture Co', source: 'community', contribution: NEW_MANIFEST.id, added: NEW_DAY });
  }
}
