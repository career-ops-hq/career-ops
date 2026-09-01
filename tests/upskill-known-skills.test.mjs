// tests/upskill-known-skills.test.mjs — unit coverage for upskill.mjs's pure
// helpers, imported directly.
//
// This file is the reason upskill.mjs's module tail is guarded by an isMain
// check. Before that guard the tail was unconditional, so importing the module
// re-parsed the IMPORTER's argv — and since test-all.mjs imports discovered
// suites IN-PROCESS, that argv is test-all's own. Measured by pinning isMain to
// true: ordinary argv dumped a 68-line JSON gap map into the middle of this
// suite's output, and an argv containing --self-test ran upskill's self-test and
// exited, killing test-all with no summary line and every later section skipped.
// That second one is a forged green — the exact failure the harness's own source
// guard rejects a discovered suite for.
//
// So the helpers below, every one documented "exported for unit testing", could
// only be asserted on from inside `upskill.mjs --self-test` until the guard existed.
//
// Keep this suite pure. Everything here is a string in / value out; nothing
// reads user data, and the one filesystem assertion uses a path that is
// guaranteed absent (readOptionalText's missing-file contract).
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nupskill.mjs known-skills helpers (import-safe module)');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'upskill.mjs')).href);
  const {
    yamlValueText,
    stripMarkdownComments,
    knownSkillsText,
    readOptionalText,
    aggregateGaps,
    computeTargetedGaps,
    parseReportGaps,
  } = mod;

  // ── the guard itself ──────────────────────────────────────────────────────
  // Importing must not have run the CLI. If the tail were unguarded this file
  // would never reach here: the module would have exited the process during the
  // await above. Assert the exports exist so a future refactor that drops one
  // fails loudly instead of destructuring to undefined and crashing below.
  const missing = [
    'yamlValueText', 'stripMarkdownComments', 'knownSkillsText', 'readOptionalText',
    'aggregateGaps', 'computeTargetedGaps', 'parseReportGaps',
  ].filter(name => typeof mod[name] !== 'function');
  if (missing.length === 0) pass('upskill.mjs imports without running its CLI; all 7 pure helpers exported');
  else fail(`upskill.mjs missing exported helper(s): ${missing.join(', ')}`);

  // ── yamlValueText ─────────────────────────────────────────────────────────
  // The bug this exists for: a skill named in a YAML COMMENT must not become a
  // known skill, because known skills are SUPPRESSED from the gap map. The
  // comment forms below are ordinary config hygiene, and two of them say the
  // user does NOT have the thing.
  const commented = yamlValueText([
    '# not using Kubernetes anymore, moved to ECS',
    '# considering a Snowflake migration in 2027',
    'skills:',
    '  - Python',
  ].join('\n'));
  if (!/Kubernetes|Snowflake/.test(commented) && /Python/.test(commented)) {
    pass('yamlValueText drops comment-only skills (Kubernetes/Snowflake) and keeps real values (Python)');
  } else {
    fail(`yamlValueText comment handling => ${JSON.stringify(commented)}`);
  }

  // A `#` inside a quoted string is data, not a comment — the reason this parses
  // YAML instead of stripping with a regex.
  const hashInString = yamlValueText('note: "C# and F# on .NET"');
  if (hashInString.includes('C# and F# on .NET')) pass('yamlValueText keeps a "#" that lives inside a quoted string');
  else fail(`yamlValueText quoted-hash => ${JSON.stringify(hashInString)}`);

  // Keys count as text: `skills: {Python: expert}` puts the skill in key position.
  const keyPosition = yamlValueText('skills:\n  Terraform: expert\n');
  if (keyPosition.includes('Terraform')) pass('yamlValueText emits mapping KEYS, not just values');
  else fail(`yamlValueText key position => ${JSON.stringify(keyPosition)}`);

  // Unparseable YAML falls back to raw text — degrade to over-eager suppression,
  // never to "no known skills", which would flood the map with false gaps.
  const broken = 'this: [is: not: valid: yaml\n  - Kubernetes';
  if (yamlValueText(broken) === broken) pass('yamlValueText falls back to raw text on a YAML parse error');
  else fail('yamlValueText should return the raw text when yamlLoad throws');

  // ...but silently is what made the original bug expensive, so the caller can
  // opt into being told. Omitting the callback keeps the helper pure, which is
  // what every assertion above relies on.
  {
    const calls = [];
    const out = yamlValueText(broken, err => calls.push(err));
    const valid = [];
    yamlValueText('skills:\n  - Python\n', err => valid.push(err));
    if (calls.length === 1 && calls[0] instanceof Error && out === broken && valid.length === 0) {
      pass('yamlValueText fires onParseFailure exactly once on malformed YAML, never on valid YAML, and still returns the raw fallback');
    } else {
      fail(`yamlValueText onParseFailure => malformed=${calls.length} valid=${valid.length} fallbackIntact=${out === broken}`);
    }
  }

  {
    // knownSkillsText must forward the callback, or the aggregate path goes
    // quiet while the targeted path warns (or vice versa) — the drift class
    // this single definition exists to prevent.
    const calls = [];
    const text = knownSkillsText('# CV\nPython\n', broken, err => calls.push(err));
    if (calls.length === 1 && /Kubernetes/.test(text)) {
      pass('knownSkillsText forwards onParseFailure and still leaks the malformed profile\'s raw text (so the fixture cannot pass by ceasing to be malformed)');
    } else {
      fail(`knownSkillsText onParseFailure => calls=${calls.length} leaksRaw=${/Kubernetes/.test(text)}`);
    }
  }

  // A cyclic anchor/alias graph must terminate, not RangeError the whole run.
  // The try//catch around yamlLoad cannot help — the throw would happen in the walk.
  try {
    const cyclic = yamlValueText('root: &a\n  self: *a\n  skill: Kafka\n');
    if (cyclic.includes('Kafka')) pass('yamlValueText walks a cyclic YAML alias graph without recursing forever');
    else fail(`yamlValueText cyclic alias => ${JSON.stringify(cyclic)}`);
  } catch (e) {
    fail(`yamlValueText threw on a cyclic alias graph: ${e.message}`);
  }

  if (yamlValueText('') === '' && yamlValueText(null) === '' && yamlValueText(undefined) === '') {
    pass('yamlValueText returns "" for empty/null/undefined');
  } else {
    fail('yamlValueText should return "" for empty/null/undefined');
  }

  // ── stripMarkdownComments ─────────────────────────────────────────────────
  // cv.md ships from a template full of <!-- guidance -->, and users leave notes
  // in the same form.
  const md = stripMarkdownComments('# CV\n<!-- removed the CISSP line, was never accurate -->\nPython, AWS\n');
  if (!md.includes('CISSP') && md.includes('Python') && md.includes('AWS')) {
    pass('stripMarkdownComments removes <!-- ... --> guidance and keeps real content');
  } else {
    fail(`stripMarkdownComments => ${JSON.stringify(md)}`);
  }

  const multi = stripMarkdownComments('A\n<!--\nKubernetes\nSnowflake\n-->\nB\n<!-- Kafka -->C');
  if (!/Kubernetes|Snowflake|Kafka/.test(multi) && multi.includes('A') && multi.includes('B') && multi.includes('C')) {
    pass('stripMarkdownComments handles multi-line and multiple comment blocks');
  } else {
    fail(`stripMarkdownComments multi-block => ${JSON.stringify(multi)}`);
  }

  // The replacement is a NEWLINE, not '': `<!-- x -->` between two skills must
  // not fuse them into one token for the extractor downstream.
  if (stripMarkdownComments('Go<!-- note -->Rust').trim().split('\n').length === 2) {
    pass('stripMarkdownComments replaces a comment with a newline, so neighbours cannot fuse');
  } else {
    fail(`stripMarkdownComments should separate neighbours: ${JSON.stringify(stripMarkdownComments('Go<!-- note -->Rust'))}`);
  }

  if (stripMarkdownComments(null) === '' && stripMarkdownComments(undefined) === '') {
    pass('stripMarkdownComments returns "" for null/undefined');
  } else {
    fail('stripMarkdownComments should return "" for null/undefined');
  }

  // ── knownSkillsText ───────────────────────────────────────────────────────
  // One definition, so the aggregate and targeted paths cannot drift (#1896).
  const known = knownSkillsText(
    '# CV\n<!-- dropped Kubernetes in 2025 -->\nPython\n',
    '# considering Snowflake\nskills:\n  - Terraform\n',
  );
  if (known.includes('Python') && known.includes('Terraform')
      && !known.includes('Kubernetes') && !known.includes('Snowflake')) {
    pass('knownSkillsText composes both strippers: markdown + YAML comments gone, real skills kept');
  } else {
    fail(`knownSkillsText => ${JSON.stringify(known)}`);
  }

  // End-to-end statement of the actual bug: a skill mentioned only in a comment
  // must still surface as a GAP, because it was never a known skill.
  {
    const knownText = knownSkillsText('# CV\n<!-- not using Kubernetes anymore -->\nPython\n', '');
    const { gaps, excludedAsKnown } = computeTargetedGaps('We need Kubernetes and Python.', knownText);
    if (gaps.includes('Kubernetes') && excludedAsKnown.includes('Python')) {
      pass('comment-only Kubernetes stays a GAP while genuinely-known Python is excluded (the #2609 bug, end to end)');
    } else {
      fail(`comment poisoning still suppresses: gaps=${gaps.join(',')} excluded=${excludedAsKnown.join(',')}`);
    }
  }

  // ── readOptionalText ──────────────────────────────────────────────────────
  // "Optional" has to mean optional: missing, unreadable and not-a-file all
  // collapse to ''. existsSync() is TRUE for a directory and reading one throws
  // EISDIR, which used to kill aggregate mode outright.
  if (readOptionalText(join(ROOT, 'no-such-file-9f3a2b.md')) === '') pass('readOptionalText returns "" for a missing file');
  else fail('readOptionalText should return "" for a missing file');

  if (readOptionalText(ROOT) === '') pass('readOptionalText returns "" for a DIRECTORY instead of throwing EISDIR');
  else fail('readOptionalText should return "" for a directory');

  {
    // A file that definitely exists: this test file.
    const self = readOptionalText(join(ROOT, 'tests', 'upskill-known-skills.test.mjs'));
    if (self.includes('readOptionalText reads a real file')) pass('readOptionalText reads a real file back as text');
    else fail('readOptionalText failed to read an existing file');
  }

  // ── parseReportGaps ───────────────────────────────────────────────────────
  {
    const parsed = parseReportGaps([
      '# 042 - Acme',
      '',
      '| Gap | Severity | Mitigation |',
      '|-----|----------|------------|',
      '| No Kafka experience | soft gap | Learn it |',
      '',
      '## Machine Summary',
      '',
      '```yaml',
      'score: 3.2',
      'hard_stops: []',
      'soft_gaps:',
      '  - "Limited Airflow exposure"',
      '```',
      '',
    ].join('\n'));
    const ok = parsed.score === 3.2
      && parsed.hasMachineSummary === true
      && /Kafka/.test(parsed.gapText)
      && /Airflow/.test(parsed.gapText);
    if (ok) pass('parseReportGaps reads score + hasMachineSummary and merges Gap-table rows with soft_gaps');
    else fail(`parseReportGaps => ${JSON.stringify(parsed)}`);
  }

  {
    // No Machine Summary: score falls back to the Global row of the score table.
    const parsed = parseReportGaps('# 043 - Beta\n\n| Block | Score |\n|---|---|\n| **Global** | **2.4/5** |\n');
    if (parsed.score === 2.4 && parsed.hasMachineSummary === false) {
      pass('parseReportGaps falls back to the Global score row when there is no Machine Summary');
    } else {
      fail(`parseReportGaps Global fallback => ${JSON.stringify(parsed)}`);
    }
  }

  // ── aggregateGaps ─────────────────────────────────────────────────────────
  {
    // Weighting is (5.0 − score) per report, counted once per report regardless
    // of how many times a report repeats the skill.
    const { gaps } = aggregateGaps(
      [
        { num: 3, score: 2.0, gapText: 'Kubernetes Kubernetes Kubernetes' },
        { num: 4, score: 4.5, gapText: 'Kubernetes' },
      ],
      new Set(),
    );
    const k = gaps.find(g => g.skill === 'Kubernetes');
    if (k && k.reports === 2 && Math.abs(k.weightedScore - 3.5) < 1e-9) {
      pass('aggregateGaps weights by (5 − score) and counts presence once per report, not once per mention');
    } else {
      fail(`aggregateGaps weighting => ${JSON.stringify(k)}`);
    }
  }

  {
    // Known-skill suppression must be canonical-to-canonical: "Java" in the CV
    // must not swallow a "JavaScript" gap.
    const { gaps, excludedAsKnown } = aggregateGaps(
      [{ num: 1, score: 2.0, gapText: 'Missing JavaScript and Kubernetes' }],
      new Set(['Java', 'Kubernetes']),
    );
    const names = gaps.map(g => g.skill);
    if (names.includes('JavaScript') && !names.includes('Kubernetes')
        && excludedAsKnown.some(e => e.skill === 'Kubernetes')) {
      pass('aggregateGaps excludes known Kubernetes without letting known "Java" swallow the JavaScript gap');
    } else {
      fail(`aggregateGaps suppression => gaps=${names.join(',')} excluded=${excludedAsKnown.map(e => e.skill).join(',')}`);
    }
  }

  {
    // Tiers are fixed, explainable thresholds over the low-fit share — not
    // quantiles, which are noise at N=5.
    const { gaps, totalLowFit } = aggregateGaps([
      { num: 10, score: 2.0, gapText: 'Terraform' },
      { num: 11, score: 2.5, gapText: 'Terraform' },
      { num: 12, score: 3.0, gapText: 'Terraform and Spark' },
      { num: 13, score: 3.5, gapText: 'nothing here' },
      { num: 14, score: 3.9, gapText: 'nothing here' },
    ], new Set());
    const terraform = gaps.find(g => g.skill === 'Terraform');
    const spark = gaps.find(g => g.skill === 'Spark');
    if (totalLowFit === 5 && terraform?.tier === 'Critical' && spark?.tier === 'Low') {
      pass('aggregateGaps tiers 3/5 low-fit reports as Critical and 1/5 as Low');
    } else {
      fail(`aggregateGaps tiering => lowFit=${totalLowFit} terraform=${terraform?.tier} spark=${spark?.tier}`);
    }
  }

  // ── computeTargetedGaps ───────────────────────────────────────────────────
  {
    // Symbol skills and substring traps: the old inline implementation compared
    // lowercased tokens with .includes(), so `go` ⊂ `mongodb` and `sql` ⊂
    // `postgresql` over-suppressed, and C++/.NET never matched at all (#1851).
    const { gaps, excludedAsKnown, knownSkills } =
      computeTargetedGaps('Wanted: C++, .NET, Go and PostgreSQL.', 'Experienced with MongoDB and SQL.');
    if (gaps.includes('C++') && gaps.includes('.NET') && gaps.includes('Go') && gaps.includes('PostgreSQL')) {
      pass('computeTargetedGaps matches symbol skills (C++/.NET) and refuses substring suppression (MongoDB⊅Go, SQL⊅PostgreSQL)');
    } else {
      fail(`computeTargetedGaps => gaps=${gaps.join(',')} excluded=${excludedAsKnown.join(',')}`);
    }
    if (knownSkills.join(',') === [...knownSkills].sort().join(',')) pass('computeTargetedGaps returns knownSkills sorted');
    else fail(`computeTargetedGaps knownSkills not sorted: ${knownSkills.join(',')}`);
  }

  {
    // Multi-line JD STRING in, no throw: the targeted path takes raw text, not
    // the { title, text } object normalizeJd expects (#1894).
    const { gaps } = computeTargetedGaps('Requirements:\n- Kubernetes and Go\n- 5+ years experience', 'Python, AWS');
    if (gaps.includes('Kubernetes') && gaps.includes('Go')) pass('computeTargetedGaps accepts a multi-line JD string');
    else fail(`computeTargetedGaps multi-line => ${gaps.join(',')}`);
  }
} catch (e) {
  fail(`upskill known-skills tests crashed: ${e.stack || e.message}`);
}
