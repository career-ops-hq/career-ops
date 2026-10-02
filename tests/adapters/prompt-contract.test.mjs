// Verifies the canonical prompt boundary and its declared command inputs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pass, fail, ROOT } from '../helpers.mjs';

const read = path => readFileSync(join(ROOT, path), 'utf8');
const router = read('.agents/skills/career-ops/SKILL.md');
const manifest = read('rules/CONTEXT_MANIFEST.md');
const contract = read('rules/shared/contract.md');
const required = ['discovery', 'liveness check', 'eligibility check', 'evaluation', 'shortlist', 'application preparation', 'submitted', 'interviewing', 'terminal outcome'];
for (const term of required) (contract.includes(term) ? pass : fail)(term, `contract includes ${term}`);
for (const domain of ['evaluation', 'applications', 'interviews', 'cv', 'insights']) (manifest.includes(domain) ? pass : fail)(domain, `manifest declares ${domain}`);
for (const path of ['article-digest.md', 'modes/_custom.md', 'interview-prep/story-bank.md', 'markets/{cn,hk,remote}/employment.md']) (manifest.includes(path) ? pass : fail)(path, `manifest names ${path}`);
for (const command of ['evaluation', 'applications', 'interviews', 'cv', 'insights']) (router.includes(`\`${command}\``) ? pass : fail)(command, `router selects ${command}`);
(router.includes('-m career_ops') ? pass : fail)('workflow', 'router enters the Python workflow');
(router.includes('Hermes may run') && router.includes('never decides or advances workflow state') ? pass : fail)('Hermes', 'router keeps scheduling separate from decisions');
(!/Stage [012]|modes\/_shared|modes\/_writing/.test(router) ? pass : fail)('router', 'canonical router has no retired prompt references');
