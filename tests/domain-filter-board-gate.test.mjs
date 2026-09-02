// tests/domain-filter-board-gate.test.mjs — the opt-in company-level gate for
// the reverse sweep (#3105): a board with no domain-bearing posting is skipped
// before any title is filtered.
//
// Two things here are worth more than the rest, because they are the two a
// later refactor is most likely to undo without noticing:
//
//   1. ABSENT domain_filter must produce null, not a permissive predicate.
//      Every portals.yml written before this feature is in that state, and the
//      gate silently swallowing boards for them is the one outcome that must
//      never happen.
//   2. The default matching mode is WHOLE WORD. An implementation that made it
//      `stem:` would still pass a naive "matches Blockchain" assertion while
//      admitting Deficiência, Defiance, Software Defined and Product Definition
//      — the 25-of-28 junk majority the gate exists to remove. The junk cases
//      below are what tells the two apart.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nscan-ats-full — domain_filter board gate');

const { buildDomainFilter, buildTitleFilter } = await import(pathToFileURL(join(ROOT, 'title-keywords.mjs')).href);
const { boardInDomain } = await import(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);

const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

// ── 1. Opt-in: nothing configured, nothing gated ────────────────────
{
  const off = [undefined, null, [], {}, 'solana', ['', '   '], [null, 42]];
  const wrong = off.filter(v => buildDomainFilter(v) !== null);
  check(wrong.length === 0, 'absent, empty or malformed domain_filter builds no gate at all');
}

// A list that survives normalization DOES build one — the other half of the
// same invariant, or "returns null" would pass by always returning null.
check(typeof buildDomainFilter(['solana']) === 'function', 'a real domain_filter builds a predicate');

// ── 2. Whole word is the default, and that is what removes the junk ──
{
  const match = buildDomainFilter(['defi', 'solana', 'crypto']);
  // Measured false positives: in every one the domain term STARTS a longer,
  // unrelated word, which is why a left-anchored `stem:` default would keep
  // them and only the right-hand anchor removes them.
  const junk = [
    'Analista de Deficiência',
    'Defiance Ohio Plant Manager',
    'Software Defined Networking Engineer',
    'Product Definition Lead',
    'Contrato Indefinido - Operario',
    'Researcher, Solanaceae Genetics',
    'Cryptography Engineer',
  ];
  const admitted = junk.filter(t => match(t));
  check(admitted.length === 0, `plain domain keywords reject the measured false positives${admitted.length ? ` (admitted: ${admitted.join(', ')})` : ''}`);

  const real = ['Core Solana Engineer', 'Engineering Lead - Crypto and DeFi'];
  const missed = real.filter(t => !match(t));
  check(missed.length === 0, `plain domain keywords still match the term as a word${missed.length ? ` (missed: ${missed.join(', ')})` : ''}`);
}

// Unicode: "Deficiência" is only rejected if the boundary understands accented
// letters. An ASCII-only anchor reads "ê" as a separator and lets the junk back
// in — the exact bug the shared WORD_CHAR class exists to prevent.
{
  const match = buildDomainFilter(['defi']);
  check(!match('Especialista em Deficiência Auditiva'), 'the word boundary is Unicode-aware, not ASCII');
}

// ── 3. `stem:` is how an entry buys the longer form back ────────────
{
  const strict = buildDomainFilter(['digital asset', 'smart contract']);
  const stemmed = buildDomainFilter(['stem:digital asset', 'stem:smart contract']);
  const plurals = ['Digital Assets Backend Engineer', 'Engineering Manager, Smart Contracts'];
  check(plurals.every(t => !strict(t)), 'the whole-word default does drop the plural — the cost is real, not hidden');
  check(plurals.every(t => stemmed(t)), '`stem:` recovers the plural form per entry');
  // And it stays honest about what it cannot do: `stem:` is left-anchored only.
  check(buildDomainFilter(['stem:crypto'])('Cryptography Engineer'), '`stem:` still admits a longer word it starts — documented, not fixed');
}

// An explicit `word:` is the default said out loud, and must not be mangled
// into `word:word:...` by the default-applying wrapper.
check(buildDomainFilter(['word:rwa'])('RWA Principal Protocol Engineer'), 'an explicit `word:` prefix is honoured');
check(!buildDomainFilter(['word:rwa'])('Software RWAs Team'), 'an explicit `word:` prefix still anchors both ends');

// Short acronyms were already anchored by compileKeyword; under a whole-word
// default they stop being a special case and must keep working.
{
  const match = buildDomainFilter(['evm', 'dao']);
  check(match('EVM Core Engineer') && match('DAO Operations Lead'), 'acronym entries match as words');
  check(!match('Devmatic Coordinator'), 'acronym entries do not fire inside another word');
}

// The " + " group is shared with title_filter.positive rather than
// reimplemented, so a user who learned it there does not get an entry that
// silently never matches — which in a board gate costs a whole board.
{
  const match = buildDomainFilter(['digital + asset']);
  check(match('Asset Manager, Digital Custody'), 'an AND-group domain entry matches in any order');
  check(!match('Digital Marketing Manager'), 'an AND-group domain entry needs every term');
}

// ── 4. The threshold is ONE posting ─────────────────────────────────
{
  const match = buildDomainFilter(['solana']);
  const board = [
    { title: 'Senior Backend Engineer' },
    { title: 'Office Manager' },
    { title: 'Solana Protocol Engineer' },
  ];
  check(boardInDomain(board, match), 'one domain-bearing posting admits the whole board');
  check(!boardInDomain(board.slice(0, 2), match), 'a board with none is skipped');
  check(!boardInDomain([], match), 'an empty board is skipped rather than admitted');
  // Once admitted, the broad keywords are usable again — that is the entire
  // point of gating on the company instead of tightening the title filter.
  const titleFilter = buildTitleFilter({ positive: ['backend'] });
  check(titleFilter('Senior Backend Engineer'), 'an admitted board keeps broad title keywords usable');
}

// Providers return arrays carrying tag properties and occasionally malformed
// rows; the gate runs before processJobs' own url/title guard, so it owns this.
{
  const match = buildDomainFilter(['solana']);
  const ragged = [null, undefined, {}, { title: null }, { title: 42 }, { title: 'Solana Engineer' }];
  try {
    check(boardInDomain(ragged, match), 'a ragged job array does not throw and still finds the match');
    check(!boardInDomain([null, { title: null }], match), 'a board of only malformed rows is skipped');
  } catch (err) {
    fail(`boardInDomain threw on malformed jobs: ${err.message}`);
  }
}
