// tests/openrouter-runner-validation.test.mjs — strict validation of evaluation reports,
// daily quota exhaustion halting, configurable timeout, and rejection of malformed tool calls.
//
// Run: node --test tests/openrouter-runner-validation.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const {
  validateEvaluationResponse,
  isDailyQuotaExhausted,
  QuotaExhaustedError,
  getModelTimeoutMs,
} = await import(pathToFileURL(join(ROOT, 'openrouter-runner.mjs')).href);

const VALID_EVALUATION = `
**URL:** https://example.com/job/123
**Score:** 4.2/5
**Decision:** Apply
**Legitimacy:** High Confidence

---

## Machine Summary
\`\`\`yaml
company: "Acme"
role: "Senior Backend Engineer"
score: 4.2
final_decision: "Apply"
\`\`\`

## A) Role Summary
Backend platform role focusing on distributed systems in Go and Node.js.
- Domain: Platform / Cloud
- Seniority: Senior
- Remote: Full

## B) Match with CV
| Requirement | Importance | Match | JD signal | Evidence / gap |
|---|---|---|---|---|
| Node.js | critical (stated) | ✅ Strong | "Expert Node.js" | cv.md: 5 years experience |

## C) Level and Strategy
Targeted at senior level with solid engineering ownership.

## D) Comp and Demand
Salary benchmark 120-140k EUR in line with market expectation.

## E) Customization Plan
Emphasize backend scale, microservices, and high-throughput queue architectures.

## F) Interview Plan
Prepare STAR stories for distributed systems troubleshooting and latency reduction.

## G) Posting Legitimacy
Verified direct company board with transparent company information. High Confidence.
`;

// ── 1. Validation of Genuine Evaluation ───────────────────────────────────

test('valid complete evaluation passes validation', () => {
  const result = validateEvaluationResponse(VALID_EVALUATION);
  assert.equal(result.ok, true, `Expected valid evaluation to pass, got: ${result.reason}`);
});

test('valid evaluation with format variants (CV Match, Personalization Plan, bold Decision) passes', () => {
  const variant = VALID_EVALUATION
    .replace('## B) Match with CV', '## B) CV Match')
    .replace('## E) Customization Plan', '## E) Personalization Plan')
    .replace('**Decision:** Apply', '**Decision:** **Apply**');
  const result = validateEvaluationResponse(variant);
  assert.equal(result.ok, true, `Expected format variant to pass, got: ${result.reason}`);
});

// ── 2. Tool-Call & Command Rejection ──────────────────────────────────────

test('rejects <tool_call> markup', () => {
  const invalid = `
${VALID_EVALUATION}
<tool_call>browser_navigate<arg_key>url</arg_key><arg_value>https://example.com</arg_value></tool_call>
`;
  const result = validateEvaluationResponse(invalid);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'contains_tool_call_markup');
});

test('rejects <dots_function_call> markup', () => {
  const invalid = `
I'll evaluate this listing.
<dots_function_call>
Bash
cat /workspace/data/blacklist.md
</dots_function_call>
`;
  const result = validateEvaluationResponse(invalid);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'contains_tool_call_markup');
});

test('rejects <|tool_call_start|> WebFetch markup', () => {
  const invalid = `
<|tool_call_start|>[WebFetch(url='https://job-boards.greenhouse.io/acme/jobs/123')]<|tool_call_end|>
`;
  const result = validateEvaluationResponse(invalid);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'contains_tool_call_markup');
});

test('rejects JSON tool invocation requests', () => {
  const invalid = `
{"tool": "browser_navigate", "url": "https://example.com", "wait_until": "networkidle"}
`;
  const result = validateEvaluationResponse(invalid);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'json_tool_request');
});

test('rejects JSON tool command payloads', () => {
  const invalid = `
{"command": "node reserve-report-num.mjs", "description": "Reserve report number"}
`;
  const result = validateEvaluationResponse(invalid);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'json_tool_request');
});

test('rejects browser session placeholder', () => {
  const invalid = `
Browser session opened. Navigating to URL: https://example.com/job/123
`;
  const result = validateEvaluationResponse(invalid);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'browser_command_instruction');
});

test('rejects User Safety placeholder stubs', () => {
  const invalid = `
User Safety: safe

<iframe src="https://example.com"></iframe>
`;
  const result = validateEvaluationResponse(invalid);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'safety_filter_placeholder');
});

test('rejects shell execution instructions', () => {
  const invalid = `
\`\`\`bash
node browser-extract.mjs https://example.com/job/123 --mode jd
\`\`\`
`;
  const result = validateEvaluationResponse(invalid);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'shell_command_instruction');
});

test('rejects node reserve-report-num command instructions while accepting normal evaluation text', () => {
  const shellCommands = [
    'node reserve-report-num',
    'node reserve-report-num.mjs',
    'node   reserve-report-num.mjs',
    'node reserve-report-num --count 1',
    'node reserve-report-num.mjs --release 001',
    'Please run node reserve-report-num.mjs before proceeding.',
    '```sh\nnode reserve-report-num\n```',
  ];

  for (const cmd of shellCommands) {
    const res = validateEvaluationResponse(cmd);
    assert.equal(res.ok, false, `Expected rejection for: "${cmd}"`);
    assert.equal(res.reason, 'shell_command_instruction');
  }

  // An otherwise complete evaluation containing the command is rejected
  const embedded = `${VALID_EVALUATION}\nPlease run node reserve-report-num.mjs to reserve a slot.`;
  const resEmbedded = validateEvaluationResponse(embedded);
  assert.equal(resEmbedded.ok, false);
  assert.equal(resEmbedded.reason, 'shell_command_instruction');

  // Normal evaluation text (including mentions of Node.js and report numbering concepts) is accepted
  const resValid = validateEvaluationResponse(VALID_EVALUATION);
  assert.equal(resValid.ok, true, `Expected valid evaluation to pass, got: ${resValid.reason}`);

  const normalWithMentions = VALID_EVALUATION.replace(
    'Backend platform role focusing on distributed systems in Go and Node.js.',
    'Role involves Node runtime services and reserving report slots as part of platform architecture.'
  );
  const resMentions = validateEvaluationResponse(normalWithMentions);
  assert.equal(resMentions.ok, true, `Expected evaluation with technical mentions to pass, got: ${resMentions.reason}`);
});

// ── 3. Empty & Incomplete Reports ─────────────────────────────────────────

test('rejects empty or null response', () => {
  assert.equal(validateEvaluationResponse('').ok, false);
  assert.equal(validateEvaluationResponse(null).ok, false);
  assert.equal(validateEvaluationResponse('   ').ok, false);
});

test('rejects responses that are too short', () => {
  const short = 'This is a brief job evaluation. The role looks fine.';
  const res = validateEvaluationResponse(short);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'content_too_short');
});

test('rejects evaluations missing essential blocks (e.g. Block A or Block B or Block G)', () => {
  const noBlockA = VALID_EVALUATION.replace(/## A\) Role Summary[\s\S]*?(?=## B\))/i, '');
  const resA = validateEvaluationResponse(noBlockA);
  assert.equal(resA.ok, false);
  assert.equal(resA.reason, 'missing_block_A');

  const noBlockB = VALID_EVALUATION.replace(/## B\) Match with CV[\s\S]*?(?=## C\))/i, '');
  const resB = validateEvaluationResponse(noBlockB);
  assert.equal(resB.ok, false);
  assert.equal(resB.reason, 'missing_block_B');

  const noBlockG = VALID_EVALUATION.replace(/## G\) Posting Legitimacy[\s\S]*$/i, '');
  const resG = validateEvaluationResponse(noBlockG);
  assert.equal(resG.ok, false);
  assert.equal(resG.reason, 'missing_block_G');
});

test('rejects misleading headings such as About and Background as block substitutes', () => {
  const withAbout = VALID_EVALUATION.replace('## A) Role Summary', '## About the Role');
  const resAbout = validateEvaluationResponse(withAbout);
  assert.equal(resAbout.ok, false);
  assert.equal(resAbout.reason, 'missing_block_A');

  const withBackground = VALID_EVALUATION.replace('## B) Match with CV', '## Background');
  const resBg = validateEvaluationResponse(withBackground);
  assert.equal(resBg.ok, false);
  assert.equal(resBg.reason, 'missing_block_B');

  const withA1 = VALID_EVALUATION.replace('## A) Role Summary', '## A1 Role Summary');
  const resA1 = validateEvaluationResponse(withA1);
  assert.equal(resA1.ok, false);
  assert.equal(resA1.reason, 'missing_block_A');
});

test('rejects evaluations without a score or decision', () => {
  const noScore = VALID_EVALUATION
    .replace(/\*\*Score:\*\* 4\.2\/5\n\*\*Decision:\*\* Apply/i, '')
    .replace(/score:\s*4\.2/i, '')
    .replace(/final_decision:\s*"Apply"/i, '');
  const res = validateEvaluationResponse(noScore);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'missing_score_or_decision');
});

// ── 4. Daily Quota Exhaustion Detection ───────────────────────────────────

test('isDailyQuotaExhausted accurately identifies 429 quota exhaustion', () => {
  assert.equal(isDailyQuotaExhausted(429, 'Rate limit exceeded: free-models-per-day'), true);
  assert.equal(isDailyQuotaExhausted(429, 'Daily limit exceeded for free tier'), true);
  assert.equal(isDailyQuotaExhausted(429, 'OpenRouter error: free model daily quota reached'), true);
  assert.equal(isDailyQuotaExhausted(429, 'Account per-day limit exceeded'), true);
  assert.equal(isDailyQuotaExhausted(429, 'Daily quota exceeded'), true);

  // Transient rate limit is NOT daily quota exhaustion
  assert.equal(isDailyQuotaExhausted(429, 'Rate limit: 20 requests per minute'), false);
  assert.equal(isDailyQuotaExhausted(429, 'temporarily rate limited, please retry in 5s'), false);
  assert.equal(isDailyQuotaExhausted(429, 'per-minute quota exceeded'), false);
  assert.equal(isDailyQuotaExhausted(500, 'free-models-per-day'), false);
});

// ── 5. OpenRouter Call With Quota Exhaustion & Mocking ─────────────────────

test('callOpenRouter immediately halts when free-models-per-day quota is hit', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'cops-quota-test-'));
  const realFetch = globalThis.fetch;
  const realKey = process.env.OPENROUTER_API_KEY;
  let modelAttempts = 0;

  try {
    process.env.CAREER_OPS_ROOT = dataRoot;
    process.env.OPENROUTER_API_KEY = 'test-key';

    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { id: 'google/model-1:free', pricing: { prompt: '0', completion: '0' } },
              { id: 'qwen/model-2:free', pricing: { prompt: '0', completion: '0' } },
              { id: 'meta-llama/model-3:free', pricing: { prompt: '0', completion: '0' } },
            ],
          }),
        };
      }
      modelAttempts++;
      return {
        ok: false,
        status: 429,
        text: async () => '{"error":{"message":"Rate limit: free-models-per-day limit reached"}}',
      };
    };

    const runnerUrl = `${pathToFileURL(join(ROOT, 'openrouter-runner.mjs')).href}?test=quota-halt`;
    const runner = await import(runnerUrl);

    await assert.rejects(
      async () => {
        await runner.callOpenRouter('system prompt', 'evaluate job');
      },
      (err) => {
        assert.equal(err.name, 'QuotaExhaustedError');
        return true;
      },
      'Expected callOpenRouter to throw QuotaExhaustedError'
    );

    // CRITICAL: modelAttempts must be 1. It must NOT cycle through the remaining 2 models!
    assert.equal(modelAttempts, 1, `Expected exactly 1 attempt before immediate halt, got ${modelAttempts}`);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = realKey;
    delete process.env.CAREER_OPS_ROOT;
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

// ── 6. Timeout Does Not Blacklist Model to Disk ───────────────────────────

test('callOpenRouter does not disk-blacklist models on timeout', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'cops-timeout-test-'));
  const realFetch = globalThis.fetch;
  const realKey = process.env.OPENROUTER_API_KEY;
  const origModel = process.env.CAREER_OPS_MODEL;

  try {
    process.env.CAREER_OPS_ROOT = dataRoot;
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.CAREER_OPS_TIMEOUT_MS = '100'; // short timeout for testing
    delete process.env.CAREER_OPS_MODEL; // ensure dynamic model rotation path is exercised

    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      if (u.endsWith('/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: 'google/model-timeout:free', pricing: { prompt: '0', completion: '0' } }],
          }),
        };
      }
      return new Promise((_, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          const err = new Error('aborted');
          err.name = 'AbortError';
          return reject(err);
        }
        signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    };

    const runnerUrl = `${pathToFileURL(join(ROOT, 'openrouter-runner.mjs')).href}?test=timeout-noblacklist`;
    const runner = await import(runnerUrl);

    await assert.rejects(
      async () => {
        await runner.callOpenRouter('system', 'user');
      },
      (err) => {
        assert.match(err.message, /Timeout after 0\.1s/);
        return true;
      }
    );

    const blacklistFile = join(dataRoot, 'data', 'model-blacklist.json');
    assert.equal(existsSync(blacklistFile), false, 'Timeout should not write a blacklist file to disk');
    assert.equal(runner.blacklistedModels.has('google/model-timeout:free'), false, 'Model should not be permanently blacklisted');
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = realKey;
    if (origModel === undefined) delete process.env.CAREER_OPS_MODEL;
    else process.env.CAREER_OPS_MODEL = origModel;
    delete process.env.CAREER_OPS_ROOT;
    delete process.env.CAREER_OPS_TIMEOUT_MS;
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

// ── 7. Pipeline --one Mode Processing ─────────────────────────────────────

test('cmdPipeline with { one: true } processes exactly one job without running subsequent listings', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'cops-pipeline-one-test-'));
  const realFetch = globalThis.fetch;
  const realKey = process.env.OPENROUTER_API_KEY;

  try {
    process.env.CAREER_OPS_ROOT = dataRoot;
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.CAREER_OPS_NO_PLAYWRIGHT = '1';

    // Set up dummy pipeline.md with 3 pending items
    const dataDir = join(dataRoot, 'data');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(dataRoot, 'reports'), { recursive: true });
    mkdirSync(join(dataRoot, 'batch', 'tracker-additions'), { recursive: true });

    const initialPipeline = [
      '# Pipeline',
      '',
      '- [ ] https://jobs.test/job-1 | Acme | Senior Backend Engineer',
      '- [ ] https://jobs.test/job-2 | Beta | Full Stack Engineer',
      '- [ ] https://jobs.test/job-3 | Gamma | DevOps Engineer',
      '',
    ].join('\n');
    writeFileSync(join(dataDir, 'pipeline.md'), initialPipeline, 'utf-8');

    let completionsCalls = 0;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: 'google/test-model:free', pricing: { prompt: '0', completion: '0' } }],
          }),
        };
      }
      if (u.includes('jobs.test/job-')) {
        return {
          ok: true,
          status: 200,
          url: u,
          text: async () => [
            '# Backend Engineer at Acme Corp',
            'About the Role:',
            'We are seeking an experienced Senior Backend Engineer to design, build, and scale our core infrastructure services.',
            'Key Responsibilities:',
            '- Architect high-throughput distributed backend services using Node.js, Go, and PostgreSQL.',
            '- Collaborate with cross-functional product and engineering teams to deliver mission-critical APIs.',
            '- Implement comprehensive observability, structured logging, tracing, and automated test coverage.',
            'Qualifications and Requirements:',
            '- 5+ years of production experience in backend development and distributed cloud architectures.',
            '- Demonstrated track record of optimizing database queries and high-concurrency microservices.',
            'Location: Remote (Worldwide overlap). Competitive salary range: $140,000 - $180,000 USD plus equity.',
            'Apply Now: Submit your application to join our engineering team.',
          ].join('\n'),
        };
      }
      if (u.endsWith('/chat/completions')) {
        completionsCalls++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: VALID_EVALUATION } }],
            usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
          }),
        };
      }
      throw new Error(`Unexpected URL in mock fetch: ${u}`);
    };

    const runnerUrl = `${pathToFileURL(join(ROOT, 'openrouter-runner.mjs')).href}?test=pipeline-one`;
    const runner = await import(runnerUrl);

    const dummyCtx = {
      shared: 'Shared context',
      profileMode: 'Profile context',
      oferta: 'Oferta context',
      cv: 'CV context',
      profile: 'Candidate: Test',
    };

    await runner.cmdPipeline(dummyCtx, { one: true });

    // Assert only 1 chat completion API call was made
    assert.equal(completionsCalls, 1, `Expected exactly 1 model completion call, got ${completionsCalls}`);

    // Assert pipeline.md has only item 1 marked done, and items 2 & 3 remain pending
    const updatedPipeline = readFileSync(join(dataDir, 'pipeline.md'), 'utf-8');
    assert.match(updatedPipeline, /- \[x\] https:\/\/jobs\.test\/job-1/);
    assert.match(updatedPipeline, /- \[ \] https:\/\/jobs\.test\/job-2/);
    assert.match(updatedPipeline, /- \[ \] https:\/\/jobs\.test\/job-3/);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = realKey;
    delete process.env.CAREER_OPS_ROOT;
    delete process.env.CAREER_OPS_NO_PLAYWRIGHT;
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

// ── 8. Upstream Compatibility & Timeout Defaults ──────────────────────────

function withTimeoutEnv(env, fn) {
  const keys = ['CAREER_OPS_TIMEOUT_MS', 'OPENROUTER_TIMEOUT_MS'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    return fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('getModelTimeoutMs defaults to 120000ms when no env override is set', () => {
  withTimeoutEnv({}, () => {
    assert.equal(getModelTimeoutMs(), 120000);
  });
});

test('getModelTimeoutMs honors CAREER_OPS_TIMEOUT_MS environment override', () => {
  withTimeoutEnv({ CAREER_OPS_TIMEOUT_MS: '60000' }, () => {
    assert.equal(getModelTimeoutMs(), 60000);
  });
});

test('getModelTimeoutMs honors OPENROUTER_TIMEOUT_MS environment override', () => {
  withTimeoutEnv({ OPENROUTER_TIMEOUT_MS: '75000' }, () => {
    assert.equal(getModelTimeoutMs(), 75000);
  });
});

test('getModelTimeoutMs reads the env at call time, so a later .env override applies', () => {
  withTimeoutEnv({}, () => {
    // Module is already imported at this point; the override is set afterwards,
    // the way loadEnvFile() does in the CLI entry point.
    assert.equal(getModelTimeoutMs(), 120000);
    process.env.CAREER_OPS_TIMEOUT_MS = '45000';
    assert.equal(getModelTimeoutMs(), 45000);
  });
});

test('getModelTimeoutMs falls back to 120000ms on invalid or non-positive environment overrides', () => {
  const invalidValues = ['abc', '-500', '0', 'NaN', 'Infinity', '1e3', '10.5', '120abc'];
  for (const val of invalidValues) {
    withTimeoutEnv({ CAREER_OPS_TIMEOUT_MS: val }, () => {
      assert.equal(getModelTimeoutMs(), 120000, `Expected 120000 fallback for value: "${val}"`);
    });
  }

  // Invalid CAREER_OPS_TIMEOUT_MS falls back to valid OPENROUTER_TIMEOUT_MS
  withTimeoutEnv({ CAREER_OPS_TIMEOUT_MS: 'not-a-number', OPENROUTER_TIMEOUT_MS: '85000' }, () => {
    assert.equal(getModelTimeoutMs(), 85000);
  });
});

test('getModelTimeoutMs rejects values above the setTimeout limit (2147483647ms)', () => {
  withTimeoutEnv({ CAREER_OPS_TIMEOUT_MS: '2147483647' }, () => {
    assert.equal(getModelTimeoutMs(), 2147483647, 'The limit itself is still accepted');
  });
  for (const val of ['2147483648', '99999999999', '9007199254740993']) {
    withTimeoutEnv({ CAREER_OPS_TIMEOUT_MS: val }, () => {
      assert.equal(getModelTimeoutMs(), 120000, `Expected 120000 fallback for value: "${val}"`);
    });
  }
  // An over-limit CAREER_OPS_TIMEOUT_MS falls through to a valid OPENROUTER_TIMEOUT_MS
  withTimeoutEnv({ CAREER_OPS_TIMEOUT_MS: '2147483648', OPENROUTER_TIMEOUT_MS: '90000' }, () => {
    assert.equal(getModelTimeoutMs(), 90000);
  });
});

test('unreadableJobPage flags 404, bot challenge, and unreadable verdicts', async () => {
  const runnerUrl = `${pathToFileURL(join(ROOT, 'openrouter-runner.mjs')).href}?test=unreadable-check`;
  const runner = await import(runnerUrl);
  assert.equal(runner.unreadableJobPage({ status: 404 }), 'HTTP 404');
  assert.equal(runner.unreadableJobPage({ status: 500 }), 'HTTP 500');
});
