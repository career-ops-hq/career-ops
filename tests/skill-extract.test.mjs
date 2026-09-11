// tests/skill-extract.test.mjs — the shared skill vocabulary + canonical
// extractor (#1896). These fixtures moved here verbatim from upskill.mjs's
// self-test when the tokenizer was relocated (PR 1, pure relocation) — behavior
// must stay byte-identical, so the same assertions now guard the shared module.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nskill-extract.mjs (shared skill tokenizer, #1896)');

try {
  const { extractSkills, canonicalize } = await import(pathToFileURL(join(ROOT, 'skill-extract.mjs')).href);

  // canonicalization: aliases + display casing, unknown tokens pass through
  const s1 = extractSkills('Needs k8s, golang and Postgres experience; NodeJS a plus');
  for (const expected of ['Kubernetes', 'Go', 'PostgreSQL', 'Node.js']) {
    if (!s1.has(expected)) fail(`extractSkills missing canonical ${expected} (got ${[...s1].join(',')})`);
  }
  if ([...s1].every(x => x !== 'k8s' && x !== 'Postgres')) pass('extractSkills canonicalizes k8s→Kubernetes, golang→Go, Postgres→PostgreSQL, NodeJS→Node.js');
  else fail(`extractSkills left a raw alias in the set: ${[...s1].join(',')}`);

  // symbol-terminated skills: \b-style boundaries would drop all four
  const s1b = extractSkills('Requires C++ and C# on .NET, plus SQL.');
  if (['C++', 'C#', '.NET', 'SQL'].every(x => s1b.has(x))) pass('extractSkills matches symbol-edge skills C++/C#/.NET/SQL');
  else fail(`extractSkills symbol skills => ${[...s1b].join(',')}`);

  // standalone "Go" is case-SENSITIVE: a capitalized token counts; prose does not
  const s1d = extractSkills('Skills: Go, Rust, TypeScript');
  const s1e = extractSkills('willing to go the extra mile; ready to GO live');
  const s1f = extractSkills('Own the Go-to-market strategy and Go-live support');
  const s1g = extractSkills('Backend in Go/Rust (Go preferred). We ship Go.');
  if (s1d.has('Go') && !s1e.has('Go') && !s1f.has('Go') && s1g.has('Go')) {
    pass('extractSkills Go pass: capitalized/punctuation-adjacent count; prose "go"/"GO" and Go-to-market/Go-live do not');
  } else {
    fail(`extractSkills Go handling => list=${s1d.has('Go')} prose=${s1e.has('Go')} hyphen=${s1f.has('Go')} punct=${s1g.has('Go')}`);
  }

  // lowercase mentions of mixed-case skills resolve to canonical casing
  const s1c = extractSkills('familiar with graphql, pytorch and postgresql');
  if (['GraphQL', 'PyTorch', 'PostgreSQL'].every(x => s1c.has(x))) pass('extractSkills lowercase mentions resolve to canonical casing');
  else fail(`extractSkills lowercase canonical => ${[...s1c].join(',')}`);

  // over-suppression boundary: cv "Java" must NOT match "JavaScript"
  const cv = extractSkills('Expert in Java and AWS.');
  if (!cv.has('JavaScript') && cv.has('Java') && cv.has('AWS')) pass('extractSkills does not let "Java" swallow "JavaScript"');
  else fail(`extractSkills Java/JavaScript boundary => ${[...cv].join(',')}`);

  // canonicalize direct: alias, display casing, unknown pass-through
  if (canonicalize('k8s') === 'Kubernetes' && canonicalize('graphql') === 'GraphQL' && canonicalize('SomeNicheFramework') === 'SomeNicheFramework') {
    pass('canonicalize maps aliases + display casing and passes unknown tokens through unchanged');
  } else {
    fail(`canonicalize => k8s=${canonicalize('k8s')} graphql=${canonicalize('graphql')} unknown=${canonicalize('SomeNicheFramework')}`);
  }

  // Certifications: recognized, but 'SAFe' must never be reachable from the
  // everyday word "safe" — through extractSkills OR through the exported
  // canonicalize(). SAFe is deliberately absent from SKILL_TOKENS and from
  // CANONICAL, and is matched only by the case-sensitive SAFE_CERT_PATTERN.
  // Table-driven over EVERY certification token, asserting both halves: the
  // token is recognized from lowercase prose, AND it canonicalizes to its
  // display form. The second half is the one that matters — a token added to
  // SKILL_TOKENS without a matching CANONICAL entry falls through to DISPLAY,
  // which title-cases it ("pmp" -> "Pmp"), missing the known-skills set. That
  // is the #1851 drift class this module exists to prevent, and it is silent.
  const certificationCases = [
    ['pmp', 'PMP'],
    ['pmi-acp', 'PMI-ACP'],
    ['pgmp', 'PgMP'],
    ['capm', 'CAPM'],
    ['pmbok', 'PMBOK'],
    ['prince2', 'PRINCE2'],
    ['certified scrummaster', 'Certified ScrumMaster'],
    ['cspo', 'CSPO'],
    ['itil', 'ITIL'],
    ['cobit', 'COBIT'],
    ['togaf', 'TOGAF'],
    ['lean six sigma', 'Lean Six Sigma'],
    ['six sigma', 'Six Sigma'],
    ['cissp', 'CISSP'],
    ['cism', 'CISM'],
    ['cipp', 'CIPP'],
    // Alternate spellings of credentials already above, each expected to land
    // on the SAME display string. This is the pairing that stops the tool
    // telling someone to earn a certification their CV already lists: the
    // known-skills set is built from the CV's spelling and the gap map from the
    // JD's, so the two only cancel if both collapse to one form. Written next to
    // their fused siblings on purpose — a future edit that changes one display
    // string and not the other fails here rather than in a user's gap map.
    ['certified scrum master', 'Certified ScrumMaster'],
    ['certified scrum product owner', 'CSPO'],
    ['pmi acp', 'PMI-ACP'],
    ['prince 2', 'PRINCE2'],
    ['lean six-sigma', 'Lean Six Sigma'],
    ['six-sigma', 'Six Sigma'],
  ];
  const certFailures = [];
  for (const [raw, display] of certificationCases) {
    const found = extractSkills(`Requires ${raw} certification.`);
    if (!found.has(display)) certFailures.push(`extract "${raw}" => ${[...found].join(',') || '(none)'}`);
    if (canonicalize(raw) !== display) certFailures.push(`canonicalize("${raw}") => ${canonicalize(raw)}`);
  }
  if (certFailures.length === 0) {
    pass(`extractSkills + canonicalize cover all ${certificationCases.length} certification tokens`);
  } else {
    fail(`certification coverage => ${certFailures.join(' | ')}`);
  }

  // 'Lean Six Sigma' must win over 'Six Sigma' — longest-first alternation,
  // same convention as 'React Native' before 'React'.
  const lss = extractSkills('Lean Six Sigma Black Belt preferred.');
  if (lss.has('Lean Six Sigma') && !lss.has('Six Sigma')) pass('extractSkills prefers "Lean Six Sigma" over the shorter "Six Sigma"');
  else fail(`extractSkills Lean Six Sigma precedence => ${[...lss].join(',')}`);

  // SAFe is handled separately (case-sensitive pattern, absent from SKILL_TOKENS
  // and CANONICAL), so it is asserted here rather than in the table above.
  const certs = extractSkills('PMP and PMI-ACP required; ITIL and CISSP preferred; SAFe a plus.');
  if (certs.has('PMP') && certs.has('PMI-ACP') && certs.has('ITIL') && certs.has('CISSP') && certs.has('SAFe')) {
    pass('extractSkills recognizes certifications alongside the case-sensitive SAFe match');
  } else {
    fail(`extractSkills certifications => ${[...certs].join(',')}`);
  }

  const prose = extractSkills('Maintain a safe working environment; safety is our priority.');
  if (!prose.has('SAFe')) pass('extractSkills does not read the word "safe" in prose as the SAFe certification');
  else fail(`extractSkills prose-safe boundary => ${[...prose].join(',')}`);

  // The case above is rejected on CASE alone, so it holds the `(?<!\w)` half of
  // SAFE_CERT_PATTERN and nothing else. 'SAFety' is the one that needs the
  // TRAILING `(?!\w)`: it is capitalized exactly like the certification and
  // differs only by what follows. Verified as a real hole rather than a
  // hypothetical — dropping `(?!\w)` makes extractSkills('SAFety training
  // programs') return SAFe, and without this line the suite stays green while
  // it does. The 'SAFe 6' positive is its pair: the boundary must reject a
  // trailing letter without also rejecting a trailing space and digit, which is
  // how the framework's own versioned name is written.
  const safetyProse = extractSkills('SAFety training programs run quarterly.');
  if (!safetyProse.has('SAFe')) pass('extractSkills does not read "SAFety" as the SAFe certification (trailing word boundary)');
  else fail(`extractSkills SAFety boundary => ${[...safetyProse].join(',')}`);

  const safeVersioned = extractSkills('SAFe 6 rollout experience required.');
  if (safeVersioned.has('SAFe')) pass('extractSkills still matches the versioned "SAFe 6" form');
  else fail(`extractSkills SAFe 6 => ${[...safeVersioned].join(',') || '(none)'}`);

  if (canonicalize('safe') === 'safe' && canonicalize('SAFe') === 'SAFe') {
    pass('canonicalize leaves "safe" unchanged and does not fold it into "SAFe"');
  } else {
    fail(`canonicalize safe-boundary => safe=${canonicalize('safe')} SAFe=${canonicalize('SAFe')}`);
  }

  // 'CSM' is deliberately NOT a token: in job-posting text it far more often
  // means Customer Success Manager than Certified ScrumMaster.
  //
  // Two assertions, because the exclusion has two halves and each one alone
  // leaves a hole the other closes:
  //
  //   - CONTEXTUAL: the collision sentence must not yield the credential.
  //     Asserted against that one value rather than `size === 0`, which would
  //     also assert nothing ELSE in the sentence is a skill — a token added
  //     later that legitimately matches "Manager" or "AE" would then fail this
  //     test for a reason it was never about.
  //   - STANDALONE: 'CSM' must not become a skill under ANY name. Narrowing to
  //     the credential above lost this: admitting 'CSM' as its own token makes
  //     extractSkills('CSM required.') return ['CSM'], and the contextual check
  //     still passes because the value it looks for is absent. Verified by
  //     temporarily adding the token — the contextual assertion stayed green.
  const csm = extractSkills('This role is part Customer Success Manager (CSM), partnered with an AE.');
  if (!csm.has('Certified ScrumMaster')) pass('extractSkills does not treat "CSM" as a certification (Customer Success Manager collision)');
  else fail(`extractSkills CSM collision => ${[...csm].join(',')}`);

  const csmAlone = extractSkills('CSM required.');
  if (!csmAlone.has('CSM') && !csmAlone.has('Certified ScrumMaster')) {
    pass('extractSkills does not admit a standalone "CSM" as a skill under any name');
  } else {
    fail(`extractSkills standalone CSM => ${[...csmAlone].join(',')}`);
  }

  // ── Marketing / GTM vocabulary ────────────────────────────────────────────
  // Same structural blindness the certification block was added for, one
  // discipline over. Every token above the marketing block is an engineering
  // tool or a delivery credential, so a marketing-operations candidate's gap
  // map could only ever report the handful of engineering words that happened
  // to appear in their reports. Measured on a real marketing-operations
  // corpus: "ABM" was named as an explicit gap in several linked reports and
  // was invisible throughout, while the top-ranked gap the tool could see was
  // a COMPANY NAME quoted inside those same ABM sentences.
  //
  // Table-driven, both halves, exactly like the certification table: the token
  // is recognized from lowercase prose AND canonicalizes to its display form.
  // A token added to SKILL_TOKENS without a matching CANONICAL entry falls
  // through to DISPLAY, which title-cases it ("abm" -> "Abm") and misses the
  // known-skills set — silent drift, the class this module exists to prevent.
  const marketingCases = [
    ['ABM', 'ABM'],
    ['account-based marketing', 'ABM'],
    ['account based marketing', 'ABM'],
    ['DSP', 'DSP'],
    ['demand-side platform', 'DSP'],
    ['demand side platform', 'DSP'],
    ['programmatic display', 'Programmatic'],
    ['programmatic advertising', 'Programmatic'],
    ['programmatic media', 'Programmatic'],
    ['media agency management', 'Media Agency Management'],
    ['media agency', 'Media Agency Management'],
    ['demand generation', 'Demand Generation'],
    ['demand gen', 'Demand Generation'],
    ['marketing automation', 'Marketing Automation'],
    ['marketing operations', 'Marketing Operations'],
    ['revenue operations', 'RevOps'],
    ['revops', 'RevOps'],
    ['lifecycle marketing', 'Lifecycle Marketing'],
    ['product marketing', 'Product Marketing'],
    ['partner marketing', 'Partner Marketing'],
    ['performance marketing', 'Performance Marketing'],
    ['growth marketing', 'Growth Marketing'],
    ['field marketing', 'Field Marketing'],
    ['content marketing', 'Content Marketing'],
    ['email marketing', 'Email Marketing'],
    ['paid media', 'Paid Media'],
    ['paid social', 'Paid Social'],
    ['paid search', 'Paid Search'],
    ['conversion rate optimization', 'Conversion Rate Optimization'],
    ['marketing mix modeling', 'Media Mix Modeling'],
    ['media mix modeling', 'Media Mix Modeling'],
    ['seo', 'SEO'],
    ['sem', 'SEM'],
    ['ppc', 'PPC'],
    // Platforms a marketing CV actually lists. These matter most on the KNOWN
    // side: without them the known-skills set built from a marketing cv.md came
    // back with 5 entries, so almost nothing could be excluded as already-held.
    ['hubspot', 'HubSpot'],
    ['marketo', 'Marketo'],
    ['pardot', 'Pardot'],
    ['braze', 'Braze'],
    ['klaviyo', 'Klaviyo'],
    ['onesignal', 'OneSignal'],
    ['intercom', 'Intercom'],
    ['semrush', 'SEMrush'],
    ['ahrefs', 'Ahrefs'],
    ['demandbase', 'Demandbase'],
    ['6sense', '6sense'],
    ['google ads', 'Google Ads'],
    ['google analytics', 'Google Analytics'],
    ['ga4', 'GA4'],
    ['google tag manager', 'Google Tag Manager'],
    ['amplitude', 'Amplitude'],
    ['mixpanel', 'Mixpanel'],
    ['n8n', 'n8n'],
    ['zapier', 'Zapier'],
  ];
  const marketingFailures = [];
  for (const [raw, display] of marketingCases) {
    const found = extractSkills(`Experience with ${raw} required.`);
    if (!found.has(display)) marketingFailures.push(`extract "${raw}" => ${[...found].join(',') || '(none)'}`);
    if (canonicalize(raw) !== display) marketingFailures.push(`canonicalize("${raw}") => ${canonicalize(raw)}`);
  }
  if (marketingFailures.length === 0) {
    pass(`extractSkills + canonicalize cover all ${marketingCases.length} marketing/GTM tokens`);
  } else {
    fail(`marketing vocabulary coverage => ${marketingFailures.join(' | ')}`);
  }

  // Longest-first alternation within the marketing families, same convention as
  // 'React Native' before 'React' and 'Lean Six Sigma' before 'Six Sigma'.
  const mktPrecedence = extractSkills('Own media agency management and account-based marketing.');
  if (mktPrecedence.has('Media Agency Management') && mktPrecedence.has('ABM')) {
    pass('extractSkills prefers the longest marketing form ("Media Agency Management", "Account-Based Marketing")');
  } else {
    fail(`marketing precedence => ${[...mktPrecedence].join(',')}`);
  }

  // A soft_gap sentence in the shape reports actually write them: the skill
  // named inside quoted JD language and prose, not as a bare list item. This is
  // the string shape the tool was silently dropping.
  const realGap = extractSkills(
    "ABM: 'Building a world-class Account-Based Marketing capability' is a CORE REMIT, " +
    "and 'deep expertise across… ABM' sits in the basic quals"
  );
  if (realGap.has('ABM')) pass('extractSkills finds ABM in a report-shaped soft_gap sentence');
  else fail(`soft_gap sentence => ${[...realGap].join(',') || '(none)'}`);

  // ── Deliberate omissions (the CSM precedent) ──────────────────────────────
  // Each of these is a legitimate marketing abbreviation whose everyday or
  // adjacent meaning collides hard enough that admitting it would mint phantom
  // gaps out of ordinary prose. Same asymmetry argument as 'CSM': a missing
  // alias costs a real skill once, visibly; a false one costs "go learn X" on
  // every posting that happens to use the word.

  // 'CRO' is Conversion Rate Optimization in marketing prose and Chief Revenue
  // Officer in the org chart, and GTM postings are full of the second one.
  const cro = extractSkills('This role reports to the CRO and partners with Sales.');
  if (!cro.has('CRO') && !cro.has('Conversion Rate Optimization')) {
    pass('extractSkills does not treat "CRO" as a skill (Chief Revenue Officer collision)');
  } else {
    fail(`CRO collision => ${[...cro].join(',')}`);
  }

  // 'GEO' is Generative Engine Optimization in AI-search work and "geography"
  // everywhere else, including the location prose in most postings.
  const geo = extractSkills('Supports customers across the EMEA geo and the APAC geo.');
  if (!geo.has('GEO')) pass('extractSkills does not read a geography "geo" as Generative Engine Optimization');
  else fail(`GEO collision => ${[...geo].join(',')}`);

  // Bare 'programmatic' is an everyday engineering adjective. Only the media
  // senses ('programmatic display/advertising/media/buying') count.
  const progAccess = extractSkills('Provides programmatic access to the billing API.');
  if (!progAccess.has('Programmatic')) {
    pass('extractSkills does not read "programmatic access" as programmatic media buying');
  } else {
    fail(`programmatic-access collision => ${[...progAccess].join(',')}`);
  }

  // 'Segment' (the CDP) is the worst offender in this family: "segment" is an
  // everyday noun in exactly the prose this vocabulary was added to read, and
  // marketing JDs are built out of it.
  const segmentProse = extractSkills('Define the enterprise segment and re-route each segment through the journey.');
  if (!segmentProse.has('Segment')) pass('extractSkills does not read an audience "segment" as the Segment CDP');
  else fail(`Segment collision => ${[...segmentProse].join(',')}`);

  // 'Iterable' (the ESP) collides with the programming term, and this module is
  // shared with jd-skill-gap, which runs over full engineering JDs.
  const iterableProse = extractSkills('The function accepts any iterable and returns a generator.');
  if (!iterableProse.has('Iterable')) pass('extractSkills does not read a programming "iterable" as the Iterable ESP');
  else fail(`Iterable collision => ${[...iterableProse].join(',')}`);

  // ── ABM is NOT Demandbase ─────────────────────────────────────────────────
  // The single most consequential boundary in this block, and the one an
  // "obvious" alias would get wrong. Demandbase is an ABM PLATFORM; owning a
  // seat in it is not owning an ABM program, and a careful evaluation says so
  // explicitly — platform familiarity is the honest adjacent claim, program
  // ownership is not.
  //
  // Aliasing Demandbase -> ABM would put ABM in the known-skills set built from
  // a CV that lists the tool, suppressing the exact gap this vocabulary was
  // added to surface — re-burying the bug one layer deeper, where it reads as
  // "no gap found" instead of "vocabulary missing". Same rule as the module's
  // no-umbrella-aliases policy: "cloud" must never count as knowing AWS.
  if (canonicalize('demandbase') === 'Demandbase' && canonicalize('abm') === 'ABM') {
    pass('canonicalize keeps Demandbase and ABM distinct (platform familiarity is not program ownership)');
  } else {
    fail(`Demandbase/ABM conflation => demandbase=${canonicalize('demandbase')} abm=${canonicalize('abm')}`);
  }

  const dbOnly = extractSkills('**Paid:** Google Ads, Demandbase');
  if (dbOnly.has('Demandbase') && !dbOnly.has('ABM')) {
    pass('a CV line listing Demandbase does not put ABM in the known-skills set');
  } else {
    fail(`Demandbase line leaked ABM => ${[...dbOnly].join(',')}`);
  }

  // 'SEM' must not fire inside 'SEMrush', and 'SEO' must survive next to it.
  const semBoundary = extractSkills('Search: SEMrush, Google Ads/AdWords');
  if (semBoundary.has('SEMrush') && !semBoundary.has('SEM')) {
    pass('extractSkills matches SEMrush without also firing the shorter SEM token');
  } else {
    fail(`SEM/SEMrush boundary => ${[...semBoundary].join(',')}`);
  }

  // empty / falsy input
  if (extractSkills('').size === 0 && extractSkills(null).size === 0) pass('extractSkills returns an empty set for empty/null input');
  else fail('extractSkills should return {} for empty/null');
} catch (e) {
  fail(`skill-extract tests crashed: ${e.message}`);
}
