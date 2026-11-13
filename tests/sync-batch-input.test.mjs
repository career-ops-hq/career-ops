// tests/sync-batch-input.test.mjs — pipeline.md "Pending" -> batch-input.tsv (#3391).
//
// Covers the parser contract this script mirrors from reconcile-pipeline.mjs
// (localized section headers, variable-width rows, labeled segments), the
// dedupe against already-queued/processed URLs, and the batch row format.
//
// Imported directly (like rank-pipeline.test.mjs) so the pure functions are
// exercised without spawning the CLI.
import { pass, fail, ROOT, SANDBOX_DATA_ROOT } from './helpers.mjs';
import { join, sep } from 'path';
import { pathToFileURL } from 'url';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, realpathSync, existsSync, writeFileSync, readFileSync } from 'fs';

console.log('\nsync-batch-input — pipeline "Pending" -> batch-input.tsv');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'sync-batch-input.mjs')).href);
  const { parsePending, urlsFromTsv, maxTsvId, planBatchRows, buildNotes, lineUrl, lineCompany, extractLabels, isSafePublicHttpUrl } = mod;
  const check = (label, cond) => (cond ? pass(label) : fail(label));

  // ── section-header matching (lib/pipeline-sections.mjs, shared with reconcile-pipeline) ──
  const pendingUnder = (heading) => parsePending(`${heading}\n- [ ] https://example.com/h | Acme | Role\n`).length === 1;
  check('English header is recognised', pendingUnder('## Pending'));
  check('Spanish header is recognised', pendingUnder('## Pendientes'));
  check('German header is recognised', pendingUnder('## Offen'));
  check('French header is recognised', pendingUnder('## En attente'));
  check('a non-pending header is not matched', !pendingUnder('## Processed'));

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

  // ── SSRF: bracketed unspecified IPv6 address ──
  check('bracketed unspecified IPv6 ([::]) is rejected', !isSafePublicHttpUrl('http://[::]/'));
  check('bracketed unspecified IPv6 with port is rejected', !isSafePublicHttpUrl('http://[::]:8080/'));
  check('bracketed IPv4-compatible IPv6 loopback is rejected', !isSafePublicHttpUrl('http://[::127.0.0.1]/'));
  check('bracketed IPv4-compatible IPv6 private is rejected', !isSafePublicHttpUrl('http://[::10.0.0.1]/'));

  // ── argValue() CLI validation ──
  // Arguments go as an array to the Node running this suite: no shell
  // re-parses the temp paths below, and no other `node` on PATH runs the CLI.
  function runCli(args, extraEnv = {}) {
    try {
      const stdout = execFileSync(process.execPath, [join(ROOT, 'sync-batch-input.mjs'), ...args], {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 15000,
        stdio: 'pipe',
        env: { ...process.env, ...extraEnv },
      });
      return { exitCode: 0, stdout };
    } catch (e) {
      return { exitCode: e.status ?? 1, stderr: (e.stderr || '').toString(), stdout: (e.stdout || '').toString() };
    }
  }
  check('--input without value exits with error', runCli(['--input', '--dry-run']).exitCode !== 0);
  check('--pipeline without value exits with error', runCli(['--pipeline', '--dry-run']).exitCode !== 0);
  check('--state without value exits with error', runCli(['--state', '--dry-run']).exitCode !== 0);
  check('--input followed by another flag exits with error', runCli(['--input', '--dry-run']).exitCode !== 0);
  check('--pipeline followed by another flag exits with error', runCli(['--pipeline', '--dry-run']).exitCode !== 0);
  check('--state followed by another flag exits with error', runCli(['--state', '--state', '--dry-run']).exitCode !== 0);

  // ── mkdirSync before writeFileSync ──
  // The fixture lives inside the sandbox data root, not beside the checkout:
  // helpers pin CAREER_OPS_ROOT to SANDBOX_DATA_ROOT, and the CLI refuses
  // paths outside its data root (resolveInsideRepo). Also keeps the
  // repository root walk (scratch-dirs.test.mjs check 13) clean.
  const TMP = realpathSync(mkdtempSync(join(SANDBOX_DATA_ROOT, 'sync-batch-input-')));
  const tmpPipeline = join(TMP, 'pipeline.md');
  const tmpInput = join(TMP, 'newsub', 'batch-input.tsv');
  const tmpState = join(TMP, 'batch-state.tsv');
  writeFileSync(tmpPipeline, '## Pending\n- [ ] https://example.com/job-1\n', 'utf-8');
  writeFileSync(tmpState, 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n', 'utf-8');
  try {
    const batchDir = join(TMP, 'newsub');
    const result = runCli(['--pipeline', tmpPipeline, '--input', tmpInput, '--state', tmpState, '--dry-run']);
    check('CLI does not crash when batch directory is missing (mkdirSync)', result.exitCode === 0);
    check('dry-run does not create missing batch directory', !existsSync(batchDir));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }

  // ── defaults resolve beside the script, even under an external data root ──
  // When CAREER_OPS_ROOT points outside the checkout, --input and --state
  // fall back to CHECKOUT_ROOT (the script's own directory), so the synced
  // batch files stay where batch-runner.sh reads them.  --pipeline still
  // resolves against CAREER_OPS, which is what scan.mjs writes to.
  const extDataRootTmp = realpathSync(mkdtempSync(join(SANDBOX_DATA_ROOT, 'ext-data-root-')));
  try {
    const extPipeline = join(extDataRootTmp, 'pipeline.md');
    writeFileSync(extPipeline, '## Pending\n- [ ] https://ext.example/job-1\n', 'utf-8');
    // Dry-run prints where a real run WOULD write; that must land in batch/
    // beside the script (the checkout), not under the external data root.
    // Before the CHECKOUT_ROOT fix this test passed vacuously: the CLI exited
    // 0 while planning to write batch-input.tsv under the data root, which
    // batch-runner.sh never reads.
    const batchDirMarker = `batch${sep}batch-input.tsv`;
    const extResult = runCli(
      ['--pipeline', extPipeline, '--dry-run'],
      { CAREER_OPS_ROOT: extDataRootTmp },
    );
    check(
      'defaults resolve beside the script under an external data root',
      extResult.exitCode === 0
        && extResult.stdout.includes(batchDirMarker)
        && !extResult.stdout.includes(extDataRootTmp.split(/[\\/]/).pop()),
    );
  } finally {
    rmSync(extDataRootTmp, { recursive: true, force: true });
  }

  // ── planBatchRows deduplication within single iteration ──
  const sameUrlPending = [
    { url: 'https://dupe-in-batch.example/a', company: 'A', notes: '' },
    { url: 'https://dupe-in-batch.example/a', company: 'B', notes: 'note: second' },
    { url: 'https://dupe-in-batch.example/b', company: 'C', notes: '' },
    { url: 'https://dupe-in-batch.example/a', company: 'D', notes: '' },
  ];
  const dedupedRows = planBatchRows(sameUrlPending, new Set(), 20);
  check('same URL in three pending entries yields one row', dedupedRows.length === 2);
  check('first occurrence of duplicated URL is kept', dedupedRows.some((r) => r.url === 'https://dupe-in-batch.example/a' && r.notes === ''));
  check('second unique URL is included', dedupedRows.some((r) => r.url === 'https://dupe-in-batch.example/b'));
  check('duplicated rows have sequential ids', dedupedRows[0].id === 20 && dedupedRows[1].id === 21);

  // ── TSV cell returns empty for undefined/null input ──
  // tsvCell is not exported; test indirectly via planBatchRows and parsePending
  const nullNotesRows = planBatchRows([
    { url: 'https://nullnotes.example/1', company: '', notes: null },
    { url: 'https://nullnotes.example/2', company: '', notes: undefined },
  ], new Set(), 30);
  check('null notes become empty in TSV', nullNotesRows[0].row === '30\thttps://nullnotes.example/1\tpipeline\t');
  check('undefined notes become empty in TSV', nullNotesRows[1].row === '31\thttps://nullnotes.example/2\tpipeline\t');

  // ── --url queues one Pending row (#5269, the dashboard Inbox `e` key) ──
  // Same normalization, dedupe, id allocation and row format as a full sync;
  // only the selection differs.
  const URL_TMP = realpathSync(mkdtempSync(join(SANDBOX_DATA_ROOT, 'sync-batch-input-url-')));
  try {
    const urlPipeline = join(URL_TMP, 'pipeline.md');
    const urlInput = join(URL_TMP, 'batch-input.tsv');
    const urlState = join(URL_TMP, 'batch-state.tsv');
    const inputHeader = 'id\turl\tsource\tnotes\n4\thttps://jobs.example.com/acme/queued\tpipeline\t\n';
    const stateBody = 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n'
      + '9\thttps://jobs.example.com/acme/done\tcompleted\t-\t-\t1\t4\t\t0\n';
    writeFileSync(urlPipeline, [
      '# Pipeline',
      '## Pending',
      '- [ ] https://jobs.example.com/acme/1 | Acme | Engineer | Remote | rank: 4.2/5 — strong fit',
      '- [ ] https://JOBS.Example.com:443/acme/2 | Acme | Analyst',
      '- [ ] https://jobs.example.com/acme/3 | Acme | Writer',
      '- [ ] https://jobs.example.com/acme/queued | Acme | Queued',
      '- [ ] https://jobs.example.com/acme/done | Acme | Done',
      '- [x] https://jobs.example.com/acme/checked | Acme | Checked',
      // The dashboard's reader lists these two rows; this script cannot read them.
      '  - [ ] https://jobs.example.com/acme/indented | Acme | Indented',
      '- [ ] Acme | https://jobs.example.com/acme/url-second | URL second',
      '## Processed',
      '- [x] https://jobs.example.com/acme/processed | Acme | Processed',
      '',
    ].join('\n'), 'utf-8');
    const reset = () => {
      writeFileSync(urlInput, inputHeader, 'utf-8');
      writeFileSync(urlState, stateBody, 'utf-8');
    };
    const readInput = () => readFileSync(urlInput, 'utf-8');
    const paths = ['--pipeline', urlPipeline, '--input', urlInput, '--state', urlState];

    reset();
    const one = runCli(['--url', 'https://jobs.example.com/acme/1', ...paths]);
    const afterOne = readInput();
    check('--url exits 0 for a Pending row', one.exitCode === 0);
    check('--url appends only the selected row, with the next id, source and notes',
      afterOne === inputHeader + '10\thttps://jobs.example.com/acme/1\tpipeline\trank: 4.2/5 — strong fit\n');
    check('--url names batch/batch-runner.sh as the next step', /batch-runner\.sh/.test(one.stdout));

    reset();
    const eq = runCli(['--url=https://jobs.example.com/acme/3', ...paths]);
    check('--url=value is read the same as the spaced form',
      eq.exitCode === 0 && readInput() === inputHeader + '10\thttps://jobs.example.com/acme/3\tpipeline\t\n');

    // The row is written https://JOBS.Example.com:443/acme/2; both sides are
    // normalized with new URL().href, as a full sync normalizes every row.
    reset();
    const norm = runCli(['--url', 'https://jobs.example.com/acme/2', ...paths]);
    check('--url matches a row whose URL differs only in host case and default port',
      norm.exitCode === 0 && readInput() === inputHeader + '10\thttps://jobs.example.com/acme/2\tpipeline\t\n');
    reset();
    const normArg = runCli(['--url', 'HTTPS://jobs.EXAMPLE.com:443/acme/1', ...paths]);
    check('--url normalizes its own argument the same way',
      normArg.exitCode === 0 && readInput().endsWith('10\thttps://jobs.example.com/acme/1\tpipeline\trank: 4.2/5 — strong fit\n'));

    // Exit 4 (URL_EXIT.NOT_PENDING) is how the dashboard tells this refusal
    // apart from other failures, so its value is pinned here.
    check('URL_EXIT values are pinned', mod.URL_EXIT.ALREADY_QUEUED === 3 && mod.URL_EXIT.NOT_PENDING === 4);
    for (const [label, target] of [
      ['a URL not in the pipeline', 'https://jobs.example.com/acme/missing'],
      ['a checked Pending row', 'https://jobs.example.com/acme/checked'],
      ['a Processed row', 'https://jobs.example.com/acme/processed'],
      ['an indented row', 'https://jobs.example.com/acme/indented'],
      ['a row whose URL is not the first cell', 'https://jobs.example.com/acme/url-second'],
    ]) {
      reset();
      const r = runCli(['--url', target, ...paths]);
      check(`--url with ${label} exits 4 and says the URL must come first`,
        r.exitCode === 4 && /Not an unchecked Pending row/.test(r.stderr || '') && r.stderr.includes('first cell after "- [ ] "'));
      check(`--url with ${label} writes nothing`, readInput() === inputHeader);
    }

    for (const [label, target] of [
      ['a local: target', 'local:jds/acme-writer.md'],
      ['a loopback URL', 'http://127.0.0.1/jobs/1'],
      ['text that is not a URL', 'acme'],
    ]) {
      reset();
      const r = runCli(['--url', target, ...paths]);
      check(`--url refuses ${label} with exit 1`, r.exitCode === 1 && /--url must be a public http\(s\) URL/.test(r.stderr || ''));
      check(`--url with ${label} writes nothing`, readInput() === inputHeader);
    }

    reset();
    const missingPipeline = runCli(['--url', 'https://jobs.example.com/acme/1', '--pipeline', join(URL_TMP, 'absent.md'), '--input', urlInput, '--state', urlState]);
    check('--url with no pipeline.md exits 4', missingPipeline.exitCode === 4 && /Not an unchecked Pending row/.test(missingPipeline.stderr || ''));

    // acme/done is only in batch-state.tsv: the dashboard shows it with no
    // status, so exit 3 is the only thing that tells it nothing was queued.
    for (const [label, target] of [
      ['batch-input.tsv', 'https://jobs.example.com/acme/queued'],
      ['batch-state.tsv only', 'https://jobs.example.com/acme/done'],
    ]) {
      reset();
      const r = runCli(['--url', target, ...paths]);
      check(`--url on a row already in ${label} is a no-op that exits 3`,
        r.exitCode === 3 && /already in batch-input\.tsv or batch-state\.tsv — nothing to queue/.test(r.stdout));
      check(`--url on a row already in ${label} writes nothing`, readInput() === inputHeader);
    }

    reset();
    const twice = [runCli(['--url', 'https://jobs.example.com/acme/1', ...paths]), runCli(['--url', 'https://jobs.example.com/acme/1', ...paths])];
    check('--url run twice queues the row once, and the second run exits 3',
      twice[0].exitCode === 0 && twice[1].exitCode === 3 && readInput().split('acme/1\t').length === 2);

    reset();
    const dry = runCli(['--dry-run', '--url', 'https://jobs.example.com/acme/3', ...paths]);
    // Compare the listed URLs as whole tokens, not substrings of the output.
    const dryUrls = dry.stdout.match(/https?:\/\/[^\s|]+/g) ?? [];
    check('--dry-run with --url lists only the selected row',
      dry.exitCode === 0 && dryUrls.length > 0 && dryUrls.every((u) => u === 'https://jobs.example.com/acme/3')
        && /dry-run — no changes written/.test(dry.stdout));
    check('--dry-run with --url writes nothing', readInput() === inputHeader);
    const dryMissing = runCli(['--dry-run', '--url', 'https://jobs.example.com/acme/missing', ...paths]);
    check('--dry-run with --url still refuses a row that is not Pending', dryMissing.exitCode === 4);

    rmSync(urlInput, { force: true });
    const fresh = runCli(['--url', 'https://jobs.example.com/acme/1', ...paths]);
    check('--url creates batch-input.tsv with its header when it is missing',
      fresh.exitCode === 0 && readInput().startsWith('# batch-input.tsv') && readInput().endsWith('10\thttps://jobs.example.com/acme/1\tpipeline\trank: 4.2/5 — strong fit\n'));

    check('--url without a value exits with error', runCli(['--url', '--dry-run', ...paths]).exitCode !== 0);
    check('--url= with an empty value exits with error', runCli(['--url=', '--dry-run', ...paths]).exitCode !== 0);

    // A full sync with nothing to add still exits 0: the exit codes are --url only.
    writeFileSync(urlInput, 'id\turl\n1\thttps://only.example.com/1\n', 'utf-8');
    const onlyPipeline = join(URL_TMP, 'only.md');
    writeFileSync(onlyPipeline, '## Pending\n- [ ] https://only.example.com/1 | Acme | Role\n', 'utf-8');
    const fullNoop = runCli(['--pipeline', onlyPipeline, '--input', urlInput, '--state', urlState]);
    check('a full sync with nothing to add still exits 0', fullNoop.exitCode === 0 && /nothing to sync/.test(fullNoop.stdout));
  } finally {
    rmSync(URL_TMP, { recursive: true, force: true });
  }
} catch (err) {
  fail(`sync-batch-input test suite threw: ${err?.message ?? err}`);
}
