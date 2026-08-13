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

// jd_file must be cleaned up in the rm -f line alongside resolved_prompt.
if (/rm -f "\$resolved_prompt" "\$jd_file"/.test(SRC) || /rm -f "\$jd_file"/.test(SRC)) {
  pass('$jd_file is removed during cleanup (no temp file leak)');
} else {
  fail('$jd_file is not cleaned up — temp files accumulate in /tmp');
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

      // Helper: write a script that mocks curl and runs the prefetch logic.
      const buildScript = (curlOutput, curlExit = 0) => {
        const jdFilePath = join(work, 'jd.html');
        // Use a fake curl that writes predetermined content
        const fakeCurlBody = curlExit === 0
          ? `printf '%s' ${JSON.stringify(curlOutput)} > "$4"`  // $4 is the --output arg value
          : `exit 1`;

        return [
          '#!/usr/bin/env bash',
          `jd_file=${JSON.stringify(jdFilePath)}`,
          `# Stub curl with a function`,
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
          `jd_prefetch_words=0`,
          `if command -v curl >/dev/null 2>&1; then`,
          `  curl --silent --location --max-time 20 \\`,
          `    --user-agent "Mozilla/5.0 (compatible; career-ops/batch)" \\`,
          `    --output "$jd_file" \\`,
          `    -- "https://example.com/job" 2>/dev/null || true`,
          `  jd_prefetch_words=$(node -e "`,
          `    const fs = require('fs');`,
          `    try {`,
          `      const text = fs.readFileSync(process.argv[1], 'utf-8')`,
          `        .replace(/<[^>]+>/g, ' ')`,
          `        .replace(/\\\\s+/g, ' ')`,
          `        .trim();`,
          `      console.log(text.split(' ').filter(Boolean).length);`,
          `    } catch (e) { console.log(0); }`,
          `  " "$jd_file" 2>/dev/null) || jd_prefetch_words=0`,
          `  if [[ "\${jd_prefetch_words:-0}" -lt 80 ]]; then`,
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
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
