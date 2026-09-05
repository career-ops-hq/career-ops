import { pass, fail } from './helpers.mjs';
import { delegatedAuthorshipClaims, factClaims, verifyFacts } from '../verify-cv-facts.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nNon-metric fact gate');

const tmp = mkdtempSync(join(tmpdir(), 'career-ops-nonmetric-facts-'));
try {
  const source = join(tmp, 'cv.md');
  const config = join(tmp, 'cv-facts.json');
  writeFileSync(source, 'Senior Platform Engineer at Acme Labs. Built using React and Docker. Cut spend to $120k and closed a €90,000 deal.');
  writeFileSync(config, JSON.stringify({ allow_metrics: [], allow_facts: [], forbidden_phrases: [] }));

  const claims = factClaims('I worked at Acme Labs as a Senior Platform Engineer, using React and Docker.');
  if (claims.some(claim => claim.kind === 'employer' && claim.value === 'acme labs')
      && claims.some(claim => claim.kind === 'title' && claim.value === 'senior platform engineer')
      && claims.some(claim => claim.kind === 'tool' && claim.value === 'react')) {
    pass('extracts employer, title, and tool claims');
  } else {
    fail(`claim extraction incomplete: ${JSON.stringify(claims)}`);
  }

  const supported = verifyFacts('I worked at Acme Labs as a Senior Platform Engineer, using React and Docker.', {
    sourcePaths: [source], configPath: config,
  });
  if (supported.verdict === 'pass' && supported.unsupportedFacts.length === 0) {
    pass('source-backed non-metric facts pass');
  } else {
    fail(`source-backed non-metric facts blocked: ${JSON.stringify(supported)}`);
  }

  const supportedCurrency = verifyFacts('Cut spend to $120k and closed a €90,000 deal.', {
    sourcePaths: [source], configPath: config,
  });
  if (supportedCurrency.verdict === 'pass' && supportedCurrency.invented.length === 0) {
    pass('source-backed currency metrics pass');
  } else {
    fail(`source-backed currency metrics were blocked: ${JSON.stringify(supportedCurrency)}`);
  }

  const unsupportedCurrency = verifyFacts('Generated $5M and saved £2.5M.', {
    sourcePaths: [source], configPath: config,
  });
  if (unsupportedCurrency.verdict === 'block'
      && unsupportedCurrency.invented.includes('$5m')
      && unsupportedCurrency.invented.includes('£2.5m')) {
    pass('unsupported currency metrics block');
  } else {
    fail(`unsupported currency metrics bypassed the fact gate: ${JSON.stringify(unsupportedCurrency)}`);
  }

  const unsupported = verifyFacts('I worked at Invented Labs as a Principal Platform Engineer, using React and Terraform.', {
    sourcePaths: [source], configPath: config,
  });
  if (unsupported.verdict === 'block'
      && unsupported.unsupportedFacts.some(claim => claim.value === 'invented labs')
      && unsupported.unsupportedFacts.some(claim => claim.value === 'principal platform engineer')
      && unsupported.unsupportedFacts.some(claim => claim.value === 'terraform')) {
    pass('unsupported employer, title, and tool claims block');
  } else {
    fail(`unsupported non-metric facts were not blocked: ${JSON.stringify(unsupported)}`);
  }

  const lowercaseUnknownTool = verifyFacts('built using react with kubernetes and google cloud.', {
    sourcePaths: [source], configPath: config,
  });
  if (lowercaseUnknownTool.verdict === 'block'
      && lowercaseUnknownTool.unsupportedFacts.some(claim => claim.value === 'kubernetes')
      && lowercaseUnknownTool.unsupportedFacts.some(claim => claim.value === 'google cloud')) {
    pass('explicit lowercase tool claims fail closed without a whitelist entry');
  } else {
    fail(`lowercase tool claims bypassed the fact gate: ${JSON.stringify(lowercaseUnknownTool)}`);
  }

  const trailingProse = factClaims('I built this using React and Docker for containerized deployments.');
  if (trailingProse.some(claim => claim.kind === 'tool' && claim.value === 'react')
      && trailingProse.some(claim => claim.kind === 'tool' && claim.value === 'docker')
      && !trailingProse.some(claim => claim.value.includes('containerized deployments'))) {
    pass('tool claims stop before trailing prepositional prose');
  } else {
    fail(`tool claim over-captured trailing prose: ${JSON.stringify(trailingProse)}`);
  }

  const connectorTools = factClaims('I built this using React with Redux in Dify.');
  if (connectorTools.some(claim => claim.kind === 'tool' && claim.value === 'react')
      && connectorTools.some(claim => claim.kind === 'tool' && claim.value === 'redux')
      && connectorTools.some(claim => claim.kind === 'tool' && claim.value === 'dify')) {
    pass('tool claims split across with/in connectors');
  } else {
    fail(`connector-separated tool claims were not extracted: ${JSON.stringify(connectorTools)}`);
  }

  const proseTools = factClaims('I worked with the team in London.');
  const contextualTool = factClaims('I built using React in production.');
  if (contextualTool.some(claim => claim.value === 'react')
      && proseTools.length === 0) {
    pass('tool extraction filters ordinary prose around technology names');
  } else {
    fail(`ordinary prose was extracted as a tool: ${JSON.stringify({ proseTools, contextualTool })}`);
  }

  const proseTitle = factClaims('The company was recognized as a Top Employer.');
  if (!proseTitle.some(claim => claim.kind === 'title')) {
    pass('ordinary as prose is not treated as a title claim');
  } else {
    fail(`ordinary prose produced a false title claim: ${JSON.stringify(proseTitle)}`);
  }

  const boundary = verifyFacts('I am using Go and Google Cloud.', {
    sourcePaths: [source], configPath: config,
  });
  if (boundary.unsupportedFacts.some(claim => claim.kind === 'tool' && claim.value === 'go')) {
    pass('fact matching does not accept embedded substrings');
  } else {
    fail(`fact matching accepted an embedded substring: ${JSON.stringify(boundary)}`);
  }

  // #3639 — concrete false positives hit in one real session: ordinary
  // gerund/abstract-noun prose after a "using"/"with"/"in" trigger word was
  // extracted as a "tool" claim and blocked a truthful document. Each of
  // these must now produce NO tool claim at all.
  const falsePositiveCases = [
    ['gerund alone', 'Built this using diagnosing and resolving workflow friction.'],
    ['gerund + abstract-noun-suffix phrase', 'Built this using recurring HR and operations tasks.'],
    ['bare abstract noun', 'Built this using efficiency.'],
    ['stoplisted noun + abstract-noun-suffix phrase', 'Built this using feedback and improve delivery.'],
    ['three-word gerund-led phrase', 'Built this using improving on-time submission.'],
  ];
  for (const [label, text] of falsePositiveCases) {
    const found = factClaims(text).filter(claim => claim.kind === 'tool');
    if (found.length === 0) {
      pass(`#3639 false positive fixed: ${label}`);
    } else {
      fail(`#3639 false positive NOT fixed (${label}): ${JSON.stringify(found)}`);
    }
  }

  // Review regression: a word ending that looks like ordinary English is not
  // enough to discard a lowercase tool claim. Spring, Unity, and Processing
  // are real technology names and must remain subject to source verification.
  for (const tool of ['spring', 'unity', 'processing']) {
    const directClaims = factClaims(`Built this using ${tool}.`).filter(claim => claim.kind === 'tool');
    const unbacked = verifyFacts(`Built this using ${tool}.`, {
      sourcePaths: [source], configPath: config,
    });
    if (directClaims.some(claim => claim.value === tool)
        && unbacked.verdict === 'block'
        && unbacked.unsupportedFacts.some(claim => claim.kind === 'tool' && claim.value === tool)) {
      pass(`lowercase technology with prose-like suffix remains fail-closed: ${tool}`);
    } else {
      fail(`lowercase technology bypassed the fact gate: ${JSON.stringify({ tool, directClaims, unbacked })}`);
    }
  }

  writeFileSync(source, 'Built the workflow using delivery.');
  const sourceBackedCollision = verifyFacts('Built the workflow using delivery.', {
    sourcePaths: [source], configPath: config,
  });
  if (sourceBackedCollision.verdict === 'pass') {
    pass('source evidence overrides an exact prose-word collision');
  } else {
    fail(`source-backed lowercase tool collided with the prose filter: ${JSON.stringify(sourceBackedCollision)}`);
  }

  // The fix must not let a fabricated tool typed in lowercase evade
  // detection just by losing its capitalisation — the false-positive fix is
  // scoped to prose-shaped (gerund/abstract-noun) fragments only.
  const lowercaseFabricationStillCaught = verifyFacts('Shipped it using kubernetes and google cloud.', {
    sourcePaths: [source], configPath: config,
  });
  if (lowercaseFabricationStillCaught.verdict === 'block'
      && lowercaseFabricationStillCaught.unsupportedFacts.some(claim => claim.value === 'kubernetes')
      && lowercaseFabricationStillCaught.unsupportedFacts.some(claim => claim.value === 'google cloud')) {
    pass('#3639 fix does not open a lowercase-evasion bypass');
  } else {
    fail(`lowercase fabricated tools bypassed the fact gate after the #3639 fix: ${JSON.stringify(lowercaseFabricationStillCaught)}`);
  }

  // A genuinely fabricated, Title-Cased tool with no source backing must
  // still block — the shape check only ever ADDS a source-backed exemption,
  // it never removes the requirement for evidence.
  const capitalizedFabricationStillCaught = verifyFacts('Shipped it using Kubernetes and Terraform.', {
    sourcePaths: [source], configPath: config,
  });
  if (capitalizedFabricationStillCaught.verdict === 'block'
      && capitalizedFabricationStillCaught.unsupportedFacts.some(claim => claim.value === 'kubernetes')
      && capitalizedFabricationStillCaught.unsupportedFacts.some(claim => claim.value === 'terraform')) {
    pass('a fabricated Title-Cased tool with no source backing still blocks');
  } else {
    fail(`a fabricated Title-Cased tool bypassed the fact gate: ${JSON.stringify(capitalizedFabricationStillCaught)}`);
  }

  // A real lowercase tool name genuinely used and listed in the source must
  // still pass cleanly, even though it is neither Title-Cased nor numbered.
  writeFileSync(source, 'Senior Platform Engineer at Acme Labs. Built using React and Docker on kubernetes with n8n. Cut spend to $120k and closed a €90,000 deal.');
  const backedLowercaseTool = verifyFacts('Deployed the service using kubernetes and n8n.', {
    sourcePaths: [source], configPath: config,
  });
  if (backedLowercaseTool.verdict === 'pass') {
    pass('a source-backed lowercase tool name is not penalized for casing');
  } else {
    fail(`a source-backed lowercase tool name was blocked: ${JSON.stringify(backedLowercaseTool)}`);
  }

  const delegatedSource = [
    'Sourced and directed vendor Acme Interactive through the WebGL build of an in-store kiosk.',
    'Built the internal deployment pipeline using Node.js.',
  ].join('\n');
  writeFileSync(source, delegatedSource);

  const escalatedText = 'Designed the interaction model and wrote the WebGL implementation for an in-store kiosk.';
  const escalatedClaims = delegatedAuthorshipClaims(escalatedText, delegatedSource);
  const escalated = verifyFacts(escalatedText, {
    sourcePaths: [source], configPath: config,
  });
  if (escalated.verdict === 'block'
      && escalatedClaims.some(claim => claim.kind === 'authorship' && claim.value.includes('wrote webgl implementation'))
      && escalated.unsupportedFacts.some(claim => claim.kind === 'authorship')) {
    pass('third-party implementation rewritten as direct authorship blocks');
  } else {
    fail(`delegated implementation was promoted to direct authorship: ${JSON.stringify({ escalatedClaims, escalated })}`);
  }

  const relativeClauseSource = [
    'Managed vendor Acme Interactive, which built the WebGL implementation for an in-store kiosk.',
    'Oversaw contractors who developed the onboarding automation in Node.js.',
  ].join('\n');
  const relativeClauseCases = [
    ['Wrote the WebGL implementation for an in-store kiosk.', 'vendor relative clause is treated as delegated execution'],
    ['Developed the onboarding automation in Node.js.', 'contractor relative clause is treated as delegated execution'],
  ];
  writeFileSync(source, relativeClauseSource);
  for (const [target, label] of relativeClauseCases) {
    const claims = delegatedAuthorshipClaims(target, relativeClauseSource);
    const result = verifyFacts(target, { sourcePaths: [source], configPath: config });
    if (claims.some(claim => claim.kind === 'authorship') && result.verdict === 'block') {
      pass(label);
    } else {
      fail(`${label} was accepted: ${JSON.stringify({ claims, result })}`);
    }
  }

  const attributionKept = verifyFacts('Directed vendor Acme Interactive through the WebGL build of an in-store kiosk.', {
    sourcePaths: [source], configPath: config,
  });
  if (attributionKept.verdict === 'pass'
      && !attributionKept.unsupportedFacts.some(claim => claim.kind === 'authorship')) {
    pass('a rewrite that keeps third-party attribution passes');
  } else {
    fail(`preserved vendor attribution was blocked: ${JSON.stringify(attributionKept)}`);
  }

  const unrelatedDirectWork = verifyFacts('Built the internal deployment pipeline using Node.js.', {
    sourcePaths: [source], configPath: config,
  });
  if (unrelatedDirectWork.verdict === 'pass'
      && !unrelatedDirectWork.unsupportedFacts.some(claim => claim.kind === 'authorship')) {
    pass('unrelated source-backed direct work is not matched to delegated work');
  } else {
    fail(`source-backed direct work was blocked: ${JSON.stringify(unrelatedDirectWork)}`);
  }

  const ambiguousSource = 'Directed vendor Acme Interactive through the WebGL build and wrote the kiosk integration layer.';
  const ambiguous = delegatedAuthorshipClaims('Wrote the kiosk integration layer.', ambiguousSource);
  if (ambiguous.length === 0) {
    pass('mixed direct and delegated source statements fail open');
  } else {
    fail(`ambiguous mixed-authorship source was blocked: ${JSON.stringify(ambiguous)}`);
  }

  const separateDirectEvidence = [
    'Directed vendor Acme Interactive through the WebGL build of an in-store kiosk.',
    'Wrote the WebGL implementation for an in-store kiosk prototype.',
  ].join('\n');
  const directlySupported = delegatedAuthorshipClaims(
    'Wrote the WebGL implementation for an in-store kiosk prototype.',
    separateDirectEvidence,
  );
  if (directlySupported.length === 0) {
    pass('separate direct-work evidence wins over overlapping delegated work');
  } else {
    fail(`explicit direct-work evidence was ignored: ${JSON.stringify(directlySupported)}`);
  }

  // Scope-verb inflation and unsourced adoption claims (#3685), end to end
  // through verifyFacts and its real source files. Both cases below were passed
  // by the gate in a real run and had to be caught by hand.
  const scopeSource = join(tmp, 'scope-cv.md');
  writeFileSync(scopeSource, [
    'Contributed to the migration to a service architecture.',
    'Implemented the ingest pipeline for the analytics team.',
  ].join('\n'));

  const inflatedScope = verifyFacts('Led the migration to a service architecture.', {
    sourcePaths: [scopeSource], configPath: config,
  });
  const scopeClaim = inflatedScope.unsupportedFacts.find(claim => claim.kind === 'scope');
  // Which line was picked is the assertion, not its exact punctuation:
  // factStatements keeps a statement's own trailing period when a line break
  // supplied the delimiter, so pinning the full string would be brittle for a
  // reason unrelated to this check.
  if (inflatedScope.verdict === 'block'
      && scopeClaim
      && scopeClaim.sourceLine.includes('Contributed to the migration')
      && !scopeClaim.sourceLine.includes('ingest')) {
    pass('an upgraded scope verb blocks and names the source line');
  } else {
    fail(`scope inflation was not blocked: ${JSON.stringify(inflatedScope)}`);
  }

  const truthfulScope = verifyFacts('Implemented the ingest pipeline for the analytics team.', {
    sourcePaths: [scopeSource], configPath: config,
  });
  if (truthfulScope.verdict === 'pass'
      && !truthfulScope.unsupportedFacts.some(claim => claim.kind === 'scope')) {
    pass('a bullet whose source carries the same verb passes');
  } else {
    fail(`a truthful scope claim was blocked: ${JSON.stringify(truthfulScope)}`);
  }

  // "worked on" is the participation wording #3685 names beside "contributed
  // to". Reading it as no-evidence let every stronger rewrite of it through.
  const workedOnSource = join(tmp, 'worked-on-cv.md');
  writeFileSync(workedOnSource, 'Worked on the migration.\nWorked at Acme Labs as a Platform Engineer.');
  const workedOn = verifyFacts('Led the migration.', {
    sourcePaths: [workedOnSource], configPath: config,
  });
  if (workedOn.verdict === 'block'
      && workedOn.unsupportedFacts.some(claim => claim.kind === 'scope' && claim.value === 'led the migration')) {
    pass('a stronger verb over a "worked on" source blocks');
  } else {
    fail(`scope inflation over "worked on" was accepted: ${JSON.stringify(workedOn)}`);
  }

  // Employment wording is not a scope claim, so it must not become the weaker
  // side of a comparison for anything it shares a noun with.
  const employmentOnly = join(tmp, 'employment-cv.md');
  writeFileSync(employmentOnly, 'Worked at Acme Labs on the billing migration.');
  const employment = verifyFacts('Led the billing migration.', {
    sourcePaths: [employmentOnly], configPath: config,
  });
  if (!employment.unsupportedFacts.some(claim => claim.kind === 'scope')) {
    pass('"worked at" is not treated as scope evidence');
  } else {
    fail(`employment wording was read as scope evidence: ${JSON.stringify(employment)}`);
  }

  // A verb binds to its own work item. The strong half of a compound source
  // sentence must not vouch for the weak half.
  const compoundSource = join(tmp, 'compound-cv.md');
  writeFileSync(compoundSource, 'Contributed to the billing migration and led the payments rewrite.');
  const compoundWeak = verifyFacts('Led the billing migration.', {
    sourcePaths: [compoundSource], configPath: config,
  });
  const compoundStrong = verifyFacts('Led the payments rewrite.', {
    sourcePaths: [compoundSource], configPath: config,
  });
  if (compoundWeak.unsupportedFacts.some(claim => claim.kind === 'scope')
      && !compoundStrong.unsupportedFacts.some(claim => claim.kind === 'scope')) {
    pass('a compound source binds each verb to its own work item');
  } else {
    fail(`compound source scoping is wrong: ${JSON.stringify({ compoundWeak, compoundStrong })}`);
  }

  const unsourcedAdoption = verifyFacts('Built internal tooling used daily across the engineering org.', {
    sourcePaths: [scopeSource], configPath: config,
  });
  if (unsourcedAdoption.verdict === 'block'
      && unsourcedAdoption.unsupportedFacts.some(claim => claim.kind === 'adoption' && claim.value === 'used daily')) {
    pass('an adoption claim absent from every source blocks');
  } else {
    fail(`an unsourced adoption claim was accepted: ${JSON.stringify(unsourcedAdoption)}`);
  }

  const orgWide = verifyFacts('Rolled the linter out organization-wide.', {
    sourcePaths: [scopeSource], configPath: config,
  });
  if (orgWide.verdict === 'block'
      && orgWide.unsupportedFacts.some(claim => claim.kind === 'adoption' && claim.value === 'organization-wide')) {
    pass('the spelled-out organization-wide claim blocks');
  } else {
    fail(`organization-wide bypassed the gate: ${JSON.stringify(orgWide)}`);
  }

  // The source side is a lemma, so a truthful CV that paraphrases its own
  // source is not punished for the rewording.
  const paraphrased = join(tmp, 'paraphrase-cv.md');
  writeFileSync(paraphrased, 'Three teams adopted the tool. The rollout went across the whole company.');
  const paraphrase = verifyFacts('Adopted by 3 teams. Rolled out company-wide.', {
    sourcePaths: [paraphrased], configPath: config,
  });
  if (!paraphrase.unsupportedFacts.some(claim => claim.kind === 'adoption')) {
    pass('a source that words its adoption differently still supports the claim');
  } else {
    fail(`a paraphrased adoption claim was blocked: ${JSON.stringify(paraphrase)}`);
  }

  const sourcedAdoption = join(tmp, 'adoption-cv.md');
  writeFileSync(sourcedAdoption, 'Implemented the ingest pipeline, used daily by the analytics team.');
  const adoptionAllowed = verifyFacts('Implemented the ingest pipeline, used daily by the analytics team.', {
    sourcePaths: [sourcedAdoption], configPath: config,
  });
  if (adoptionAllowed.verdict === 'pass'
      && !adoptionAllowed.unsupportedFacts.some(claim => claim.kind === 'adoption')) {
    pass('a source-backed adoption claim passes');
  } else {
    fail(`a source-backed adoption claim was blocked: ${JSON.stringify(adoptionAllowed)}`);
  }

  // allow_facts is the existing escape hatch for a verified exception, and it
  // has to reach the new kinds too or the only way past a false positive is to
  // reword the CV.
  const allowConfig = join(tmp, 'cv-facts-allow.json');
  writeFileSync(allowConfig, JSON.stringify({
    allow_metrics: [], allow_facts: ['led the migration to a service architecture'], forbidden_phrases: [],
  }));
  const allowed = verifyFacts('Led the migration to a service architecture.', {
    sourcePaths: [scopeSource], configPath: allowConfig,
  });
  if (!allowed.unsupportedFacts.some(claim => claim.kind === 'scope')) {
    pass('allow_facts exempts a verified scope claim');
  } else {
    fail(`allow_facts did not reach the scope check: ${JSON.stringify(allowed)}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
