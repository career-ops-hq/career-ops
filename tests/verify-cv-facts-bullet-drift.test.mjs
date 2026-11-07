// #1411: a rendered bullet that keeps its source's keywords but changes what
// the candidate did ("Used Kafka" -> "Led a Kafka migration") is anchored to
// its source bullet and blocked unless every edit is an allowed one.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { assertFacts, bulletDriftClaims, driftClaimAdvice, verifyFacts } from '../verify-cv-facts.mjs';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nBullet drift gate (#1411)');

const SOURCE = `# Jane Doe

## Experience

### Acme Corp
**Senior Software Engineer**

- Used Kafka for event ingestion in the billing service
- Supported the pricing team on the 2024 repricing analysis
- Reviewed pull requests for the payments service
- Built a Python ETL pipeline for finance reporting
- Led the migration of reporting to Snowflake
- Sourced and directed vendor Acme Interactive through the WebGL build of an in-store kiosk

### Globex
- Led hiring for the data team
`;

const ul = (...items) => `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
const drift = (target, options) => bulletDriftClaims(target, SOURCE, options);
const check = (name, ok, detail) => (ok ? pass(name) : fail(`${name}: ${JSON.stringify(detail)}`));

// Escalations the existing verb lists do not hold.
for (const [bullet, word] of [
  ['Led a Kafka migration for the billing service', 'led'],
  ['Spearheaded the 2024 repricing analysis', 'spearheaded'],
  ['Rebuilt the payments service', 'rebuilt'],
  ['Architected the Kafka event platform for billing', 'architected'],
]) {
  const claims = drift(ul(bullet));
  check(`blocks "${word}" over its source bullet's verb`,
    claims.length === 1 && claims[0].kind === 'drift' && claims[0].added.includes(word), claims);
}

const kafka = drift(ul('Led a Kafka migration for the billing service'))[0];
check('quotes the anchored source bullet, not the whole source',
  kafka?.sourceLine === 'Used Kafka for event ingestion in the billing service', kafka);

// "Led hiring for the data team" is a different entry: its verb must not vouch.
check('a verb from another entry does not vouch for this bullet',
  drift(ul('Led a Kafka migration for the billing service')).length === 1, null);

// heathernew09's case from the thread: directed a vendor -> wrote it yourself.
const vendor = drift(ul('Designed the interaction model and wrote the WebGL implementation for an in-store kiosk'));
check('a later clause\'s verb is checked too (vendor -> "wrote")',
  vendor.length === 1 && vendor[0].added.includes('designed') && vendor[0].added.includes('wrote'), vendor);

// Allowed edits: inflection, reorder, deletion, nominalisation, function words,
// and keyword injection outside predicate position.
for (const bullet of [
  'Built Python ETL pipelines powering finance reporting',
  'Building reliable Python ETL pipelines for finance and FP&amp;A reporting',
  'Led Snowflake migration of reporting',
  'Migrated reporting to Snowflake',
  'Uses Kafka for billing service event ingestion',
  'Built a Python ETL pipeline in Python, Airflow and dbt for finance reporting',
  'Reviewed pull requests',
]) {
  const claims = drift(ul(bullet));
  check(`allows a truthful rewrite: "${bullet}"`, claims.length === 0, claims);
}

check('a leading label is not read as the verb',
  drift(ul('Billing: Used Kafka for event ingestion in the billing service')).length === 0, null);
check('the verb after a leading label is still checked',
  drift(ul('Billing: Led a Kafka migration for the billing service')).length === 1, null);
check('a verb that opens the label is still checked',
  drift(ul('Led the Kafka ingestion for billing: event service')).length === 1, null);
check('-ing list nouns in later clauses are not read as verbs',
  drift(ul('Built a Python ETL pipeline for finance, marketing and engineering reporting')).length === 0, null);
// Review on #6630: a later clause opening with a regular "-ed" word is
// ambiguous. Before a noun it warns; before a determiner, or as an irregular
// past form, it is a verb and blocks.
{
  const [adjective] = drift(ul('Built Python ETL pipelines for finance and automated reporting'));
  check('"and automated reporting" warns instead of blocking',
    adjective?.blocking === false && adjective.added.includes('automated'), adjective);
  const [related] = drift(ul('Built a Python ETL pipeline for finance and related to billing'));
  check('"and related to billing" warns instead of blocking', related?.blocking === false, related);
  const [verb] = drift(ul('Built a Python ETL pipeline for finance reporting and managed the vendors'));
  check('"and managed the vendors" still blocks', verb?.blocking === true, verb);
}
check('a bullet with no source anchor is left to the other checks',
  drift(ul('Organised the company hackathon')).length === 0, null);

// Declared swaps are pairwise: valid only where the anchor has the left word.
check('allow_swaps clears a declared verb swap',
  drift(ul('Led a Kafka migration for the billing service'), { allowSwaps: ['used -> led'] }).length === 0, null);
check('allow_swaps folds inflections on both sides',
  drift(ul('Leading Kafka ingestion for the billing service'), { allowSwaps: ['uses -> led'] }).length === 0, null);
check('a swap does not apply to a bullet whose anchor lacks its source word',
  drift(ul('Led the 2024 repricing analysis'), { allowSwaps: ['used -> led'] }).length === 1, null);
check('a single-word allow_facts entry allows that verb',
  drift(ul('Spearheaded the 2024 repricing analysis'), { allowFacts: ['spearheaded'] }).length === 0, null);
check('"used" still matches "using" in its own anchor',
  drift(ul('Used Kafka for event ingestion in billing'), {}).length === 0
    && bulletDriftClaims(ul('Used Kafka for billing event ingestion'), '- Ingested billing events using Kafka\n').length === 0, null);
check('one shared tool name plus "using" is not an anchor',
  drift(ul('Grew pipeline using Kafka across three regions')).length === 0, null);
let threw = false;
try { drift(ul('Led a Kafka migration for the billing service'), { allowSwaps: ['led'] }); } catch { threw = true; }
check('a malformed allow_swaps entry fails closed', threw, null);

// LaTeX and markdown bullets are read the same way.
check('reads LaTeX \\resumeItem bullets',
  drift('\\begin{document}\\resumeItem{Led a Kafka migration for the billing service}\\end{document}').length === 1, null);
check('reads LaTeX \\item bullets',
  drift('\\begin{document}\\begin{itemize}\\item Rebuilt the payments service\n\\end{itemize}\\end{document}').length === 1, null);
check('reads markdown bullets',
  drift('## Experience\n- Spearheaded the 2024 repricing analysis\n').length === 1, null);
check('prose outside a list is not anchored',
  drift('<p>Led a Kafka migration for the billing service.</p>').length === 0, null);

// Through verifyFacts: blocking verdict, config, de-duplication, language skip.
const tmp = mkdtempSync(join(tmpdir(), 'career-ops-bullet-drift-'));
try {
  const source = join(tmp, 'cv.md');
  const config = join(tmp, 'cv-facts.json');
  const html = join(tmp, 'cv.html');
  writeFileSync(source, SOURCE);
  const write = (extra = {}) => writeFileSync(config, JSON.stringify({ allow_metrics: [], allow_facts: [], forbidden_phrases: [], ...extra }));
  write();
  const run = (target) => verifyFacts(target, { sourcePaths: [source], configPath: config });

  const blocked = run(ul('Led a Kafka migration for the billing service'));
  check('verifyFacts blocks a drifted bullet', blocked.verdict === 'block'
    && blocked.unsupportedFacts.some(claim => claim.kind === 'drift'), blocked);

  const ambiguous = run(ul('Built a Python ETL pipeline for finance and automated reporting'));
  check('verifyFacts reports an ambiguous drift as advisory, not a block',
    ambiguous.verdict === 'warn' && ambiguous.advisoryFacts.some(claim => claim.kind === 'drift')
      && !ambiguous.unsupportedFacts.some(claim => claim.kind === 'drift'), ambiguous);

  check('verifyFacts passes the source bullet verbatim',
    run(ul('Used Kafka for event ingestion in the billing service')).verdict === 'pass', null);

  write({ allow_swaps: ['used -> led'] });
  check('allow_swaps in cv-facts.json clears the block',
    run(ul('Led a Kafka migration for the billing service')).verdict === 'pass', null);

  write({ allow_facts: ['led a kafka migration for the billing service'] });
  check('allow_facts waives a drifted bullet by value',
    run(ul('Led a Kafka migration for the billing service')).verdict === 'pass', null);

  write({ allow_swaps: 'used -> led' });
  let configThrew = false;
  try { run(ul('Rebuilt the payments service')); } catch { configThrew = true; }
  check('a non-array allow_swaps is a config error', configThrew, null);
  write();

  const owned = run(ul('Owned the 2024 repricing analysis end to end'));
  check('a bullet the scope check reports is not reported twice',
    owned.unsupportedFacts.filter(claim => claim.kind === 'scope').length === 1
      && !owned.unsupportedFacts.some(claim => claim.kind === 'drift'), owned.unsupportedFacts);

  writeFileSync(source, '- Utilizó Kafka para la ingesta de eventos en el servicio de facturación\n');
  const spanish = run(ul('Dirigió la migración de Kafka en el servicio de facturación'));
  check('a non-English document skips the drift check',
    !spanish.unsupportedFacts.some(claim => claim.kind === 'drift'), spanish.unsupportedFacts);
  writeFileSync(source, SOURCE);

  let message = '';
  try { assertFacts(ul('Rebuilt the payments service'), { sourcePaths: [source], configPath: config }); } catch (err) { message = err.message; }
  check('assertFacts names the added word, the source bullet and allow_swaps',
    /drift=rebuilt the payments service/.test(message) && /Reviewed pull requests/.test(message)
      && /allow_swaps/.test(message) && /"rebuilt"/.test(message)
      && /"reviewed -> rebuilt"/.test(message), message);
  check('the swap example names a labelled source bullet\'s verb, not its label',
    /"used -> led"/.test(driftClaimAdvice({ added: ['led'], sourceLine: 'Billing: Used Kafka for event ingestion' })), null);

  writeFileSync(html, ul('Spearheaded the 2024 repricing analysis'));
  const cli = spawnSync(NODE, [join(ROOT, 'verify-cv-facts.mjs'), html, '--source', source, '--config', config], { encoding: 'utf-8' });
  check('CLI exits 1 and prints the drift advice',
    cli.status === 1 && /drift: spearheaded the 2024 repricing analysis/.test(cli.stderr)
      && /source: Supported the pricing team/.test(cli.stderr) && /allow_swaps/.test(cli.stderr), cli.stderr);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
