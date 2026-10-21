import { pass, fail } from './helpers.mjs';
import { factClaims, metricClaims, stripMarkup, verifyFacts } from '../verify-cv-facts.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nTool names inside punctuation, invisible characters, or a long fragment');

// The tool gate is fail-closed: a name the sources never mention blocks the
// render. A fragment holding any character outside the tool-name class, or
// more than three words, used to be dropped before it was compared with the
// sources, so wrapping a name in quotes or brackets, splitting it with an
// invisible character, or ending the sentence with "!" let it through. Each
// block case pairs a tool the source backs with one it does not, so the only
// correct verdict is a block on the second. The pass cases show the name is
// read as the same name, not turned into a different claim that blocks.
const tmp = mkdtempSync(join(tmpdir(), 'career-ops-tool-fragments-'));
try {
  const source = join(tmp, 'cv.md');
  const config = join(tmp, 'cv-facts.json');
  writeFileSync(config, JSON.stringify({ allow_metrics: [], allow_facts: [], forbidden_phrases: [], warn_phrases: [] }));

  const check = (cv, target) => {
    writeFileSync(source, `${cv}\n`);
    return verifyFacts(target, { sourcePaths: [source], configPath: config });
  };
  const tools = result => result.unsupportedFacts.filter(claim => claim.kind === 'tool').map(claim => claim.value);
  const blocksOn = (label, cv, target, expected) => {
    const result = check(cv, target);
    const found = tools(result);
    if (result.verdict === 'block' && JSON.stringify(found) === JSON.stringify(expected)) pass(label);
    else fail(`${label}: expected a block on exactly ${JSON.stringify(expected)}, got ${result.verdict} ${JSON.stringify(found)}`);
  };
  const passes = (label, cv, target) => {
    const result = check(cv, target);
    if (result.verdict === 'pass' && result.unsupportedFacts.length === 0) pass(label);
    else fail(`${label}: expected a clean pass, got ${result.verdict} ${JSON.stringify(result.unsupportedFacts)}`);
  };
  const toolValues = text => factClaims(text).filter(claim => claim.kind === 'tool').map(claim => claim.value);

  const javaOnly = '- Built services using Java.';
  const javaAndKubernetes = '- Built services using Java and Kubernetes.';

  // Quotes, backticks and brackets around a name are not part of it.
  const wrappers = [
    ['double quotes', '"Kubernetes"'],
    ['curly double quotes', '\u201cKubernetes\u201d'],
    ['single quotes', "'Kubernetes'"],
    ['curly single quotes', '\u2018Kubernetes\u2019'],
    ['guillemets', '\u00abKubernetes\u00bb'],
    ['backticks', '`Kubernetes`'],
    ['parentheses', '(Kubernetes)'],
    ['square brackets', '[Kubernetes]'],
    ['braces', '{Kubernetes}'],
  ];
  for (const [label, wrapped] of wrappers) {
    blocksOn(`a name in ${label} is checked`, javaOnly, `- Built it using Java and ${wrapped}.`, ['kubernetes']);
    passes(`a name in ${label} the source backs passes`, javaAndKubernetes, `- Built it using Java and ${wrapped}.`);
  }

  // A bracket inside a fragment separates names the way a comma does.
  blocksOn('a name in brackets after another name is checked',
    javaOnly, '- Built it using Java (Kubernetes).', ['kubernetes']);
  blocksOn('a name before a bracketed gloss is checked',
    '- Ran clusters on EKS.', '- Ran it using Kubernetes (EKS).', ['kubernetes']);
  blocksOn('each name in a bracketed list is checked',
    '- Ran clusters using AWS and EKS.', '- Ran it using AWS (EKS, Kubernetes).', ['kubernetes']);
  passes('a bracketed gloss of two backed names passes',
    '- Ran clusters using Kubernetes and EKS.', '- Ran it using Kubernetes (EKS).');

  // A character that renders as nothing does not split or change a name.
  const invisibles = [
    ['zero-width space', '\u200b'],
    ['zero-width non-joiner', '\u200c'],
    ['zero-width joiner', '\u200d'],
    ['word joiner', '\u2060'],
    ['byte order mark', '\ufeff'],
    ['soft hyphen', '\u00ad'],
    ['left-to-right mark', '\u200e'],
    ['invisible separator', '\u2063'],
    ['Mongolian vowel separator', '\u180e'],
  ];
  for (const [label, char] of invisibles) {
    blocksOn(`a name split by a ${label} is checked as the name`, javaOnly, `- Built it using Java and Kuber${char}netes.`, ['kubernetes']);
    passes(`a name split by a ${label} the source backs passes`, javaAndKubernetes, `- Built it using Java and Kuber${char}netes.`);
  }
  blocksOn('a name after a variation selector is checked',
    javaOnly, '- Built it using Java and Kubernetes\ufe0f.', ['kubernetes']);
  blocksOn('a name inside directional isolates is checked',
    javaOnly, '- Built it using Java and \u2066Kubernetes\u2069.', ['kubernetes']);
  // Invisible characters are removed from the whole document, so a trigger
  // word split by one still introduces its list, and the other claim kinds
  // read what the reader sees too.
  blocksOn('a trigger split by a zero-width space still reads its list',
    javaOnly, '- Built it us\u200bing Kubernetes.', ['kubernetes']);
  const employerResult = check('- Worked at Acme Labs as a Staff Engineer.', '- Worked\u200b at Initech as a Staff Engineer.');
  if (employerResult.verdict === 'block' && employerResult.unsupportedFacts.some(claim => claim.kind === 'employer' && claim.value === 'initech')) {
    pass('an employer trigger split by a zero-width space still reads the employer');
  } else {
    fail(`an employer trigger split by a zero-width space hid the employer: ${employerResult.verdict} ${JSON.stringify(employerResult.unsupportedFacts)}`);
  }
  const metricResult = check('- Grew revenue 40% in a year.', '- Grew revenue 4\u200b0% in a year.');
  if (metricResult.verdict === 'pass' && metricResult.invented.length === 0) pass('a backed metric split by a zero-width space passes');
  else fail(`a backed metric split by a zero-width space was read as another number: ${JSON.stringify(metricResult.invented)}`);

  // "!", "?" and ":" end a sentence or a list the way "." does.
  blocksOn('a name before "!" is checked', javaOnly, '- Built it using Java and Kubernetes!', ['kubernetes']);
  blocksOn('a name before "?" is checked', javaOnly, '- Built it using Java and Kubernetes?', ['kubernetes']);
  blocksOn('a name before ":" is checked', javaOnly, '- Built it using Java and Kubernetes: done', ['kubernetes']);
  blocksOn('a name before "!" mid-paragraph is checked', javaOnly, '- Built it using Java and Kubernetes! Then shipped it.', ['kubernetes']);
  blocksOn('a list after "using:" is checked', javaOnly, '- Tools I was using: Java, Kubernetes.', ['kubernetes']);
  passes('the clause after ":" is not read as a tool',
    javaAndKubernetes, '- Built it using Java and Kubernetes: cut release time.');
  blocksOn('a declared list after "Technologies:" is still read',
    javaOnly, 'Technologies: Java, Kubernetes', ['kubernetes']);
  const afterPeriod = toolValues('Built it using React. Grew ARR.');
  if (JSON.stringify(afterPeriod) === JSON.stringify(['react'])) pass('a sentence-ending period still ends the capture');
  else fail(`a sentence-ending period did not end the capture: ${JSON.stringify(afterPeriod)}`);
  const beforeFor = toolValues('Built it using React and Docker for containerized deployments.');
  if (JSON.stringify(beforeFor) === JSON.stringify(['react', 'docker'])) pass('a capture still ends before "for"');
  else fail(`a capture ran past "for": ${JSON.stringify(beforeFor)}`);

  // A trademark sign after a name is not part of it.
  blocksOn('a name with a registered sign is checked', javaOnly, '- Built it using Java and Kubernetes\u00ae.', ['kubernetes']);
  passes('a backed name with a registered sign passes',
    '- Ran campaigns using Salesforce.', '- Ran campaigns using Salesforce\u00ae.');

  // A symbol standing alone between names separates them the way "and" does.
  for (const symbol of ['&', '+', '|', '\u00b7', '\u2022', '\u2014', '\u2013', '\u2192', '/', '-']) {
    blocksOn(`a name after a standalone "${symbol}" is checked`, javaOnly, `- Built it using Java ${symbol} Kubernetes.`, ['kubernetes']);
    passes(`two backed names around a standalone "${symbol}" pass`, javaAndKubernetes, `- Built it using Java ${symbol} Kubernetes.`);
  }
  // A dash never sits inside a name, so it separates without spaces too.
  for (const dash of ['\u2014', '\u2013']) {
    blocksOn(`a name after an unspaced "${dash}" is checked`, javaOnly, `- Built it using Java${dash}Kubernetes.`, ['kubernetes']);
    passes(`two backed names around an unspaced "${dash}" pass`, javaAndKubernetes, `- Built it using Java${dash}Kubernetes.`);
  }

  // A character outside the old name class, inside a name, no longer hides it.
  blocksOn('a name with an ampersand is checked', javaOnly, '- Built it using Java and AT&T Cloud.', ['at&t cloud']);
  passes('a backed name with an ampersand passes', '- Built it using AT&T Cloud.', '- Built it using AT&T Cloud.');
  blocksOn('a name with an underscore is checked', javaOnly, '- Built it using Java and scikit_learn.', ['scikit_learn']);
  passes('a backed name with an underscore passes', '- Built it using scikit_learn.', '- Built it using scikit_learn.');
  blocksOn('a name with an apostrophe is checked', javaOnly, "- Built it using Java and Kubernetes's operator.", ["kubernetes's operator"]);
  blocksOn('a package name after "@" is checked', javaOnly, '- Built it using Java and @kubernetes/client.', ['kubernetes/client']);

  // A bracket holds a gloss as often as a name. A name in it is checked, and
  // a lowercase description is not read as a tool.
  blocksOn('a name inside a bracketed description is checked',
    javaOnly, '- Built it using Java (managed Kubernetes).', ['kubernetes']);
  passes('a lowercase bracketed description is not a tool',
    javaOnly, '- Built it using Java (self-hosted).');
  passes('a longer lowercase bracketed description is not a tool',
    javaOnly, '- Built it using Java (kept behind the firewall).');

  // A fragment longer than three words is a clause, not a list item. Its
  // names are checked, each on its own; its lowercase prose is not a tool.
  blocksOn('a four-word name is checked', javaOnly, '- Built it using Google Cloud Vertex AI.', ['google cloud vertex ai']);
  blocksOn('a name at the head of a clause is checked',
    javaOnly, '- Grew pipeline using Salesforce across three regions.', ['salesforce']);
  passes('a backed name at the head of a clause passes',
    '- Ran campaigns using Salesforce.', '- Grew pipeline using Salesforce across three regions.');
  blocksOn('a versioned name at the head of a clause is checked',
    '- Drafted content using GPT-4.', '- Drafted content using GPT-5 so writers could focus on strategy.', ['gpt-5']);
  passes('a backed versioned name at the head of a clause passes',
    '- Drafted content using GPT-4.', '- Drafted content using GPT-4 so writers could focus on strategy.');
  blocksOn('a name later in a clause is checked',
    javaOnly, '- Built it using Java through managed Kubernetes clusters.', ['kubernetes']);
  passes('the pronoun "I" in a clause is not a tool',
    javaOnly, '- Built it using Java so I could ship weekly.');
  passes('a backed four-word name passes', '- Built models using Google Cloud Vertex AI.', '- Built it using Google Cloud Vertex AI.');
  blocksOn('a four-word name after a backed one is checked',
    javaOnly, '- Built it using Java and Amazon Elastic Kubernetes Service.', ['amazon elastic kubernetes service']);
  blocksOn('a five-word name with a year is checked by its name',
    javaOnly, '- Built it using Microsoft Azure DevOps Server 2022.', ['microsoft azure devops server']);
  const longName = `K${'x'.repeat(90)}`;
  blocksOn('a name longer than 80 characters is checked', javaOnly, `- Built it using Java and ${longName}.`, [longName.toLowerCase()]);
  // A name is short. A capture of hundreds of capitalised words, or of one
  // enormous token, is not one, and looking it up in the sources must block
  // rather than throw on a regular expression too large to build.
  for (const [label, text] of [
    ['a thousand capitalised words', `- Built it using ${'Alpha '.repeat(1000).trim()}.`],
    ['one enormous token', `- Built it using K${'x'.repeat(200000)}.`],
  ]) {
    try {
      const result = check(javaOnly, text);
      if (result.verdict === 'block') pass(`a capture of ${label} blocks`);
      else fail(`a capture of ${label} did not block: ${result.verdict}`);
    } catch (error) {
      fail(`a capture of ${label} threw: ${String(error.message).slice(0, 80)}`);
    }
  }
  // Nothing the gate read before may go unread. A piece touching a bracket or
  // a colon was dropped whole, and the pieces beside it were read as list
  // items; they still are.
  const blocksIncluding = (label, cv, target, expected) => {
    const result = check(cv, target);
    const found = tools(result);
    if (result.verdict === 'block' && expected.every(value => found.includes(value))) pass(label);
    else fail(`${label}: expected a block including ${JSON.stringify(expected)}, got ${result.verdict} ${JSON.stringify(found)}`);
  };
  const javaAndAws = '- Built services using Java and AWS.';
  blocksOn('the names after a colon are still checked',
    javaAndAws, '- Built the platform using AWS: Glue, Athena and Redshift.', ['glue', 'athena', 'redshift']);
  blocksOn('a list a colon introduces is checked',
    javaAndAws, '- Rebuilt delivery using a modern stack: Terraform and Datadog.', ['terraform', 'datadog']);
  blocksOn('a fullwidth colon reads as a colon',
    javaAndAws, '- Built it using Java\uff1a Kubernetes and Terraform.', ['kubernetes', 'terraform']);
  blocksIncluding('the items inside a bracketed list are still checked',
    '- Built models using Python.', '- Built models using Python (pandas, numpy, scikit-learn and matplotlib).', ['numpy', 'scikit-learn']);
  blocksIncluding('an item inside brackets after a connector is still checked',
    '- Shipped using Docker.', '- Shipped using Docker (with kubectl and helm).', ['kubectl']);
  blocksOn('a name with an inner capital is read inside brackets',
    '- Shipped apps using Swift.', '- Shipped apps using Swift (iOS, macOS, watchOS and tvOS).', ['ios', 'macos', 'watchos', 'tvos']);
  blocksOn('a name after a product name ending in "!" is still checked',
    '- Ran sites using Joomla.', '- Ran sites using Joomla! and WordPress.', ['wordpress']);
  passes('a backed product name ending in "!" passes',
    '- Ran sites using Joomla! and WordPress.', '- Ran sites using Joomla! and WordPress.');
  blocksOn('a later name after a product name with "!" inside is still checked',
    '- Ran media using Yahoo! DSP.', '- Ran media using Yahoo! DSP and Marin.', ['marin']);
  blocksOn('a low opening quote does not hide the rest of the list',
    javaOnly, '- Built it using Java, \u201ekubectl\u201c, helm and terraform.', ['kubectl', 'helm', 'terraform']);
  blocksOn('a low single opening quote does not hide the rest of the list',
    javaOnly, '- Built it using Java, \u201akubectl\u2018, helm and terraform.', ['kubectl', 'helm', 'terraform']);

  // The sentence after "!" or "?" is not part of the list.
  passes('the sentence after "?" is not read as a tool',
    javaAndKubernetes, '- Built it using Java and Kubernetes? Then we scaled it.');
  passes('the sentence after "!" is not read as a tool',
    javaAndKubernetes, '- Built it using Java and Kubernetes! Then we scaled it.');

  // A number on its own names nothing.
  passes('a numbered list of backed names passes',
    '- Ran it using HubSpot, Salesforce and Looker.', '- Ran it using 1) HubSpot, 2) Salesforce and 3) Looker.');
  blocksOn('a numbered list still checks its names',
    '- Ran it using HubSpot and Salesforce.', '- Ran it using 1) HubSpot, 2) Salesforce and 3) Looker.', ['looker']);
  passes('a bare number in a clause is not a tool',
    '- Ran campaigns using Salesforce.', '- Grew pipeline using Salesforce across 3 regions.');
  passes('a ratio in a clause is not a tool',
    '- Ran ads using Google Ads and LinkedIn Ads.', '- Ran ads using a 70:20:10 budget split across Google Ads and LinkedIn Ads.');

  // An HTML entity is the character it encodes.
  passes('a backed name before an HTML entity passes',
    '- Ran it using Marketo and Salesforce.', '- Ran it using Marketo&reg; and Salesforce.');
  blocksOn('a name after an HTML entity is checked', javaOnly, '- Built it using Java &mdash; Kubernetes.', ['kubernetes']);
  blocksOn('a name split by an encoded zero-width space is checked as the name',
    javaOnly, '- Built it using Java and Kuber&#8203;netes.', ['kubernetes']);
  blocksOn('a name split by an encoded soft hyphen is checked as the name',
    javaOnly, '- Built it using Java and Kuber&shy;netes.', ['kubernetes']);
  const escapedMarkup = toolValues('Built it using &lt;b&gt;Kubernetes&lt;/b&gt; and Java.');
  if (escapedMarkup.includes('java')) pass('an escaped tag is not decoded into markup that removes the text after it');
  else fail(`an escaped tag hid the list: ${JSON.stringify(escapedMarkup)}`);

  // A connector joined by a hyphen is part of a word.
  const inHouse = toolValues('Built it using in-house models and Snowflake.');
  if (JSON.stringify(inHouse) === JSON.stringify(['in-house models', 'snowflake'])) pass('a connector joined by a hyphen does not split a phrase');
  else fail(`a hyphenated connector split a phrase: ${JSON.stringify(inHouse)}`);

  // Each separator and boundary is pinned by a case that changes without it.
  blocksOn('a name in a bracketed description led by a determiner is checked',
    javaOnly, '- Built it using Java (the Kubernetes operator).', ['kubernetes']);
  blocksOn('a three-word lowercase list item is checked whole',
    javaOnly, '- Built it using Java and apache spark streaming.', ['apache spark streaming']);
  for (const separator of ['|', '\u00b7', '\u2022', '\u2192', '\u2190', '"', '\u0060', '\u201c', '\u201d', '\u201e', '\u201a', '\u00ab', '\u00bb', '\u2039', '\u203a']) {
    passes(`two backed names joined by an unspaced "${separator}" pass`, javaAndKubernetes, `- Built it using Java${separator}Kubernetes.`);
  }
  passes('a quoted backed name before a clause passes',
    javaAndKubernetes, '- Built it using "Kubernetes" so the team could ship weekly.');
  passes('a backticked backed name before a clause passes',
    javaAndKubernetes, '- Built it using `Kubernetes` so the team could ship weekly.');
  passes('a backed name of more than 50 characters passes',
    '- Ran clusters using Amazon Web Services Elastic Kubernetes Service Anywhere.', '- Ran it using Amazon Web Services Elastic Kubernetes Service Anywhere.');
  blocksOn('a name after a closed bracket is checked',
    javaAndKubernetes, '- Built it using Java (Kubernetes) and kubectl.', ['kubectl']);
  blocksOn('a name after a stray closing bracket is checked', javaOnly, '- Built it using Java) and kubectl.', ['kubectl']);
  blocksOn('a name ending in "+" keeps it', '- Built it using C and Java.', '- Built it using Java and C++.', ['c++']);
  blocksOn('a name ending in "#" keeps it', '- Built it using C and Java.', '- Built it using Java and F#.', ['f#']);
  const hiddenGrouping = [...metricClaims('Reached 1\u200b234 567 users.')];
  const visibleGrouping = [...metricClaims('Reached 1234 567 users.')];
  if (JSON.stringify(hiddenGrouping) === JSON.stringify(visibleGrouping)) pass('an invisible character does not change how digits group');
  else fail(`an invisible character regrouped digits: ${JSON.stringify(hiddenGrouping)} vs ${JSON.stringify(visibleGrouping)}`);
  // Growth, not a wall-clock limit: ten times the input may take about ten
  // times as long, and quadratic growth takes a hundred times. A slow runner
  // alone does not fail it; the large run must also be slow in absolute terms.
  const timeSymbolRun = length => {
    const started = performance.now();
    factClaims(`Built it using K${'@'.repeat(length)}x.`);
    return performance.now() - started;
  };
  timeSymbolRun(2000);
  const smallRun = Math.max(timeSymbolRun(20000), 1);
  const largeRun = timeSymbolRun(200000);
  if (largeRun < 1000 || largeRun / smallRun < 40) pass('a long run of symbols in a fragment is read in linear time');
  else fail(`a long run of symbols scaled superlinearly: ${Math.round(smallRun)} ms for 20,000, ${Math.round(largeRun)} ms for 200,000`);
  const longProse = toolValues('Built it using data to cut churn by half.');
  if (longProse.length === 0) pass('a long prose fragment the prose words mark is still not a tool');
  else fail(`a long prose fragment was read as a tool: ${JSON.stringify(longProse)}`);

  // A number names nothing, so it ends a name inside a clause. A count, a
  // percentage or a multiplier beside an acronym is a metric, not part of a
  // name the sources must contain word for word.
  passes('a percentage after a backed acronym is not part of a name',
    '- Cut CAC by 30% with nurture flows built in HubSpot.', '- Rebuilt nurture using HubSpot to cut CAC 30%.');
  passes('a count before a backed acronym is not part of a name',
    '- Ran HubSpot in 12 markets across EMEA.', '- Scaled demand using HubSpot across 12 EMEA markets.');
  passes('a multiplier after a backed acronym is not part of a name',
    '- Lifted MQLs by 3x using HubSpot.', '- Rebuilt scoring using HubSpot and lifted MQLs 3x across regions.');
  blocksOn('a versioned name in a clause is checked by its name',
    '- Built services using Go.', '- Built it using Python 3 across every service.', ['python']);

  // The old pattern kept a trailing "-", so "C--" is not read as "C". No name
  // ends in a slash, so a stray one is trimmed.
  blocksOn('a name ending in "-" keeps it', '- Built it using C and Java.', '- Built it using Java and C--.', ['c--']);
  passes('a stray slash after a backed name is trimmed', '- Built it using Go and Java.', '- Built it using Java and Go/.');

  // A trademark sign is not part of the name it follows, inside a clause too.
  passes('a backed name with a trademark sign passes',
    '- Ran campaigns using Salesforce.', '- Ran campaigns using Salesforce\u2122.');
  passes('a backed name with a trademark sign in a clause passes',
    '- Ran campaigns using Salesforce.', '- Grew pipeline using Salesforce\u2122 across three regions.');
  passes('a backed name with a registered sign in a clause passes',
    '- Ran campaigns using Salesforce.', '- Grew pipeline using Salesforce\u00ae across three regions.');
  passes('a backed name with an encoded trademark sign passes',
    '- Ran campaigns using Salesforce.', '- Grew pipeline using Salesforce&trade; across three regions.');

  // Each entity is decoded in the pass that keeps escaped markup as text.
  blocksOn('a name in escaped angle brackets is checked',
    javaOnly, '- Built it using Java and &lt;Kubernetes&gt;.', ['kubernetes']);
  blocksOn('a name after an escaped "<" is checked',
    javaOnly, '- Built it using Java and &lt;Kubernetes>.', ['kubernetes']);
  blocksOn('a name split by a hex-encoded soft hyphen is checked as the name',
    javaOnly, '- Built it using Java and Kuber&#xad;netes.', ['kubernetes']);
  blocksOn('a name in encoded quotes is checked',
    javaOnly, '- Built it using Java and &quot;Kubernetes&quot;.', ['kubernetes']);
  // An encoded line break renders as a space, so it neither ends the list
  // nor stays in the text as an entity, and it is not a clause boundary.
  blocksOn('a name after an encoded line break is checked',
    javaOnly, '- Built it using Java&#10;and Kubernetes.', ['kubernetes']);
  const encodedBreak = stripMarkup('Shipped it&#10;in one quarter.', { keepLineBreaks: true });
  if (encodedBreak === 'Shipped it in one quarter.') pass('an encoded line break is a space, not a line break');
  else fail(`an encoded line break was kept as a line break: ${JSON.stringify(encodedBreak)}`);
  // An entity is decoded once: a double-escaped "&amp;lt;" is the text "&lt;".
  const doubleEscaped = stripMarkup('Built it using Java and &amp;lt;Kubernetes&amp;gt;.');
  if (doubleEscaped.includes('&lt;Kubernetes&gt;')) pass('a double-escaped entity is decoded once');
  else fail(`a double-escaped entity was decoded twice: ${JSON.stringify(doubleEscaped)}`);

  // A word that is an abbreviation, or a name joined to another by a slash, in
  // a clause of four or more words.
  passes('a slash between single letters is not a name',
    '- Ran experiments using HubSpot.', '- Ran experiments using HubSpot and A/B splits on landing pages.');
  passes('a dotted abbreviation in a clause is not a name',
    '- Ran outreach using HubSpot.', '- Ran outreach using HubSpot to weekly regional sales U.S. lists.');
  blocksOn('a dotted name joined to another by a slash is read as two names',
    '- Built APIs using Node.js and AWS Lambda.', '- Built the API using Node.js/Express on AWS Lambda.', ['express']);
  blocksOn('a name that opens with a dot is a name inside a clause',
    '- Built services using C#.', '- Built services using .NET on Azure App Service.', ['.net', 'azure app service']);
  passes('a backed dotted name and a backed name joined by a slash pass',
    '- Built the API using Node.js and Express on AWS Lambda.', '- Built the API using Node.js/Express on AWS Lambda.');

  // The piece just after a bracket and the piece opening one are read by
  // their names only.
  passes('a lowercase word after a bracketed gloss is not a tool',
    '- Ran clusters using Kubernetes and EKS.', '- Ran it using Kubernetes (EKS) self-hosted.');
  passes('a lowercase word opening a bracketed list is not a tool',
    '- Ran clusters using Java and EKS.', '- Ran it using Java (self-hosted, EKS).');
  for (const [open, close] of [['\u201c', '\u201d'], ['\u201a', '\u2018'], ['\u00ab', '\u00bb'], ['\u2039', '\u203a']]) {
    passes(`two backed names in adjacent ${open}${close} quotes pass`,
      javaAndKubernetes, `- Built it using ${open}Java${close} ${open}Kubernetes${close}.`);
  }

  // CJK and Arabic punctuation that normalization leaves alone. Their commas
  // separate names, and their full stop and semicolon end the sentence the
  // way "!" and "?" do.
  blocksOn('a name after an Arabic comma is checked',
    javaOnly, '- Built it using Java\u060c kubectl\u060c helm.', ['kubectl', 'helm']);
  passes('a backed list with Arabic commas passes',
    '- Built it with Java, kubectl and helm.', '- Built it using Java\u060c kubectl\u060c helm.');
  blocksOn('a name after an ideographic comma is checked',
    javaOnly, '- Built it using Java\u3001Kubernetes.', ['kubernetes']);
  passes('two backed names around an ideographic full stop pass',
    javaAndKubernetes, '- Built it using Java\u3002Kubernetes.');
  passes('the sentence after an ideographic full stop is not read as a tool',
    javaAndKubernetes, '- Built it using Java and Kubernetes\u3002Then we scaled it.');
  passes('the clause after an Arabic semicolon is not read as a tool',
    javaAndKubernetes, '- Built it using Java and Kubernetes\u061b Then we scaled it.');

  // A capture of hundreds of thousands of names is read without overflowing
  // the call stack.
  try {
    factClaims(`Built it using ${'Abc def '.repeat(150000)}`);
    pass('a capture of 150,000 names is read without throwing');
  } catch (error) {
    fail(`a capture of 150,000 names threw: ${String(error.message).slice(0, 80)}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
