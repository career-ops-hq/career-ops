import { pass, fail } from './helpers.mjs';
import { factClaims, verifyFacts } from '../verify-cv-facts.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nTool claims hidden by a dot, a second trigger, or a connector');

// The tool gate is fail-closed: a name the sources never mention blocks the
// render. Most block cases below pair a tool the source backs with one it does
// not, so the only correct verdict is a block on the second. Before this
// suite those passed, because the second name was never extracted at all. The
// rest guard what the change must keep: names the gate already checked, and
// prose it must not read as a tool.
const tmp = mkdtempSync(join(tmpdir(), 'career-ops-hidden-tools-'));
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
    if (result.verdict === 'block' && expected.every(value => found.includes(value))) pass(label);
    else fail(`${label}: expected a block on ${JSON.stringify(expected)}, got ${result.verdict} ${JSON.stringify(found)}`);
  };
  const passes = (label, cv, target) => {
    const result = check(cv, target);
    if (result.verdict === 'pass' && tools(result).length === 0) pass(label);
    else fail(`${label}: expected a clean pass, got ${result.verdict} ${JSON.stringify(result.unsupportedFacts)}`);
  };

  // A dot inside a name is not the end of a sentence. The capture stopped at
  // it, so everything after a dotted name went unread.
  for (const name of ['Node.js', 'Next.js', 'Vue.js', 'ASP.NET', 'D3.js', '.NET']) {
    blocksOn(`a tool after ${name} is still checked`,
      `- Built services using ${name}.`, `- Built the service using ${name} and Kafka.`, ['kafka']);
  }

  // A lowercase dotted name is read whole too, and so is the name after it.
  // Truncated, "building.io" became "building", which is also an ordinary
  // word: any rule that reads "building" alone as prose would leave this line
  // with nothing checked, Java included.
  blocksOn('a tool after a lowercase dotted name is still checked',
    '- Built the CMS using building.io.', '- Built the CMS using building.io and Java.', ['java']);
  blocksOn('a lowercase dotted name is checked whole',
    '- Built the CMS using Java.', '- Built the CMS using building.io and Java.', ['building.io']);

  // The dotted name is compared whole. Cut at the dot, "Next.js" was checked
  // as "next", which any CV that says "next quarter" appears to back.
  blocksOn('a dotted name is compared whole, not by its first segment',
    '- Planned the next quarter.', '- Built the app using Next.js.', ['next.js']);
  passes('a dotted name the source backs passes',
    '- Built APIs using Node.js.', '- Built the API using Node.js.');
  const toolValues = text => factClaims(text).filter(claim => claim.kind === 'tool').map(claim => claim.value);
  const afterPeriod = toolValues('Built it using React. Grew ARR.');
  if (afterPeriod.length > 0 && afterPeriod.every(value => value === 'react')) pass('a sentence-ending period still ends the capture');
  else fail(`a sentence-ending period did not end the capture: ${JSON.stringify(afterPeriod)}`);

  // Reading through the dot can make a fragment longer than the three words a
  // tool claim may have. The shorter capture still runs, so a dotted name that
  // was checked before is checked still.
  const unrelated = '- Built services in Python and Postgres.';
  blocksOn('a dotted name in a long fragment is still checked',
    unrelated, '- Built the API using Node.js on AWS Lambda.', ['node']);
  blocksOn('a dotted name in a bullet with no period is still checked',
    unrelated, '- Built the API using Node.js\n- Led the platform team\n', ['node']);
  // The dotted name itself is compared whole in a long fragment too. Cut at
  // the dot, it is checked as "node" or "next", which a source that says
  // "Node" or "next quarter" appears to back.
  blocksOn('a dotted name before a connector in a long fragment is compared whole',
    '- Built APIs using Node.', '- Built the API using Node.js on AWS Lambda.', ['node.js']);
  blocksOn('a dotted name in a long fragment with no connector is compared whole',
    '- Built APIs using Node.', '- Built the API using Node.js 20 LTS runtime.', ['node.js']);
  blocksOn('a long fragment does not reduce a dotted name to its first segment',
    '- Planned the next quarter.', '- Built the app using Next.js on Vercel Edge.', ['next.js']);
  blocksOn('a dotted name in a long "worked with" fragment is compared whole',
    '- Planned the next quarter.', '- Worked with Next.js on Vercel Edge.', ['next.js']);
  blocksOn('a dotted name joined to another by a slash is compared whole',
    '- Built APIs using Node.', '- Built the API using Node.js/Express on AWS Lambda.', ['node.js']);
  for (const text of ['Ran experiments using A/B splits on landing pages.', 'Grew pipeline using paid/organic mix on LinkedIn.']) {
    const found = toolValues(text);
    if (!found.some(value => value.includes('/') || value === 'a' || value === 'b' || value === 'paid' || value === 'organic')) pass(`a slash between plain words is not read as a name: ${text}`);
    else fail(`a slash between plain words was read as a name (${text}): ${JSON.stringify(found)}`);
  }
  blocksOn('a name that opens with a dot in a long fragment is compared whole',
    '- Built services using C#.', '- Built services using .NET on Azure App Service.', ['.net']);
  // Only a word whose every dot-separated part has two or more characters,
  // and whose first and last parts each hold a letter, reads as a dotted name.
  // An abbreviation, a version number, or a figure with a unit in a long
  // fragment is not one.
  for (const [text, number] of [
    ['Ran outreach using weekly regional sales U.S. lists.', 'u.s'],
    ['Deployed using Ubuntu 22.04 LTS images.', '22.04'],
    ['Grew MAUs using lifecycle push campaigns reaching 12.5M users.', '12.5m'],
    ['Grew signups using referral loops driving 10.5k signups.', '10.5k'],
    ['Cut latency using edge caching under 99.9ms at p95.', '99.9ms'],
    ['Built APIs using Express servers running Node v18.17 LTS.', 'v18.17'],
  ]) {
    const found = toolValues(text);
    if (!found.includes(number)) pass(`a dotted abbreviation, version or figure is not a dotted name: ${text}`);
    else fail(`a dotted abbreviation, version or figure was read as a dotted name (${text}): ${JSON.stringify(found)}`);
  }

  // A list item that opens with its own trigger is read after that trigger.
  // It used to be discarded as prose, because "using" is itself a prose word.
  blocksOn('a tool after a second "using" is still checked',
    '- Built it using React.', '- Built it using React, using Kubernetes.', ['kubernetes']);
  blocksOn('a lowercase tool after a second "using" is still checked',
    '- Modeled data using Snowflake.', '- Modeled data using Snowflake, using dbt.', ['dbt']);
  blocksOn('a capitalised second "Using" is read the same way',
    '- Modeled data using Snowflake.', '- Modeled data using Snowflake, Using dbt.', ['dbt']);
  // Only a "using" that opens the item counts. One in the middle of an item is
  // left alone, so the words around it are never glued into one name.
  const midItem = toolValues('Built it using React, Kafka using Docker.');
  if (!midItem.some(value => value.includes('kafkadocker'))) pass('a "using" inside an item is not stripped');
  else fail(`a "using" inside an item was stripped: ${JSON.stringify(midItem)}`);
  // With a determiner after the second "using", the item is read whole, as
  // it always was, so a tool-shaped item still blocks.
  blocksOn('a determiner after a second "using" keeps the item checked',
    '- Built the frontend using React.', '- Built it using React, using their S3.', ['using their s3']);
  const innerDeterminer = toolValues('Built it using React, using our playbook.');
  if (innerDeterminer.includes('react') && !innerDeterminer.some(value => value.includes('playbook'))) pass('a determiner after a second "using" still marks prose');
  else fail(`a determiner after a second "using" was read as a tool: ${JSON.stringify(innerDeterminer)}`);

  // A connector such as "on" or "at" no longer discards the name before it,
  // in a fragment of up to three words. What follows the connector is where or
  // when, and stays unread (see toolNameBeforeConnector).
  blocksOn('a tool before "on" is still checked',
    '- Deployed using Docker.', '- Deployed using Docker, Kubernetes on AWS.', ['kubernetes']);
  blocksOn('a tool before "at" is still checked',
    '- Ran the rollout using Salesforce.', '- Ran the rollout using Salesforce, Gong at scale.', ['gong']);
  for (const tail of ['by default', 'from scratch', 'to staging', 'of course', 'a lot']) {
    blocksOn(`a tool before "${tail}" is still checked`,
      '- Deployed using Docker.', `- Deployed using Docker, Kubernetes ${tail}.`, ['kubernetes']);
  }
  // Only a list that "worked with" opens is left alone, not a list that
  // mentions it later or a later item that opens with its own "using".
  blocksOn('a later "worked with" does not hide a tool before a connector',
    '- Deployed using Docker. Worked with Finance on pricing.',
    '- Deployed using Docker, Kubernetes on AWS, worked with Finance.', ['kubernetes']);
  blocksOn('a "using" item inside a "worked with" list keeps the connector rule',
    '- Worked with Finance on pricing.', '- Worked with Finance, using Kubernetes on AWS.', ['kubernetes']);
  passes('a capitalised word after a connector is not read as a tool',
    '- Reported to the CMO using Looker.', '- Reported to the CMO using Looker on Mondays.');

  // The prose filter keeps doing its job. A fragment with a prose word other
  // than a connector yields nothing, even with a capitalised word in it; a
  // lowercase word before a connector is left to the existing prose filter;
  // and a clause the first trigger already marked as prose with a determiner
  // stays prose after a later trigger.
  for (const text of [
    'Built this using feedback on delivery.',
    'Planned launches using Ops on deployment.',
    'Worked with Finance on pricing.',
    'Reported using data on Mondays.',
    'Worked with the team, using feedback on delivery.',
    'Worked with the CFO, using pricing experiments.',
    'Grew pipeline using our playbook, using account scoring.',
  ]) {
    const found = toolValues(text);
    if (found.length === 0) pass(`a prose fragment yields no tool claim: ${text}`);
    else fail(`a prose fragment was read as a tool (${text}): ${JSON.stringify(found)}`);
  }

  // Both tool patterns read most names; each claim is reported once, and only
  // a repeat of the same kind counts as one.
  const once = toolValues('Built it using Kafka and React.');
  if (JSON.stringify(once) === JSON.stringify(['kafka', 'react'])) pass('each tool claim is reported once');
  else fail(`tool claims were repeated: ${JSON.stringify(once)}`);
  const kinds = factClaims('Worked at Salesforce, using Salesforce.').map(({ kind, value }) => `${kind}:${value}`);
  if (kinds.includes('employer:salesforce') && kinds.includes('tool:salesforce')) pass('the same value as two kinds is kept as two claims');
  else fail(`a claim of one kind hid a claim of another: ${JSON.stringify(kinds)}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
