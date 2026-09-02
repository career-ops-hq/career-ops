// tests/sync-batch-input.test.mjs — pipeline.md "Pending" -> batch-input.tsv (#3391).
//
// Covers the parser contract this script mirrors from reconcile-pipeline.mjs
// (localized section headers, variable-width rows, labeled segments), the
// dedupe against already-queued/processed URLs, and the batch row format.
//
// Imported directly (like rank-pipeline.test.mjs) so the pure functions are
// exercised without spawning the CLI.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nsync-batch-input — pipeline "Pending" -> batch-input.tsv');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'sync-batch-input.mjs')).href);
  const { parsePending, urlsFromTsv, maxTsvId, planBatchRows, buildNotes, lineUrl, lineCompany, extractLabels, isSafePublicHttpUrl, PENDING_RE } = mod;
  const check = (label, cond) => (cond ? pass(label) : fail(label));

  // ── section-header matching (mirrors reconcile-pipeline's localized PENDING_RE) ──
  check('English header is recognised', PENDING_RE.test('## Pending'));
  check('Spanish header is recognised', PENDING_RE.test('## Pendientes'));
  check('German header is recognised', PENDING_RE.test('## Offen'));
  check('French header is recognised', PENDING_RE.test('## En attente'));
  check('a non-pending header is not matched', !PENDING_RE.test('## Processed'));

  // ── url / company / label extraction ──
  check('bare URL parses', lineUrl('https://example.com/1') === 'https://example.com/1');
  check('url stops at the first pipe', lineUrl('https://example.com/2 | Acme | Role') === 'https://example.com/2');
  check('company is the second positional cell', lineCompany('https://example.com/3 | Acme | Role') === 'Acme');
  check('a bare row has no company', lineCompany('https://example.com/4') === '');
  const labels = extractLabels('https://example.com/5 | Acme | Role | note: curated | trust: 80 missing_apply_url');
  check('note label extracts', labels.note === 'curated');
  check('trust label extracts with flags', labels.trust === '80 missing_apply_url');
  check('unlabelled rows yield no labels', Object.keys(extractLabels('https://example.com/6 | Acme | Role')).length === 0);
  check(
    'notes are labelled segments joined by pipes',
    buildNotes({ note: 'curated', trust: '80 missing_apply_url' }) === 'note: curated | trust: 80 missing_apply_url',
  );

  // ── parsePending: variable-width rows + localized headers ──
  const es = parsePending([
    '## Pendientes',
    '- [ ] https://example.com/1',
    '- [ ] https://example.com/2 | Acme | Backend Engineer | Remote',
    '- [ ] https://example.com/3 | Beta | SA | Remote | 180000 | note: curated',
    '## Procesadas',
    '- [x] https://example.com/4 | Gamma | Done',
  ].join('\n'));
  check('three pending rows parsed under a Spanish header', es.length === 3);
  check('bare row has empty company/notes', es[0].company === '' && es[0].notes === '');
  check('4-column row keeps company', es[1].company === 'Acme');
  check('labelled segment becomes notes', es[2].notes === 'note: curated');

  const processed = parsePending([
    '## Pending',
    '- [ ] https://example.com/9 | Acme | Role',
    '',
    '- [ ] https://example.com/10 | Beta | Role | note: curated',
  ].join('\n'));
  check('blank lines are skipped', processed.length === 2);

  check('public HTTPS URLs are accepted', isSafePublicHttpUrl('https://example.com/jobs/1'));
  check('localhost URLs are rejected', !isSafePublicHttpUrl('http://localhost:3000/jobs'));
  check('private IPv4 URLs are rejected', !isSafePublicHttpUrl('https://10.0.0.5/jobs'));
  check('IPv4 shorthand loopback URLs are rejected', !isSafePublicHttpUrl('http://2130706433/jobs'));
  check('IPv6 loopback URLs are rejected', !isSafePublicHttpUrl('http://[::1]/jobs'));
  check('local/internal hostnames are rejected', !isSafePublicHttpUrl('https://metadata.google.internal/compute'));
  check('IPv4-compatible IPv6 loopback is rejected', !isSafePublicHttpUrl('http://[::127.0.0.1]/'));
  check('normalized IPv4-compatible IPv6 loopback is rejected', !isSafePublicHttpUrl('http://[0:0:0:0:0:0:7f00:1]/'));
  check('IPv4-compatible IPv6 private is rejected', !isSafePublicHttpUrl('http://[::10.0.0.1]/'));
  check('unspecified IPv6 address is rejected', !isSafePublicHttpUrl('http://[::]/'));
  const filteredP = parsePending([
    '## Pending',
    '- [ ] http://[::127.0.0.1]/admin | Bad | Role',
    '- [ ] https://example.com/safe | Good | Role',
  ].join('\n'));
  check('IPv4-compatible IPv6 loopback is filtered from pending', filteredP.length === 1 && filteredP[0].url === 'https://example.com/safe');
  const filtered = parsePending([
    '## Pending',
    '- [ ] http://127.0.0.1/admin | Bad | Role',
    '- [ ] https://example.com/safe | Good | Role',
  ].join('\n'));
  check('unsafe pending URLs are filtered before batch rows are planned', filtered.length === 1 && filtered[0].url === 'https://example.com/safe');

  // ── urlsFromTsv / maxTsvId (existing input + state) ──
  const inputTsv = [
    '# batch-input.tsv header comment',
    'id\turl\tsource\tnotes',
    '1\thttps://queued.example/1\tpipeline\tpriority',
    '2\thttps://queued.example/2\tGreenhouse\t',
    '',
  ].join('\n');
  const inputUrls = urlsFromTsv(inputTsv, 1);
  check('existing input URLs are collected from the url column', inputUrls.has('https://queued.example/1'));
  check('header comment, header row, and blanks are ignored', inputUrls.size === 2);
  check('maxTsvId reads the largest numeric id', maxTsvId(inputTsv) === 2);
  check('maxTsvId ignores the header row', maxTsvId('id\turl\n7\tx\n') === 7);
  check('maxTsvId is 0 with no numeric ids', maxTsvId('# only comments\n') === 0);

  const stateTsv = [
    'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries',
    '1\thttps://done.example/1\tcompleted\t2026-08-25\t2026-08-25\t1\t3.5\t\t0',
    '5\thttps://done.example/5\tcompleted\t2026-08-26\t2026-08-26\t1\t4\t\t0',
  ].join('\n');
  const stateUrls = urlsFromTsv(stateTsv, 1);
  check('batch-state URLs are collected from column 2', stateUrls.has('https://done.example/1'));
  check('maxTsvId covers state rows too', maxTsvId(stateTsv) === 5);

  // ── planBatchRows: dedupe + numeric-id row format ──
  const pending = parsePending([
    '## Pending',
    '- [ ] https://new.example/1 | Acme | Role',
    '- [ ] https://queued.example/1 | Beta | Role',
    '- [ ] https://new.example/3 | Gamma | Role | trust: 90 suspicious_domain',
    '- [ ] https://new.example/2', // bare
  ].join('\n'));
  const existing = new Set([...inputUrls, ...stateUrls]);
  const startedId = Math.max(maxTsvId(inputTsv), maxTsvId(stateTsv)) + 1;
  const rows = planBatchRows(pending, existing, startedId);
  check('queued and processed URLs are deduped', rows.length === 3);
  check('ids are allocated sequentially after the highest existing id', rows[0].id === 6 && rows[2].id === 8);
  check('a fresh entry carries id/url/source/notes tabs', rows[0].row === '6\thttps://new.example/1\tpipeline\t');
  check('labelled segments ride into notes', rows.some((r) => r.notes === 'trust: 90 suspicious_domain'));
  check('a bare row keeps empty notes', rows.some((r) => r.row === '8\thttps://new.example/2\tpipeline\t'));
  check('every row uses the pipeline source', rows.every((r) => r.row.includes('\tpipeline\t')));
  check('every id is a positive integer', rows.every((r) => Number.isInteger(r.id) && r.id > 0));

  const duplicateRows = planBatchRows([
    { url: 'https://dupe.example/1', company: 'A', notes: '' },
    { url: 'https://dupe.example/1', company: 'B', notes: '' },
  ], new Set(), 10);
  check('duplicates inside one pending section are queued once', duplicateRows.length === 1);
  check('startId honours an explicit starting id', duplicateRows[0].id === 10);

  const unsafeFieldRows = planBatchRows([
    { url: 'https://fields.example/1', company: 'Acme\tInc', notes: 'line1\nline2\rline3' },
  ], new Set(), 3);
  check('embedded tabs/newlines are sanitized before TSV row construction', unsafeFieldRows[0].row === '3\thttps://fields.example/1\tpipeline\tline1 line2 line3');
  check('sanitized batch rows remain four columns', unsafeFieldRows[0].row.split('\t').length === 4);
} catch (err) {
  fail(`sync-batch-input test suite threw: ${err?.message ?? err}`);
}
