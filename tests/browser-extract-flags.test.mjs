// tests/browser-extract-flags.test.mjs — browser-extract.mjs's CLI contract.
//
// The script hand-rolled its argv parsing and matched tokens EXACTLY against a
// local `FLAGS` set, which left three distinct failures on `main` (#3004). All
// three are the class lib/cli-flags.mjs exists to end (#2401/#2402, #2775):
//
//   --max-chars=50000        → not in FLAGS, not the URL either: dropped, and
//                              the run returned a JD truncated at the 12000
//                              default with exit 0. Silently wrong.
//   --max-char 5000 <url>    → the typo was skipped, then `5000` became the URL
//                              and the real one was discarded — reported as
//                              `invalid URL`, naming nothing the caller typed.
//   <url> --bogus            → skipped entirely, run proceeded. Fully silent.
//   --help / -h              → exit 1 with a `no_url` error, never usage; `-h`
//                              does not start with `--`, so it was read AS the
//                              URL and failed with `invalid URL`.
//
// Every case below runs the real binary as a subprocess, because the defect is
// in what the CLI does end to end, not only in what parseArgs returns. The
// error paths must all exit BEFORE Playwright launches, so none of them needs a
// browser or a network — a case that hung would be a regression in itself.
import { pass, fail, ROOT } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { tmpdir } from 'os';

console.log('\nbrowser-extract.mjs — flag validation and value forms');

const NODE = process.execPath;
const SCRIPT = join(ROOT, 'browser-extract.mjs');

// cwd is deliberately not the project root: the script resolves its own paths
// through import.meta.url, and a cwd-relative read would show up here.
function run(args) {
  try {
    const out = execFileSync(NODE, [SCRIPT, ...args], { cwd: tmpdir(), encoding: 'utf-8', timeout: 30000 });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

const { parseArgs } = await import(pathToFileURL(SCRIPT).href);

// ── 1. A mistyped flag is refused, and the message names it ──────────────
// Before: `5000` became the URL and the caller was told the URL was invalid.
{
  const r = run(['--max-char', '5000', 'https://example.com/job']);
  if (r.code !== 0 && /--max-char\b/.test(r.out) && !/invalid URL/.test(r.out)) {
    pass('--max-char is refused by name, not misreported as an invalid URL');
  } else {
    fail(`typo not named: code=${r.code} out=${r.out.trim().slice(0, 160)}`);
  }
}

// A typo that is not adjacent to a value was the fully silent case: it left the
// URL intact and the run proceeded as if nothing had been asked for.
{
  const r = run(['https://example.com/job', '--bogus']);
  if (r.code !== 0 && /--bogus/.test(r.out)) {
    pass('an unrecognized flag after the URL is refused instead of ignored');
  } else {
    fail(`--bogus silently accepted: code=${r.code} out=${r.out.trim().slice(0, 160)}`);
  }
}

// ── 2. --help and -h print usage and exit 0, without launching a browser ──
// Before: --help exited 1 with a no_url error, and -h was read as the URL.
for (const flag of ['--help', '-h']) {
  const r = run([flag]);
  if (r.code === 0 && /--max-chars/.test(r.out) && !/error|invalid URL/i.test(r.out)) {
    pass(`${flag} prints the usage block and exits 0`);
  } else {
    fail(`${flag}: code=${r.code} out=${r.out.trim().slice(0, 160)}`);
  }
}

// The unrecognized-flag check must run BEFORE --help, or `--help --bogus`
// exits 0 having never looked at --bogus (the ordering CodeRabbit caught on
// #2745/#2746).
{
  const r = run(['--help', '--bogus']);
  if (r.code !== 0 && /--bogus/.test(r.out)) {
    pass('--help --bogus still reports the unrecognized flag');
  } else {
    fail(`ordering regression: code=${r.code} out=${r.out.trim().slice(0, 160)}`);
  }
}

// A value flag with no operand must not be swallowed by --help either (#2961).
{
  const r = run(['--max-chars', '--help']);
  if (r.code !== 0 && /--max-chars requires a value/.test(r.out)) {
    pass('--max-chars --help reports the missing operand instead of showing help');
  } else {
    fail(`missing operand: code=${r.code} out=${r.out.trim().slice(0, 160)}`);
  }
}

// ── 3. Both value forms actually reach the extractor ─────────────────────
// This is the half the gate alone does not fix: `--max-chars=50000` passed
// validation and was then dropped by parseArgs, so the JD came back capped at
// 12000 for a caller who explicitly asked for more.
{
  const eq = parseArgs(['--max-chars=50000', 'https://example.com/job']);
  const sp = parseArgs(['--max-chars', '50000', 'https://example.com/job']);
  if (eq.maxChars === 50000 && sp.maxChars === 50000) {
    pass('--max-chars reaches the extractor in both the equals and space forms');
  } else {
    fail(`--max-chars dropped: equals=${eq.maxChars} space=${sp.maxChars}`);
  }
}

{
  const r = parseArgs(['--mode=listing', '--max=7', '--timeout=999', 'https://example.com/careers']);
  if (r.mode === 'listing' && r.max === 7 && r.timeout === 999 && r.url === 'https://example.com/careers') {
    pass('--mode, --max and --timeout all honour the equals form');
  } else {
    fail(`equals form dropped: ${JSON.stringify(r)}`);
  }
}

// ── 4. Regressions the rewrite could have introduced ─────────────────────
// The URL is still found positionally, whichever side of the flags it is on,
// and a flag's space-separated value is never mistaken for it.
{
  const before = parseArgs(['--mode', 'listing', 'https://example.com/careers']);
  const after = parseArgs(['https://example.com/careers', '--mode', 'listing']);
  if (before.url === 'https://example.com/careers' && after.url === 'https://example.com/careers') {
    pass('the URL is still found on either side of the flags');
  } else {
    fail(`url positioning: before=${before.url} after=${after.url}`);
  }
}

// `--max 0` is a meaningful request (cap the listing at nothing) and must not
// be replaced by the default, while an out-of-range or non-integer value still
// falls back rather than propagating NaN into the extractor.
{
  const zero = parseArgs(['--max', '0', 'https://example.com/careers']);
  const neg = parseArgs(['--max-chars', '-5', 'https://example.com/job']);
  const junk = parseArgs(['--timeout', 'soon', 'https://example.com/job']);
  if (zero.max === 0 && neg.maxChars === 12000 && junk.timeout === 15000) {
    pass('--max 0 is honoured, and out-of-range or non-numeric values fall back');
  } else {
    fail(`range rules: max=${zero.max} maxChars=${neg.maxChars} timeout=${junk.timeout}`);
  }
}

// A bad --mode value is still the extractor's error to report, not the gate's:
// validateFlags only knows flag NAMES, so `--mode nonsense` must reach the
// existing bad_mode check rather than being refused as an unrecognized flag.
{
  const r = run(['--mode', 'nonsense', 'https://example.com/job']);
  if (r.code !== 0 && /bad_mode/.test(r.out)) {
    pass('an unknown --mode value still reaches the extractor\'s own bad_mode error');
  } else {
    fail(`bad_mode bypassed: code=${r.code} out=${r.out.trim().slice(0, 160)}`);
  }
}
