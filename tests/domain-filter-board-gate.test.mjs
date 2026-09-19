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
import { readFileSync } from 'node:fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nscan-ats-full — domain_filter board gate');

const { buildDomainFilter, buildTitleFilter } = await import(pathToFileURL(join(ROOT, 'title-keywords.mjs')).href);
const { boardInDomain, boardGateDecision, retryGateDecision } = await import(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);

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

// ── 5. Truncation: the one board the gate must NOT decide ───────────
//
// The two-board case @artemtrofymenko and @Scott-Emberson converged on (#3304).
// The first board is the property this feature exists for; the second is the
// one that made the original placement wrong, and it is the reason this suite
// asserts a THREE-valued decision rather than a boolean. A test written around
// the old ordering would have pinned the defect: it would redden on the fix.
{
  const match = buildDomainFilter(['defi', 'crypto']);

  // (a) Complete board, nothing domain-bearing → gated, ahead of any title work.
  const complete = [{ title: 'Office Manager' }, { title: 'Executive Assistant' }];
  check(boardGateDecision(complete, match) === 'gate', 'a complete board with no domain posting is gated');

  // (b) The same rows, but the provider said the response was cut short. The
  // only domain-bearing posting can sit in exactly the tail the sequential
  // retry is about to fetch, so this board is NOT evidence of anything yet.
  const truncated = Object.assign([...complete], { workdayTruncated: true });
  check(boardGateDecision(truncated, match) === 'defer', 'a truncated board with no domain posting is deferred, not gated');

  // And the deferral is not academic: the fuller result inverts the verdict.
  const full = [...complete, { title: 'DeFi Protocol Engineer' }];
  check(boardGateDecision(full, match) === 'process', 'the fuller retry result admits the board the truncated page would have dropped');

  // (c) A truncated board that ALREADY matches needs no deferral — the retry
  // returns a superset, so the verdict cannot change, and processing the
  // partial page banks those matches even if the retry later fails.
  const truncatedMatch = Object.assign([...full], { workdayTruncated: true });
  check(boardGateDecision(truncatedMatch, match) === 'process', 'a truncated board that already matches is processed, not deferred');

  // (d) Opt-out is still opt-out: with no filter nothing is gated or deferred,
  // truncated or not, or every existing portals.yml changes behaviour.
  check(boardGateDecision(complete, null) === 'process', 'no domain_filter: a complete board is processed');
  check(boardGateDecision(truncated, null) === 'process', 'no domain_filter: a truncated board is processed, never deferred');
}

// ── 5b. The retry, where a deferred board is actually decided ───────
//
// Raised by @artemtrofymenko and CodeRabbit on c15995ee (#3304): the retry
// judged every queued board with an inline check, so a retry truncated a
// second time was counted as gated, and so was a board the sweep had already
// admitted if the retry's cut missed its domain posting.
{
  const match = buildDomainFilter(['defi', 'crypto']);
  const junk = [{ title: 'Office Manager' }];
  const junkTruncated = Object.assign([...junk], { workdayTruncated: true });
  const inDomain = [...junk, { title: 'DeFi Protocol Engineer' }];

  // Deferred: the fuller result decides.
  check(retryGateDecision(junk, match, true) === 'gate', 'retry: a deferred board with a complete, off-domain result is gated');
  check(retryGateDecision(inDomain, match, true) === 'process', 'retry: a deferred board whose fuller result matches is processed');
  // Deferred and truncated again: no third fetch, so not "correctly excluded".
  check(retryGateDecision(junkTruncated, match, true) === 'process', 'retry: a deferred board truncated again is admitted, never counted as gated');
  // Admitted by the sweep: a retry cut elsewhere cannot un-admit it.
  check(retryGateDecision(junkTruncated, match, false) === 'process', 'retry: a board the sweep admitted is not gated by a re-truncated retry');
  check(retryGateDecision(junk, match, false) === 'process', 'retry: a board the sweep admitted is not re-judged at all');
  // Opt-out stays opt-out.
  check(retryGateDecision(junk, null, true) === 'process', 'retry: no domain_filter, nothing gated');
}

// ── 6. Deleting the feature must redden this suite ──────────────────
//
// Measured on 93b8bde5: removing the gate's early-return block left 97
// assertions green across four suites, because every one of them exercised the
// primitive and none the decision. `boardGateDecision` is what the call site
// now branches on, so a gate deleted from the sweep can no longer pass here
// with the predicate left intact.
{
  const match = buildDomainFilter(['solana']);
  const junkBoard = [{ title: 'Office Manager' }];
  const alwaysProcess = boardGateDecision(junkBoard, match) === 'process';
  check(!alwaysProcess, 'the decision is not a stub that always processes');
  check(typeof boardGateDecision === 'function', 'the sweep decides through an exported, testable function');
}

// ── 7. Placement, which is this PR's headline and the part a unit test
//      cannot reach ──────────────────────────────────────────────────
//
// The sweep lives inside main() and reaches the network through a provider, so
// nothing short of a subprocess with a stubbed ATS exercises the call site
// itself: with the block deleted, sections 1-6 stay green. A source-order guard
// is the cheap half of that, and it is the half that reddens on deletion —
// the same layout-guard idiom the suite already uses elsewhere. It asserts the
// three orderings the feature's claims rest on, not the code that implements
// them.
{
  const src = readFileSync(join(ROOT, 'scan-ats-full.mjs'), 'utf8');
  const sweep = src.slice(src.indexOf('const truncated = []'), src.indexOf('Second chance for boards'));
  const at = needle => sweep.indexOf(needle);

  const queue = at('truncated.push(entry)');
  const gate = at('boardGateDecision(jobs, domainFilter)');
  const process_ = at('await processJobs(');

  check(gate !== -1, 'the sweep decides the board through boardGateDecision');
  // The bug this section exists for: the gate returned before the retry queue,
  // so a truncated board was judged on a page nobody claimed was complete.
  check(queue !== -1 && queue < gate, 'a truncated board is queued for the retry BEFORE the gate can drop it');
  // The headline: no title is filtered on a board that failed the gate.
  check(process_ !== -1 && gate < process_, 'the gate runs ahead of processJobs, not after it');
  // The sweep records which boards it deferred; without that the retry cannot
  // tell a deferred board from an admitted one.
  check(at("deferred.add(entry)") !== -1, 'the sweep records the boards it deferred');

  // The retry is the other call site, and the one @artemtrofymenko's `if (false)`
  // mutation showed no test read.
  const retry = src.slice(src.indexOf('Second chance for boards'), src.indexOf('totalErrors += errors'));
  const rGate = retry.indexOf('retryGateDecision(jobs, domainFilter, deferred.has(entry))');
  const rProcess = retry.indexOf('await processJobs(');
  check(rGate !== -1, 'the retry decides the board through retryGateDecision');
  check(rProcess !== -1 && rGate < rProcess, 'the retry gate runs ahead of processJobs');
  check(!/boardInDomain\(/.test(retry), 'the retry no longer judges a board with an inline boardInDomain check');
}
