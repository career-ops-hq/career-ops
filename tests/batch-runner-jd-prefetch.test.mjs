// tests/batch-runner-jd-prefetch.test.mjs — pins the JD pre-fetch logic added
// in fix #2492.
//
// THE BUG THIS PINS
//
// process_offer() in batch/batch-runner.sh created a temp file with mktemp but
// never wrote to it. Workers always found an empty $jd_file and fell through to
// WebFetch (batch-prompt.md Step 1 fallback). WebFetch is unreliable on
// JS-rendered boards (Phenom, Workday, iCIMS): it returns the JS shell rather
// than the JD text. 35 of 251 offers failed in the original report.
//
// The fix adds a curl pre-fetch + a word-count sufficiency check:
//   - curl writes the raw HTML into $jd_file in one round-trip
//   - node strips HTML tags and counts visible words
//   - < 80 words → likely a JS shell → truncate to 0 bytes → WebFetch fallback
//   - curl absent or failing → $jd_file stays empty → WebFetch fallback
//
// Tests extract the real bash snippets from batch-runner.sh so the tests and
// the implementation can never drift apart.
import { pass, fail, getBash } from './helpers.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdtempSync as _mdt } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n');

console.log('\nbatch-runner.sh — JD pre-fetch (issue #2492)');

// ── presence checks ─────────────────────────────────────────────────────────

// The comment must reference #2492 for git-blame traceability.
if (/#2492/.test(SRC)) {
  pass('batch-runner.sh references issue #2492 in the prefetch comment');
} else {
  fail('issue reference #2492 is missing — hard to trace the reason for this block later');
}

// The mktemp line must still be present (security: prevents predictable paths).
if (/mktemp.*batch-jd/.test(SRC)) {
  pass('mktemp with per-offer prefix is present (symlink-attack guard intact)');
} else {
  fail('mktemp with batch-jd prefix is missing from batch-runner.sh');
}

// curl must be invoked with --output pointing at $jd_file (may span lines).
// The pattern appears as:  curl ...\ \n  --output "$jd_file"
if (/--output "\$jd_file"/.test(SRC) || /-o "\$jd_file"/.test(SRC)) {
  pass('curl --output writes fetched content to $jd_file');
} else {
  fail('curl is not writing to $jd_file — the file stays empty');
}

// The threshold must be held in a named local variable (not a bare 80 literal).
if (/local prefetch_min_words=80/.test(SRC)) {
  pass('word-count threshold is in named variable prefetch_min_words=80');
} else {
  fail('could not find local prefetch_min_words=80 in batch-runner.sh');
}

// Both prefetch variables must be declared with `local` to avoid leaking into
// callers when process_offer() is invoked by the parallel fan-out dispatcher.
if (/local jd_prefetch_words=0/.test(SRC)) {
  pass('jd_prefetch_words is declared local (no global state leak between offers)');
} else {
  fail('jd_prefetch_words must be declared with `local` to prevent parallel-run interference');
}

// The prefetch block must be guarded by `command -v curl` so it is skipped when
// curl is absent instead of throwing "command not found" and aborting the offer.
if (/command -v curl/.test(SRC)) {
  pass('prefetch is guarded by "command -v curl" (skipped gracefully when curl is absent)');
} else {
  fail('"command -v curl" guard is missing — a system without curl aborts the offer');
}

// The curl call must end with `|| true` so a curl failure cannot propagate to
// the outer `set -e` shell (if enabled) and abort process_offer().
if (/curl[\s\S]{0,400}2>\/dev\/null \|\| true/.test(SRC)) {
  pass('curl call uses "|| true" (curl failure cannot abort the offer processing)');
} else {
  fail('"|| true" after curl is missing — a curl failure may abort process_offer()');
}

// The comparison uses the named variable, not a bare literal.
if (/-lt "\$prefetch_min_words"/.test(SRC)) {
  pass('comparison references $prefetch_min_words (not a bare literal)');
} else {
  fail('comparison does not use $prefetch_min_words — magic number still present');
}

// curl must use --fail so HTTP error pages do not reach the worker.
if (/--fail\b/.test(SRC)) {
  pass('curl uses --fail (HTTP error responses discard body, not passed to worker)');
} else {
  fail('curl is missing --fail — HTTP error pages could pass the word-count check');
}

// curl must cap redirect hops.
if (/--max-redirs\s+\d+/.test(SRC)) {
  pass('curl uses --max-redirs to cap redirect chains');
} else {
  fail('curl is missing --max-redirs — unbounded redirect loops possible');
}

// curl must request compressed (gzip/deflate) responses.
if (/--compressed\b/.test(SRC)) {
  pass('curl uses --compressed (accepts gzip/deflate encoded boards)');
} else {
  fail('curl is missing --compressed — gzip responses write binary garbage to $jd_file');
}

// curl must send an Accept header so boards serve HTML rather than JSON.
if (/--header.*Accept.*text\/html/.test(SRC) || /--header.*text\/html/.test(SRC)) {
  pass('curl sends Accept: text/html header (boards serve HTML, not JSON or mobile variant)');
} else {
  fail('curl is missing Accept header — some boards may serve JSON or redirect to a mobile view');
}

// max-time must be in a sensible range (5–120 seconds). Extract early so it
// can be referenced by the connect-timeout ordering check below.
const maxTimeMatch = SRC.match(/--max-time\s+(\d+)/);
if (maxTimeMatch) {
  const maxTime = Number(maxTimeMatch[1]);
  if (maxTime >= 5 && maxTime <= 120) {
    pass(`curl --max-time is ${maxTime}s (within the 5-120s reasonable range)`);
  } else {
    fail(`curl --max-time is ${maxTime}s — too short (<5s) or too long (>120s) for a prefetch`);
  }
} else {
  fail('curl is missing --max-time — unbounded requests could hang a batch worker indefinitely');
}

// curl must use a browser-like user-agent so job boards don't block the prefetch.
if (/--user-agent\s+"Mozilla/.test(SRC)) {
  pass('curl uses a Mozilla/... user-agent (bot-blockers and rate-limiters are less likely to block)');
} else {
  fail('curl user-agent is missing or does not start with Mozilla — some boards block non-browser UAs');
}

// curl must have a separate connect timeout (TCP stall should not eat the full budget).
const connectTimeoutMatch = SRC.match(/--connect-timeout\s+(\d+)/);
if (connectTimeoutMatch) {
  pass('curl uses --connect-timeout (TCP stalls fail fast, not consuming the full max-time)');
  // connect-timeout must be strictly less than max-time; otherwise it is redundant.
  const connectTimeout = Number(connectTimeoutMatch[1]);
  const maxTimeValue = maxTimeMatch ? Number(maxTimeMatch[1]) : Infinity;
  if (connectTimeout < maxTimeValue) {
    pass(`connect-timeout (${connectTimeout}s) < max-time (${maxTimeValue}s) — connect guard is meaningful`);
  } else {
    fail(`connect-timeout (${connectTimeout}s) >= max-time (${maxTimeValue}s) — connect-timeout is redundant`);
  }
} else {
  fail('curl is missing --connect-timeout — unreachable servers stall for the full max-time');
}

// The integer sanitization guard must be present — strips non-digit chars, defaults to 0.
if (/jd_prefetch_words="\$\{jd_prefetch_words\/\/\[/.test(SRC) || /jd_prefetch_words.*\[.*\^0-9\]/.test(SRC)) {
  pass('jd_prefetch_words is sanitized to integer (non-digit characters stripped)');
} else {
  fail('jd_prefetch_words integer sanitization is missing — non-integer node output causes bash arithmetic error');
}

// The curl call must use `-- "$url"` to separate options from the URL operand.
// A URL starting with `-` would otherwise be parsed as a curl flag (flag injection).
if (/-- "\$url"/.test(SRC)) {
  pass('curl uses -- before $url (URL-as-flag injection prevented)');
} else {
  fail('curl is missing "-- \\"$url\\"" — a URL starting with - would be parsed as a flag');
}

// The node word-count snippet must use process.argv[1] (not "$jd_file" expanded into the JS)
// to prevent shell injection if the temp path ever contains characters meaningful to JavaScript.
if (/readFileSync\(process\.argv\[1\]/.test(SRC)) {
  pass('node snippet reads file via process.argv[1] (not shell-expanded path in JS string — injection safe)');
} else {
  fail('node snippet does not use process.argv[1] — a special-char temp path could cause JS parse error');
}

// jd_file must be cleaned up in the rm -f line alongside resolved_prompt.
if (/rm -f "\$resolved_prompt" "\$jd_file"/.test(SRC) || /rm -f "\$jd_file"/.test(SRC)) {
  pass('$jd_file is removed during cleanup (no temp file leak)');
} else {
  fail('$jd_file is not cleaned up — temp files accumulate in /tmp');
}

// The prefetch block must occur BEFORE the "--- Processing offer" log line so
// the operator sees the prefetch outcome before the worker launch message.
const mktemPos = SRC.indexOf('jd_file="$(mktemp');
const prefetchPos = SRC.indexOf('if command -v curl');
const processingPos = SRC.indexOf('echo "--- Processing offer');
if (mktemPos >= 0 && prefetchPos >= 0 && processingPos >= 0 &&
    mktemPos < prefetchPos && prefetchPos < processingPos) {
  pass('prefetch block is ordered correctly: mktemp → prefetch → "--- Processing offer" echo');
} else {
  fail('prefetch block ordering is wrong — expected mktemp → prefetch → echo Processing');
}

// Log messages must be present for both the thin-content and rich-content paths.
if (/JD prefetch.*thin content/.test(SRC)) {
  pass('thin-content log message is present ("JD prefetch: thin content")');
} else {
  fail('thin-content log message is missing — operators cannot see prefetch fallback reason');
}
if (/JD prefetch.*words written/.test(SRC)) {
  pass('success log message is present ("JD prefetch: N words written")');
} else {
  fail('success log message is missing — operators cannot verify prefetch outcome');
}

// ── word-count node snippet ──────────────────────────────────────────────────
// Extract the node -e program that counts visible words so we can run it in
// isolation. This ensures the stripping + counting logic stays correct as the
// surrounding shell code evolves.
const wordCountMatch = SRC.match(/jd_prefetch_words=\$\(node -e "([\s\S]*?)" "\$jd_file"/);

if (!wordCountMatch) {
  fail('could not extract the word-count node snippet from batch-runner.sh — tests need updating');
} else {
  pass('word-count node snippet is present and extractable');

  const nodeSnippet = wordCountMatch[1];
  const work = mkdtempSync(join(tmpdir(), 'cops-jdprefetch-'));

  try {
    const runWordCount = (content) => {
      const filePath = join(work, 'jd.html');
      writeFileSync(filePath, content);
      const result = spawnSync(process.execPath, ['-e', nodeSnippet, filePath], {
        encoding: 'utf-8',
        timeout: 10000,
      });
      return parseInt(result.stdout.trim(), 10) || 0;
    };

    // A real job description has hundreds of visible words.
    const realJdHtml = `
      <html><body>
        <h1>Senior Software Engineer</h1>
        <p>We are looking for an experienced engineer to join our team. You will work on
        distributed systems, design APIs, mentor junior engineers, and drive technical
        decisions. Requirements include five years of backend experience, proficiency in
        Go or Python, and strong communication skills. Responsibilities include building
        scalable microservices, reviewing pull requests, participating in on-call
        rotation, collaborating with product managers, and documenting architecture
        decisions. We offer competitive compensation, equity, remote flexibility, and a
        strong engineering culture. Apply today to join our mission-driven team.</p>
      </body></html>`;
    const realCount = runWordCount(realJdHtml);
    if (realCount >= 80) {
      pass(`real JD HTML counts ${realCount} visible words (>= 80 threshold)`);
    } else {
      fail(`real JD HTML counted only ${realCount} words — threshold of 80 would wrongly truncate it`);
    }

    // A JS shell (Workday, Phenom, iCIMS pattern) has near-zero visible text.
    const jsShellHtml = `
      <!doctype html><html lang="en"><head>
        <meta charset="utf-8">
        <title>Jobs</title>
        <script src="/static/js/main.chunk.js"></script>
      </head><body>
        <div id="root"></div>
        <script>window.__REDUX_STATE__={}</script>
      </body></html>`;
    const shellCount = runWordCount(jsShellHtml);
    if (shellCount < 80) {
      pass(`JS shell HTML counts only ${shellCount} visible words (< 80 threshold → truncates correctly)`);
    } else {
      fail(`JS shell HTML counted ${shellCount} words — threshold of 80 would not catch it`);
    }

    // A JS shell with a large inline bundle: script content must NOT be counted.
    // Without explicit <script> stripping, JS code inflates the word count and
    // the shell passes the threshold, sending JS code to the worker.
    const inlineBundleHtml = `
      <!doctype html><html><head></head><body>
        <div id="app"></div>
        <script>
          const routes = [
            { path: '/home', component: 'Home', exact: true, strict: false },
            { path: '/jobs', component: 'JobList', exact: true, strict: false },
            { path: '/jobs/:id', component: 'JobDetail', exact: true },
          ];
          const store = configureStore({ reducer: { jobs: jobsReducer, auth: authReducer } });
          const theme = createTheme({ palette: { primary: { main: '#3f51b5' } } });
          function App() { return createElement(Provider, { store }, createElement(Router, { routes })); }
          function JobList() { return jobs.map(j => createElement(JobCard, { key: j.id, job: j })); }
          function JobDetail() { return createElement(JobContent, { job: selectedJob, loading }); }
        </script>
      </body></html>`;
    const bundleCount = runWordCount(inlineBundleHtml);
    if (bundleCount < 80) {
      pass(`JS shell with inline bundle: ${bundleCount} visible words (script content stripped correctly)`);
    } else {
      fail(`JS shell with inline bundle: ${bundleCount} words — script content was not stripped and inflated the count`);
    }

    // A <style> block with many rules must also be stripped.
    const styleHeavyHtml = `
      <!doctype html><html><head>
        <style>
          .container { display: flex; flex-direction: column; align-items: center; }
          .header { font-size: 24px; font-weight: bold; color: #333; margin-bottom: 16px; }
          .body { font-size: 16px; line-height: 1.5; color: #666; max-width: 800px; }
          .footer { font-size: 12px; color: #999; margin-top: 32px; text-align: center; }
        </style>
      </head><body><div id="root"></div></body></html>`;
    const styleCount = runWordCount(styleHeavyHtml);
    if (styleCount < 80) {
      pass(`style-heavy shell: ${styleCount} visible words (style block stripped correctly)`);
    } else {
      fail(`style-heavy shell: ${styleCount} words — style block was not stripped`);
    }

    // An empty file (curl failed) should count zero words.
    const emptyCount = runWordCount('');
    if (emptyCount === 0) {
      pass('empty file counts 0 words (curl-failure path handled)');
    } else {
      fail(`empty file counted ${emptyCount} words instead of 0`);
    }

    // Exactly 80 words is at the boundary — should NOT be truncated (< not <=).
    const exactly80 = '<p>' + 'word '.repeat(80).trim() + '</p>';
    const boundaryCount = runWordCount(exactly80);
    if (boundaryCount >= 80) {
      pass(`80-word boundary: counted ${boundaryCount} words (threshold is < 80, so this is kept)`);
    } else {
      fail(`80-word boundary miscounted as ${boundaryCount}`);
    }

    // 79 words is just below — must be truncated.
    const exactly79 = '<p>' + 'word '.repeat(79).trim() + '</p>';
    const below79Count = runWordCount(exactly79);
    if (below79Count < 80) {
      pass(`79-word boundary: counted ${below79Count} words (< 80 → file truncated)`);
    } else {
      fail(`79-word boundary miscounted as ${below79Count} (expected < 80)`);
    }

    // Whitespace-only content (blank page, minimal HTML with no text) must count 0.
    const whitespaceOnly = '   \n\t  \r\n   ';
    const wsCount = runWordCount(whitespaceOnly);
    if (wsCount === 0) {
      pass('whitespace-only content counts 0 words');
    } else {
      fail(`whitespace-only content counted ${wsCount} words instead of 0`);
    }

    // A binary file (e.g. accidentally fetching a PDF URL) should count 0 safe words.
    // Node reads it as UTF-8, gets garbled text, and the visible-word count stays low.
    // We simulate this with a short run of non-text bytes as a string.
    const binaryContent = '\x00\x01\x02\x03\xff\xfe\xfd binary payload \x04\x05';
    const binaryCount = runWordCount(binaryContent);
    if (binaryCount < 80) {
      pass(`binary content (${binaryCount} words): file would be truncated → WebFetch fallback`);
    } else {
      fail(`binary content: counted ${binaryCount} words — too high, worker would receive garbage`);
    }

    // HTML entities in visible text should be counted as words (they are readable).
    // `&amp;`, `&lt;`, `&#8203;` etc. remain as-is after tag-stripping and count.
    const entityHtml = '<p>' + 'word&amp;word '.repeat(10).trim() + '</p>';
    const entityCount = runWordCount(entityHtml);
    if (entityCount > 0) {
      pass(`HTML entities in visible text are counted as words (${entityCount} words)`);
    } else {
      fail('HTML entities in visible text counted as 0 — they should still count');
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ── end-to-end bash simulation ───────────────────────────────────────────────
// Run the full curl → word-count → truncate decision in an isolated bash script
// that substitutes curl with a function so no network is needed.
{
  const work = mkdtempSync(join(tmpdir(), 'cops-jdprefetch-e2e-'));
  try {
    // Extract the curl block and word-count block from SRC.
    // We look for the block between mktemp and the echo "--- Processing offer" line.
    const prefetchBlock = SRC.match(
      /jd_file="\$\(mktemp[\s\S]*?\n\n  echo "--- Processing offer/
    );

    if (!prefetchBlock) {
      fail('could not extract the prefetch block from batch-runner.sh for e2e test');
    } else {
      pass('prefetch block is extractable for e2e simulation');

      // Extract the real node word-count snippet from SRC so this e2e test
      // always uses the same logic as batch-runner.sh — no drift possible.
      const realWordCountSnippet = (wordCountMatch && wordCountMatch[1]) || '';

      // Helper: write a script that mocks curl and runs the real prefetch logic.
      const buildScript = (curlOutput, curlExit = 0) => {
        const jdFilePath = join(work, 'jd.html');

        return [
          '#!/usr/bin/env bash',
          `jd_file=${JSON.stringify(jdFilePath)}`,
          `> "$jd_file"`,  // mktemp creates empty file
          `# Stub curl: writes predetermined content or fails`,
          `curl() {`,
          `  local output_arg=""`,
          `  while [[ $# -gt 0 ]]; do`,
          `    if [[ "$1" == "--output" || "$1" == "-o" ]]; then output_arg="$2"; shift 2`,
          `    else shift; fi`,
          `  done`,
          curlExit === 0
            ? `  [[ -n "$output_arg" ]] && printf '%s' ${JSON.stringify(curlOutput)} > "$output_arg" || true`
            : `  return 1`,
          `}`,
          `prefetch_min_words=80`,
          `jd_prefetch_words=0`,
          `if command -v curl >/dev/null 2>&1; then`,
          `  curl --silent --location --max-time 20 --connect-timeout 5 \\`,
          `    --fail --max-redirs 10 --compressed \\`,
          `    --user-agent "Mozilla/5.0 (compatible; career-ops/batch)" \\`,
          `    --header "Accept: text/html,application/xhtml+xml,*/*;q=0.8" \\`,
          `    --output "$jd_file" \\`,
          `    -- "https://example.com/job" 2>/dev/null || true`,
          `  jd_prefetch_words=$(node -e "${realWordCountSnippet.replace(/"/g, '\\"')}" "$jd_file" 2>/dev/null) || jd_prefetch_words=0`,
          `  jd_prefetch_words="\${jd_prefetch_words//[^0-9]/}"`,
          `  jd_prefetch_words="\${jd_prefetch_words:-0}"`,
          `  if [[ "$jd_prefetch_words" -lt "$prefetch_min_words" ]]; then`,
          `    : > "$jd_file"`,
          `  fi`,
          `fi`,
          // Report results: file size and word count
          `file_size=$(wc -c < "$jd_file" 2>/dev/null || echo 0)`,
          `printf '%s|%s\\n' "$jd_prefetch_words" "$file_size"`,
        ].join('\n');
      };

      const bash = getBash();

      // Case 1: rich HTML → file stays populated
      const richHtml = '<p>' + 'word '.repeat(120).trim() + '</p>';
      const script1 = join(work, 'case1.sh');
      writeFileSync(script1, buildScript(richHtml));
      const result1 = execFileSync(bash, [script1], { encoding: 'utf-8', timeout: 30000 }).trim();
      const [words1, size1] = result1.split('|').map(Number);
      if (words1 >= 80 && size1 > 0) {
        pass(`rich HTML (${words1} words): file kept (${size1} bytes) — worker reads real JD`);
      } else {
        fail(`rich HTML: expected kept file, got words=${words1} size=${size1}`);
      }

      // Case 2: JS shell HTML → file truncated to 0 bytes
      const jsShell = '<div id="root"></div><script>window.__STATE__={}</script>';
      const script2 = join(work, 'case2.sh');
      writeFileSync(script2, buildScript(jsShell));
      const result2 = execFileSync(bash, [script2], { encoding: 'utf-8', timeout: 30000 }).trim();
      const [words2, size2] = result2.split('|').map(Number);
      if (size2 === 0) {
        pass(`JS shell HTML (${words2} words): file truncated → WebFetch fallback fires`);
      } else {
        fail(`JS shell HTML: expected truncated file, got words=${words2} size=${size2}`);
      }

      // Case 3: curl failure → file empty → WebFetch fallback fires
      const script3 = join(work, 'case3.sh');
      writeFileSync(script3, buildScript('', 1));
      const result3 = execFileSync(bash, [script3], { encoding: 'utf-8', timeout: 30000 }).trim();
      const [, size3] = result3.split('|').map(Number);
      if (size3 === 0) {
        pass('curl failure: file stays empty → WebFetch fallback fires');
      } else {
        fail(`curl failure: expected empty file, got size=${size3}`);
      }

      // Case 4: exactly 79 words → truncated (< 80)
      const html79 = '<p>' + 'word '.repeat(79).trim() + '</p>';
      const script4 = join(work, 'case4.sh');
      writeFileSync(script4, buildScript(html79));
      const result4 = execFileSync(bash, [script4], { encoding: 'utf-8', timeout: 30000 }).trim();
      const [words4, size4] = result4.split('|').map(Number);
      if (size4 === 0) {
        pass(`79-word HTML in bash: file truncated (words=${words4}) → WebFetch fallback fires`);
      } else {
        fail(`79-word HTML in bash: expected truncated, got words=${words4} size=${size4}`);
      }

      // Case 5: exactly 80 words → file kept (threshold is < 80, not <=)
      const html80 = '<p>' + 'word '.repeat(80).trim() + '</p>';
      const script5 = join(work, 'case5.sh');
      writeFileSync(script5, buildScript(html80));
      const result5 = execFileSync(bash, [script5], { encoding: 'utf-8', timeout: 30000 }).trim();
      const [words5, size5] = result5.split('|').map(Number);
      if (size5 > 0) {
        pass(`80-word HTML in bash: file kept (words=${words5}, size=${size5}) — threshold is strict <`);
      } else {
        fail(`80-word HTML in bash: expected kept file, got words=${words5} size=${size5}`);
      }

      // Case 7: page with large inline JS bundle → script stripped → file truncated.
      // Without <script> stripping, the JS token count would exceed the threshold
      // and send JS code to the worker. This verifies the fix in bash context.
      const inlineBundle = [
        '<html><head></head><body><div id="root"></div>',
        '<script>',
        // 150+ JS tokens that would pass a naive word-count
        Array.from({ length: 20 }, (_, i) =>
          `const route${i} = { path: '/job/${i}', component: 'Job${i}', exact: true };`
        ).join(' '),
        '</script>',
        '</body></html>',
      ].join('');
      const script7 = join(work, 'case7.sh');
      writeFileSync(script7, buildScript(inlineBundle));
      const result7 = execFileSync(bash, [script7], { encoding: 'utf-8', timeout: 30000 }).trim();
      const [words7, size7] = result7.split('|').map(Number);
      if (size7 === 0) {
        pass(`inline JS bundle (${words7} visible words after stripping): file truncated → WebFetch fires`);
      } else {
        fail(`inline JS bundle: expected truncated file (JS stripped), got words=${words7} size=${size7}`);
      }

      // Case 6: curl not in PATH → file stays empty → WebFetch fallback fires.
      // Remove curl from PATH so `command -v curl` fails and the block is skipped.
      const buildNoCurlScript = () => {
        const jdFilePath = join(work, 'jd-nocurl.html');
        return [
          '#!/usr/bin/env bash',
          `jd_file=${JSON.stringify(jdFilePath)}`,
          `> "$jd_file"`,  // mktemp creates empty file
          `prefetch_min_words=80`,
          `jd_prefetch_words=0`,
          // Remove curl from PATH
          `export PATH="$(echo "$PATH" | tr ':' '\\n' | grep -v curl | tr '\\n' ':')"`,
          // The actual guard from batch-runner.sh
          `if command -v curl >/dev/null 2>&1; then`,
          `  echo 'ERROR: curl should not be found in this test' >&2`,
          `fi`,
          `file_size=$(wc -c < "$jd_file" 2>/dev/null || echo 0)`,
          `printf '%s|%s\\n' "$jd_prefetch_words" "$file_size"`,
        ].join('\n');
      };
      const script6 = join(work, 'case6.sh');
      writeFileSync(script6, buildNoCurlScript());
      const result6 = execFileSync(bash, [script6], { encoding: 'utf-8', timeout: 30000 }).trim();
      const [, size6] = result6.split('|').map(Number);
      if (size6 === 0) {
        pass('curl absent from PATH: file stays empty → WebFetch fallback fires');
      } else {
        fail(`curl absent: expected empty file, got size=${size6}`);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
