// tests/privacy-filter.test.mjs — opt-in contact redaction (utils/privacy-filter.mjs)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pass, fail, ROOT } from './helpers.mjs';
import {
  PLACEHOLDERS, isRedactionEnabled, redactCandidatePII, restoreCandidatePII,
  redactIfEnabled, restoreIfEnabled, anonymizeContext,
} from '../utils/privacy-filter.mjs';

console.log('\nprivacy-filter.mjs unit tests');

function check(cond, okMsg, failMsg) {
  if (cond) pass(okMsg); else fail(failMsg || okMsg);
}

const PROFILE_ON = `
candidate:
  full_name: "Jane Doe"
  email: "jane.doe@example.org"
  phone: "+91 98765 43210"
  linkedin: "https://www.linkedin.com/in/janedoe"
  github: "github.com/janedoe"
privacy:
  redact_contact_info: true
`;
const PROFILE_OFF = PROFILE_ON.replace('true', 'false');
const PROFILE_UNSET = PROFILE_ON.replace(/privacy:[\s\S]*$/, '');

const CV = `# Jane Doe
Email: Jane.Doe@Example.org | Phone: 98765-43210 | Alt: +91 (98765) 43210
LinkedIn: linkedin.com/in/janedoe | GitHub: https://github.com/janedoe
Contact Jane Doe at jane.doe@example.org. Worked with Janet Doerr and JANE DOE.
`;

try {
  // ── Toggle: nothing runs unless the profile turns it on ──────────────────
  check(isRedactionEnabled(PROFILE_ON), 'enabled when privacy.redact_contact_info is true');
  check(!isRedactionEnabled(PROFILE_OFF), 'disabled when the flag is false');
  check(!isRedactionEnabled(PROFILE_UNSET), 'disabled when the privacy block is absent');
  check(!isRedactionEnabled(''), 'disabled for empty profile');
  check(!isRedactionEnabled('candidate: [unclosed'), 'disabled for malformed YAML');
  check(!isRedactionEnabled(PROFILE_ON.replace('true', '"true"')), 'string "true" does not enable it');

  check(redactIfEnabled(CV, PROFILE_OFF) === CV, 'redactIfEnabled is a no-op when off');
  check(redactIfEnabled(CV, PROFILE_UNSET) === CV, 'redactIfEnabled is a no-op when unset');
  const ctxOff = { cv: CV, profile: PROFILE_OFF, profileMode: 'Jane Doe' };
  const anonOff = anonymizeContext(ctxOff);
  check(anonOff.cv === CV && anonOff.profileMode === 'Jane Doe', 'anonymizeContext is a no-op when off');

  // ── Redaction ────────────────────────────────────────────────────────────
  const red = redactIfEnabled(CV, PROFILE_ON);
  check(!/jane\s+doe/i.test(red), 'name removed (any case)');
  check(!/jane\.doe@example\.org/i.test(red), 'email removed (any case)');
  check(!/98765/.test(red) && !/43210/.test(red), 'phone removed across formats, with or without country code');
  check(!/janedoe/i.test(red), 'LinkedIn and GitHub handles removed, URL prefix forms included');
  check(red.includes(PLACEHOLDERS.name) && red.includes(PLACEHOLDERS.email), 'placeholders inserted');
  check(red.includes('Janet Doerr'), 'a different person with a similar name is left alone');

  // ── Round trip: the tailored CV gets the real details back ───────────────
  const model = `<h1>${PLACEHOLDERS.name}</h1><p>${PLACEHOLDERS.email} | ${PLACEHOLDERS.phone} | ` +
    `https://www.${PLACEHOLDERS.linkedin} | ${PLACEHOLDERS.github}</p>`;
  const back = restoreIfEnabled(model, PROFILE_ON);
  check(back.includes('<h1>Jane Doe</h1>'), 'restore puts the real name back');
  // Whole-string comparison instead of domain substring checks to satisfy CodeQL:
  const expectedBack = '<h1>Jane Doe</h1><p>jane.doe@example.org | +91 98765 43210 | ' +
    'https://www.linkedin.com/in/janedoe | github.com/janedoe</p>';
  check(back === expectedBack, 'restore emits the configured URLs exactly, without doubling the URL prefix');
  check(!/Candidate Name|candidate@|\/candidate/.test(back), 'no placeholder survives restore');
  check(restoreIfEnabled(model, PROFILE_OFF) === model, 'restoreIfEnabled is a no-op when off');
  check(restoreCandidatePII('Cost: $& $1', PROFILE_ON) === 'Cost: $& $1', 'restore leaves unrelated text untouched');

  // ── anonymizeContext ─────────────────────────────────────────────────────
  const ctx = { cv: CV, profile: PROFILE_ON, profileMode: 'Built by Jane Doe (jane.doe@example.org)', shared: 'Jane Doe' };
  const anon = anonymizeContext(ctx);
  check(!/\bjane\b/i.test(anon.cv) && !/\bjane\b/i.test(anon.profile) && !/\bjane\b/i.test(anon.profileMode), 'anonymizeContext redacts cv, profile and profileMode');
  check(anon.shared === 'Jane Doe', 'anonymizeContext leaves shared mode text alone');
  check(ctx.cv === CV, 'anonymizeContext does not mutate its input');
  check(isRedactionEnabled(anon.profile), 'redacted profile still parses and keeps the privacy flag');

  // ── Multi-email and review follow-ups ────────────────────────────────────
  const altProfile = (altBlock) => `
candidate:
  full_name: "Jane Doe"
  email: "jane.doe@example.org"
  alternate_emails:
${altBlock}
  linkedin: "https://www.linkedin.com/in/janedoe/?utm_source=share#about"
privacy:
  redact_contact_info: true
`;
  const PROFILE_ALT = altProfile('    - "jane@work.example"\n    - "jd@home.example"');
  const PROFILE_ALT_MAP = altProfile('    work: "jane@work.example"\n    personal: "jd@home.example"');
  for (const [label, prof] of [['list', PROFILE_ALT], ['mapping', PROFILE_ALT_MAP]]) {
    const out = anonymizeContext({
      cv: 'Mail jane@work.example or JD@HOME.example or jane.doe@example.org',
      profile: prof,
    });
    check(!/work\.example|home\.example|jane\.doe@/i.test(out.cv), `alternate_emails (${label}) are redacted through anonymizeContext`);
  }

  // Two-address round trip: distinct reversible placeholders preserve each address
  const CV_TWO_EMAILS = `Email: jane.doe@example.org | Work: jane@work.example`;
  const redTwo = redactIfEnabled(CV_TWO_EMAILS, PROFILE_ALT);
  check(!/jane\.doe@|jane@work/i.test(redTwo), 'both primary and alternate emails are redacted');
  check(redTwo.includes(PLACEHOLDERS.email) && redTwo.includes('candidate-alt1@example.com'),
    'each email receives a distinct placeholder');
  const restoredTwo = restoreIfEnabled(redTwo, PROFILE_ALT);
  check(restoredTwo === CV_TWO_EMAILS, 'two-address round trip preserves both primary and alternate email');

  const urlOut = redactCandidatePII(
    'See https://www.linkedin.com/in/janedoe/?utm_source=share#about and linkedin.com/in/janedoe?trk=x.', PROFILE_ALT);
  check(!/janedoe|utm_source|trk=/.test(urlOut), 'LinkedIn URL with query/fragment is redacted in full');
  check(urlOut.endsWith('.'), 'sentence punctuation after the URL is kept');

  const upper = restoreCandidatePII(`${PLACEHOLDERS.name.toUpperCase()} <${PLACEHOLDERS.email.toUpperCase()}>`, PROFILE_ON);
  check(upper === 'Jane Doe <jane.doe@example.org>', 'restore is case-insensitive for an uppercased model response');

  // ── Rule order and phone/URL edge cases ──────────────────────────────────
  const ONE_WORD = 'candidate:\n  full_name: "Jane"\n  email: "jane.doe@example.org"\n';
  check(redactCandidatePII('Write to jane.doe@example.org, ask for Jane.', ONE_WORD) ===
    `Write to ${PLACEHOLDERS.email}, ask for ${PLACEHOLDERS.name}.`,
  'a one-word name does not corrupt the email before it is redacted');

  const WITH_EXT = 'candidate:\n  full_name: "Jane Doe"\n  phone: "+1 415 555 2671 ext 123"\n';
  check(!/555/.test(redactCandidatePII('Call 415 555 2671 or +1 (415) 555-2671', WITH_EXT)),
    'phone extension digits stay out of the number matcher');
  check(restoreCandidatePII(PLACEHOLDERS.phone, WITH_EXT) === '+1 415 555 2671 ext 123', 'restore keeps the configured phone including its extension');

  // National phone number with trunk prefix (e.g. 09876543210 for +91 98765 43210)
  const cvTrunkPhone = 'Call 09876543210 or 098-765-43210';
  const redTrunk = redactCandidatePII(cvTrunkPhone, PROFILE_ON);
  check(!/98765/.test(redTrunk), 'national trunk-prefixed phone (09876543210) is redacted for +91 profile');

  // Identity-bearing portfolio and social URLs
  const PROFILE_PORTFOLIO = `
candidate:
  full_name: "Jane Smith"
  email: "jane@example.com"
  portfolio_url: "https://janesmith.dev"
  twitter: "https://x.com/janesmith"
privacy:
  redact_contact_info: true
`;
  const cvPortfolio = 'Portfolio at https://janesmith.dev?view=full and janesmith.dev. Twitter: https://x.com/janesmith.';
  const redPortfolio = redactCandidatePII(cvPortfolio, PROFILE_PORTFOLIO);
  check(!/janesmith\.dev|x\.com\/janesmith/.test(redPortfolio), 'portfolio and twitter URLs are redacted');
  check(redPortfolio.endsWith('.'), 'sentence punctuation after social URL is kept');
  const restoredPortfolio = restoreCandidatePII(redPortfolio, PROFILE_PORTFOLIO);
  check(restoredPortfolio === 'Portfolio at https://janesmith.dev and https://janesmith.dev. Twitter: https://x.com/janesmith.',
    'portfolio and twitter URLs are restored correctly');

  // X and Twitter are one profile under two hosts: either configured form matches both
  const PROFILE_TWITTER_HOST = `
candidate:
  full_name: "Jane Smith"
  twitter: "https://twitter.com/janesmith"
privacy:
  redact_contact_info: true
`;
  const cvBothHosts = 'X: https://x.com/janesmith | Twitter: twitter.com/janesmith | www.x.com/janesmith/';
  for (const [label, prof] of [['x.com', PROFILE_PORTFOLIO], ['twitter.com', PROFILE_TWITTER_HOST]]) {
    const out = redactCandidatePII(cvBothHosts, prof);
    check(!/janesmith/i.test(out), `twitter configured on ${label} redacts both x.com and twitter.com URLs`);
  }
  check(redactCandidatePII('Files on box.com/janesmith', PROFILE_PORTFOLIO) === 'Files on box.com/janesmith',
    'x.com does not match inside a longer host such as box.com');

  // Two portfolio links: each gets its own placeholder and restores to its own URL
  const PROFILE_TWO_PORTFOLIOS = `
candidate:
  full_name: "Jane Smith"
  portfolio_url: "https://janesmith.dev"
  portfolio: "https://behance.net/janesmith"
privacy:
  redact_contact_info: true
`;
  const cvTwoPortfolios = 'Site: https://janesmith.dev | Work: https://behance.net/janesmith';
  const redTwoPortfolios = redactCandidatePII(cvTwoPortfolios, PROFILE_TWO_PORTFOLIOS);
  check(PLACEHOLDERS.portfolio_url !== PLACEHOLDERS.portfolio, 'portfolio_url and portfolio use distinct placeholders');
  check(!/janesmith/i.test(redTwoPortfolios), 'both portfolio links are redacted');
  check(restoreCandidatePII(redTwoPortfolios, PROFILE_TWO_PORTFOLIOS) === cvTwoPortfolios,
    'two-portfolio round trip restores each link in its own place');

  const EMPTY_URL = 'candidate:\n  full_name: "Jane Doe"\n  linkedin: "https://"\n  github: "www."\n';
  check(redactCandidatePII('Plain text with no profile links', EMPTY_URL) === 'Plain text with no profile links',
    'a URL value with an empty path adds no rule');

  // ── Edge cases ───────────────────────────────────────────────────────────
  check(redactCandidatePII(null, PROFILE_ON) === null, 'null text passes through');
  check(redactCandidatePII('Text', '') === 'Text', 'empty profile passes text through');
  check(redactCandidatePII('Jane Doe', 'candidate:\n  full_name: "Al"') === 'Jane Doe', 'too-short values are ignored');
  check(redactCandidatePII('a.b+c@x.io', 'candidate:\n  email: "a.b+c@x.io"') === PLACEHOLDERS.email, 'regex metacharacters in values are escaped');
} catch (err) {
  fail(`privacy-filter test crashed: ${err.stack || err.message}`);
}

// ── Wiring: each script reads the toggle through the filter, none hard-codes it ──
const read = (f) => readFileSync(join(ROOT, f), 'utf-8');
check(/redactIfEnabled/.test(read('gemini-eval.mjs')), 'gemini-eval.mjs applies the opt-in filter');
check(/anonymizeContext\(/.test(read('openrouter-runner.mjs')), 'openrouter-runner.mjs applies the opt-in filter');
const tailor = read('openai-tailor.mjs');
check(/redactIfEnabled/.test(tailor) && /restoreIfEnabled/.test(tailor), 'openai-tailor.mjs redacts and restores');
const restoreAt = tailor.indexOf('restoreIfEnabled(tailoredHtml');
const validateAt = tailor.indexOf('validateLockedSections(tailoredHtml');
check(restoreAt >= 0 && validateAt >= 0 && restoreAt < validateAt,
  'openai-tailor.mjs restores before locked-section validation');
