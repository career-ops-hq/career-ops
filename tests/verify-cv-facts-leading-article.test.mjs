import { pass, fail } from './helpers.mjs';
import { factClaims, verifyFacts } from '../verify-cv-facts.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nA tool named after a leading "a" or "an"');

// The tool gate is fail-closed: a name the sources never mention blocks the
// render. A piece led by "a" or "an" used to be dropped by the prose-word
// check, so "using a Kubernetes cluster" was never compared with cv.md and a
// fabricated name passed.
//
// The design rule: a leading article changes nothing about WHETHER a fragment
// is a tool claim, only WHAT is checked. The article is stripped and the rest
// goes through the decision a fragment with no article gets. If that claims
// nothing, so does the article form. If it claims the whole fragment, the
// claims are the tool-shaped names in it instead, each alone, so a source that
// says "Kubernetes" backs "a Kubernetes cluster". The names are capitalised
// words, words with an inner capital, words with a digit that are not a
// measure ("3CX", "4D", "n8n"), and dotted names such as "node.js". A fragment
// with none of them ("a small team", "a 2024 roadmap") claims nothing. The
// determiners of #4004 ("the", "our", "their") still mark ordinary reference.
const tmp = mkdtempSync(join(tmpdir(), 'career-ops-leading-article-'));
try {
  const source = join(tmp, 'cv.md');
  const config = join(tmp, 'cv-facts.json');
  writeFileSync(config, JSON.stringify({ allow_metrics: [], allow_facts: [], forbidden_phrases: [], warn_phrases: [] }));

  const reactOnly = '- Built the platform using React.';

  const check = (cv, target) => {
    writeFileSync(source, `${cv}\n`);
    return verifyFacts(target, { sourcePaths: [source], configPath: config });
  };
  // Claims are compared as sets: their order is not part of the contract.
  const sorted = values => [...values].sort();
  const sameSet = (found, expected) => JSON.stringify(sorted(found)) === JSON.stringify(sorted(expected));
  const tools = result => result.unsupportedFacts.filter(claim => claim.kind === 'tool').map(claim => claim.value);
  const toolValues = text => factClaims(text).filter(claim => claim.kind === 'tool').map(claim => claim.value);
  const blocksOn = (label, cv, target, expected) => {
    const result = check(cv, target);
    const found = tools(result);
    if (result.verdict === 'block' && sameSet(found, expected)) pass(label);
    else fail(`${label}: expected a block on exactly ${JSON.stringify(expected)}, got ${result.verdict} ${JSON.stringify(found)}`);
  };
  const passes = (label, cv, target) => {
    const result = check(cv, target);
    if (result.verdict === 'pass' && result.unsupportedFacts.length === 0) pass(label);
    else fail(`${label}: expected a clean pass, got ${result.verdict} ${JSON.stringify(result.unsupportedFacts)}`);
  };
  const claims = (label, text, expected) => {
    const found = toolValues(text);
    if (sameSet(found, expected)) pass(label);
    else fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(found)}`);
  };
  // The article form must reach the verdict the same sentence reaches without
  // it, against a source that backs neither and against one that backs both.
  const sameVerdict = (label, withArticle, without, backedCv) => {
    for (const [cv, which] of [[reactOnly, 'unbacked'], [backedCv, 'backed']].filter(([cv]) => cv)) {
      const a = check(cv, withArticle);
      const b = check(cv, without);
      if (a.verdict === b.verdict) pass(`${label} (${which})`);
      else fail(`${label} (${which}): "${withArticle}" is ${a.verdict} ${JSON.stringify(tools(a))}, "${without}" is ${b.verdict} ${JSON.stringify(tools(b))}`);
    }
  };
  const sameClaims = (label, withArticle, without) => {
    const a = toolValues(withArticle);
    const b = toolValues(without);
    if (sameSet(a, b)) pass(label);
    else fail(`${label}: "${withArticle}" claims ${JSON.stringify(a)}, "${without}" claims ${JSON.stringify(b)}`);
  };

  // The reproduction from the issue. The first line is the control: the same
  // unbacked name blocks when no article comes before it. A dotted name is
  // read by two captures, the one that stops at the dot and the one that
  // reads through it, so the control for those two shows both.
  blocksOn('the control, a name with no article, is checked',
    reactOnly, '- Built the platform using Kubernetes.', ['kubernetes']);
  blocksOn('a name after "a" is checked',
    reactOnly, '- Built the platform using a Kubernetes cluster.', ['kubernetes']);
  blocksOn('a name after "an" is checked',
    reactOnly, '- Built the platform using an Elasticsearch index.', ['elasticsearch']);
  blocksOn('a dotted name after "an" in a later list item is checked',
    reactOnly, '- Built the platform using React and an ASP.NET backend.', ['asp', 'asp.net']);
  blocksOn('a dotted name after "a" is checked',
    reactOnly, '- Rebuilt the storefront using a Next.js app.', ['next', 'next.js']);

  // The class is every list item behind an article, whatever the trigger.
  blocksOn('a name after "a" in the middle of a list is checked',
    reactOnly, '- Built the platform using React, a Kubernetes cluster and Docker.', ['kubernetes', 'docker']);
  blocksOn('a name after "an" in a declared list is checked',
    reactOnly, 'Technologies: React, an Elasticsearch index', ['elasticsearch']);
  blocksOn('a name after "an" behind a later "using" is checked',
    reactOnly, '- Built the platform using React, using an Elasticsearch.', ['elasticsearch']);
  blocksOn('a name after a capitalised "A" is checked',
    reactOnly, '- Built the platform using A Kubernetes cluster.', ['kubernetes']);
  blocksOn('a name after "an" behind "worked with" is checked',
    reactOnly, '- Worked with an Elasticsearch cluster.', ['elasticsearch']);

  // After the article the name is checked alone, so a source that says
  // "Kubernetes" backs "a Kubernetes cluster".
  claims('a name after "a" is read without the noun behind it',
    'Built the platform using a Kubernetes cluster.', ['kubernetes']);
  claims('a name after "an" is read without the noun behind it',
    'Built the platform using an Elasticsearch index.', ['elasticsearch']);
  claims('a dotted name after "a" is read without the noun behind it',
    'Built the platform using a Next.js app.', ['next', 'next.js']);

  // A lowercase suffix joined by a hyphen describes the name, it is not part
  // of it. A name with a digit or a capital after the hyphen stays whole.
  for (const [article, name, suffix, noun] of [
    ['a', 'Kubernetes', 'based', 'stack'],
    ['an', 'AI', 'powered', 'workflow'],
    ['a', 'Salesforce', 'native', 'app'],
  ]) {
    const phrase = `${article} ${name}-${suffix} ${noun}`;
    blocksOn(`"${phrase}" is checked as ${name.toLowerCase()}`,
      reactOnly, `- Built the platform using ${phrase}.`, [name.toLowerCase()]);
    passes(`"${phrase}" passes when the source backs ${name}`,
      `- Ran workloads using ${name}.`, `- Built the platform using ${phrase}.`);
  }
  claims('every lowercase segment after the name is cut', 'Built the platform using a Kubernetes-based-managed stack.', ['kubernetes']);
  blocksOn('a name with a version after a hyphen stays whole',
    '- Drafted copy using GPT-3.', '- Drafted copy using a GPT-4 agent.', ['gpt-4']);
  passes('a backed name with a version after a hyphen passes',
    '- Drafted copy using GPT-4.', '- Drafted copy using a GPT-4 agent.');
  // A single letter before a lowercase suffix is a prefix of an ordinary
  // word ("C-suite", "E-commerce", "X-ray"), not a name.
  for (const phrase of ['a C-suite narrative', 'a C-suite sponsor', 'an E-commerce platform', 'an X-ray machine']) {
    passes(`"${phrase}" passes`, reactOnly, `- Built the platform using ${phrase}.`);
    claims(`"${phrase}" claims no tool`, `Built the platform using ${phrase}.`, []);
  }
  // A suffix that is not lowercase keeps the word whole.
  for (const [phrase, name] of [['a T-Mobile plan', 't-mobile'], ['a Wi-Fi network', 'wi-fi'], ['a Pre-IPO round', 'pre-ipo']]) {
    blocksOn(`"${phrase}" is checked as ${name}`, reactOnly, `- Built the platform using ${phrase}.`, [name]);
  }

  // A single quote around a name is not part of it, straight or curly.
  for (const [label, open, close] of [['straight', "'", "'"], ['curly', '‘', '’']]) {
    blocksOn(`a name in ${label} single quotes after an article is checked`,
      reactOnly, `- Built the platform using an ${open}Elasticsearch${close} index.`, ['elasticsearch']);
    passes(`a backed name in ${label} single quotes after an article passes`,
      '- Ran search on Elasticsearch.', `- Built the platform using an ${open}Elasticsearch${close} index.`);
    blocksOn(`a name in ${label} single quotes later in a list is checked`,
      reactOnly, `- Built the platform using React and an ${open}Elasticsearch${close} index.`, ['elasticsearch']);
  }

  // A possessive is the name followed by "'s".
  for (const [label, mark] of [['straight', "'"], ['curly', '’']]) {
    blocksOn(`a name with a ${label} possessive after an article is checked as the name`,
      reactOnly, `- Built the platform using an Elasticsearch${mark}s index.`, ['elasticsearch']);
    passes(`a backed name with a ${label} possessive after an article passes`,
      '- Ran search on Elasticsearch.', `- Built the platform using an Elasticsearch${mark}s index.`);
  }

  // The article form reaches the verdict and the claims of the same text
  // without it, because it goes through the same decision. Where the sentence
  // without an article claims nothing, the one with it claims nothing either.
  const financeBacked = '- Partnered with the CFO and Finance.';
  sameVerdict('"Worked with a Finance team" reads as "Worked with Finance team"',
    '- Worked with a Finance team.', '- Worked with Finance team.', financeBacked);
  sameVerdict('"Worked with a CFO" reads as "Worked with CFO"',
    '- Worked with a CFO.', '- Worked with CFO.', financeBacked);
  // A word that is only ever prose is never a name on its own, so the article
  // form claims nothing where the form without it claims the whole phrase.
  claims('a prose word alone after an article is not claimed', 'Built it using a Building permit.', []);
  passes('a prose word alone after an article passes', reactOnly, '- Built it using a Building permit.');
  // The capture stops at the dot of an abbreviation and leaves one letter.
  for (const phrase of ['Hired using a U.S. agency.', 'Grew it using a U.K. partner.']) {
    passes(`"${phrase}" passes`, reactOnly, `- ${phrase}`);
    claims(`"${phrase}" claims no tool`, phrase, []);
  }
  sameClaims('"Worked with a Finance team" claims what "Worked with Finance team" claims',
    'Worked with a Finance team.', 'Worked with Finance team.');
  sameClaims('"Worked with a CFO" claims what "Worked with CFO" claims',
    'Worked with a CFO.', 'Worked with CFO.');
  // A digit in a name keeps the name.
  blocksOn('a name with a digit after "an" is checked as the name',
    reactOnly, '- Stored the exports using an S3 bucket.', ['s3']);
  passes('a backed name with a digit after "an" passes',
    '- Stored exports in S3.', '- Stored the exports using an S3 bucket.');
  blocksOn('a lowercase name with a digit after "an" is checked as the name',
    reactOnly, '- Automated the intake using an n8n workflow.', ['n8n']);
  passes('a backed lowercase name with a digit after "an" passes',
    '- Automated the intake using n8n.', '- Automated the intake using an n8n workflow.');
  // A digit-led word is a name unless it is a measure: a number alone, or a
  // number with one suffix letter from k, m, b or x, in either case, the
  // suffixes the metric patterns read on a number ("50k users", "10x"). Any
  // other letters make it a name, lowercase or not.
  for (const [phrase, name] of [['a 3CX phone', '3cx'], ['a 4D database', '4d'], ['a 1C platform', '1c'], ['a 3CX', '3cx']]) {
    blocksOn(`"${phrase}" is checked as ${name}`, reactOnly, `- Built it using ${phrase}.`, [name]);
    passes(`"${phrase}" passes when the source backs ${name}`, `- Ran it on ${name.toUpperCase()}.`, `- Built it using ${phrase}.`);
  }
  claims('"a 3CX" claims what "3CX" claims', 'Built it using a 3CX.', toolValues('Built it using 3CX.'));
  // Lowercase letters after the digits do not make a measure either. Main
  // blocks each of these as a whole phrase.
  for (const [phrase, name] of [
    ['a 4me workspace', '4me'], ['a 3cx phone', '3cx'], ['a 4d database', '4d'],
    ['a 5ms latency', '5ms'], ['a 2kg weight', '2kg'], ['a 12MB cache', '12mb'],
  ]) {
    blocksOn(`"${phrase}" is checked as ${name}`, reactOnly, `- Built it using ${phrase}.`, [name]);
    claims(`"${phrase}" claims ${name}`, `Built it using ${phrase}.`, [name]);
  }
  blocksOn('a versioned name after "a" is checked as the name',
    reactOnly, '- Ran the build using a Python 3 runtime.', ['python']);

  // A single capital letter followed by a noun is claimed: "an R package"
  // checks R. Known limit: it is not claimed before a hyphen suffix or alone,
  // because "a C-suite sponsor" would then block. Main passes all of these.
  claims('known limit: "an R-based pipeline" claims no tool', 'Built it using an R-based pipeline.', []);
  claims('known limit: "a C-based toolchain" claims no tool', 'Built it using a C-based toolchain.', []);
  claims('known limit: "an R" alone claims no tool', 'Built it using an R.', []);
  passes('known limit: "an R-based pipeline" passes', reactOnly, '- Built it using an R-based pipeline.');
  blocksOn('"an R package" is checked as R',
    reactOnly, '- Built the model using an R package.', ['r']);
  blocksOn('"a C library" is checked as C',
    reactOnly, '- Built the service using a C library.', ['c']);
  // Without the article the whole "R package" is claimed, so a source that
  // backs R still blocks. That is the older false positive, not copied here.
  sameVerdict('"using an R package" reads as "using R package"',
    '- Built the model using an R package.', '- Built the model using R package.', null);
  passes('a backed R after "an" passes',
    '- Built models in R.', '- Built the model using an R package.');

  // Ordinary prose behind an article is not a tool. These also pass on
  // unchanged main, so they guard the fix against reading more than names.
  passes('an article before lowercase prose is not a tool',
    reactOnly, '- Built the platform using a small team.');
  passes('an article before a lowercase phrase behind "worked with" is not a tool',
    reactOnly, '- Worked with an outside agency on the launch.');
  passes('a lowercase noun phrase behind "worked with" is not a tool',
    reactOnly, '- Worked with an outside agency.');
  passes('an article before a lowercase clause in a list is not a tool',
    reactOnly, '- Built the platform using React and a custom internal workflow.');
  passes('a capitalised article before lowercase prose is not a tool',
    reactOnly, '- Built the platform using An outside agency.');
  claims('an article before a lowercase phrase yields nothing', 'Built it using a small team.', []);
  claims('an article before a lone lowercase word yields nothing', 'Worked with an agency.', []);

  // The determiners of #4004 still mark ordinary reference.
  passes('"the" before a name is still ordinary reference',
    reactOnly, '- Built the platform using the Kubernetes cluster.');
  passes('"our" before a name is still ordinary reference',
    reactOnly, '- Built the platform using our Kubernetes cluster.');
  passes('"their" before a name is still ordinary reference',
    reactOnly, '- Built the platform using their Kubernetes cluster.');
  blocksOn('a determiner later in a list taints only its own fragment',
    reactOnly, '- Built the platform using React, the Kubernetes cluster and an Elasticsearch index.', ['elasticsearch']);

  // A fragment of four or more words, counting the article, is read by its
  // names, as it was before. The fix must not narrow that reading. Both pass
  // on unchanged main.
  claims('a four-word fragment led by an article is still read by its names',
    'Built it using a mix of Python and Go.', ['python', 'go']);
  blocksOn('a four-word fragment behind "worked with" is still read by its names',
    reactOnly, '- Worked with a Board on strategy.', ['board']);

  // Measure guards. These also pass before the digit rule, so they pin the
  // measure side of it rather than prove the rule. Unchanged main blocks each
  // as a whole phrase, so they are not regression guards against main.
  // "4K" and "3M" are measures here, so "a 4K camera" and "a 3M respirator"
  // pass: a known limit, because the suffix cannot tell a product from a unit.
  for (const [phrase, label] of [
    ['a 2024 roadmap', 'a number'], ['a 10x engineer', 'a multiplier'], ['a 5M budget', 'a magnitude'],
    ['a 50K budget', 'a thousand'], ['a 1.5B budget', 'a billion'], ['a 40% target', 'a percentage'],
    ['a 4K camera', 'known limit: a product written like a thousand'],
    ['a 3M respirator', 'known limit: a product written like a million'],
  ]) {
    claims(`${label} with a noun after an article claims no tool: "${phrase}"`, `Built it using ${phrase}.`, []);
  }
  passes('a number with a noun after an article passes', reactOnly, '- Planned the launch using a 2024 roadmap.');

  // Regression guards. Each of these passes on unchanged main too, because it
  // never reaches the article branch or only passes there by being dropped.
  // They are kept to pin behaviour the fix must not lose, not to prove the fix.
  blocksOn('guard: a name after "an" in a bracketed list is checked',
    reactOnly, '- Built the platform using React (an Elasticsearch index).', ['elasticsearch']);
  claims('guard: every name in a long clause behind an article is read on its own',
    'Built the platform using a Kubernetes cluster on AWS across three regions.', ['kubernetes', 'aws']);
  passes('guard: a backed name after "a" passes',
    '- Ran workloads on Kubernetes.', '- Built the platform using a Kubernetes cluster.');
  passes('guard: a backed name after "an" in a later list item passes',
    '- Built it using React and ASP.NET.', '- Built the platform using React and an ASP.NET backend.');
  passes('guard: a backed dotted name after "a" passes',
    '- Shipped it using Next.js.', '- Rebuilt the storefront using a Next.js app.');
  // Growth, not a wall-clock limit, as in verify-cv-facts-tool-fragments: ten
  // times the input may take about ten times as long, and quadratic growth
  // takes a hundred times. A name with a long run of hyphenated lowercase
  // segments, then a capital, was scanned from every hyphen.
  const timeHyphenRun = repeats => {
    const started = performance.now();
    factClaims(`- Built it using a Ab${'-ab'.repeat(repeats)}-A stack.`);
    return performance.now() - started;
  };
  timeHyphenRun(2000);
  const smallHyphenRun = Math.max(timeHyphenRun(4000), 1);
  const largeHyphenRun = timeHyphenRun(40000);
  if (largeHyphenRun < 1000 || largeHyphenRun / smallHyphenRun < 40) pass('a long run of hyphenated segments after an article is read in linear time');
  else fail(`a long hyphenated run scaled superlinearly: ${Math.round(smallHyphenRun)} ms for 4,000, ${Math.round(largeHyphenRun)} ms for 40,000`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
