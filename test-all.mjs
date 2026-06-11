#!/usr/bin/env node

/**
 * test-all.mjs — Comprehensive test suite for career-ops
 *
 * Run before merging any PR or pushing changes.
 * Tests: syntax, scripts, dashboard, data contract, personal data, paths.
 *
 * Usage:
 *   node test-all.mjs           # Run all tests
 *   node test-all.mjs --quick   # Skip dashboard build (faster)
 */

import { execSync, execFileSync } from 'child_process';
import { readFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const QUICK = process.argv.includes('--quick');
const NODE = process.execPath;

let passed = 0;
let failed = 0;
let warnings = 0;

function pass(msg) { console.log(`  ✅ ${msg}`); passed++; }
function fail(msg) { console.log(`  ❌ ${msg}`); failed++; }
function warn(msg) { console.log(`  ⚠️  ${msg}`); warnings++; }

function run(cmd, args = [], opts = {}) {
  try {
    if (Array.isArray(args) && args.length > 0) {
      return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf-8', timeout: 30000, ...opts }).trim();
    }
    return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', timeout: 30000, ...opts }).trim();
  } catch (e) {
    return null;
  }
}

function fileExists(path) { return existsSync(join(ROOT, path)); }
function readFile(path) { return readFileSync(join(ROOT, path), 'utf-8'); }

console.log('\n🧪 career-ops test suite\n');

// ── 1. SYNTAX CHECKS ────────────────────────────────────────────

console.log('1. Syntax checks');

const mjsFiles = readdirSync(ROOT).filter(f => f.endsWith('.mjs'));
for (const f of mjsFiles) {
  const result = run(NODE, ['--check', f]);
  if (result !== null) {
    pass(`${f} syntax OK`);
  } else {
    fail(`${f} has syntax errors`);
  }
}

// ── 2. SCRIPT EXECUTION ─────────────────────────────────────────

console.log('\n2. Script execution (graceful on empty data)');

const scripts = [
  { name: 'cv-sync-check.mjs', expectExit: 1, allowFail: true }, // fails without cv.md (normal in repo)
  { name: 'verify-pipeline.mjs', expectExit: 0 },
  { name: 'normalize-statuses.mjs', expectExit: 0 },
  { name: 'dedup-tracker.mjs', expectExit: 0 },
  { name: 'merge-tracker.mjs', expectExit: 0 },
  { name: 'analyze-patterns.mjs --self-test', expectExit: 0 },
  { name: 'updater-migration-tests.mjs', expectExit: 0 },
  { name: 'validate-portals.mjs --file templates/portals.example.yml', expectExit: 0 },
  { name: 'update-system.mjs check', expectExit: 0 },
];

for (const { name, allowFail } of scripts) {
  const result = run(NODE, name.split(' '), { stdio: ['pipe', 'pipe', 'pipe'] });
  if (result !== null) {
    pass(`${name} runs OK`);
  } else if (allowFail) {
    warn(`${name} exited with error (expected without user data)`);
  } else {
    fail(`${name} crashed`);
  }
}

// ── 3. LIVENESS CLASSIFICATION ──────────────────────────────────

console.log('\n3. Liveness classification');

try {
  const { classifyLiveness } = await import(pathToFileURL(join(ROOT, 'liveness-core.mjs')).href);

  const expiredChromeApply = classifyLiveness({
    finalUrl: 'https://example.com/jobs/closed-role',
    bodyText: 'Company Careers\nApply\nThe job you are looking for is no longer open.',
    applyControls: [],
  });
  if (expiredChromeApply.result === 'expired') {
    pass('Expired pages are not revived by nav/footer "Apply" text');
  } else {
    fail(`Expired page misclassified as ${expiredChromeApply.result}`);
  }

  const activeWorkdayPage = classifyLiveness({
    finalUrl: 'https://example.workday.com/job/123',
    bodyText: [
      '663 JOBS FOUND',
      'Senior AI Engineer',
      'Join our applied AI team to ship production systems, partner with customers, and own delivery across evaluation, deployment, and reliability.',
    ].join('\n'),
    applyControls: ['Apply for this Job'],
  });
  if (activeWorkdayPage.result === 'active') {
    pass('Visible apply controls still keep real job pages active');
  } else {
    fail(`Active job page misclassified as ${activeWorkdayPage.result}`);
  }

  const closedMycareersfuture = classifyLiveness({
    finalUrl: 'https://www.mycareersfuture.gov.sg/job/engineering/senior-staff-embedded-software-engineer',
    bodyText: [
      'Senior Staff Embedded Software Engineer',
      'MaxLinear Asia Singapore Private Limited',
      '9 applications    Posted 27 Oct 2025    Closed on 26 Nov 2025',
      'Applications have closed for this job',
      'Log in to Apply',
      "You'll need to log in with Singpass to verify your identity.",
      'Roles & Responsibilities: design, develop and maintain embedded firmware for broadband communications ICs.',
    ].join('\n'),
    applyControls: ['Log in to Apply'],
  });
  if (closedMycareersfuture.result === 'expired') {
    pass('Closed postings with "Applications have closed" banner are detected');
  } else {
    fail(`Closed mycareersfuture posting misclassified as ${closedMycareersfuture.result}`);
  }

  const cloudflareChallenge = classifyLiveness({
    status: 403,
    finalUrl: 'https://www.pracuj.pl/praca/sap-consultant,oferta,1004870954',
    bodyText: 'www.pracuj.pl\nJust a moment...\nPerforming security verification\nThis website uses a security service to protect against malicious bots.\nRay ID: a06489bab8bc4cd7\nPerformance and Security by Cloudflare',
    applyControls: [],
  });
  if (cloudflareChallenge.result === 'uncertain' && cloudflareChallenge.code === 'bot_challenge') {
    pass('Cloudflare anti-bot challenge pages are uncertain, not expired');
  } else {
    fail(`Cloudflare challenge misclassified as ${cloudflareChallenge.result} (${cloudflareChallenge.code})`);
  }

  const blocked403 = classifyLiveness({
    status: 403,
    finalUrl: 'https://www.pracuj.pl/praca/sap-consultant,oferta,1004870954',
    bodyText: 'Access denied',
    applyControls: [],
  });
  if (blocked403.result === 'uncertain' && blocked403.code === 'access_blocked') {
    pass('HTTP 403 is treated as access-blocked (uncertain), not expired');
  } else {
    fail(`HTTP 403 misclassified as ${blocked403.result} (${blocked403.code})`);
  }

  const activePolishPosting = classifyLiveness({
    status: 200,
    finalUrl: 'https://www.pracuj.pl/praca/administrator-sap-utilities-warszawa,oferta,1004870954',
    bodyText: 'Administrator SAP Utilities. Connectis_. Siedziba firmy: Chmielna 71, Warszawa. '.repeat(6),
    applyControls: ['Aplikuj Aplikuj na ogłoszenie'],
  });
  if (activePolishPosting.result === 'active') {
    pass('Polish "Aplikuj" apply control marks a loaded posting active');
  } else {
    fail(`Polish apply control not recognized: ${activePolishPosting.result} (${activePolishPosting.code})`);
  }

  // Headed-fallback-on-challenge path (liveness-browser.mjs). Fake Playwright
  // pages script the goto/evaluate calls so we can exercise the wrapper without
  // launching a browser. checkUrlLiveness reads body text first, apply controls
  // second — the fake returns them in that order.
  const { checkUrlLivenessWithFallback, isChallengeResult, jitteredDelayMs } =
    await import(pathToFileURL(join(ROOT, 'liveness-browser.mjs')).href);

  const disabled = jitteredDelayMs(0) === 0 && jitteredDelayMs(-1) === 0;
  let inRange = true;
  for (let i = 0; i < 200; i += 1) {
    const d = jitteredDelayMs(5000);
    if (d < 5000 || d >= 10000) { inRange = false; break; }
  }
  if (disabled && inRange) {
    pass('jitteredDelayMs returns 0 when disabled and stays in [base, 2*base)');
  } else {
    fail(`jitteredDelayMs out of spec (disabled=${disabled}, inRange=${inRange})`);
  }

  const fakePage = ({ status, finalUrl, bodyText, applyControls }) => {
    let evalCall = 0;
    return {
      async goto() { return { status: () => status }; },
      async waitForTimeout() {},
      url() { return finalUrl; },
      async evaluate() { evalCall += 1; return evalCall === 1 ? bodyText : applyControls; },
    };
  };
  const URL = 'https://www.pracuj.pl/praca/sap-consultant,oferta,1004870954';
  const challengePage = () => fakePage({
    status: 403,
    finalUrl: URL,
    bodyText: 'Just a moment... Performing security verification. Ray ID: abc123. Cloudflare.',
    applyControls: [],
  });
  const livePage = () => fakePage({
    status: 200,
    finalUrl: URL,
    bodyText: 'Administrator SAP Utilities. '.repeat(20),
    applyControls: ['Apply for this job'],
  });

  if (isChallengeResult({ result: 'uncertain', code: 'bot_challenge' }) &&
      isChallengeResult({ result: 'uncertain', code: 'access_blocked' }) &&
      !isChallengeResult({ result: 'expired', code: 'http_gone' }) &&
      !isChallengeResult({ result: 'active', code: 'apply_control_visible' })) {
    pass('isChallengeResult flags only bot_challenge/access_blocked uncertains');
  } else {
    fail('isChallengeResult misclassified a result');
  }

  const fellBackToActive = await checkUrlLivenessWithFallback(challengePage(), URL, {
    getHeadedPage: async () => livePage(),
  });
  if (fellBackToActive.result === 'active') {
    pass('Headed fallback recovers a challenge-blocked page as active');
  } else {
    fail(`Headed fallback did not recover page: ${fellBackToActive.result} (${fellBackToActive.code})`);
  }

  const noProvider = await checkUrlLivenessWithFallback(challengePage(), URL, {});
  if (noProvider.result === 'uncertain' && noProvider.code === 'bot_challenge') {
    pass('No fallback provider keeps the original challenge result');
  } else {
    fail(`Missing provider changed result to ${noProvider.result} (${noProvider.code})`);
  }

  const stillBlocked = await checkUrlLivenessWithFallback(challengePage(), URL, {
    getHeadedPage: async () => challengePage(),
  });
  if (stillBlocked.result === 'uncertain' && stillBlocked.code === 'bot_challenge'
      && /headed retry also blocked/.test(stillBlocked.reason)) {
    pass('Persistent challenge stays uncertain after headed retry (never upgraded to expired)');
  } else {
    fail(`Persistent challenge mishandled: ${stillBlocked.result} (${stillBlocked.code})`);
  }

  const noHeadedAvailable = await checkUrlLivenessWithFallback(challengePage(), URL, {
    getHeadedPage: async () => null, // headed launch failed (no display)
  });
  if (noHeadedAvailable.result === 'uncertain' && noHeadedAvailable.code === 'bot_challenge') {
    pass('Headless-only environment degrades to original challenge result');
  } else {
    fail(`No-display degrade path wrong: ${noHeadedAvailable.result} (${noHeadedAvailable.code})`);
  }

  // SSRF guard — `rejectPrivateOrInvalid` has to refuse every URL whose host
  // resolves to loopback / private / link-local space. The earlier guard only
  // matched literal IPv4 patterns and bracketless IPv6, so several Chromium-
  // routable bypasses (0.0.0.0, [::], [::1] (bracketed), [::ffff:127.0.0.1],
  // localhost.) slipped through. These cases keep that regression covered.
  const { rejectPrivateOrInvalid } = await import(
    pathToFileURL(join(ROOT, 'liveness-browser.mjs')).href
  );
  const blockCases = [
    ['http://0.0.0.0/admin', 'IPv4 all-zeros (Linux routes to loopback)'],
    ['http://[::]/', 'IPv6 all-zeros (Linux routes to loopback)'],
    ['http://[::1]/', 'IPv6 loopback (brackets included in url.hostname)'],
    ['http://[::ffff:127.0.0.1]/', 'IPv4-mapped IPv6 loopback (dotted form)'],
    ['http://[::ffff:7f00:1]/', 'IPv4-mapped IPv6 loopback (hex form)'],
    ['http://[::ffff:169.254.169.254]/', 'IPv4-mapped IPv6 link-local (cloud metadata)'],
    ['http://[fc00::1]/', 'IPv6 ULA (private)'],
    ['http://[fe80::1]/', 'IPv6 link-local'],
    ['http://localhost./', 'FQDN-trailing-dot localhost'],
    ['http://localhost.localdomain/', 'localhost.localdomain alias'],
    ['http://169.254.169.254/latest/meta-data/', 'cloud metadata IPv4 link-local'],
    ['http://10.0.0.5/', 'IPv4 RFC1918'],
  ];
  let blockMissed = 0;
  for (const [url, label] of blockCases) {
    const verdict = rejectPrivateOrInvalid(url);
    if (verdict?.code !== 'blocked_host') {
      fail(`SSRF guard missed ${label}: ${url} → ${verdict ? verdict.code : 'allowed'}`);
      blockMissed += 1;
    }
  }
  if (blockMissed === 0) pass(`SSRF guard blocks ${blockCases.length} known bypass vectors`);

  const allowCases = [
    'https://boards.greenhouse.io/example/jobs/123',
    'https://jobs.lever.co/example/abc-def',
    'https://example.com/careers/role',
    'https://www.pracuj.pl/praca/role,oferta,1234567',
  ];
  let allowDenied = 0;
  for (const url of allowCases) {
    if (rejectPrivateOrInvalid(url) !== null) {
      fail(`SSRF guard false-positive on legitimate ATS URL: ${url}`);
      allowDenied += 1;
    }
  }
  if (allowDenied === 0) pass('SSRF guard lets legitimate ATS URLs through');

  const protoCase = rejectPrivateOrInvalid('file:///etc/passwd');
  if (protoCase?.code === 'unsupported_protocol') {
    pass('SSRF guard rejects unsupported protocol');
  } else {
    fail(`SSRF guard let unsupported protocol through: ${protoCase?.code ?? 'allowed'}`);
  }
} catch (e) {
  fail(`Liveness classification tests crashed: ${e.message}`);
}

// ── 4. DASHBOARD BUILD ──────────────────────────────────────────

if (!QUICK) {
  console.log('\n4. Dashboard build');
  const isWindows = process.platform === 'win32';
  const outPath = isWindows ? 'career-dashboard-test.exe' : '/tmp/career-dashboard-test';
  const goBuild = run(`cd dashboard && go build -o ${outPath} . 2>&1`);
  if (goBuild !== null) {
    pass('Dashboard compiles');
    if (isWindows) {
      try { rmSync(join(ROOT, 'dashboard', 'career-dashboard-test.exe'), { force: true }); } catch (e) {}
    }
  } else {
    fail('Dashboard build failed');
  }
} else {
  console.log('\n4. Dashboard build (skipped --quick)');
}

// ── 5. DATA CONTRACT ────────────────────────────────────────────

console.log('\n5. Data contract validation');

// Check system files exist
const systemFiles = [
  'CLAUDE.md', 'VERSION', 'DATA_CONTRACT.md',
  'modes/_shared.md', 'modes/_profile.template.md',
  'modes/oferta.md', 'modes/pdf.md', 'modes/scan.md',
  'templates/states.yml', 'templates/cv-template.html',
  '.claude/skills/career-ops/SKILL.md',
];

for (const f of systemFiles) {
  if (fileExists(f)) {
    pass(`System file exists: ${f}`);
  } else {
    fail(`Missing system file: ${f}`);
  }
}

// Check user files are NOT tracked (gitignored)
const userFiles = [
  'config/profile.yml', 'modes/_profile.md', 'portals.yml',
];
for (const f of userFiles) {
  const tracked = run('git', ['ls-files', f]);
  if (tracked === '') {
    pass(`User file gitignored: ${f}`);
  } else if (tracked === null) {
    pass(`User file gitignored: ${f}`);
  } else {
    fail(`User file IS tracked (should be gitignored): ${f}`);
  }
}

const batchRunnerSource = readFile('batch/batch-runner.sh');
const minScoreSkipIndex = batchRunnerSource.indexOf('update_state "$id" "$url" "skipped"');
const minScoreReturnIndex = batchRunnerSource.indexOf('return 0', minScoreSkipIndex);
const completedStateIndex = batchRunnerSource.indexOf('update_state "$id" "$url" "completed"', minScoreSkipIndex);
if (
  minScoreSkipIndex !== -1 &&
  minScoreReturnIndex !== -1 &&
  completedStateIndex !== -1 &&
  minScoreSkipIndex < minScoreReturnIndex &&
  minScoreReturnIndex < completedStateIndex
) {
  pass('Batch min-score gate returns before completed state update');
} else {
  fail('Batch min-score gate can fall through to completed state update');
}

if (/if \[\[ "\$status" == "completed" \|\| "\$status" == "skipped" \]\]/.test(batchRunnerSource)) {
  pass('Batch resume treats min-score skipped offers as terminal');
} else {
  fail('Batch resume can reprocess min-score skipped offers');
}

if (/local total=0 completed=0 skipped=0 failed=0 pending=0/.test(batchRunnerSource) &&
    /skipped\) skipped=\$\(\(skipped \+ 1\)\)/.test(batchRunnerSource) &&
    /Completed: \$completed \| Skipped: \$skipped \| Failed: \$failed \| Pending: \$pending/.test(batchRunnerSource)) {
  pass('Batch summary reports skipped offers separately from pending');
} else {
  fail('Batch summary can misreport skipped offers as pending');
}

// ── 6. PERSONAL DATA LEAK CHECK ─────────────────────────────────

console.log('\n6. Personal data leak check');

const leakPatterns = [
  'Santiago', 'santifer.io', 'Santifer iRepair', 'Zinkee', 'ALMAS',
  'hi@santifer.io', '688921377', '/Users/santifer/',
];

const scanExtensions = ['md', 'yml', 'html', 'mjs', 'sh', 'go', 'json'];
const allowedFiles = [
  // English README + localized translations (all legitimately credit Santiago)
  'README.md', 'README.es.md', 'README.fr.md', 'README.ja.md', 'README.ko-KR.md',
  'README.pt-BR.md', 'README.ru.md', 'README.cn.md', 'README.zh-TW.md',
  // Standard project files
  'LICENSE', 'CITATION.cff', 'CONTRIBUTING.md', 'CHANGELOG.md', 'TRADEMARK.md',
  'package.json', '.github/FUNDING.yml', 'CLAUDE.md', 'AGENTS.md', 'go.mod', 'test-all.mjs',
  '.claude-plugin/marketplace.json', '.claude-plugin/plugin.json',
  // Community / governance files (added in v1.3.0, all legitimately reference the maintainer)
  'CODE_OF_CONDUCT.md', 'GOVERNANCE.md', 'SECURITY.md', 'SUPPORT.md',
  '.github/SECURITY.md',
  // Dashboard credit string
  'dashboard/internal/ui/screens/pipeline.go',
  'dashboard/internal/ui/screens/progress.go',
];

// Build pathspec for git grep — only scan tracked files matching these
// extensions. This is what `grep -rn` was trying to do, but git-aware:
// untracked files (debate artifacts, AI tool scratch, local plans/) and
// gitignored files can't trigger false positives because they were never
// going to reach a commit anyway.
const grepPathspec = scanExtensions.map(e => `'*.${e}'`).join(' ');

let leakFound = false;
for (const pattern of leakPatterns) {
  const result = run(
    `git grep -n "${pattern}" -- ${grepPathspec} 2>/dev/null`
  );
  if (result) {
    for (const line of result.split('\n')) {
      const file = line.split(':')[0];
      if (allowedFiles.some(a => file.includes(a))) continue;
      if (file.includes('dashboard/go.mod')) continue;
      warn(`Possible personal data in ${file}: "${pattern}"`);
      leakFound = true;
    }
  }
}
if (!leakFound) {
  pass('No personal data leaks outside allowed files');
}

// ── 7. ABSOLUTE PATH CHECK ──────────────────────────────────────

console.log('\n7. Absolute path check');

// Same git grep approach: only scans tracked files. Untracked AI tool
// outputs, local debate artifacts, etc. can't false-positive here.
const absPathResult = run(
  `git grep -n "/Users/" -- '*.mjs' '*.sh' '*.md' '*.go' '*.yml' 2>/dev/null | grep -v README.md | grep -v LICENSE | grep -v CLAUDE.md | grep -v test-all.mjs`
);
if (!absPathResult) {
  pass('No absolute paths in code files');
} else {
  for (const line of absPathResult.split('\n').filter(Boolean)) {
    fail(`Absolute path: ${line.slice(0, 100)}`);
  }
}

// ── 8. MODE FILE INTEGRITY ──────────────────────────────────────

console.log('\n8. Mode file integrity');

const expectedModes = [
  '_shared.md', '_profile.template.md', 'oferta.md', 'pdf.md', 'scan.md',
  'batch.md', 'apply.md', 'auto-pipeline.md', 'contacto.md', 'deep.md',
  'ofertas.md', 'pipeline.md', 'project.md', 'tracker.md', 'training.md',
  'interview.md',
];

for (const mode of expectedModes) {
  if (fileExists(`modes/${mode}`)) {
    pass(`Mode exists: ${mode}`);
  } else {
    fail(`Missing mode: ${mode}`);
  }
}

// Check _shared.md references _profile.md
const shared = readFile('modes/_shared.md');
if (shared.includes('_profile.md')) {
  pass('_shared.md references _profile.md');
} else {
  fail('_shared.md does NOT reference _profile.md');
}

const applyMode = readFile('modes/apply.md');
if (
  applyMode.includes('## Step 5 — Preflight gate') &&
  applyMode.includes('verify liveness with Playwright') &&
  applyMode.includes('matching report has been loaded') &&
  applyMode.includes('Do not continue to Step 6 until this preflight is resolved') &&
  applyMode.includes('refuse to generate final copy')
) {
  pass('apply mode includes liveness and role-match preflight gate');
} else {
  fail('apply mode missing liveness/role-match preflight gate');
}

// ── 9. LOCAL PARSER CONTRACT ────────────────────────────────────

console.log('\n9. Local parser contract');

const scanScript = readFile('scan.mjs');
if (
  scanScript.includes('typeof entry.name !== \'string\'') &&
  scanScript.includes('entry.name.trim()') &&
  scanScript.includes('entry.name.toLowerCase()')
) {
  pass('scan.mjs guards company names before filtering');
} else {
  fail('scan.mjs does not guard company names before filtering');
}

if (
  scanScript.includes("skipIds: ['local-parser']") &&
  scanScript.includes('local parser failed, used API fallback') &&
  scanScript.includes('resolveProvider(company, providers')
) {
  pass('scan.mjs falls back to ATS API when local parser fails');
} else {
  fail('scan.mjs does not fall back to ATS API when local parser fails');
}

if (fileExists('providers/local-parser.mjs')) {
  pass('local-parser provider module exists');
} else {
  fail('local-parser provider module is missing');
}

const scanMode = fileExists('modes/scan.md') ? readFile('modes/scan.md') : '';
if (
  scanMode.includes('local_parser_ok') &&
  (scanMode.includes('No Expensive Scraping Repetition') || scanMode.includes('no repetir scraping caro')) &&
  (scanMode.includes('name not listed in `local_parser_ok`') || scanMode.includes('nombre no listado en `local_parser_ok`'))
) {
  pass('scan.md skips expensive levels after successful local parser');
} else {
  fail('scan.md missing local_parser_ok skip rules for agent scan');
}

if (!fileExists('scripts/parsers/cohere_jobs.py')) {
  pass('Cohere parser example is not bundled as a runtime script');
} else {
  fail('Cohere parser example is still bundled as a runtime script');
}

const portalExample = readFile('templates/portals.example.yml');
if (
  !portalExample.includes('cohere_jobs.py') &&
  portalExample.includes('scripts/parsers/example-js-company-jobs.js') &&
  portalExample.includes('scripts/parsers/example_python_company_jobs.py') &&
  portalExample.includes('already know their target careers URL')
) {
  pass('portals example documents a generic local parser contract');
} else {
  fail('portals example still points at a bundled Cohere parser');
}

// ── 10. PORTALS CONFIG VALIDATOR ────────────────────────────────

console.log('\n10. Portals config validator');

try {
  const tmp = mkdtempSync(join(tmpdir(), 'career-ops-portals-validator-'));
  const validPath = join(tmp, 'valid.yml');
  const invalidProviderPath = join(tmp, 'invalid-provider.yml');
  const emptyKeywordPath = join(tmp, 'empty-keyword.yml');
  const duplicateCompanyPath = join(tmp, 'duplicate-company.yml');

  writeFileSync(validPath, `
title_filter:
  positive: ["AI"]
  negative: ["Intern"]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
`, 'utf-8');

  writeFileSync(invalidProviderPath, `
title_filter:
  positive: ["AI"]
tracked_companies:
  - name: "Acme"
    provider: "missing-provider"
    careers_url: "https://jobs.lever.co/acme"
`, 'utf-8');

  writeFileSync(emptyKeywordPath, `
title_filter:
  positive: ["AI", "   "]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
`, 'utf-8');

  writeFileSync(duplicateCompanyPath, `
title_filter:
  positive: ["AI"]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
  - name: " acme "
    careers_url: "https://jobs.lever.co/acme2"
`, 'utf-8');

  const validResult = run(NODE, ['validate-portals.mjs', '--file', validPath]);
  if (validResult !== null && validResult.includes('0 errors')) {
    pass('validate-portals accepts a minimal valid portals file');
  } else {
    fail('validate-portals should accept a minimal valid portals file');
  }

  const exampleResult = run(NODE, ['validate-portals.mjs', '--file', 'templates/portals.example.yml']);
  if (exampleResult !== null && exampleResult.includes('0 errors')) {
    pass('validate-portals accepts templates/portals.example.yml');
  } else {
    fail('validate-portals should accept templates/portals.example.yml');
  }

  const invalidProviderResult = run(NODE, ['validate-portals.mjs', '--file', invalidProviderPath]);
  if (invalidProviderResult === null) {
    pass('validate-portals rejects unknown explicit providers');
  } else {
    fail('validate-portals should reject unknown explicit providers');
  }

  const emptyKeywordResult = run(NODE, ['validate-portals.mjs', '--file', emptyKeywordPath]);
  if (emptyKeywordResult === null) {
    pass('validate-portals rejects empty title/location keywords');
  } else {
    fail('validate-portals should reject empty title/location keywords');
  }

  const duplicateCompanyResult = run(NODE, ['validate-portals.mjs', '--file', duplicateCompanyPath]);
  if (duplicateCompanyResult !== null && duplicateCompanyResult.includes('1 warning')) {
    pass('validate-portals warns on duplicate enabled company names');
  } else {
    fail('validate-portals should warn on duplicate enabled company names');
  }

  rmSync(tmp, { recursive: true, force: true });
} catch (e) {
  fail(`portals validator tests crashed: ${e.message}`);
}

// ── 11. AGENTS.md INTEGRITY ─────────────────────────────────────

console.log('\n11. AGENTS.md integrity');

const agents = readFile('AGENTS.md');
const requiredSections = [
  'Data Contract', 'Update Check', 'Ethical Use',
  'Offer Verification', 'Canonical States', 'TSV Format',
  'First Run', 'Onboarding',
];

for (const section of requiredSections) {
  if (agents.includes(section)) {
    pass(`AGENTS.md has section: ${section}`);
  } else {
    fail(`AGENTS.md missing section: ${section}`);
  }
}

// ── 11. VERSION FILE ─────────────────────────────────────────────

console.log('\n11. Version file');

if (fileExists('VERSION')) {
  // VERSION may carry a release-please marker, e.g. "1.9.0 # x-release-please-version".
  // Validate the first whitespace-delimited token, mirroring update-system.mjs parseVersionFile().
  const version = readFile('VERSION').trim().split(/\s+/)[0];
  if (/^\d+\.\d+\.\d+$/.test(version)) {
    pass(`VERSION is valid semver: ${version}`);
  } else {
    fail(`VERSION is not valid semver: "${version}"`);
  }
} else {
  fail('VERSION file missing');
}

// ── 11. LOCATION FILTER — always_allow tier ───────────────────────

console.log('\n11. Location filter — always_allow tier');

try {
  const { buildLocationFilter, shouldDedupScanHistoryRow } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

  const filter = buildLocationFilter({
    always_allow: ['belgium', 'brussels'],
    allow: ['europe', 'emea', 'remote'],
    block: ['france', 'germany', 'united states'],
  });

  // Case 1: home-region passes regardless of other text
  if (filter('Brussels, Belgium') === true) pass('Brussels, Belgium passes (always_allow hit)');
  else fail('Brussels, Belgium should pass');

  // Case 2: always_allow wins over block (THE motivating case for this tier)
  if (filter('Remote, Belgium or France') === true) pass('Remote, Belgium or France passes (always_allow beats block)');
  else fail('Remote, Belgium or France should pass — always_allow must win over block');

  // Case 3: no always_allow hit, block still rejects
  if (filter('Paris, France') === false) pass('Paris, France is rejected (block still applies)');
  else fail('Paris, France should be rejected');

  // Case 4: empty location → pass (existing semantics, unchanged)
  if (filter('') === true) pass('empty location passes (unchanged semantics)');
  else fail('empty location should pass');

  // Case 5: case-insensitivity
  if (filter('BRUSSELS, BELGIUM') === true) pass('case-insensitive match works');
  else fail('case-insensitive match failed');

  // Case 6: backward compatibility — no always_allow key behaves like stock allow/block
  const stockFilter = buildLocationFilter({
    allow: ['europe', 'remote'],
    block: ['france'],
  });
  if (stockFilter('Remote, Belgium or France') === false) pass('without always_allow, block still wins (backward compatible)');
  else fail('without always_allow, behaviour must match stock allow/block (block wins)');

  // Case 7: null/missing locationFilter → pass-all filter (early-return path)
  const nullFilter = buildLocationFilter(null);
  if (nullFilter('Anywhere on Earth') === true && nullFilter('') === true) {
    pass('null locationFilter returns a pass-all filter (early-return path)');
  } else {
    fail('null locationFilter should return a pass-all filter');
  }

  // Case 8: string-instead-of-array → wrapped to a 1-item list
  const stringFilter = buildLocationFilter({ always_allow: 'belgium', block: ['france'] });
  if (stringFilter('Remote, Belgium or France') === true) {
    pass('always_allow as a bare string is wrapped to a single-item list');
  } else {
    fail('always_allow as a bare string should still work');
  }

  // Case 9: null/non-string items are filtered out (no crash, no false matches)
  const messyFilter = buildLocationFilter({
    always_allow: [null, 'belgium', 42, undefined],
    block: ['france', null, 7],
  });
  if (messyFilter('Brussels, Belgium') === true && messyFilter('Paris, France') === false) {
    pass('non-string entries (null, numbers, undefined) are filtered out without crashing');
  } else {
    fail('mixed-type keyword lists should not crash and should still match string entries');
  }

  // Case 10: all-null/non-string list → empty after normalization (no false rejects)
  const allBadFilter = buildLocationFilter({ block: [null, 42, undefined], allow: ['remote'] });
  if (allBadFilter('Remote') === true) {
    pass('a block list with only non-string entries normalizes to [] (no false rejects)');
  } else {
    fail('non-string-only block list should not cause rejection');
  }

  // Case 11: empty / whitespace-only entries are dropped (would otherwise pass-all via includes(''))
  const emptyKeywordFilter = buildLocationFilter({
    always_allow: ['', '  '],
    allow: ['remote'],
    block: ['france'],
  });
  if (emptyKeywordFilter('Paris, France') === false) {
    pass('empty/whitespace always_allow entries are dropped (no pass-all via includes(""))');
  } else {
    fail('empty always_allow entries should NOT bypass block — would have made the filter pass-all');
  }

  // Case 12: surrounding whitespace is trimmed so the keyword still matches
  const whitespaceFilter = buildLocationFilter({
    always_allow: ['  Belgium  ', '\tBrussels\n'],
    block: ['france'],
  });
  if (whitespaceFilter('Remote, Belgium or France') === true) {
    pass('whitespace-padded keywords still match after trim');
  } else {
    fail('"  Belgium  " should be trimmed and still match "Remote, Belgium or France"');
  }

  // Case 13: whitespace-only location is treated as missing (pass-all-tiers)
  if (filter('   \t  ') === true) pass('whitespace-only location passes (treated as missing)');
  else fail('whitespace-only location should pass');

  // Case 14: non-string location (number/object/null) → pass without throwing
  let crashed = false;
  try {
    const r1 = filter(42);
    const r2 = filter({ city: 'Brussels' });
    const r3 = filter(null);
    const r4 = filter(undefined);
    if (r1 === true && r2 === true && r3 === true && r4 === true) {
      pass('non-string location values (number, object, null, undefined) pass without throwing');
    } else {
      fail(`non-string location results: number=${r1}, object=${r2}, null=${r3}, undefined=${r4}`);
    }
  } catch (e) {
    crashed = true;
    fail(`non-string location crashed: ${e.message}`);
  }

  // Case 15: a malformed location (e.g. legacy object) does NOT bypass block when interpreted naively —
  // the guard returns true (pass) BEFORE block/allow even run, which is correct: scoring/eval happens
  // downstream from the scan filter, so malformed locations should fall through to the manual evaluation
  // step rather than being silently dropped here.
  if (filter(42) === true) pass('non-string locations are passed through to downstream evaluation, not silently dropped');
  else fail('non-string locations should pass through');

  if (
    shouldDedupScanHistoryRow({ firstSeen: '2026-06-01', status: 'added' }, { recheckAfterDays: 30, today: '2026-06-10' }) === true &&
    shouldDedupScanHistoryRow({ firstSeen: '2026-05-01', status: 'added' }, { recheckAfterDays: 30, today: '2026-06-10' }) === false &&
    shouldDedupScanHistoryRow({ firstSeen: '2026-02-31', status: 'added' }, { recheckAfterDays: 30, today: '2026-06-10' }) === true &&
    shouldDedupScanHistoryRow({ firstSeen: '2026-05-01', status: 'skipped_blocked_host' }, { recheckAfterDays: 30, today: '2026-06-10' }) === true &&
    shouldDedupScanHistoryRow({ firstSeen: '2026-05-01', status: 'added' }, { today: '2026-06-10' }) === true &&
    scanScript.includes('Recheck eligible:')
  ) {
    pass('scan-history TTL rechecks old added URLs while permanent statuses stay deduped');
  } else {
    fail('scan-history TTL policy did not match expected recheck/permanent behavior');
  }

} catch (e) {
  fail(`always_allow tests crashed: ${e.message}`);
}
// ── 12. FOLLOW-UP CADENCE LOGIC ─────────────────────────────────

console.log('\n12. Follow-up cadence logic');

try {
  const cadence = await import(pathToFileURL(join(ROOT, 'followup-cadence.mjs')).href);

  // CLI regression: the import.meta.url guard must still let the module run as a CLI.
  // Data-independent — default mode emits the result as JSON: a `metadata` object when
  // the tracker has applications, or an `{error}` object (exit 1) when it is empty.
  // Empty output would mean the guard wrongly suppressed main().
  let cliOut = '';
  try {
    cliOut = execFileSync(NODE, [join(ROOT, 'followup-cadence.mjs')], { cwd: ROOT, encoding: 'utf-8', timeout: 30000 });
  } catch (cliErr) {
    cliOut = `${cliErr.stdout || ''}`; // exit 1 on an empty tracker is expected; keep stdout
  }
  let cliJson = null;
  try { cliJson = JSON.parse(cliOut.trim()); } catch { /* leave null → fail below */ }
  if (cliJson && typeof cliJson === 'object' && ('metadata' in cliJson || 'error' in cliJson)) {
    pass('CLI still executes under the import.meta.url guard (emits result JSON)');
  } else {
    fail('CLI produced no structured JSON when run directly — import.meta.url guard may be broken');
  }

  // Date helpers
  if (cadence.addDays(cadence.parseDate('2026-05-01'), 7) === '2026-05-08') {
    pass('addDays advances a parsed date by N days (UTC)');
  } else {
    fail(`addDays produced ${cadence.addDays(cadence.parseDate('2026-05-01'), 7)}`);
  }
  if (cadence.daysBetween(cadence.parseDate('2026-05-01'), cadence.parseDate('2026-05-08')) === 7) {
    pass('daysBetween counts whole days between two dates');
  } else {
    fail('daysBetween miscounted');
  }
  if (cadence.parseDate('not-a-date') === null && cadence.parseDate('2026-05-01') instanceof Date) {
    pass('parseDate rejects malformed input and accepts ISO dates');
  } else {
    fail('parseDate validation wrong');
  }

  // Status normalization (strips bold + trailing date, lowercases, maps aliases)
  if (cadence.normalizeStatus('**Applied** 2026-05-01') === 'applied') {
    pass('normalizeStatus strips bold + trailing date and lowercases');
  } else {
    fail(`normalizeStatus produced ${cadence.normalizeStatus('**Applied** 2026-05-01')}`);
  }

  const cadenceTmp = mkdtempSync(join(tmpdir(), 'co-cadence-'));
  const profilePath = join(cadenceTmp, 'profile.yml');
  writeFileSync(profilePath, [
    'followup_cadence:',
    '  applied_first_days: 11',
    '  applied_subsequent_days: 5',
    '  applied_max_followups: 4',
    '  responded_initial_days: 2',
    '  responded_subsequent_days: 6',
    '  interview_thankyou_days: 3',
  ].join('\n'));

  const profileCadence = cadence.resolveCadenceConfig({ profilePath });
  if (
    profileCadence.applied_first === 11 &&
    profileCadence.applied_subsequent === 5 &&
    profileCadence.applied_max_followups === 4 &&
    profileCadence.responded_initial === 2 &&
    profileCadence.responded_subsequent === 6 &&
    profileCadence.interview_thankyou === 3
  ) {
    pass('follow-up cadence reads profile.yml overrides');
  } else {
    fail(`profile cadence override failed: ${JSON.stringify(profileCadence)}`);
  }

  const cliCadence = cadence.resolveCadenceConfig({ profilePath, appliedDays: 9 });
  if (cliCadence.applied_first === 9 && cliCadence.applied_subsequent === 5) {
    pass('follow-up cadence CLI override wins over profile applied_first');
  } else {
    fail(`CLI cadence override failed: ${JSON.stringify(cliCadence)}`);
  }

  const malformedProfile = join(cadenceTmp, 'malformed.yml');
  writeFileSync(malformedProfile, 'followup_cadence: [');
  const fallbackCadence = cadence.resolveCadenceConfig({ profilePath: malformedProfile });
  if (fallbackCadence.applied_first === cadence.DEFAULT_CADENCE.applied_first) {
    pass('follow-up cadence ignores malformed optional profile config');
  } else {
    fail(`malformed profile did not fall back to defaults: ${JSON.stringify(fallbackCadence)}`);
  }

  rmSync(cadenceTmp, { recursive: true, force: true });

  // Urgency decision tree (CADENCE defaults: applied_first=7, max_followups=2, responded_initial=1, interview_thankyou=1)
  const urgencyCases = [
    [['applied', 7, null, 0], 'overdue', 'applied past applied_first → overdue'],
    [['applied', 3, null, 0], 'waiting', 'applied within window → waiting'],
    [['applied', 30, null, 2], 'cold', 'applied at max follow-ups → cold'],
    [['responded', 0, null, 0], 'urgent', 'responded before responded_initial → urgent'],
    [['interview', 1, null, 0], 'overdue', 'interview past thank-you window → overdue'],
  ];
  for (const [args, expected, label] of urgencyCases) {
    const got = cadence.computeUrgency(...args);
    if (got === expected) pass(`computeUrgency: ${label}`);
    else fail(`computeUrgency ${label}: expected ${expected}, got ${got}`);
  }

  // Next follow-up date scheduling
  const nextCases = [
    [['applied', '2026-05-01', null, 0], '2026-05-08', 'first applied follow-up = appDate + applied_first'],
    [['applied', '2026-05-01', null, 2], null, 'cold (max follow-ups) → null'],
    [['interview', '2026-05-01', null, 0], '2026-05-02', 'interview = appDate + interview_thankyou'],
  ];
  for (const [args, expected, label] of nextCases) {
    const got = cadence.computeNextFollowupDate(...args);
    if (got === expected) pass(`computeNextFollowupDate: ${label}`);
    else fail(`computeNextFollowupDate ${label}: expected ${expected}, got ${got}`);
  }
} catch (e) {
  fail(`follow-up cadence module crashed: ${e.message}`);
}

// ── 12. PROVIDERS — Workable ────────────────────────────────────────

console.log('\n12. Provider — workable');

try {
  const workable = (await import(pathToFileURL(join(ROOT, 'providers/workable.mjs')).href)).default;
  const { parseWorkableMarkdown } = await import(pathToFileURL(join(ROOT, 'providers/workable.mjs')).href);

  // detect() — auto-detection from careers_url
  if (workable.id === 'workable') pass('workable.id is "workable"');
  else fail(`workable.id is ${JSON.stringify(workable.id)}`);

  const hit = workable.detect({ name: 'TestCo', careers_url: 'https://apply.workable.com/optimile' });
  if (hit && hit.url === 'https://apply.workable.com/optimile/jobs.md') {
    pass('workable.detect() resolves apply.workable.com/<slug> → /jobs.md feed');
  } else {
    fail(`workable.detect() returned ${JSON.stringify(hit)}`);
  }

  const miss = workable.detect({ name: 'TestCo', careers_url: 'https://example.com/careers' });
  if (miss === null) pass('workable.detect() returns null for non-workable URLs');
  else fail(`workable.detect() should return null, got ${JSON.stringify(miss)}`);

  // parse() — markdown table
  const sampleMd = [
    '# Optimile — All Open Positions',
    '',
    '| Title | Department | Location | Type | Salary | Posted | Details |',
    '|---|---|---|---|---|---|---|',
    '| Senior AI PM | Product | Ghent, Belgium | Full-time | — | 2026-04-01 | [View](https://apply.workable.com/optimile/jobs/view/ABC123.md) |',
    '| Tech Lead | Engineering | Remote | Full-time | — | 2026-03-25 | [View](https://apply.workable.com/optimile/jobs/view/DEF456.md) |',
  ].join('\n');

  const jobs = parseWorkableMarkdown(sampleMd, 'Optimile');
  if (jobs.length === 2) pass('parseWorkableMarkdown extracts 2 jobs from 2-row table');
  else fail(`parseWorkableMarkdown returned ${jobs.length} jobs, expected 2`);

  if (jobs[0]?.title === 'Senior AI PM' && jobs[0]?.location === 'Ghent, Belgium' && jobs[0]?.company === 'Optimile') {
    pass('parseWorkableMarkdown extracts title, location, company correctly');
  } else {
    fail(`parseWorkableMarkdown row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[0]?.url === 'https://apply.workable.com/optimile/jobs/view/ABC123') {
    pass('parseWorkableMarkdown strips .md suffix from job URL');
  } else {
    fail(`parseWorkableMarkdown should strip .md; got url=${JSON.stringify(jobs[0]?.url)}`);
  }

  // Robustness
  if (parseWorkableMarkdown('', 'X').length === 0) pass('empty input → empty result');
  else fail('empty input should yield empty result');

  if (parseWorkableMarkdown(null, 'X').length === 0) pass('null input → empty result (no crash)');
  else fail('null input should yield empty result without crashing');

  // fetch() reaches the http context on the happy path (allowed hostname).
  await workable.fetch(
    { name: 'Smoke', careers_url: 'https://apply.workable.com/optimile' },
    {
      transport: 'http',
      fetchText: async (url) => {
        if (!url.startsWith('https://apply.workable.com/')) {
          throw new Error('fetchText called with unexpected URL');
        }
        return '| Title | Department | Location | Type | Salary | Posted | Details |\n|---|---|---|---|---|---|---|\n';
      },
      fetchJson: async () => { throw new Error('fetchJson should not be called'); },
    },
  );
  pass('workable.fetch() reaches fetchText on the happy path (allowed hostname)');

  // fetch() rejects an unresolvable careers_url (no apply.workable.com match in URL).
  let rejected = false;
  try {
    await workable.fetch(
      { name: 'BadUrl', careers_url: 'https://evil.com/totally-not-workable' },
      {
        transport: 'http',
        fetchText: async () => { throw new Error('SSRF! should not reach here'); },
        fetchJson: async () => { throw new Error('SSRF! should not reach here'); },
      },
    );
  } catch (e) {
    if (e.message.includes('cannot derive feed URL')) {
      rejected = true;
    } else {
      fail(`workable.fetch() rejected with wrong error: ${e.message}`);
    }
  }
  if (rejected) pass('workable.fetch() rejects unresolvable careers_url before fetch');
  else fail('workable.fetch() should throw cannot-derive-feed-URL for non-Workable URLs');

  // SSRF: malicious URL with apply.workable.com in the PATH (not hostname) must not be detected as Workable.
  // With strict URL parsing, the hostname `evil.example` fails the check and detect() returns null.
  if (workable.detect({ name: 'Spoof', careers_url: 'https://evil.example/apply.workable.com/slug' }) === null) {
    pass('workable.detect() rejects path-spoofed URLs (apply.workable.com in path, not hostname)');
  } else {
    fail('workable.detect() must NOT misdetect URLs that contain apply.workable.com in the path');
  }

  // careers_url with non-string value (e.g. YAML mistake passing a number) → detect() returns null without crashing
  if (workable.detect({ name: 'X', careers_url: 42 }) === null) {
    pass('workable.detect() returns null for non-string careers_url (42)');
  } else {
    fail('workable.detect() should treat non-string careers_url as missing');
  }

  // Workable parser tolerates a title with a stray pipe — URL is extracted from the line, not cols[7]
  const strayPipeMd = [
    '| Title | Department | Location | Type | Salary | Posted | Details |',
    '|---|---|---|---|---|---|---|',
    '| Senior PM (full | part-time) | Product | Remote | Full-time | — | 2026-04-01 | [View](https://apply.workable.com/x/jobs/view/PIPE.md) |',
  ].join('\n');
  const strayJobs = parseWorkableMarkdown(strayPipeMd, 'X');
  if (strayJobs.length === 1 && strayJobs[0].url === 'https://apply.workable.com/x/jobs/view/PIPE') {
    pass('parseWorkableMarkdown extracts URL from line-level regex (survives stray pipes in title)');
  } else {
    fail(`stray-pipe row not handled correctly: ${JSON.stringify(strayJobs)}`);
  }

  // Off-domain [View] link is dropped (URL validation)
  const offDomainMd = [
    '| Title | Department | Location | Type | Salary | Posted | Details |',
    '|---|---|---|---|---|---|---|',
    '| Good Role | Product | Remote | Full-time | — | 2026-04-01 | [View](https://apply.workable.com/x/jobs/view/ABC.md) |',
    '| Evil Role | Product | Remote | Full-time | — | 2026-04-01 | [View](https://evil.example/jobs/view/X) |',
    '| Insecure Role | Product | Remote | Full-time | — | 2026-04-01 | [View](http://apply.workable.com/x/jobs/view/Y.md) |',
  ].join('\n');
  const filteredJobs = parseWorkableMarkdown(offDomainMd, 'X');
  if (filteredJobs.length === 1 && filteredJobs[0].title === 'Good Role') {
    pass('parseWorkableMarkdown drops off-domain and non-https [View] links');
  } else {
    fail(`expected only "Good Role" through, got ${JSON.stringify(filteredJobs.map(j => j.title))}`);
  }

} catch (e) {
  fail(`workable provider tests crashed: ${e.message}`);
}

// ── 13. PROVIDERS — SmartRecruiters ─────────────────────────────────

console.log('\n13. Provider — smartrecruiters');

try {
  const sr = (await import(pathToFileURL(join(ROOT, 'providers/smartrecruiters.mjs')).href)).default;
  const { parseSmartRecruitersResponse } = await import(pathToFileURL(join(ROOT, 'providers/smartrecruiters.mjs')).href);

  if (sr.id === 'smartrecruiters') pass('smartrecruiters.id is "smartrecruiters"');
  else fail(`smartrecruiters.id is ${JSON.stringify(sr.id)}`);

  const hitCareers = sr.detect({ name: 'Adyen', careers_url: 'https://careers.smartrecruiters.com/adyen' });
  if (hitCareers && hitCareers.url.startsWith('https://api.smartrecruiters.com/v1/companies/adyen/postings')) {
    pass('smartrecruiters.detect() resolves careers.smartrecruiters.com/<slug> → api URL');
  } else {
    fail(`smartrecruiters.detect(careers) returned ${JSON.stringify(hitCareers)}`);
  }

  const hitJobs = sr.detect({ name: 'X', careers_url: 'https://jobs.smartrecruiters.com/x' });
  if (hitJobs && hitJobs.url.startsWith('https://api.smartrecruiters.com/v1/companies/x/postings')) {
    pass('smartrecruiters.detect() also handles jobs.smartrecruiters.com');
  } else {
    fail(`smartrecruiters.detect(jobs) returned ${JSON.stringify(hitJobs)}`);
  }

  if (sr.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('smartrecruiters.detect() returns null for non-SR URLs');
  } else {
    fail('smartrecruiters.detect() should return null for non-SR URLs');
  }

  // parseSmartRecruitersResponse
  const sample = {
    content: [
      {
        id: 'abc-123',
        name: 'Senior PM',
        ref: 'https://api.smartrecruiters.com/v1/companies/sgs/postings/abc-123',
        location: { fullLocation: 'Geneva, Switzerland', remote: false },
      },
      {
        id: 'def-456',
        name: 'Remote AI Engineer',
        ref: 'https://api.smartrecruiters.com/v1/companies/sgs/postings/def-456',
        location: { city: 'Paris', country: 'France', remote: true },
      },
      {
        id: 'ghi-789',
        name: 'No-ref Role',
        location: { fullLocation: 'Berlin, Germany' },
      },
    ],
  };
  const jobs = parseSmartRecruitersResponse(sample, 'SGS');
  if (jobs.length === 3) pass('parseSmartRecruitersResponse extracts 3 jobs');
  else fail(`parseSmartRecruitersResponse returned ${jobs.length} jobs`);

  if (jobs[0]?.location === 'Geneva, Switzerland' && jobs[0]?.title === 'Senior PM') {
    pass('parseSmartRecruitersResponse uses fullLocation when present');
  } else {
    fail(`row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[1]?.location === 'Paris, France, Remote') {
    pass('parseSmartRecruitersResponse builds location from city/country/remote when no fullLocation');
  } else {
    fail(`row 1 location = ${JSON.stringify(jobs[1]?.location)}, expected "Paris, France, Remote"`);
  }

  if (jobs[0]?.url === 'https://jobs.smartrecruiters.com/sgs/postings/abc-123') {
    pass('parseSmartRecruitersResponse rewrites api.smartrecruiters.com → jobs.smartrecruiters.com');
  } else {
    fail(`row 0 url = ${JSON.stringify(jobs[0]?.url)}`);
  }

  if (jobs[2]?.url && jobs[2].url.startsWith('https://jobs.smartrecruiters.com/sgs/ghi-789')) {
    pass('parseSmartRecruitersResponse falls back to synthetic URL when ref is missing');
  } else {
    fail(`row 2 url = ${JSON.stringify(jobs[2]?.url)}`);
  }

  // Empty input safety
  if (parseSmartRecruitersResponse({}, 'X').length === 0) pass('empty {} input → empty result');
  else fail('empty {} input should yield empty result');

  if (parseSmartRecruitersResponse({ content: 'not an array' }, 'X').length === 0) {
    pass('non-array content → empty result (no crash)');
  } else {
    fail('non-array content should yield empty result');
  }

  // careers_url with non-string value → detect() returns null without crashing
  if (sr.detect({ name: 'X', careers_url: { foo: 'bar' } }) === null) {
    pass('smartrecruiters.detect() returns null for non-string careers_url (object)');
  } else {
    fail('smartrecruiters.detect() should treat non-string careers_url as missing');
  }

  // Fallback URL when both ref AND id are missing → empty string (not "undefined" in URL)
  const noRefNoId = parseSmartRecruitersResponse(
    { content: [{ name: 'Stranded Role' }] },
    'X',
  );
  if (noRefNoId.length === 1 && noRefNoId[0].url === '') {
    pass('parseSmartRecruitersResponse returns url="" when both ref and id are missing');
  } else {
    fail(`expected url='' when ref+id both missing, got ${JSON.stringify(noRefNoId[0])}`);
  }

  // SSRF: malicious URL with smartrecruiters hostname in the PATH (not host) must not be detected.
  if (sr.detect({ name: 'Spoof', careers_url: 'https://evil.example/careers.smartrecruiters.com/slug' }) === null) {
    pass('smartrecruiters.detect() rejects path-spoofed URLs');
  } else {
    fail('smartrecruiters.detect() must NOT misdetect path-spoofed URLs');
  }

  // SmartRecruiters: untrusted j.ref host falls through to fallback rather than rewriting
  const bogusRef = parseSmartRecruitersResponse(
    { content: [{ id: 'X1', name: 'Strange Role', ref: 'https://evil.example/v1/companies/x/postings/X1' }] },
    'TestCo',
  );
  if (bogusRef[0]?.url && !bogusRef[0].url.includes('evil.example')) {
    pass('parseSmartRecruitersResponse rejects untrusted j.ref host (falls through to fallback)');
  } else {
    fail(`untrusted j.ref leaked into url: ${JSON.stringify(bogusRef[0]?.url)}`);
  }

  // SmartRecruiters: companyName with spaces/symbols is slugified for the fallback URL
  const slugifiedCompany = parseSmartRecruitersResponse(
    { content: [{ id: 'X2', name: 'Strange Role' }] },
    'My Acme & Co.',
  );
  if (slugifiedCompany[0]?.url === 'https://jobs.smartrecruiters.com/my-acme-co/X2-strange-role') {
    pass('parseSmartRecruitersResponse slugifies the companyName for the fallback URL');
  } else {
    fail(`fallback URL not properly slugified: ${JSON.stringify(slugifiedCompany[0]?.url)}`);
  }

  // Pagination: fetch() loops until an empty page (or short page) is returned
  let pageRequests = 0;
  const pagedJobs = await sr.fetch(
    { name: 'PagedCo', careers_url: 'https://careers.smartrecruiters.com/paged' },
    {
      transport: 'http',
      fetchText: async () => { throw new Error('fetchText should not be called'); },
      fetchJson: async (url) => {
        pageRequests++;
        const offset = parseInt(new URL(url).searchParams.get('offset') || '0', 10);
        if (offset === 0) {
          // Page 1: full page (100 items)
          return { content: Array.from({ length: 100 }, (_, i) => ({ id: `P1-${i}`, name: `Role 1-${i}` })) };
        }
        if (offset === 100) {
          // Page 2: short page (50 items) → loop stops after this
          return { content: Array.from({ length: 50 }, (_, i) => ({ id: `P2-${i}`, name: `Role 2-${i}` })) };
        }
        // Should not be reached because page 2 was short
        return { content: [] };
      },
    },
  );
  if (pageRequests === 2 && pagedJobs.length === 150) {
    pass('smartrecruiters.fetch() paginates and aggregates results (2 pages → 150 total)');
  } else {
    fail(`pagination: pageRequests=${pageRequests}, total=${pagedJobs.length} (expected 2 requests / 150 results)`);
  }

  // Pagination stop condition: empty content terminates the loop
  let emptyPageRequests = 0;
  const emptyJobs = await sr.fetch(
    { name: 'EmptyCo', careers_url: 'https://careers.smartrecruiters.com/empty' },
    {
      transport: 'http',
      fetchText: async () => { throw new Error('fetchText should not be called'); },
      fetchJson: async () => {
        emptyPageRequests++;
        return { content: [] };
      },
    },
  );
  if (emptyPageRequests === 1 && emptyJobs.length === 0) {
    pass('smartrecruiters.fetch() stops on the first empty page');
  } else {
    fail(`empty pagination: requests=${emptyPageRequests}, total=${emptyJobs.length}`);
  }

} catch (e) {
  fail(`smartrecruiters provider tests crashed: ${e.message}`);
}

// ── 14. PROVIDERS — Recruitee ───────────────────────────────────────

console.log('\n14. Provider — recruitee');

try {
  const recruitee = (await import(pathToFileURL(join(ROOT, 'providers/recruitee.mjs')).href)).default;
  const { parseRecruiteeResponse } = await import(pathToFileURL(join(ROOT, 'providers/recruitee.mjs')).href);

  if (recruitee.id === 'recruitee') pass('recruitee.id is "recruitee"');
  else fail(`recruitee.id is ${JSON.stringify(recruitee.id)}`);

  const hit = recruitee.detect({ name: 'Channable', careers_url: 'https://channable.recruitee.com' });
  if (hit && hit.url === 'https://channable.recruitee.com/api/offers/') {
    pass('recruitee.detect() resolves <slug>.recruitee.com → api offers');
  } else {
    fail(`recruitee.detect() returned ${JSON.stringify(hit)}`);
  }

  if (recruitee.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('recruitee.detect() returns null for non-recruitee URLs');
  } else {
    fail('recruitee.detect() should return null for non-recruitee URLs');
  }

  // parseRecruiteeResponse
  const sample = {
    offers: [
      { title: 'Senior PM', careers_url: 'https://channable.recruitee.com/o/senior-pm', city: 'Utrecht', country: 'Netherlands', remote: false },
      { title: 'Backend Eng', url: 'https://channable.recruitee.com/o/backend', city: 'Amsterdam', country: 'Netherlands', remote: true },
      { title: 'AI Lead', location: 'Remote, EMEA' },
    ],
  };
  const jobs = parseRecruiteeResponse(sample, 'Channable');
  if (jobs.length === 3) pass('parseRecruiteeResponse extracts 3 offers');
  else fail(`parseRecruiteeResponse returned ${jobs.length} offers`);

  if (jobs[0]?.title === 'Senior PM' && jobs[0]?.company === 'Channable' && jobs[0]?.url === 'https://channable.recruitee.com/o/senior-pm') {
    pass('parseRecruiteeResponse prefers careers_url field over url');
  } else {
    fail(`row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[1]?.location === 'Amsterdam, Netherlands, Remote') {
    pass('parseRecruiteeResponse assembles city/country/remote when no location field');
  } else {
    fail(`row 1 location = ${JSON.stringify(jobs[1]?.location)}, expected "Amsterdam, Netherlands, Remote"`);
  }

  if (jobs[2]?.location === 'Remote, EMEA') {
    pass('parseRecruiteeResponse uses explicit location field when present');
  } else {
    fail(`row 2 location = ${JSON.stringify(jobs[2]?.location)}`);
  }

  if (parseRecruiteeResponse({}, 'X').length === 0) pass('empty {} → empty result');
  else fail('empty {} should yield empty result');

  if (parseRecruiteeResponse({ offers: null }, 'X').length === 0) {
    pass('null offers → empty result (no crash)');
  } else {
    fail('null offers should yield empty result');
  }

  // careers_url with non-string value → detect() returns null without crashing
  if (recruitee.detect({ name: 'X', careers_url: null }) === null && recruitee.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('recruitee.detect() returns null for non-string careers_url (null and 7)');
  } else {
    fail('recruitee.detect() should treat non-string careers_url as missing');
  }

  // SSRF: malicious URL with recruitee.com in the PATH (not host) must not be detected.
  if (recruitee.detect({ name: 'Spoof', careers_url: 'https://evil.example/channable.recruitee.com/foo' }) === null) {
    pass('recruitee.detect() rejects path-spoofed URLs');
  } else {
    fail('recruitee.detect() must NOT misdetect path-spoofed URLs');
  }

  // Off-domain offer URL is dropped (URL validation)
  const offDomainOffers = parseRecruiteeResponse(
    {
      offers: [
        { title: 'Good', careers_url: 'https://channable.recruitee.com/o/good' },
        { title: 'Evil', careers_url: 'https://evil.example/o/evil' },
        { title: 'Insecure', careers_url: 'http://channable.recruitee.com/o/insecure' },
        { title: 'No URL field' },
      ],
    },
    'Channable',
  );
  if (offDomainOffers[0]?.url === 'https://channable.recruitee.com/o/good' && offDomainOffers[1]?.url === '' && offDomainOffers[2]?.url === '' && offDomainOffers[3]?.url === '') {
    pass('parseRecruiteeResponse drops off-domain, non-https, and missing offer URLs');
  } else {
    fail(`URL validation: row0=${JSON.stringify(offDomainOffers[0]?.url)}, row1=${JSON.stringify(offDomainOffers[1]?.url)}, row2=${JSON.stringify(offDomainOffers[2]?.url)}, row3=${JSON.stringify(offDomainOffers[3]?.url)}`);
  }

} catch (e) {
  fail(`recruitee provider tests crashed: ${e.message}`);
}

// ── 12. TRACKER REPORT LINK NORMALIZATION (#760) ────────────────

console.log('\n12. Tracker report-link normalization');

try {
  const { normalizeReportLink } = await import(pathToFileURL(join(ROOT, 'tracker-links.mjs')).href);
  const repo = '/repo';
  const dataDir = join(repo, 'data');

  // data/ layout: root-relative TSV link → ../reports/...
  const fromTsv = normalizeReportLink('[12](reports/012-acme-2026-01-04.md)', dataDir, repo);
  if (fromTsv === '[12](../reports/012-acme-2026-01-04.md)') {
    pass('data/ layout: root-relative link rewritten to ../reports/...');
  } else {
    fail(`data/ layout normalization wrong: ${fromTsv}`);
  }

  // Idempotent: re-running on an already-normalized link must not double-prefix
  const twice = normalizeReportLink(fromTsv, dataDir, repo);
  if (twice === fromTsv) {
    pass('normalization is idempotent (no double-prefix on re-run)');
  } else {
    fail(`normalization not idempotent: ${twice}`);
  }

  // Root layout: tracker at repo root → link stays reports/...
  const atRoot = normalizeReportLink('[12](reports/012-acme-2026-01-04.md)', repo, repo);
  if (atRoot === '[12](reports/012-acme-2026-01-04.md)') {
    pass('root layout: link stays root-relative reports/...');
  } else {
    fail(`root layout normalization wrong: ${atRoot}`);
  }

  // Non-report links are left untouched — including external URLs that happen
  // to contain an embedded "/reports/" segment (must not be rewritten).
  const other = normalizeReportLink('[site](https://example.com/reports/foo.md)', dataDir, repo);
  if (other === '[site](https://example.com/reports/foo.md)') {
    pass('non-report links (incl. URLs with embedded /reports/) are left untouched');
  } else {
    fail(`non-report link altered: ${other}`);
  }

  // End-to-end migration against a fictional fixture tracker (no personal data)
  const tmpDir = mkdtempSync(join(tmpdir(), 'career-ops-migrate-'));
  try {
    mkdirSync(join(tmpDir, 'data'));
    mkdirSync(join(tmpDir, 'reports'));
    writeFileSync(join(tmpDir, 'reports', '012-acme-2026-01-04.md'), '# fixture\n');
    const tracker = join(tmpDir, 'data', 'applications.md');
    writeFileSync(tracker,
      '# Applications Tracker\n\n' +
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
      '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
      '| 12 | 2026-01-04 | Acme | Engineer | 4.2/5 | Evaluated | ✅ | [12](reports/012-acme-2026-01-04.md) | ok |\n');

    // Migrate by pointing the script at the fixture tracker via env override.
    run(NODE, ['merge-tracker.mjs', '--migrate'], { env: { ...process.env, CAREER_OPS_TRACKER: tracker } });
    const after = readFileSync(tracker, 'utf-8');
    if (after.includes('[12](../reports/012-acme-2026-01-04.md)')) {
      pass('migration rewrites fixture tracker links to ../reports/...');
    } else {
      fail('migration did not rewrite fixture tracker link');
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
} catch (e) {
  fail(`tracker-link normalization tests crashed: ${e.message}`);
}

// ── MERGE-TRACKER FUZZY DEDUP (#751 / #721 family) ──────────────
// roleFuzzyMatch over-matched whenever the token overlap dominated the
// SMALLER side: two distinct roles sharing a long prefix ("Full-Stack
// Engineer 5, AI Insights & Visualizations" vs "Full Stack Engineer 5, Ads
// Reporting") or a brand token (#751: "UberEats Feed" vs "Consumer
// Fulfillment (UberEats)") collapsed onto one tracker row — silently
// dropping evaluations. The ratio now divides by the token UNION (true
// Jaccard): genuine reposts (identical token sets) still score 1.0, while
// distinct specialties fall below the 0.6 threshold.
console.log('\n🧪 Testing merge-tracker fuzzy dedup (distinct roles vs reposts)...');
try {
  const mergeTmp = mkdtempSync(join(tmpdir(), 'career-ops-merge-'));
  try {
    mkdirSync(join(mergeTmp, 'data'));
    mkdirSync(join(mergeTmp, 'reports'));
    const additionsDir = join(mergeTmp, 'additions');
    mkdirSync(additionsDir);
    const tracker = join(mergeTmp, 'data', 'applications.md');
    writeFileSync(tracker,
      '# Applications Tracker\n\n' +
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
      '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
      '| 1 | 2026-01-04 | StreamCo | Full Stack Engineer 5, Ads Reporting | 4.4/5 | Evaluated | ❌ | [1](../reports/001-streamco-2026-01-04.md) | existing |\n' +
      '| 2 | 2026-01-04 | Uber | Senior Software Engineer, Consumer Fulfillment (UberEats) | 4.2/5 | Evaluated | ❌ | [2](../reports/002-uber-2026-01-04.md) | existing |\n');
    for (const n of ['001-streamco-2026-01-04', '002-uber-2026-01-04', '003-streamco-2026-01-05', '004-uber-2026-01-05', '005-streamco-2026-01-06']) {
      writeFileSync(join(mergeTmp, 'reports', `${n}.md`), '# fixture\n');
    }
    // Two DISTINCT roles (long shared prefix / shared brand token) + one true repost (score bump).
    writeFileSync(join(additionsDir, '003-streamco.tsv'),
      '3\t2026-01-05\tStreamCo\tFull-Stack Engineer 5, AI Insights & Visualizations\tEvaluated\t4.6/5\t❌\t[3](reports/003-streamco-2026-01-05.md)\tdistinct role\n');
    writeFileSync(join(additionsDir, '004-uber.tsv'),
      '4\t2026-01-05\tUber\tSenior Software Engineer, UberEats Feed\tEvaluated\t4.1/5\t❌\t[4](reports/004-uber-2026-01-05.md)\tdistinct team (#751)\n');
    writeFileSync(join(additionsDir, '005-streamco.tsv'),
      '5\t2026-01-06\tStreamCo\tFull Stack Engineer 5, Ads Reporting\tEvaluated\t4.5/5\t❌\t[5](reports/005-streamco-2026-01-06.md)\trepost\n');

    run(NODE, ['merge-tracker.mjs'], { env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: additionsDir } });
    const merged = readFileSync(tracker, 'utf-8');

    // Distinct role sharing a long prefix must be ADDED, not folded into the existing row.
    if (merged.includes('AI Insights & Visualizations') && merged.includes('Ads Reporting')) {
      pass('distinct roles with shared prefix kept as separate rows');
    } else {
      fail('distinct role with shared prefix was merged away (silent data loss)');
    }

    // #751 repro: different teams under one brand token must both survive.
    if (merged.includes('UberEats Feed') && merged.includes('Consumer Fulfillment')) {
      pass('brand-token roles (#751: UberEats Feed vs Consumer Fulfillment) kept separate');
    } else {
      fail('brand-token roles were deduped (#751 regression)');
    }

    // True repost (identical role tokens) must still UPDATE in place — exactly one row, score bumped.
    const adsRows = merged.split('\n').filter(l => l.includes('Ads Reporting'));
    if (adsRows.length === 1 && adsRows[0].includes('4.5/5')) {
      pass('true repost still updates the existing row in place (4.4 → 4.5, no duplicate)');
    } else {
      fail(`repost handling broken: ${adsRows.length} 'Ads Reporting' rows, expected 1 updated to 4.5/5`);
    }
  } finally {
    rmSync(mergeTmp, { recursive: true, force: true });
  }
} catch (e) {
  fail(`merge-tracker fuzzy dedup tests crashed: ${e.message}`);
}

// ── 12. COLD-START TRIGGER ──────────────────────────────────────

console.log('\n12. Cold-start trigger (deterministic onboarding state)');

try {
  // Virgin env: none of the 4 user-layer prerequisites present → must onboard.
  const virgin = mkdtempSync(join(tmpdir(), 'co-cold-'));
  const v = JSON.parse(run(NODE, ['doctor.mjs', '--json', '--target', virgin]) || '{}');
  if (
    v.onboardingNeeded === true &&
    Array.isArray(v.missing) &&
    v.missing.length === 4 &&
    Array.isArray(v.warnings)
  ) {
    pass('Virgin env → onboarding triggered (4 prerequisites missing)');
  } else {
    fail(`Virgin env not flagged for onboarding: ${JSON.stringify(v)}`);
  }
  rmSync(virgin, { recursive: true, force: true });

  // Fully provisioned env: all 4 present → must NOT onboard.
  const ready = mkdtempSync(join(tmpdir(), 'co-ready-'));
  mkdirSync(join(ready, 'config'), { recursive: true });
  mkdirSync(join(ready, 'modes'), { recursive: true });
  for (const f of ['cv.md', 'config/profile.yml', 'modes/_profile.md', 'portals.yml']) {
    writeFileSync(join(ready, f), 'x');
  }
  const r = JSON.parse(run(NODE, ['doctor.mjs', '--json', '--target', ready]) || '{}');
  if (r.onboardingNeeded === false && Array.isArray(r.warnings)) {
    pass('Provisioned env → no onboarding');
  } else {
    fail(`Provisioned env falsely flagged for onboarding: ${JSON.stringify(r)}`);
  }
  rmSync(ready, { recursive: true, force: true });

  const claudeDoc = readFile('CLAUDE.md');
  if (
    /node\s+doctor\.mjs\s+--json/.test(claudeDoc) &&
    /"warnings"\s*:\s*\[\.\.\.\]/.test(claudeDoc) &&
    !/Does\s+`cv\.md`\s+exist\?/i.test(claudeDoc)
  ) {
    pass('CLAUDE.md delegates onboarding state to doctor --json');
  } else {
    fail('CLAUDE.md still duplicates onboarding prerequisite checks');
  }
} catch (e) {
  fail(`Cold-start trigger test crashed: ${e.message}`);
}
// ── 15. PROVIDERS — SolidJobs ─────────────────────────────────────

console.log('\n15. Provider — solidjobs');

try {
  const sj = (await import(pathToFileURL(join(ROOT, 'providers/solidjobs.mjs')).href)).default;

  if (sj.id === 'solidjobs') pass('solidjobs.id is "solidjobs"');
  else fail(`solidjobs.id is ${JSON.stringify(sj.id)}`);

  // detect() matches valid SolidJobs API URL
  const hit = sj.detect({ name: 'SJ', careers_url: 'https://solid.jobs/public-api/offers/it?campaign=career-ops' });
  if (hit && hit.url) pass('solidjobs.detect() matches valid API URL');
  else fail('solidjobs.detect() should match solid.jobs public-api URL');

  // detect() rejects non-SolidJobs URL
  if (sj.detect({ name: 'X', careers_url: 'https://example.com/jobs' }) === null) {
    pass('solidjobs.detect() rejects non-SolidJobs URL');
  } else {
    fail('solidjobs.detect() must reject non-SolidJobs URLs');
  }

  // detect() rejects path-spoofed URL (solid.jobs in path, not hostname)
  if (sj.detect({ name: 'X', careers_url: 'https://evil.example/solid.jobs/public-api/offers/it' }) === null) {
    pass('solidjobs.detect() rejects path-spoofed URLs');
  } else {
    fail('solidjobs.detect() must NOT misdetect URLs with solid.jobs in the path');
  }

  // detect() returns null for non-string careers_url
  if (sj.detect({ name: 'X', careers_url: 42 }) === null) {
    pass('solidjobs.detect() returns null for non-string careers_url (42)');
  } else {
    fail('solidjobs.detect() should treat non-string careers_url as missing');
  }

  // detect() returns null for missing careers_url
  if (sj.detect({ name: 'X' }) === null) {
    pass('solidjobs.detect() returns null for missing careers_url');
  } else {
    fail('solidjobs.detect() should return null when careers_url is missing');
  }

  // fetch() parses { jobs: [...] } response with company from API
  const fakeJobs = {
    jobs: [
      { title: 'Senior Dev', url: 'https://solid.jobs/o/abc123/career-ops', company: 'Acme Corp', locations: ['Warszawa', 'Remote'] },
      { title: 'Junior Dev', url: 'https://solid.jobs/o/def456/career-ops', company: 'Beta Inc', locations: ['Kraków'] },
    ],
  };
  const parsed = await sj.fetch(
    { name: 'SolidJobs IT', careers_url: 'https://solid.jobs/public-api/offers/it?campaign=career-ops' },
    { transport: 'http', fetchJson: async () => fakeJobs, fetchText: async () => '' },
  );
  if (parsed.length === 2) pass('solidjobs.fetch() returns 2 jobs from mock response');
  else fail(`solidjobs.fetch() returned ${parsed.length} jobs, expected 2`);

  if (parsed[0].company === 'Acme Corp') pass('solidjobs.fetch() uses j.company from API response');
  else fail(`solidjobs.fetch() company is ${JSON.stringify(parsed[0].company)}, expected "Acme Corp"`);

  if (parsed[0].location === 'Warszawa, Remote') pass('solidjobs.fetch() joins locations array');
  else fail(`solidjobs.fetch() location is ${JSON.stringify(parsed[0].location)}, expected "Warszawa, Remote"`);

  if (parsed[0].title === 'Senior Dev' && parsed[0].url === 'https://solid.jobs/o/abc123/career-ops') {
    pass('solidjobs.fetch() maps title and url correctly');
  } else {
    fail(`solidjobs.fetch() title/url wrong: ${JSON.stringify(parsed[0])}`);
  }

  // fetch() falls back to entry.name when j.company is missing
  const noCompanyJobs = { jobs: [{ title: 'Tester', url: 'https://solid.jobs/o/xyz/career-ops', locations: [] }] };
  const fallback = await sj.fetch(
    { name: 'SolidJobs IT', careers_url: 'https://solid.jobs/public-api/offers/it?campaign=career-ops' },
    { transport: 'http', fetchJson: async () => noCompanyJobs, fetchText: async () => '' },
  );
  if (fallback[0].company === 'SolidJobs IT') pass('solidjobs.fetch() falls back to entry.name when j.company missing');
  else fail(`solidjobs.fetch() fallback company is ${JSON.stringify(fallback[0].company)}`);

  // fetch() handles empty locations array
  if (fallback[0].location === '') pass('solidjobs.fetch() returns empty string for empty locations array');
  else fail(`solidjobs.fetch() location for empty array is ${JSON.stringify(fallback[0].location)}`);

  // fetch() rejects non-SolidJobs hostname (SSRF)
  let ssrfRejected = false;
  try {
    await sj.fetch(
      { name: 'Evil', careers_url: 'https://evil.com/public-api/offers/it' },
      { transport: 'http', fetchJson: async () => { throw new Error('SSRF! should not reach here'); }, fetchText: async () => '' },
    );
  } catch (e) {
    if (e.message.includes('untrusted hostname')) ssrfRejected = true;
    else fail(`solidjobs.fetch() rejected with wrong error: ${e.message}`);
  }
  if (ssrfRejected) pass('solidjobs.fetch() rejects untrusted hostname (SSRF protection)');
  else fail('solidjobs.fetch() should reject non-solid.jobs hostnames');

  // fetch() throws on missing careers_url
  let missingUrl = false;
  try {
    await sj.fetch(
      { name: 'No URL' },
      { transport: 'http', fetchJson: async () => ({}), fetchText: async () => '' },
    );
  } catch (e) {
    if (e.message.includes('careers_url required')) missingUrl = true;
    else fail(`solidjobs.fetch() missing URL error: ${e.message}`);
  }
  if (missingUrl) pass('solidjobs.fetch() throws on missing careers_url');
  else fail('solidjobs.fetch() should throw when careers_url is missing');

  // fetch() rejects HTTP (non-HTTPS) URL
  let httpRejected = false;
  try {
    await sj.fetch(
      { name: 'HTTP', careers_url: 'http://solid.jobs/public-api/offers/it' },
      { transport: 'http', fetchJson: async () => { throw new Error('should not reach here'); }, fetchText: async () => '' },
    );
  } catch (e) {
    if (e.message.includes('HTTPS')) httpRejected = true;
    else fail(`solidjobs.fetch() HTTP rejection wrong error: ${e.message}`);
  }
  if (httpRejected) pass('solidjobs.fetch() rejects HTTP URLs (HTTPS enforcement)');
  else fail('solidjobs.fetch() should reject non-HTTPS URLs');

  // fetch() rejects malformed/unparseable URL
  let malformedRejected = false;
  try {
    await sj.fetch(
      { name: 'Bad', careers_url: 'not-a-url' },
      { transport: 'http', fetchJson: async () => { throw new Error('should not reach here'); }, fetchText: async () => '' },
    );
  } catch (e) {
    if (e.message.includes('invalid URL')) malformedRejected = true;
    else fail(`solidjobs.fetch() malformed URL wrong error: ${e.message}`);
  }
  if (malformedRejected) pass('solidjobs.fetch() rejects malformed URLs');
  else fail('solidjobs.fetch() should reject unparseable URLs');

  // fetch() throws on unexpected API response (no jobs array)
  const badResponses = [
    [{}, 'empty object'],
    [{ jobs: null }, 'jobs: null'],
    [{ jobs: 'not-array' }, 'jobs: string'],
    [{ offers: [] }, 'wrong key name'],
    [null, 'null response'],
  ];
  for (const [resp, label] of badResponses) {
    let threw = false;
    try {
      await sj.fetch(
        { name: 'SolidJobs IT', careers_url: 'https://solid.jobs/public-api/offers/it?campaign=career-ops' },
        { transport: 'http', fetchJson: async () => resp, fetchText: async () => '' },
      );
    } catch (e) {
      if (e.message.includes('unexpected API response')) threw = true;
      else fail(`solidjobs.fetch() bad response (${label}) wrong error: ${e.message}`);
    }
    if (threw) pass(`solidjobs.fetch() throws on bad API response (${label})`);
    else fail(`solidjobs.fetch() should throw on bad API response (${label})`);
  }

  // fetch() filters out jobs with empty/missing url
  const mixedJobs = {
    jobs: [
      { title: 'Has URL', url: 'https://solid.jobs/o/1/career-ops', company: 'A', locations: [] },
      { title: 'No URL', url: '', company: 'B', locations: [] },
      { title: 'Missing URL', company: 'C', locations: [] },
    ],
  };
  const filtered = await sj.fetch(
    { name: 'SolidJobs IT', careers_url: 'https://solid.jobs/public-api/offers/it?campaign=career-ops' },
    { transport: 'http', fetchJson: async () => mixedJobs, fetchText: async () => '' },
  );
  if (filtered.length === 1 && filtered[0].title === 'Has URL') pass('solidjobs.fetch() filters out jobs with empty/missing url');
  else fail(`solidjobs.fetch() should filter empty URLs, got ${filtered.length} jobs: ${JSON.stringify(filtered)}`);

  // fetch() handles string locations (non-array)
  const stringLocJobs = { jobs: [{ title: 'Dev', url: 'https://solid.jobs/o/2/career-ops', company: 'X', locations: 'Warsaw' }] };
  const strLoc = await sj.fetch(
    { name: 'SolidJobs IT', careers_url: 'https://solid.jobs/public-api/offers/it?campaign=career-ops' },
    { transport: 'http', fetchJson: async () => stringLocJobs, fetchText: async () => '' },
  );
  if (strLoc[0].location === 'Warsaw') pass('solidjobs.fetch() handles string locations');
  else fail(`solidjobs.fetch() string location is ${JSON.stringify(strLoc[0].location)}, expected "Warsaw"`);

  // detect() returns null for valid hostname but wrong path
  if (sj.detect({ name: 'X', careers_url: 'https://solid.jobs/careers' }) === null) {
    pass('solidjobs.detect() rejects solid.jobs URL with wrong path');
  } else {
    fail('solidjobs.detect() should reject solid.jobs URLs not under /public-api/offers/');
  }

  // fetch() passes redirect:'error' to fetchJson
  let capturedOpts = null;
  await sj.fetch(
    { name: 'SolidJobs IT', careers_url: 'https://solid.jobs/public-api/offers/it?campaign=career-ops' },
    { transport: 'http', fetchJson: async (_url, opts) => { capturedOpts = opts; return { jobs: [] }; }, fetchText: async () => '' },
  );
  if (capturedOpts && capturedOpts.redirect === 'error') pass('solidjobs.fetch() passes redirect:"error" to fetchJson');
  else fail(`solidjobs.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);

  // fetch() tolerates malformed array members without crashing
  const malformedMembers = { jobs: [null, 7, { title: 'OK', url: 'https://solid.jobs/o/3/career-ops', company: 'Z' }] };
  const safeParsed = await sj.fetch(
    { name: 'SolidJobs IT', careers_url: 'https://solid.jobs/public-api/offers/it?campaign=career-ops' },
    { transport: 'http', fetchJson: async () => malformedMembers, fetchText: async () => '' },
  );
  if (safeParsed.length === 1 && safeParsed[0].url === 'https://solid.jobs/o/3/career-ops') {
    pass('solidjobs.fetch() skips malformed jobs members without crashing');
  } else {
    fail(`solidjobs.fetch() malformed members handling failed: ${JSON.stringify(safeParsed)}`);
  }
} catch (e) {
  fail(`solidjobs provider tests crashed: ${e.message}`);
}

// ── 15. URL REDISCOVERY FALLBACK (--rediscover-404) ─────────────

console.log('\n15. URL rediscovery fallback');

try {
  const { extractCareersUrlDomain, pickRediscoveredUrl } = await import(
    pathToFileURL(join(ROOT, 'scan.mjs')).href
  );

  // extractCareersUrlDomain — pure hostname extraction, null on missing/invalid
  if (extractCareersUrlDomain('https://job-boards.greenhouse.io/anthropic') === 'job-boards.greenhouse.io') {
    pass('extractCareersUrlDomain pulls hostname from a careers URL');
  } else {
    fail('extractCareersUrlDomain failed on a valid URL');
  }
  if (extractCareersUrlDomain(null) === null) {
    pass('extractCareersUrlDomain returns null for missing careers_url');
  } else {
    fail('extractCareersUrlDomain did not return null for null input');
  }
  if (extractCareersUrlDomain('not-a-url') === null) {
    pass('extractCareersUrlDomain returns null for an unparseable URL');
  } else {
    fail('extractCareersUrlDomain did not return null for a bad URL');
  }

  // pickRediscoveredUrl — first search hit whose hostname exactly matches domain
  const domain = 'job-boards.greenhouse.io';
  const hrefs = [
    'https://duckduckgo.com/l/?uddg=ad',          // search-engine chrome / noise
    'https://other-board.lever.co/acme/123',      // wrong domain
    'https://job-boards.greenhouse.io/acme/456',  // first real match
    'https://job-boards.greenhouse.io/acme/789',  // later match
  ];
  if (pickRediscoveredUrl(hrefs, domain) === 'https://job-boards.greenhouse.io/acme/456') {
    pass('pickRediscoveredUrl returns the first same-domain result');
  } else {
    fail(`pickRediscoveredUrl picked the wrong URL: ${pickRediscoveredUrl(hrefs, domain)}`);
  }
  if (pickRediscoveredUrl(['https://elsewhere.com/x'], domain) === null) {
    pass('pickRediscoveredUrl returns null when no result matches the domain');
  } else {
    fail('pickRediscoveredUrl did not return null for no domain match');
  }
  if (pickRediscoveredUrl([], domain) === null) {
    pass('pickRediscoveredUrl returns null for an empty result set');
  } else {
    fail('pickRediscoveredUrl did not return null for empty input');
  }
  // Redirect unwrapping is restricted to real DuckDuckGo hosts: a look-alike
  // host must not get its uddg target unwrapped (and its own hostname does not
  // match the careers domain, so the result is null).
  const lookAlike = `https://evil-duckduckgo.com/l/?uddg=${encodeURIComponent('https://job-boards.greenhouse.io/acme/456')}`;
  if (pickRediscoveredUrl([lookAlike], domain) === null) {
    pass('pickRediscoveredUrl ignores uddg redirects from look-alike hosts');
  } else {
    fail('pickRediscoveredUrl unwrapped a redirect from a look-alike host');
  }
  // DuckDuckGo HTML wraps each result in a /l/?uddg= redirect — must be
  // unwrapped, otherwise every hostname looks like duckduckgo.com and nothing
  // ever matches the careers domain (the fallback would silently never fire).
  const ddg = ['//duckduckgo.com/l/?uddg=' + encodeURIComponent('https://job-boards.greenhouse.io/acme/999')];
  if (pickRediscoveredUrl(ddg, domain) === 'https://job-boards.greenhouse.io/acme/999') {
    pass('pickRediscoveredUrl unwraps DuckDuckGo redirect links');
  } else {
    fail(`pickRediscoveredUrl did not unwrap DDG redirect: ${pickRediscoveredUrl(ddg, domain)}`);
  }
  // A look-alike host that merely contains the domain as a substring must not match.
  if (pickRediscoveredUrl(['https://job-boards.greenhouse.io.attacker.com/x'], domain) === null) {
    pass('pickRediscoveredUrl rejects look-alike hostnames');
  } else {
    fail('pickRediscoveredUrl accepted a look-alike hostname');
  }
} catch (e) {
  fail(`URL rediscovery tests crashed: ${e.message}`);
}

// ── 13. BATCH RATE-LIMIT PAUSE ──────────────────────────────────

console.log('\n13. Batch rate-limit pause');

try {
  const tmp = mkdtempSync(join(tmpdir(), 'co-batch-rate-'));
  const batchDir = join(tmp, 'batch');
  const fakeBin = join(tmp, 'bin');
  mkdirSync(batchDir, { recursive: true });
  mkdirSync(join(tmp, 'reports'), { recursive: true });
  mkdirSync(join(tmp, 'data'), { recursive: true });
  mkdirSync(fakeBin, { recursive: true });

  writeFileSync(join(batchDir, 'batch-runner.sh'), readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8'));
  execFileSync('chmod', ['+x', join(batchDir, 'batch-runner.sh')]);
  writeFileSync(join(tmp, 'merge-tracker.mjs'), 'console.log("merge fixture");\n');
  writeFileSync(join(tmp, 'verify-pipeline.mjs'), 'console.log("verify fixture");\n');
  writeFileSync(join(batchDir, 'batch-prompt.md'), 'URL={{URL}}\nJD={{JD_FILE}}\nREPORT={{REPORT_NUM}}\n');
  writeFileSync(join(batchDir, 'batch-input.tsv'), [
    'id\turl\tsource\tnotes',
    '1\thttps://example.com/one\tfixture\t-',
    '2\thttps://example.com/two\tfixture\t-',
    '3\thttps://example.com/three\tfixture\t-',
  ].join('\n') + '\n');
  writeFileSync(join(fakeBin, 'claude'), [
    '#!/usr/bin/env bash',
    'echo "You\\x27ve hit your session limit · resets 12:30pm (Asia/Taipei)"',
    'exit 1',
  ].join('\n') + '\n');
  execFileSync('chmod', ['+x', join(fakeBin, 'claude')]);

  const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` };
  const out = run('bash', [join(batchDir, 'batch-runner.sh'), '--parallel', '1', '--max-retries', '3', '--rate-limit-sleep', '0'], {
    cwd: tmp,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) || '';
  const state = readFileSync(join(batchDir, 'batch-state.tsv'), 'utf-8').trim().split('\n');
  const first = state[1]?.split('\t') || [];

  if (state.length === 2 && first[0] === '1' && first[2] === 'paused_rate_limit' && first[8] === '0' && out.includes('pausing batch')) {
    pass('session-limit pauses batch without consuming retry budget or scheduling more jobs');
  } else {
    fail(`session-limit pause wrong: lines=${state.length}, first=${JSON.stringify(first)}, out=${JSON.stringify(out.slice(-240))}`);
  }

  writeFileSync(join(batchDir, 'batch-state.tsv'), [
    'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries',
    '1\thttps://example.com/one\tpaused_rate_limit\t2026-01-01T00:00:00Z\t2026-01-01T00:00:01Z\t001\t-\tsession-limit; paused\t0',
    '2\thttps://example.com/two\tfailed\t2026-01-01T00:00:00Z\t2026-01-01T00:00:01Z\t002\t-\tworker-crash\t1',
  ].join('\n') + '\n');
  const dry = run('bash', [join(batchDir, 'batch-runner.sh'), '--resume-paused', '--dry-run'], {
    cwd: tmp,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) || '';
  if (dry.includes('#1: https://example.com/one') && !dry.includes('#2: https://example.com/two')) {
    pass('--resume-paused dry-run selects paused jobs only');
  } else {
    fail(`--resume-paused selection wrong: ${dry}`);
  }

  rmSync(tmp, { recursive: true, force: true });
} catch (e) {
  fail(`Batch rate-limit pause test crashed: ${e.message}`);
}

// ── 15. BATCH RUNNER MCP ISOLATION (#506) ───────────────────────

console.log('\n15. Batch runner MCP isolation');

try {
  const batchRunner = readFileSync(join(ROOT, 'batch', 'batch-runner.sh'), 'utf-8');
  // Workers must be spawned with --strict-mcp-config so they don't inherit the
  // parent session's MCP servers (e.g. Playwright) and deadlock fighting over a
  // single browser when --parallel > 1 (issue #506).
  const claudeArgsLine = batchRunner
    .split('\n')
    .find(l => l.includes('claude_args=('));
  if (claudeArgsLine && claudeArgsLine.includes('--strict-mcp-config')) {
    pass('batch workers spawn with --strict-mcp-config (no inherited MCP)');
  } else {
    fail('batch-runner.sh worker spawn missing --strict-mcp-config (issue #506 regression)');
  }
} catch (e) {
  fail(`Batch runner MCP isolation test crashed: ${e.message}`);
}

// ── SUMMARY ─────────────────────────────────────────────────────

console.log('\n' + '='.repeat(50));
console.log(`📊 Results: ${passed} passed, ${failed} failed, ${warnings} warnings`);

if (failed > 0) {
  console.log('🔴 TESTS FAILED — do NOT push/merge until fixed\n');
  process.exit(1);
} else if (warnings > 0) {
  console.log('🟡 Tests passed with warnings — review before pushing\n');
  process.exit(0);
} else {
  console.log('🟢 All tests passed — safe to push/merge\n');
  process.exit(0);
}
