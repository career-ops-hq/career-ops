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

  // #3907 — "role:" or "title:" immediately followed by a bare capitalised
  // pronoun ("I") satisfied the old `[A-Z][\w/-]*` first-token class (the
  // `*` allows zero extra characters), so ordinary prose like a cover-letter
  // disclaimer was misread as a one-letter job title claim and blocked
  // rendering even though nothing false was ever asserted.
  const roleColonPronoun = factClaims(
    'I want to be direct about something important to this role: I do not have functional knowledge in X.',
  );
  if (!roleColonPronoun.some(claim => claim.kind === 'title')) {
    pass('#3907 "role: I" is not read as a one-letter title claim');
  } else {
    fail(`#3907 regression: "role: I ..." produced a false title claim: ${JSON.stringify(roleColonPronoun)}`);
  }

  const titleColonArticle = factClaims('Please review the role: A candidate should have strong communication skills.');
  if (!titleColonArticle.some(claim => claim.kind === 'title')) {
    pass('#3907 "role: A" is not read as a one-letter title claim');
  } else {
    fail(`#3907 regression: "role: A ..." produced a false title claim: ${JSON.stringify(titleColonArticle)}`);
  }

  // The #3907 fix must not make the gate blind to real title fabrication,
  // including short 2-letter acronym titles, which are common enough (VP,
  // PM, HR) that a naive "require 2+ letters, uppercase only" fix would have
  // broken them.
  const unsupportedAcronymTitle = verifyFacts('Title: VP of Sales, previously unrelated experience.', {
    sourcePaths: [source], configPath: config,
  });
  if (unsupportedAcronymTitle.verdict === 'block'
      && unsupportedAcronymTitle.unsupportedFacts.some(claim => claim.kind === 'title' && claim.value === 'vp of sales')) {
    pass('#3907 fix does not blind the gate to a fabricated acronym title (VP of Sales)');
  } else {
    fail(`#3907 fix broke acronym title detection: ${JSON.stringify(unsupportedAcronymTitle)}`);
  }

  const unsupportedRealTitle = verifyFacts('Title: Principal Engineer, previously unrelated experience.', {
    sourcePaths: [source], configPath: config,
  });
  if (unsupportedRealTitle.verdict === 'block'
      && unsupportedRealTitle.unsupportedFacts.some(claim => claim.kind === 'title' && claim.value === 'principal engineer')) {
    pass('#3907 fix still flags a genuinely unsupported title claim (Principal Engineer)');
  } else {
    fail(`#3907 fix regressed real title detection: ${JSON.stringify(unsupportedRealTitle)}`);
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

  // #4004 - `isLikelyTool()` accepts by default: a fragment that is neither
  // tool-shaped nor an exact source match is still asserted as a tool unless
  // one of its words happens to sit in `TOOL_PROSE_WORDS`. A tailoring run
  // that rewords a "using" sentence out of the CV's own vocabulary therefore
  // blocks the render of a document that asserts nothing false.
  writeFileSync(source, [
    'Regional Sales Manager at Northwind Supply.',
    'Reported on campaign performance and on coverage of the pipeline every week.',
    'Advised clients on solutions for print and digital channels.',
    'Grew the account through a consultative approach to selling.',
  ].join('\n'));
  const rewordedProse = [
    ['a reworded source phrase', 'Reported weekly using campaign performance and pipeline coverage.'],
    ['a noun phrase reassembled from the source', 'Advised clients using digital solutions.'],
    ['a gerund phrase from the source', 'Grew the account using consultative selling.'],
  ];
  for (const [label, target] of rewordedProse) {
    const result = verifyFacts(target, { sourcePaths: [source], configPath: config });
    if (result.verdict === 'pass' && !result.unsupportedFacts.some(claim => claim.kind === 'tool')) {
      pass(`#4004 prose built from the source's own words is not a tool claim: ${label}`);
    } else {
      fail(`#4004 ordinary prose blocked a truthful document (${label}): ${JSON.stringify(result)}`);
    }
  }

  // A name the source never mentions is still unverified, whatever its casing:
  // the source-vocabulary test above must not become a way to smuggle one in.
  const novelLowercaseTool = verifyFacts('Reported weekly using kubernetes.', {
    sourcePaths: [source], configPath: config,
  });
  if (novelLowercaseTool.verdict === 'block'
      && novelLowercaseTool.unsupportedFacts.some(claim => claim.kind === 'tool' && claim.value === 'kubernetes')) {
    pass('#4004 a lowercase name absent from the source still blocks');
  } else {
    fail(`#4004 opened a bypass for an unbacked lowercase tool: ${JSON.stringify(novelLowercaseTool)}`);
  }

  // Determiners are a closed grammatical class, so this one needs no source:
  // "that campaign" and "our playbook" are ordinary reference, not products.
  const determinerCases = [
    ['a demonstrative', 'Rebuilt the funnel using that campaign.'],
    ['a possessive', 'Ran the quarterly review using our playbook.'],
  ];
  for (const [label, text] of determinerCases) {
    const found = factClaims(text).filter(claim => claim.kind === 'tool');
    if (found.length === 0) {
      pass(`#4004 a determiner-led fragment is not a tool claim: ${label}`);
    } else {
      fail(`#4004 determiner-led prose was extracted as a tool (${label}): ${JSON.stringify(found)}`);
    }
  }

  // A determiner LATER in a list leads one fragment, not the whole capture.
  // The check ran on the raw capture before the split, so "React and our
  // playbook" lost React, and an unsupported "kubernetes" in that position
  // stopped being blocked at all. A determiner immediately after the trigger
  // is different and still drops the clause: that marks the trigger as
  // ordinary English ("worked with the team in London"), which the prose guard
  // above depends on.
  const mixedList = factClaims('Built with React and our playbook.').filter(claim => claim.kind === 'tool');
  if (mixedList.some(claim => claim.value === 'react')
      && !mixedList.some(claim => claim.value.includes('playbook'))) {
    pass('#4004 a determiner in one fragment does not discard its siblings');
  } else {
    fail(`#4004 a determiner-led fragment took the whole list with it: ${JSON.stringify(mixedList)}`);
  }

  const mixedListFailClosed = factClaims('Shipped it using kubernetes and our stack.').filter(claim => claim.kind === 'tool');
  if (mixedListFailClosed.some(claim => claim.value === 'kubernetes')) {
    pass('#4004 an unsupported name beside a determiner-led fragment is still claimed');
  } else {
    fail(`#4004 a determiner-led sibling suppressed a claim that must block: ${JSON.stringify(mixedListFailClosed)}`);
  }

  // A determiner can be the WHOLE fragment, not just its lead: the `for`
  // lookahead ends the capture at "that", and the split can leave one standing
  // alone. Requiring trailing whitespace missed both.
  const bareDeterminer = factClaims('Built this using that for the migration.').filter(claim => claim.kind === 'tool');
  if (bareDeterminer.length === 0) {
    pass('#4004 a determiner standing alone is not a tool claim');
  } else {
    fail(`#4004 a bare determiner was extracted as a tool: ${JSON.stringify(bareDeterminer)}`);
  }

  // The whole-clause drop is about PROSE triggers: a determiner after "using"
  // or "worked with" says the trigger is ordinary English. A determiner after
  // "Technologies:" says no such thing, because that trigger is a declaration
  // whatever follows it, so there the determiner taints only its own fragment.
  const declaredWithDeterminer = factClaims('Technologies: our playbook and React').filter(claim => claim.kind === 'tool');
  if (declaredWithDeterminer.some(claim => claim.value === 'react')
      && !declaredWithDeterminer.some(claim => claim.value.includes('playbook'))) {
    pass('#4004 a determiner in a declared list does not discard the list');
  } else {
    fail(`#4004 a declared technology was lost to a determiner sibling: ${JSON.stringify(declaredWithDeterminer)}`);
  }

  const declaredFailClosed = factClaims('Tech stack: our stack and kubernetes').filter(claim => claim.kind === 'tool');
  if (declaredFailClosed.some(claim => claim.value === 'kubernetes')) {
    pass('#4004 a declared list still yields the claim the gate must block');
  } else {
    fail(`#4004 a determiner sibling suppressed a declared claim: ${JSON.stringify(declaredFailClosed)}`);
  }

  // The other direction: an explicit declaration is still a declaration.
  const declaredTools = factClaims('Technologies: React, Postgres');
  if (declaredTools.some(claim => claim.kind === 'tool' && claim.value === 'react')
      && declaredTools.some(claim => claim.kind === 'tool' && claim.value === 'postgres')) {
    pass('#4004 a Technologies: list is still extracted');
  } else {
    fail(`#4004 lost a declared technology list: ${JSON.stringify(declaredTools)}`);
  }

  const builtWithTools = factClaims('Built with Django and Redis.');
  if (builtWithTools.some(claim => claim.kind === 'tool' && claim.value === 'django')
      && builtWithTools.some(claim => claim.kind === 'tool' && claim.value === 'redis')) {
    pass('#4004 a "built with" declaration is still extracted');
  } else {
    fail(`#4004 lost a "built with" declaration: ${JSON.stringify(builtWithTools)}`);
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
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
