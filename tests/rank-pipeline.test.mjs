// tests/rank-pipeline.test.mjs — the opt-in LLM relevance re-ranker (#1144).
//
// Two properties carry the maintainer's constraints and are what this file
// mostly exists to pin down:
//
//   1. It annotates, never drops. Every write path appends to a row and leaves
//      the rest of the line byte-identical; no code path removes or reorders a
//      row. A score without a usable reason is not written at all — a bare
//      number the user cannot argue with is the failure mode the issue named.
//   2. Cost stays bounded. `--limit` caps a run and the ceiling cannot be raised
//      by passing something larger, because the core scan being zero-token is
//      only meaningful if the opt-in pass cannot quietly become unbounded.
//
// A model-authored reason string is untrusted input: it reaches a pipe-delimited
// markdown row, so `|` and newlines must not survive it into the file.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nrank-pipeline — annotate-never-drop, bounded cost');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'rank-pipeline.mjs')).href);
  const {
    formatRankSegment,
    parsePendingEntries,
    appendRankAnnotation,
    selectBatch,
    detectCli,
    parseBatchResponse,
    buildPrompt,
    CLI_CANDIDATES,
    LIMIT_CEILING,
  } = mod;

  const check = (label, cond) => (cond ? pass(label) : fail(label));

  // ── scoring + reason sanitation ──
  check('score above range clamps to 5.0', formatRankSegment(9, 'x').startsWith('rank: 5.0/5'));
  check('negative score clamps to 0.0', formatRankSegment(-4, 'x').startsWith('rank: 0.0/5'));
  check('score renders to one decimal', formatRankSegment(4, 'x').startsWith('rank: 4.0/5'));
  check('a blank reason yields no segment', formatRankSegment(4, '  ') === '');
  check('a non-numeric score yields no segment', formatRankSegment('high', 'x') === '');
  check(
    'a pipe in the reason cannot open a column',
    !formatRankSegment(3, 'pays well | remote').slice('rank: 3.0/5 — '.length).includes('|'),
  );
  check(
    'a newline in the reason cannot forge a row',
    !formatRankSegment(3, 'ok\n- [ ] https://evil.test | Evil | Role').includes('\n'),
  );

  // ── row selection ──
  const fixture = [
    '## Pending',
    '- [ ] https://x.test/1 | Acme | Backend Engineer',
    '- [ ] https://x.test/2 | Beta | Android Engineer | Remote | posted: 2026-06-18 | note: curated',
    '- [x] https://x.test/3 | Gamma | Already Processed',
    '- [ ] https://x.test/4 | Delta | Already Ranked | rank: 3.0/5 — prior run',
    'not a row at all',
  ].join('\n');
  const pending = parsePendingEntries(fixture);

  check('processed rows are excluded', !pending.some(e => e.url.endsWith('/3')));
  check('already-ranked rows are excluded (idempotent re-runs)', !pending.some(e => e.url.endsWith('/4')));
  check('non-row lines are ignored', pending.length === 2);
  check('company parses off the row', pending[0].company === 'Acme');
  check('title parses on a row carrying optional segments', pending[1].title === 'Android Engineer');

  // ── the annotate-never-drop contract ──
  const original = pending[1].raw;
  const annotated = appendRankAnnotation(original, 4.2, 'Strong Kotlin match');
  check('the original row survives byte-for-byte', annotated.startsWith(original));
  check('the segment rides last, after note:', annotated.endsWith('| rank: 4.2/5 — Strong Kotlin match'));
  check('an existing note: segment is untouched', annotated.includes('| note: curated |'));
  check('re-annotating is a no-op', appendRankAnnotation(annotated, 1, 'different') === annotated);
  check('an unusable score leaves the row alone', appendRankAnnotation(original, NaN, 'x') === original);
  check('a reasonless score leaves the row alone', appendRankAnnotation(original, 5, '') === original);

  // ── bounded cost ──
  check('--limit caps the run', selectBatch(pending, 1).length === 1);
  check('the ceiling cannot be raised by a larger --limit', selectBatch(Array(400).fill({}), 5000).length === LIMIT_CEILING);
  check('a zero/absent limit falls back to the default', selectBatch(Array(90).fill({}), undefined).length === 20);
  check('selection is deterministic (file order)', selectBatch(pending, 2)[0].url === pending[0].url);

  // ── batch response handling ──
  check('a clean array parses', parseBatchResponse('[{"id":0,"score":4,"reason":"ok"}]').length === 1);
  check('surrounding prose is tolerated', parseBatchResponse('Here:\n[{"id":0,"score":4,"reason":"ok"}]\n').length === 1);
  check('malformed JSON yields no results, not a throw', parseBatchResponse('{oops').length === 0);
  check('a non-array payload yields nothing', parseBatchResponse('{"id":0,"score":3}').length === 0);
  check('an entry without a score is dropped', parseBatchResponse('[{"id":0,"reason":"none"}]').length === 0);

  // Number(null) === 0, Number(false) === 0, Number('') === 0 — every one of
  // those is a valid finite number. Checking the ORIGINAL JSON value's type
  // (not a Number(...)-coerced one) is what keeps {"id":null,"score":null} from
  // silently annotating batch entry 0 as a 0.0/5 match.
  check('a null id is rejected', parseBatchResponse('[{"id":null,"score":3,"reason":"x"}]').length === 0);
  check('a boolean id is rejected', parseBatchResponse('[{"id":false,"score":3,"reason":"x"}]').length === 0);
  check('an empty-string id is rejected', parseBatchResponse('[{"id":"","score":3,"reason":"x"}]').length === 0);
  check('a fractional id is rejected', parseBatchResponse('[{"id":0.5,"score":3,"reason":"x"}]').length === 0);
  check('a negative id is rejected', parseBatchResponse('[{"id":-1,"score":3,"reason":"x"}]').length === 0);
  check('a null score is rejected', parseBatchResponse('[{"id":0,"score":null,"reason":"x"}]').length === 0);
  check('a boolean score is rejected', parseBatchResponse('[{"id":0,"score":true,"reason":"x"}]').length === 0);
  check('an empty-string score is rejected', parseBatchResponse('[{"id":0,"score":"","reason":"x"}]').length === 0);
  check('id 0 / score 0 is a legitimately valid entry', parseBatchResponse('[{"id":0,"score":0,"reason":"x"}]').length === 1);

  // ── CLI detection (injected probe: touches no real binaries) ──
  check('the first installed CLI wins', detectCli(CLI_CANDIDATES, b => b === 'codex').bin === 'codex');
  check('priority order is respected', detectCli(CLI_CANDIDATES, () => true).bin === 'claude');
  check('no CLI installed returns null', detectCli(CLI_CANDIDATES, () => false) === null);

  // ── applying annotations: row text is not a unique identity ──
  // pipeline.md does not enforce line uniqueness, so two byte-identical pending
  // rows are two entries that were scored separately. Keying by row text would
  // hand both the same segment and silently discard one score.
  const { applyAnnotations } = mod;
  const dupRaw = '- [ ] https://x.test/9 | Acme | Backend Engineer';
  const dup = applyAnnotations(['## Pending', dupRaw, dupRaw].join('\n'), [
    { raw: dupRaw, segment: 'rank: 4.0/5 — first' },
    { raw: dupRaw, segment: 'rank: 2.0/5 — second' },
  ]);
  check('both duplicate rows get annotated', dup.written === 2);
  check('each duplicate keeps its own score, in file order', /— first[\s\S]*— second/.test(dup.text));
  check(
    'a row already carrying rank: is left alone',
    applyAnnotations(`${dupRaw} | rank: 1.0/5 — old`, [{ raw: dupRaw, segment: 'rank: 5.0/5 — new' }]).written === 0,
  );
  check(
    'an annotation whose row vanished is a no-op, not a corruption',
    applyAnnotations('- [ ] https://other.test | X | Y', [{ raw: dupRaw, segment: 'rank: 3.0/5 — x' }]).written === 0,
  );

  // Regression: 3 byte-identical pending rows + --limit 1 selects only the
  // first one in file order. Only that selected occurrence may end up
  // annotated — the two unselected duplicates must stay untouched, not
  // silently pick up the selected one's score too.
  const tripleDupText = [
    '## Pending',
    '- [ ] https://x.test/10 | Acme | Backend Engineer',
    '- [ ] https://x.test/10 | Acme | Backend Engineer',
    '- [ ] https://x.test/10 | Acme | Backend Engineer',
  ].join('\n');
  const tripleDupPending = parsePendingEntries(tripleDupText);
  const tripleDupSelected = selectBatch(tripleDupPending, 1);
  check('--limit 1 selects exactly one of three duplicates', tripleDupSelected.length === 1);
  const tripleDupOut = applyAnnotations(tripleDupText, [
    { raw: tripleDupSelected[0].raw, segment: 'rank: 4.5/5 — only this one' },
  ]);
  check('only the selected duplicate is annotated', tripleDupOut.written === 1);
  check(
    'exactly one occurrence carries the segment',
    (tripleDupOut.text.match(/rank: 4\.5\/5/g) ?? []).length === 1,
  );
  check('the two unselected duplicates remain pending, unranked',
    parsePendingEntries(tripleDupOut.text).length === 2);

  // ── prompt hygiene ──
  check('postings are marked as untrusted content', /untrusted data/.test(buildPrompt(pending, '')));
} catch (err) {
  fail(`rank-pipeline test suite threw: ${err?.message ?? err}`);
}
