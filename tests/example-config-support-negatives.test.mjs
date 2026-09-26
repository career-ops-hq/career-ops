// tests/example-config-support-negatives.test.mjs — the shipped example config
// must reject support-agent roles without rejecting senior roles that merely
// NAME a support organisation.
//
// title_filter negatives are plain substrings, so a domain word used as a
// negative catches every seniority above it too. "Customer Care" blocked
// "AI Agents Manager: Customer Care" — an AI role FOR a support org, not a
// support-agent job — while the support titles it was aimed at ("Customer Care
// Onboarding", "Customer Care Operations") carry no positive keyword and were
// already excluded, so the shorter form cost two verdicts and bought none.
//
// Asserted against the shipped template rather than a literal, because that file
// is what every new install starts from.

import { readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { pass, fail, ROOT } from './helpers.mjs';
import { buildTitleFilter } from '../scan.mjs';

console.log('\nexample config — support negatives name the role, not the domain');

const cfg = yaml.load(readFileSync(join(ROOT, 'templates/portals.example.yml'), 'utf-8'));
const matches = buildTitleFilter(cfg.title_filter);

const mustReject = ['Customer Care Agent', 'Senior Customer Care Agent'];
const leaked = mustReject.filter((t) => matches(t) !== false);
if (leaked.length === 0) {
  pass('the example config still rejects customer-care agent roles');
} else {
  fail(`support-agent titles leaked through: ${JSON.stringify(leaked)}`);
}

// Observed titles, not constructed ones: both appear in a real scan corpus.
const mustKeep = ['AI Agents Manager: Customer Care', 'AI Support Delivery Manager: Customer Care'];
const dropped = mustKeep.filter((t) => matches(t) !== true);
if (dropped.length === 0) {
  pass('a senior AI role naming customer care as its domain is not vetoed');
} else {
  fail(`domain-qualified senior roles rejected: ${JSON.stringify(dropped)}`);
}

// The distinguishing property, stated directly: no negative may be a bare domain
// word that a more senior title would also carry.
const negatives = (cfg.title_filter?.negative || []).filter((k) => typeof k === 'string');
if (!negatives.includes('Customer Care')) {
  pass('the bare domain negative is not present');
} else {
  fail('"Customer Care" is back as a bare negative — it vetoes senior roles in that domain');
}
