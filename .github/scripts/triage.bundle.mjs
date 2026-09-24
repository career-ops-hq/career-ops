#!/usr/bin/env node
// GENERADO por github-src/scripts/build.mjs: no editar a mano. Fuente: github-src/scripts/triage.mjs + bin/lib/triage-core.mjs + policy/*.json
// {"builtAt":"2026-09-23T22:20:58.081Z","core":"bin/lib/triage-core.mjs","policies":{"labels":"8 entradas","trivial":"18 entradas","priority":"7 entradas"}}
import fs from 'node:fs';
import path from 'node:path';

const POLICIES = {"labels":{"version":1,"_doc":"Máquina de estados por labels. Los scripts leen de aquí; nada se hardcodea. who_sets/who_clears: action | session | coderabbit | human | collisions | priority.","maintainers":["santifer","Scott-Emberson"],"bots":["coderabbitai","coderabbitai[bot]","github-actions","github-actions[bot]","dependabot","dependabot[bot]","renovate","renovate[bot]","copilot","copilot-pull-request-reviewer"],"states":["triage/new","triage/ci-hold","triage/needs-split","needs-rebase","triage/waiting-author","triage/ready","triage/trivial","triage/re-review"],"statePrecedence":["needs-rebase","triage/ci-hold","triage/needs-split","triage/waiting-author","triage/trivial","triage/re-review","triage/ready","triage/new"],"areas":{"🔴 core-architecture":["AGENTS.md","CLAUDE.md","OPENCODE.md","DATA_CONTRACT.md","modes/_shared.md"],"⚠️ agent-behavior":["modes/*.md","modes/**/*.md",".claude/skills/**",".cursor/skills/**",".opencode/skills/**",".qwen/skills/**",".antigravitycli/skills/**",".grok/skills/**"],"🔧 scripts":["*.mjs","batch/**"],"📄 docs":["docs/**","README*.md","CONTRIBUTING.md","GOVERNANCE.md","CODE_OF_CONDUCT.md","SECURITY.md","SUPPORT.md"],"🌐 i18n":["README.*.md","modes/de/**","modes/fr/**","modes/hi/**","modes/ja/**","modes/ru/**"],"📊 dashboard":["dashboard/**"],"📦 dependencies":["package.json","package-lock.json"],"⚙️ ci":[".github/**"],"area:web":["web/**"]},"labels":{"triage/new":{"color":"BFD4F2","description":"Sin clasificar todavía: la Action decide estado en el siguiente sweep","who_sets":"action","who_clears":"action","exclusive_group":"triage"},"triage/ci-hold":{"color":"E99695","description":"Primerizo con CI pendiente de aprobación: un maintainer la libera","who_sets":"action","who_clears":"action","exclusive_group":"triage"},"triage/needs-split":{"color":"F9D0C4","description":"Demasiado grande o toca demasiadas áreas: pedir troceo","who_sets":"action","who_clears":"action","exclusive_group":"triage"},"needs-rebase":{"color":"fbca04","description":"Conflicts with main after recent merges; author rebase needed","who_sets":"action","who_clears":"action","exclusive_group":"triage","exists":true},"triage/waiting-author":{"color":"FBCA04","description":"La pelota está en el tejado del autor (CI rojo o cambios pedidos)","who_sets":"session","who_clears":"action","exclusive_group":"triage"},"triage/ready":{"color":"0E8A16","description":"CI verde y sin bloqueos: lista para revisión humana","who_sets":"action","who_clears":"action","exclusive_group":"triage"},"triage/trivial":{"color":"C2E0C6","description":"Pasa todos los gates de merge trivial: se fusiona sin lote","who_sets":"action","who_clears":"action","exclusive_group":"triage"},"triage/re-review":{"color":"1D76DB","description":"Tenía OK y cambió después: hay que volver a mirar","who_sets":"action","who_clears":"action","exclusive_group":"triage"},"direction/needs-santiago":{"color":"D93F0B","description":"Decisión de dirección reservada a Santiago: no se fusiona sin su OK","who_sets":"session","who_clears":"session","exclusive_group":"direction","blocks_merge":true},"direction/review":{"color":"5319E7","description":"Política de dirección: revisar encaje antes de avanzar","who_sets":"session","who_clears":"session","exclusive_group":"direction"},"needs-maintainer-decision":{"color":"D93F0B","description":"Architecture/strategy/precedent call reserved for Santiago","who_sets":"human","who_clears":"human","exclusive_group":"direction","exists":true,"synonym_of":"direction/needs-santiago"},"maintainer-commitment":{"color":"D876E3","description":"Hay una promesa nuestra registrada en el ledger para esta PR","who_sets":"session","who_clears":"session"},"blocks-others":{"color":"E4E669","description":"Otras PRs abiertas tocan sus mismos ficheros: fusionarla primero","who_sets":"collisions","who_clears":"collisions"},"p0":{"color":"B60205","description":"Critical / blocking","who_sets":"priority","who_clears":"priority","exclusive_group":"priority","exists":true},"p1":{"color":"D93F0B","description":"High priority","who_sets":"priority","who_clears":"priority","exclusive_group":"priority","exists":true},"p2":{"color":"FBCA04","description":"Medium priority","who_sets":"priority","who_clears":"priority","exclusive_group":"priority","exists":true,"no_label":true,"_doc":"p2 es el estado por defecto: no se etiqueta. classify solo añade p0/p1 y quita p0/p1 cuando dejan de cumplirse."},"quality-check":{"color":"D4C5F9","description":"Automated signal: a maintainer reads this one by hand before anything else happens","who_sets":"coderabbit","who_clears":"human","exists":true,"read_only":true},"agent-generated":{"color":"5319e7","description":"Drafted by a coding agent operated by a maintainer; read, run and signed by a human before review","who_sets":"human","who_clears":"human","exists":true,"read_only":true},"stale":{"color":"ededed","description":"","who_sets":"action","who_clears":"action","exists":true,"read_only":true},"plugin-candidate":{"color":"8B5CF6","description":"Good integration, lives outside core — candidate for the optional-integrations/plugin surface","who_sets":"human","who_clears":"human","exists":true,"read_only":true},"adoption/track":{"color":"1D76DB","description":"In the PR adoption ladder: author unresponsive, clock running","who_sets":"action","who_clears":"action","exists":true,"read_only":true},"adoption/pinged":{"color":"5DA8E8","description":"Adoption ladder step 1: friendly ping posted","who_sets":"action","who_clears":"action","exists":true,"read_only":true},"adoption/warned":{"color":"F9A825","description":"Adoption ladder step 2: adoption notice posted, 2 weeks to respond","who_sets":"action","who_clears":"action","exists":true,"read_only":true},"adoption/ready":{"color":"D93F0B","description":"Adoption ladder step 3: eligible for close + adoptable companion issue (maintainer action)","who_sets":"action","who_clears":"human","exists":true,"read_only":true},"🔧 scripts":{"color":"ededed","description":"","who_sets":"action","who_clears":"action","exists":true,"read_only":true,"area":true},"⚠️ agent-behavior":{"color":"ededed","description":"","who_sets":"action","who_clears":"action","exists":true,"read_only":true,"area":true},"📄 docs":{"color":"ededed","description":"","who_sets":"action","who_clears":"action","exists":true,"read_only":true,"area":true},"🔴 core-architecture":{"color":"ededed","description":"","who_sets":"action","who_clears":"action","exists":true,"read_only":true,"area":true},"area:web":{"color":"dd7627","description":"Web/UI surface — owned by the career-ops-ui agent (first-party web)","who_sets":"human","who_clears":"human","exists":true,"read_only":true,"area":true},"📊 dashboard":{"color":"ededed","description":"","who_sets":"action","who_clears":"action","exists":true,"read_only":true,"area":true},"📦 dependencies":{"color":"ededed","description":"","who_sets":"action","who_clears":"action","exists":true,"read_only":true,"area":true},"🌐 i18n":{"color":"ededed","description":"","who_sets":"action","who_clears":"action","exists":true,"read_only":true,"area":true},"⚙️ ci":{"color":"ededed","description":"","who_sets":"action","who_clears":"action","exists":true,"read_only":true,"area":true}}},"trivial":{"version":1,"_doc":"Gates de merge trivial. Todos en código (bin/lib/triage-core.mjs evaluateGates). Un test negativo por gate en tests/core.test.mjs.","maxLinesSmall":50,"safeAreas":["📄 docs","🌐 i18n"],"safePathPrefixes":["docs/","tests/","test/"],"safeFilePatterns":["README*.md","*.test.mjs","*.test.js","*.test.ts","*_test.go"],"requiredChecks":["test (ubuntu-latest)","test (macos-latest)","test (windows-latest)"],"forbiddenLabels":["quality-check","agent-generated","needs-rebase","🔴 core-architecture","⚠️ agent-behavior","direction/needs-santiago","direction/review","needs-maintainer-decision"],"forbiddenLabelPrefixes":["direction/"],"coderabbitLogins":["coderabbitai","coderabbitai[bot]"],"minAuthorMerged":1,"codeowners":{"file":".github/CODEOWNERS","owner":"@santifer","extraPatterns":["/plugins-registry/"],"_extraPatternsDoc":"plugins-registry.json ya no existe; hoy es plugins-registry/** y sigue siendo chokepoint de Santiago.","fallbackPatterns":["/README*.md","/CONTRIBUTING.md","/MAINTAINERS.md","/ARCHITECTURE.md","/.github/CODEOWNERS","/.github/copilot-instructions.md","/.github/agents/","/.github/instructions/","/CLAUDE.md","/AGENTS.md","/CODEX.md","/OPENCODE.md","/GEMINI.md","/modes/_shared.md","/DATA_CONTRACT.md","/update-system.mjs","/updater-migration-tests.mjs","/plugins-registry.json","/validate-plugin-registry.mjs","/plugin-install.mjs","/plugin-audit.mjs","/plugins/_engine.mjs","/plugins/_lock.mjs","/plugins/_net.mjs","/plugins/_registry.mjs","/.github/workflows/","/docs/PLUGIN_REVIEW.md","/web/"],"_fallbackDoc":"Copia de los patrones de @santifer en CODEOWNERS para cuando no hay checkout (Action). loadPolicies prefiere el fichero real."},"mergeState":{"requireMergeable":"MERGEABLE","reject":["DIRTY","BLOCKED","BEHIND"],"allowBehind":false,"allowBlocked":true,"_doc":"BLOCKED lo produce la propia protección de rama (falta la aprobación que da act-approve): se permite. BEHIND se permitirá cuando haya merge queue (allowBehind=true)."},"sessionCap":15,"informativeChecks":["CodeRabbit","renovate/artifacts","web typecheck + build","label","welcome","guard"],"_informativeChecksDoc":"Checks que nunca ponen la CI en rojo: informativos por diseño (web-ci.yml) o de servicio.","policyChecks":["direction-gate"],"_policyChecksDoc":"Checks de política, no de CI del autor: ciStatus los ignora (ni rojo ni pendiente, no disparan waiting-author) pero el gate `policy-checks` bloquea el merge trivial si alguno está en rojo."},"priority":{"version":1,"_doc":"p0/p1/p2 calculados en bin/lib/triage-core.mjs computePriority. Cada asignación lleva why en ≤12 palabras.","p0":{"labels":["security","regression"],"codeqlOpenAlerts":true},"p1":{"commitmentDueWithinHours":48,"blocksOthersMinDependents":10,"firstTimerReadyHours":48,"reReview":true,"_blocksOthersDoc":"blocks-others = las `blocksOthersTop` PRs con más dependientes, siempre que tengan ≥ blocksOthersMinDependents. Con 291 abiertas y ficheros como update-system.mjs tocados por 49 PRs, un umbral solo por número marcaba 120: el grafo es denso y lo útil es el top.","blocksOthersTop":15},"firstResponseHours":20,"needsSplit":{"maxLines":1000,"maxAreas":2},"sizeClasses":{"XS":10,"S":50,"M":250,"L":1000}}};
const JEV_CATALOG = {"quality":{"domain":"quality","version":1,"state_default":["title","body(4000)","files","diffHead(120)"],"questions":[{"id":"kind","type":"choice","summary":"Tipo de cambio según lo que toca el diff, no según el prefijo del título.","instructions":"What kind of change is this pull request, judged by the files and diff rather than by the title prefix?","criteria":{"fix":"Corrects a bug or regression in existing behaviour.","feature":"Adds new behaviour, a new mode, command, option or provider on the existing path.","provider":"Adds or changes a job-source provider or scanner.","docs":"Documentation, README, guides, comments only.","i18n":"Translations or language packs.","test":"Tests, fixtures or test harness only.","chore":"Dependencies, CI, tooling, formatting, renames without behaviour change.","refactor":"Restructures code without changing behaviour.","mixed":"Several of the above combined in one pull request."},"state":["title","body(4000)","files","diffHead(120)"],"effect":"note","since":"2026-09-22","source":"CONVENTIONS (triage por tipo) y CONTRIBUTING §What makes a good PR"},{"id":"describes_diff","type":"noul","summary":"El cuerpo explica lo que el diff hace de verdad; si no, se pide información antes de revisar.","instructions":"Does the pull request description accurately explain what the diff changes and why, at the level a reviewer needs?","criteria":{"yes":"The body names the problem, the change and how it was checked, and the files listed match that story.","no":"The body is empty, a template left unfilled, unrelated to the files changed, or claims changes that the diff does not show."},"state":["title","body(4000)","files","diffHead(120)"],"threshold_review":0.5,"hit_when":"below","effect":"needs-info","since":"2026-09-22","source":"CONTRIBUTING §What makes a good PR"},{"id":"is_spam","type":"noul","summary":"Solo marca; nunca cierra. Una PR vacía, de prueba o sin relación con el proyecto.","instructions":"Is this pull request spam or noise, meaning it has no plausible intent to improve the project?","criteria":{"yes":"Empty or placeholder changes, link farming, unrelated files, mass-generated boilerplate with no connection to the codebase, test commits opened by mistake.","no":"Any genuine attempt to fix, add or document something, even if low quality, off-scope or poorly written."},"state":["title","body(4000)","files","diffHead(120)"],"threshold_review":0.7,"effect":"flag","since":"2026-09-22","source":"CLAUDE.md constitución regla 4 (nunca spam-close sin presentarlo)"},{"id":"is_success_story","type":"noul","summary":"El autor cuenta que consiguió trabajo o entrevistas gracias al proyecto; recibe reconocimiento, nunca cierre automático.","instructions":"Does the author report a personal success obtained with the project (interviews, offers, a hired outcome) as part of this contribution?","criteria":{"yes":"The body or title tells that the author got interviews, offers or a job using the tool, or thanks the project for a personal outcome.","no":"No personal outcome is reported; it is a plain technical change."},"state":["title","body(4000)"],"threshold_review":0.6,"effect":"flag","since":"2026-09-22","source":"product-routing (una success-story legítima recibe reconocimiento)"},{"id":"ai_generated_signal","type":"noul","summary":"Señal de texto o código generado sin revisión humana; solo orienta la profundidad de la revisión.","instructions":"Does this pull request show signs of being generated by an AI agent without human review of the result?","criteria":{"yes":"Generic marketing-style prose, claims that do not match the diff, invented file paths or APIs, boilerplate sections repeated, very large diffs that touch unrelated areas with uniform style, references to non-existent features.","no":"Focused change with specific reasoning, references to real files and issues, human-scale wording, or an explicitly declared agent-generated change reviewed by a person."},"state":["title","body(4000)","files","diffHead(120)"],"threshold_review":0.7,"effect":"note","since":"2026-09-22","source":"product-routing (apariencia de texto generado es señal para investigar, no evidencia para cerrar)"},{"id":"scope_creep","type":"noul","summary":"La PR mezcla varias entregas independientes; se pide partirla, no se rechaza.","instructions":"Does this pull request bundle several independent changes that could each be reviewed and merged on their own?","criteria":{"yes":"Multiple unrelated features or fixes, a feature plus large refactors or formatting of untouched files, a new component plus docs plus tooling for other areas in one diff.","no":"One coherent change with the tests, docs and small adjacent adjustments it needs."},"state":["title","body(4000)","files","diffHead(120)"],"threshold_review":0.7,"effect":"needs-split","since":"2026-09-22","source":"product-routing (el tamaño puede requerir partir la entrega, no rechazar su existencia)"}]},"intent":{"domain":"intent","version":1,"state_default":["comment(3000)","title"],"questions":[{"id":"author_comment_intent","type":"choice","summary":"Solo delivered o question quitan waiting-author; el resto se registra.","instructions":"What is the author's intent in this comment on their own pull request?","criteria":{"delivered":"The author says the requested change is done, pushed, rebased or ready for another look.","question":"The author asks the maintainers something they need answered to continue.","pushback":"The author disagrees with the review or the routing and argues for their approach.","will_do_later":"The author acknowledges the request and says they will do it later, without delivering yet.","abandoning":"The author says they will not continue, closes the door, or hands the work over.","unrelated":"Thanks, small talk, bot output or content that does not change the state of the pull request."},"state":["comment(3000)","title"],"effect":"clear-waiting-author","since":"2026-09-22","source":"plan 3.7 (quita waiting-author solo con delivered/question)"},{"id":"maintainer_owes_reply","type":"noul","summary":"El comentario deja una pregunta o entrega esperando a que el mantenedor conteste.","instructions":"After this comment, does the maintainer owe the author a reply before the pull request can move?","criteria":{"yes":"The author asked a direct question, delivered what was asked, or is waiting for a decision only the maintainer can make.","no":"The comment needs no answer, is a bot message, or the ball is still on the author's side."},"state":["comment(3000)","title"],"threshold_review":0.6,"effect":"priority","since":"2026-09-22","source":"plan 3.4 (primera respuesta y prioridad p1)"}]}};

// ---- bin/lib/triage-core.mjs (inlineado) ----
const { PR_QUERY, jevMarkerToSignals, normLogin, shape, globToRegex, matchGlob, areasFor, parseCodeowners, ownersFor, codeownerHits, ciStatus, sizeClass, evaluateGates, computePriority, classify, collisions, blocksOthersSet, loadPolicies } = (() => {
// Núcleo puro de triage: sin red, sin gh.mjs. Corre igual en la sesión y en la Action del repo.
// Entrada: snapshot (bin/lib/snapshot.mjs) + políticas (policy/*.json). Salida: estado, labels, prioridad, gates, porqués.


const H = 3600 * 1000;
const hoursSince = (iso, now) => iso ? (now - Date.parse(iso)) / H : Infinity;
const age = (iso, now) => { const h = hoursSince(iso, now); return h >= 48 ? `${Math.floor(h / 24)}d` : `${Math.max(0, Math.floor(h))}h`; };

/** Consulta GraphQL de una PR. Fuente única: snapshot.mjs y la Action (github-src) la importan de aquí. */
const PR_QUERY = `query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){ pullRequest(number:$number){
    number title body author{login} authorAssociation createdAt updatedAt isDraft state
    headRefOid baseRefName headRefName isCrossRepository headRepository{nameWithOwner} mergeable mergeStateStatus maintainerCanModify
    additions deletions changedFiles reviewDecision
    autoMergeRequest{enabledAt mergeMethod}
    mergeQueueEntry{position state}
    labels(first:50){nodes{name}}
    files(first:100){pageInfo{hasNextPage endCursor} nodes{path additions deletions changeType}}
    commits(last:1){nodes{commit{committedDate statusCheckRollup{state contexts(first:100){pageInfo{hasNextPage} nodes{__typename ... on CheckRun{name status conclusion} ... on StatusContext{context state}}}}}}}
    reviews(first:100){pageInfo{hasNextPage} nodes{author{login} state submittedAt body commit{oid}}}
    reviewThreads(first:100){pageInfo{hasNextPage} nodes{isResolved isOutdated comments(first:1){nodes{author{login} createdAt}}}}
    comments(first:100){pageInfo{hasNextPage endCursor} nodes{author{login} body createdAt}}
    timelineItems(last:100, itemTypes:[PULL_REQUEST_COMMIT, HEAD_REF_FORCE_PUSHED_EVENT, LABELED_EVENT, READY_FOR_REVIEW_EVENT]){nodes{__typename
      ... on PullRequestCommit{commit{committedDate author{user{login}}}}
      ... on HeadRefForcePushedEvent{createdAt actor{login}}
      ... on LabeledEvent{createdAt label{name}}
      ... on ReadyForReviewEvent{createdAt}}}
  } } }`;

// ── snapshot: respuesta GraphQL → objeto plano (pura; la usa snapshot.mjs y la Action) ─────
const MARKER = /<!--\s*co:([^\s>]+)\s*--!?>/g; // --!?> : CodeQL js/bad-tag-filter exige aceptar también el cierre --!>
const JEV_META = new Set(['pr', 'sha7', 'v', 'catalogVersion', 'catalog', 'version', 'model', 'ts', 'headSha', 'sha', 'labelsApplied', 'data']);
/**
 * Bloque co:jev (tal como lo devuelve `parseJevMarkers` de github-src/scripts/jev-marker.mjs: {pr, sha7, v, model, domains, labelsApplied, ts})
 * → señales del ledger, una por dominio. Tolera {data:{…}}, {quality:{…}, intent:{…}} y {domain, answers}. answers → {id:{p, value?, confidence?}}.
 */
function jevMarkerToSignals(marker, { headSha = null } = {}) {
  const d = marker.data ? { ...marker, ...marker.data } : marker;
  const catalogVersion = d.v ?? d.catalogVersion ?? d.catalog ?? d.version ?? null;
  const model = d.model ?? null;
  const normA = (answers) => Object.fromEntries(Object.entries(answers || {}).map(([id, v]) => [id, typeof v === 'number' ? { p: v } : { p: v?.p ?? null, ...(v?.value !== undefined ? { value: v.value } : {}), ...(v?.confidence !== undefined ? { confidence: v.confidence } : {}) }]));
  const domains = d.domains ? Object.entries(d.domains) : d.domain ? [[d.domain, d.answers || {}]] : Object.entries(d).filter(([k, v]) => !JEV_META.has(k) && v && typeof v === 'object' && !Array.isArray(v));
  const sha = headSha && marker.sha7 && headSha.startsWith(marker.sha7) ? headSha : (headSha || marker.sha7 || null);
  return domains.map(([domain, answers]) => ({ type: 'signal', source: 'action', domain, pr: marker.pr, headSha: sha, sha7: marker.sha7 || null, catalogVersion, model, markerTs: d.ts ?? null, answers: normA(answers) }));
}
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const normLogin = (login) => String(login || '').replace(/\[bot\]$/, '');
const norm = normLogin;
const maxDate = (arr) => arr.filter(Boolean).sort().at(-1) || null;
const minDate = (arr) => arr.filter(Boolean).sort()[0] || null;
/**
 * @param pr  nodo `pullRequest` de la consulta PR_QUERY de snapshot.mjs (files/comments/reviewThreads ya paginados)
 * @param o   { authorMergedCount, codeqlAlerts, maintainers:[login], parseJev?: (body)=>[...] } (parseJev = parseJevMarkers de github-src/scripts/jev-marker.mjs; sin él, jevMarkers=[])
 */
function shape(pr, { authorMergedCount = null, codeqlAlerts = null, maintainers = [], parseJev = null } = {}) {
  const MAINTAINERS = new Set(maintainers);
  const author = norm(pr.author?.login);
  const isMaintainer = (l) => MAINTAINERS.has(norm(l)) && norm(l) !== author;
  const comments = pr.comments.nodes.map(c => ({ author: norm(c.author?.login), body: c.body || '', createdAt: c.createdAt }));
  const reviews = pr.reviews.nodes.map(r => ({ author: norm(r.author?.login), state: r.state, submittedAt: r.submittedAt, body: r.body || '', commit: r.commit?.oid || null }));
  const threads = pr.reviewThreads.nodes.map(t => ({ isResolved: t.isResolved, isOutdated: t.isOutdated, author: norm(t.comments?.nodes?.[0]?.author?.login), createdAt: t.comments?.nodes?.[0]?.createdAt || null }));
  const cr = new Set(['coderabbitai']);
  const rollup = pr.commits.nodes[0]?.commit?.statusCheckRollup || null;
  const runs = (rollup?.contexts?.nodes || []).map(c => c.__typename === 'CheckRun'
    ? { name: c.name, status: c.status, conclusion: c.conclusion }
    : { name: c.context, status: c.state === 'PENDING' ? 'IN_PROGRESS' : 'COMPLETED', conclusion: c.state });
  const markers = []; const jevMarkers = [];
  for (const b of [...comments.map(c => c.body), ...reviews.map(r => r.body)]) { for (const m of b.matchAll(MARKER)) markers.push(m[1]); if (parseJev) jevMarkers.push(...parseJev(b)); }
  const maint = [...comments.filter(c => isMaintainer(c.author)).map(c => c.createdAt), ...reviews.filter(r => isMaintainer(r.author)).map(r => r.submittedAt)];
  const tl = pr.timelineItems.nodes;
  const authorActs = [
    ...comments.filter(c => c.author === author).map(c => c.createdAt),
    ...tl.filter(t => t.__typename === 'PullRequestCommit').map(t => t.commit?.committedDate),
    ...tl.filter(t => t.__typename === 'HeadRefForcePushedEvent').map(t => t.createdAt),
    ...tl.filter(t => t.__typename === 'ReadyForReviewEvent').map(t => t.createdAt),
  ];
  const labeledAt = {};
  for (const t of tl) if (t.__typename === 'LabeledEvent' && t.label?.name) labeledAt[t.label.name] = t.createdAt;
  const lastCommitAt = maxDate(tl.filter(t => t.__typename === 'PullRequestCommit').map(t => t.commit?.committedDate)) || pr.commits.nodes[0]?.commit?.committedDate || null;
  return {
    number: pr.number, title: pr.title, body: (pr.body || '').replace(EMAIL, '[email]'), author, authorAssociation: pr.authorAssociation,
    createdAt: pr.createdAt, updatedAt: pr.updatedAt, isDraft: pr.isDraft, state: pr.state,
    headSha: pr.headRefOid, baseRef: pr.baseRefName, headRef: pr.headRefName ?? null, isFork: pr.isCrossRepository ?? null, headRepo: pr.headRepository?.nameWithOwner ?? null, mergeable: pr.mergeable, mergeStateStatus: pr.mergeStateStatus, maintainerCanModify: pr.maintainerCanModify,
    autoMerge: pr.autoMergeRequest ? { enabledAt: pr.autoMergeRequest.enabledAt, method: pr.autoMergeRequest.mergeMethod } : null,
    mergeQueue: pr.mergeQueueEntry ? { position: pr.mergeQueueEntry.position, state: pr.mergeQueueEntry.state } : null,
    labels: pr.labels.nodes.map(l => l.name), labeledAt,
    files: pr.files.nodes.map(f => ({ path: f.path, status: f.changeType, additions: f.additions, deletions: f.deletions })),
    additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changedFiles,
    reviewDecision: pr.reviewDecision,
    checks: { state: rollup ? rollup.state : null, runs, truncated: !!rollup?.contexts?.pageInfo?.hasNextPage },
    coderabbit: {
      hasReview: reviews.some(r => cr.has(r.author)) || comments.some(c => cr.has(c.author)),
      changesRequested: reviews.filter(r => cr.has(r.author)).at(-1)?.state === 'CHANGES_REQUESTED',
      unresolvedThreads: threads.filter(t => cr.has(t.author) && !t.isResolved && !t.isOutdated).length,
    },
    reviews: reviews.map(({ body, ...r }) => r),
    unresolvedThreads: threads.filter(t => !t.isResolved && !t.isOutdated).length,
    authorMergedCount: authorMergedCount ?? null,
    codeqlAlerts: codeqlAlerts ?? null,
    lastCommitAt,
    lastAuthorActivityAt: maxDate(authorActs) || pr.createdAt,
    lastMaintainerCommentAt: maxDate(maint),
    firstMaintainerResponseAt: minDate(maint),
    markers, jevMarkers,
    commentCount: comments.length,
  };
}

// ── globs ──────────────────────────────────────────────────────────────────
/** Glob estilo minimatch sin matchBase (como actions/labeler): `*` no cruza `/`, `**` sí. */
function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { i++; if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
const matchGlob = (glob, file) => globToRegex(glob).test(file);

/** Áreas del labeler que toca una lista de ficheros. */
function areasFor(files, areas) {
  const hit = [];
  for (const [area, globs] of Object.entries(areas || {})) {
    if (files.some(f => globs.some(g => matchGlob(g, f)))) hit.push(area);
  }
  return hit;
}

// ── CODEOWNERS ─────────────────────────────────────────────────────────────
/** Reglas [{pattern, owners}] en orden; la última que casa gana. */
function parseCodeowners(text) {
  return String(text || '').split('\n').map(l => l.replace(/#.*$/, '').trim()).filter(Boolean)
    .map(l => { const [pattern, ...owners] = l.split(/\s+/); return { pattern, owners }; });
}
function codeownerRegex(pattern) {
  let p = pattern; let anchored = false, dir = false;
  if (p.startsWith('/')) { anchored = true; p = p.slice(1); }
  if (p.endsWith('/')) { dir = true; p = p.slice(0, -1); }
  if (!anchored && !p.includes('/')) anchored = false; else anchored = true;
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') { if (p[i + 1] === '*') { i++; re += '.*'; } else re += '[^/]*'; }
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const prefix = anchored ? '^' : '^(?:.*/)?';
  const suffix = dir ? '(?:/.*)?$' : '(?:/.*)?$';
  return new RegExp(prefix + re + suffix);
}
function ownersFor(file, rules) {
  let owners = [];
  for (const r of rules) if (codeownerRegex(r.pattern).test(file)) owners = r.owners;
  return owners;
}
/** Patrones (últimos ganadores) cuyo owner incluye `owner`, más extras. */
function codeownerHits(files, rules, owner, extra = []) {
  const extraRules = extra.map(pattern => ({ pattern, owners: [owner] }));
  return files.filter(f => ownersFor(f, [...rules, ...extraRules]).includes(owner));
}

// ── CI ─────────────────────────────────────────────────────────────────────
/** Estado de CI en el headSha: green | red | pending | held (espera aprobación) | absent (sin checks) | stale (sin la matriz actual) | unknown. */
function ciStatus(snapshot, trivialPolicy) {
  const checks = snapshot.checks;
  if (!checks || checks.state === undefined) return { status: 'unknown', why: 'no pude ver los checks' };
  const policyChecks = trivialPolicy?.policyChecks || [];
  const runs = (checks.runs || []).filter(r => !policyChecks.includes(r.name));
  if (checks.state === null && runs.length === 0) return { status: 'absent', why: 'sin checks en el head' };
  const req = trivialPolicy?.requiredChecks || [];
  const held = runs.filter(r => r.conclusion === 'ACTION_REQUIRED');
  if (held.length) return { status: 'held', why: 'CI espera aprobación de un maintainer' };
  const missing = req.filter(n => !runs.some(r => r.name === n));
  if (missing.length) return { status: 'stale', why: `CI antigua en el head: falta ${missing[0]}` };
  const reqRuns = runs.filter(r => req.includes(r.name));
  const red = reqRuns.find(r => r.status === 'COMPLETED' && ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ERROR'].includes(r.conclusion));
  if (red) return { status: 'red', why: `${red.name} en rojo` };
  const informative = trivialPolicy?.informativeChecks || [];
  const anyRed = runs.find(r => r.status === 'COMPLETED' && ['FAILURE', 'TIMED_OUT', 'ERROR'].includes(r.conclusion) && !informative.includes(r.name));
  const pending = reqRuns.find(r => r.status !== 'COMPLETED' || r.conclusion === null || r.conclusion === 'PENDING');
  if (pending) return { status: 'pending', why: `${pending.name} aún corriendo` };
  if (reqRuns.every(r => ['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(r.conclusion))) {
    if (anyRed) return { status: 'red', why: `${anyRed.name} en rojo` };
    return { status: 'green', why: 'matriz completa en verde' };
  }
  return { status: 'unknown', why: 'checks en estado no reconocido' };
}

// ── tamaño / fronteras ─────────────────────────────────────────────────────
function sizeClass(lines, classes) {
  for (const [k, max] of Object.entries(classes)) if (lines < max) return k;
  return 'XL';
}
const lines = (s) => (s.additions || 0) + (s.deletions || 0);
const has = (s, l) => (s.labels || []).includes(l);

// ── gates de merge trivial ─────────────────────────────────────────────────
/**
 * @returns {{gates:[{id,status:'pass'|'fail'|'unknown',why}], pass:boolean}}
 * `sessionCount` = merges triviales ya hechas hoy (ledger); si es null se evalúa `unknown`.
 */
function evaluateGates(snapshot, trivialPolicy, { labelsPolicy, sessionCount = null } = {}) {
  const tp = trivialPolicy; const gates = [];
  const files = (snapshot.files || []).map(f => f.path);
  const g = (id, status, why) => gates.push({ id, status, why });
  const n = lines(snapshot);
  const areas = areasFor(files, labelsPolicy?.areas || {});
  const safeFile = (f) => tp.safePathPrefixes.some(p => f.startsWith(p)) || tp.safeFilePatterns.some(p => matchGlob(p, f) || matchGlob('**/' + p, f));
  const onlySafe = files.length > 0 && files.every(safeFile);
  const onlySafeAreas = files.length > 0 && areas.length > 0 && areas.every(a => tp.safeAreas.includes(a)) && files.every(f => areas.some(a => (labelsPolicy.areas[a] || []).some(gl => matchGlob(gl, f))));
  if (files.length === 0) g('scope', 'unknown', 'no pude ver los ficheros');
  else if (onlySafe || onlySafeAreas) g('scope', 'pass', 'solo docs/i18n/tests');
  else if (n < tp.maxLinesSmall) g('scope', 'pass', `${n} líneas (< ${tp.maxLinesSmall})`);
  else g('scope', 'fail', `${n} líneas y toca código`);

  const ci = ciStatus(snapshot, tp);
  g('ci-green', ci.status === 'green' ? 'pass' : ci.status === 'unknown' ? 'unknown' : 'fail', ci.why);

  g('no-quality-check', has(snapshot, 'quality-check') ? 'fail' : 'pass', has(snapshot, 'quality-check') ? 'CodeRabbit pidió lectura humana' : 'sin quality-check');

  const cr = snapshot.coderabbit;
  if (!cr) g('coderabbit-clean', 'unknown', 'no pude ver CodeRabbit');
  else if (cr.changesRequested) g('coderabbit-clean', 'fail', 'CodeRabbit pidió cambios');
  else if (cr.unresolvedThreads > 0) g('coderabbit-clean', 'fail', `${cr.unresolvedThreads} hilos de CodeRabbit sin resolver`);
  else g('coderabbit-clean', 'pass', cr.hasReview ? 'CodeRabbit sin findings abiertos' : 'CodeRabbit no ha comentado');

  const m = snapshot.authorMergedCount;
  if (m === null || m === undefined) g('author-merged', 'unknown', 'no pude contar merges del autor');
  else g('author-merged', m >= tp.minAuthorMerged ? 'pass' : 'fail', m >= tp.minAuthorMerged ? `autor con ${m} merges previos` : 'primerizo: sin merges previos');

  const rules = tp.codeownersRules?.length ? tp.codeownersRules : (tp.codeowners?.fallbackPatterns || []).map(pattern => ({ pattern, owners: [tp.codeowners.owner] }));
  if (!rules.length) g('no-codeowners', 'unknown', 'sin CODEOWNERS cargado');
  else {
    const hits = codeownerHits(files, rules, tp.codeowners.owner, tp.codeowners.extraPatterns || []);
    g('no-codeowners', hits.length ? 'fail' : 'pass', hits.length ? `${hits[0]} es de ${tp.codeowners.owner}` : 'ningún fichero de Santiago');
  }

  const bad = (snapshot.labels || []).find(l => tp.forbiddenLabels.includes(l) || tp.forbiddenLabelPrefixes.some(p => l.startsWith(p)));
  g('no-blocking-labels', bad ? 'fail' : 'pass', bad ? `lleva ${bad}` : 'sin labels bloqueantes');

  const ms = tp.mergeState;
  if (snapshot.mergeable === null || snapshot.mergeable === undefined || snapshot.mergeable === 'UNKNOWN') g('mergeable', 'unknown', 'GitHub aún no calculó mergeable');
  else if (snapshot.mergeable !== ms.requireMergeable) g('mergeable', 'fail', 'en conflicto con main');
  else {
    const st = snapshot.mergeStateStatus;
    const rejected = ms.reject.includes(st) && !(st === 'BEHIND' && ms.allowBehind) && !(st === 'BLOCKED' && ms.allowBlocked);
    g('mergeable', rejected ? 'fail' : 'pass', rejected ? `mergeStateStatus ${st}` : `mergeable, ${st || 'estado ok'}`);
  }

  g('not-draft', snapshot.isDraft ? 'fail' : 'pass', snapshot.isDraft ? 'es borrador' : 'no es borrador');

  // Checks de política (direction-gate): no son CI del autor, pero un merge trivial nunca pasa con uno en rojo.
  const pc = (snapshot.checks?.runs || []).filter(r => (tp.policyChecks || []).includes(r.name));
  const pcRed = pc.find(r => ['FAILURE', 'TIMED_OUT', 'ERROR', 'ACTION_REQUIRED', 'CANCELLED'].includes(r.conclusion));
  const pcPending = pc.find(r => r.status !== 'COMPLETED' || r.conclusion === null);
  if (pcRed) g('policy-checks', 'fail', `${pcRed.name} en rojo: reserva nuestra`);
  else if (pcPending) g('policy-checks', 'unknown', `${pcPending.name} aún corriendo`);
  else g('policy-checks', 'pass', pc.length ? 'checks de política en verde' : 'sin checks de política en el head');

  if (sessionCount === null || sessionCount === undefined) g('session-cap', 'unknown', 'sin contador de sesión');
  else g('session-cap', sessionCount < tp.sessionCap ? 'pass' : 'fail', `${sessionCount}/${tp.sessionCap} triviales hoy`);

  return { gates, pass: gates.every(x => x.status === 'pass'), failing: gates.filter(x => x.status !== 'pass').map(x => x.id) };
}

// ── prioridad ──────────────────────────────────────────────────────────────
/**
 * @param {object} ctx  { commitments: [{pr,due,status,text}], dependents: number, now, state }
 */
function computePriority(snapshot, priorityPolicy, { commitments = [], dependents = 0, blocksOthers = undefined, now = Date.now(), state = null } = {}) {
  const pp = priorityPolicy;
  const hit = (snapshot.labels || []).find(l => pp.p0.labels.includes(l));
  if (hit) return { priority: 'p0', why: `lleva label ${hit}` };
  if (pp.p0.codeqlOpenAlerts && snapshot.codeqlAlerts > 0) return { priority: 'p0', why: `${snapshot.codeqlAlerts} alertas CodeQL abiertas` };
  const open = commitments.filter(c => Number(c.pr) === Number(snapshot.number) && c.status === 'open' && c.due);
  const soon = open.map(c => ({ ...c, h: (Date.parse(c.due) - now) / H })).sort((a, b) => a.h - b.h)[0];
  if (soon && soon.h <= pp.p1.commitmentDueWithinHours) return { priority: 'p1', why: soon.h < 0 ? `compromiso vencido hace ${age(soon.due, now)}` : `compromiso vence en ${Math.max(1, Math.round(soon.h))}h` };
  const blocks = blocksOthers === undefined ? dependents >= pp.p1.blocksOthersMinDependents : blocksOthers;
  if (blocks) return { priority: 'p1', why: `bloquea ${dependents} PRs por ficheros compartidos` };
  const readyAt = snapshot.labeledAt?.['triage/ready'];
  if (snapshot.authorMergedCount === 0 && has(snapshot, 'triage/ready') && hoursSince(readyAt || snapshot.createdAt, now) > pp.p1.firstTimerReadyHours) return { priority: 'p1', why: `primerizo listo desde hace ${age(readyAt || snapshot.createdAt, now)}` };
  if (pp.p1.reReview && (state === 'triage/re-review' || has(snapshot, 'triage/re-review'))) return { priority: 'p1', why: 'tenía OK y cambió después' };
  return { priority: 'p2', why: 'sin señal de urgencia' };
}

// ── clasificación ──────────────────────────────────────────────────────────
const GATE_SHORT = { scope: 'tamaño', 'ci-green': 'CI', 'no-quality-check': 'quality-check', 'coderabbit-clean': 'CodeRabbit', 'author-merged': 'primerizo', 'no-codeowners': 'CODEOWNERS', 'no-blocking-labels': 'labels', mergeable: 'BEHIND/conflicto', 'not-draft': 'borrador' };
function staleApproval(snapshot, maintainers) {
  const approvals = (snapshot.reviews || []).filter(r => r.state === 'APPROVED' && maintainers.includes(r.author));
  if (!approvals.length) return false;
  const last = approvals.sort((a, b) => (a.submittedAt || '').localeCompare(b.submittedAt || '')).at(-1);
  return !!last.commit && last.commit !== snapshot.headSha;
}

/**
 * Función pura. `extras`: { sessionCount, commitments, dependents, okGiven } (vienen del ledger/colisiones; opcionales).
 */
function classify(snapshot, { labelsPolicy, trivialPolicy, priorityPolicy, now = Date.now(), sessionCount = null, commitments = [], dependents = 0, blocksOthers = undefined, okGiven = false, rebaseManual = new Set(), rebaseClean = new Set() } = {}) {
  const why = [];
  const files = (snapshot.files || []).map(f => f.path);
  const n = lines(snapshot);
  const areas = areasFor(files, labelsPolicy.areas);
  const size = sizeClass(n, priorityPolicy.sizeClasses);
  const ci = ciStatus(snapshot, trivialPolicy);
  const firstTimer = snapshot.authorMergedCount === 0;
  const needsRebase = snapshot.mergeable === 'CONFLICTING' || snapshot.mergeStateStatus === 'DIRTY';
  const needsSplit = n > priorityPolicy.needsSplit.maxLines || areas.length > priorityPolicy.needsSplit.maxAreas;
  // Primerizo: GitHub no crea check-runs para los workflows retenidos, así que el head aparece sin la matriz (stale) o sin checks (absent): es CI retenida.
  const ciHold = firstTimer && (ci.status === 'held' || ci.status === 'absent' || ci.status === 'stale');
  const responded = !!snapshot.lastMaintainerCommentAt || (snapshot.markers || []).length > 0;
  // A un maintainer o a un bot no se le debe primera respuesta (ni disculpa): el sweep de la Action ya los excluye; aquí igual.
  const authorIsMaintainer = (labelsPolicy.maintainers || []).includes(snapshot.author);
  const authorIsBot = Boolean(snapshot.authorIsBot) || (labelsPolicy.bots || []).some(b => b === snapshot.author || b === `${snapshot.author}[bot]`) || /\[bot\]$/.test(String(snapshot.author || ''));
  const firstResponseMissing = !responded && !authorIsMaintainer && !authorIsBot && hoursSince(snapshot.createdAt, now) > priorityPolicy.firstResponseHours;
  const gatesRes = evaluateGates(snapshot, trivialPolicy, { labelsPolicy, sessionCount });
  const trivialCandidate = gatesRes.gates.filter(g => g.id !== 'session-cap').every(g => g.status === 'pass');
  // waiting-author se conserva solo mientras el autor no haya actuado (push/comentario) después de nuestro último
  // comentario o de la puesta del label (labeledAt). Sin ninguna referencia no se conserva: manda la causa objetiva.
  const waitRef = [snapshot.lastMaintainerCommentAt, snapshot.labeledAt?.['triage/waiting-author']].filter(Boolean).sort().at(-1) || null;
  const waitingKept = has(snapshot, 'triage/waiting-author') && !!waitRef && !(snapshot.lastAuthorActivityAt > waitRef);
  const changesRequested = snapshot.reviewDecision === 'CHANGES_REQUESTED';
  const reReview = okGiven || staleApproval(snapshot, labelsPolicy.maintainers);

  let state;
  if (snapshot.isDraft) { state = 'triage/new'; why.push('borrador: no se toca'); }
  else if (needsRebase) {
    state = 'needs-rebase'; const key = `${snapshot.number}@${snapshot.headSha}`;
    // "ours" solo con sondeo limpio (rebase-probe): sin sondeo no se promete nada.
    why.push(rebaseManual.has(key) ? 'conflicto con main; el rebase automático no es limpio: rebase del autor' : !snapshot.maintainerCanModify ? 'conflicto con main; rebase del autor' : rebaseClean.has(key) ? 'conflicto con main; sondeo limpio: podemos arreglarlo nosotros' : 'conflicto con main; permite edits: sondear con rebase-probe');
  }
  else if (ciHold) { state = 'triage/ci-hold'; why.push('primerizo con CI retenida'); }
  else if (needsSplit) { state = 'triage/needs-split'; why.push(n > priorityPolicy.needsSplit.maxLines ? `${n} líneas: pedir troceo` : `toca ${areas.length} áreas: pedir troceo`); }
  else if (waitingKept) { state = 'triage/waiting-author'; why.push('esperando al autor desde nuestro último comentario'); }
  else if (ci.status === 'red') { state = 'triage/waiting-author'; why.push(`CI rojo: ${ci.why}`); }
  else if (changesRequested) { state = 'triage/waiting-author'; why.push('cambios pedidos en revisión'); }
  else if (reReview) { state = 'triage/re-review'; why.push('tenía OK y cambió después'); }
  else if (trivialCandidate) { state = 'triage/trivial'; why.push('pasa todos los gates: merge trivial'); }
  else if (ci.status === 'green') { state = 'triage/ready'; why.push(`CI verde; no trivial: ${gatesRes.failing.filter(f => f !== 'session-cap').map(f => GATE_SHORT[f] || f).slice(0, 3).join(', ') || 'nada'}`); }
  else { state = 'triage/new'; why.push(ci.status === 'pending' ? 'CI aún corriendo' : ci.status === 'held' ? 'CI retenida' : ci.status === 'absent' ? 'sin CI en el head' : ci.status === 'stale' ? 'CI antigua en el head: relanzar' : 'CI ilegible'); }

  const pr = computePriority(snapshot, priorityPolicy, { commitments, dependents, blocksOthers, now, state });
  const current = new Set(snapshot.labels || []);
  const labelsToAdd = []; const labelsToRemove = [];
  const exclusive = (name) => Object.entries(labelsPolicy.labels).filter(([k, v]) => v.exclusive_group === labelsPolicy.labels[name]?.exclusive_group && k !== name).map(([k]) => k);
  const setExclusive = (name) => {
    if (!current.has(name) && !labelsPolicy.labels[name]?.no_label) labelsToAdd.push(name);
    for (const other of exclusive(name)) if (current.has(other) && !labelsPolicy.labels[other]?.read_only && !labelsPolicy.labels[other]?.no_label && labelsPolicy.labels[other]?.exclusive_group !== 'direction') labelsToRemove.push(other);
  };
  setExclusive(state);
  setExclusive(pr.priority);
  if (firstResponseMissing) why.push(`sin respuesta nuestra desde hace ${age(snapshot.createdAt, now)}`);

  return {
    number: snapshot.number, state, priority: pr.priority, priorityWhy: pr.why, why, labelsToAdd, labelsToRemove,
    sizeClass: size, lines: n, areas, trivialCandidate, needsSplit, needsRebase, ciHold, firstResponseMissing, authorIsMaintainer, authorIsBot, dependents, blocksOthers: !!(blocksOthers === undefined ? dependents >= priorityPolicy.p1.blocksOthersMinDependents : blocksOthers),
    ci: ci.status, gates: gatesRes.gates, failingGates: gatesRes.failing, age: age(snapshot.createdAt, now),
  };
}

// ── colisiones (grafo PR↔ficheros) ─────────────────────────────────────────
const READINESS = { 'triage/trivial': 4, 'triage/ready': 3, 'triage/re-review': 3, 'triage/new': 2, 'triage/waiting-author': 1, 'triage/ci-hold': 1, 'triage/needs-split': 0, 'needs-rebase': 0 };
/**
 * @param {Array<{number, files:[{path}], additions, deletions, createdAt, state?, maintainerCanModify}>} prs  (state = estado de triage si se conoce)
 * @returns {{ pairs, blocks: {n:[...]}, dependsOn: {n:[...]}, order:[n], dependents:{n:count} }}
 */
function collisions(prs) {
  const byFile = new Map();
  for (const p of prs) for (const f of (p.files || [])) { const k = f.path; if (!byFile.has(k)) byFile.set(k, new Set()); byFile.get(k).add(p.number); }
  const shared = new Map(); // "a|b" -> [files]
  for (const [file, set] of byFile) {
    const arr = [...set].sort((a, b) => a - b);
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) { const k = `${arr[i]}|${arr[j]}`; if (!shared.has(k)) shared.set(k, []); shared.get(k).push(file); }
  }
  const info = new Map(prs.map(p => [p.number, p]));
  const rank = (p) => READINESS[p.state] ?? 2;
  const sz = (p) => (p.additions || 0) + (p.deletions || 0);
  // A bloquea a B si comparten ficheros y A está más cerca de merge (readiness, luego tamaño menor, luego más antigua).
  const aBeforeB = (a, b) => rank(a) !== rank(b) ? rank(a) > rank(b) : sz(a) !== sz(b) ? sz(a) < sz(b) : (a.createdAt || '') !== (b.createdAt || '') ? (a.createdAt || '') < (b.createdAt || '') : a.number < b.number;
  const blocks = {}, dependsOn = {}; const pairs = [];
  for (const p of prs) { blocks[p.number] = []; dependsOn[p.number] = []; }
  for (const [k, files] of shared) {
    const [a, b] = k.split('|').map(Number); const A = info.get(a), B = info.get(b);
    const first = aBeforeB(A, B) ? a : b, second = first === a ? b : a;
    blocks[first].push(second); dependsOn[second].push(first);
    pairs.push({ a: first, b: second, files: files.sort() });
  }
  const dependents = Object.fromEntries(Object.entries(blocks).map(([n, l]) => [n, l.length]));
  // Orden greedy: primero las que más bloquean y menos dependen; desempate tamaño menor, número menor. Estable.
  const remaining = new Set(prs.map(p => p.number)); const order = [];
  while (remaining.size) {
    let best = null, bestScore = -Infinity;
    for (const n of [...remaining].sort((x, y) => x - y)) {
      const b = blocks[n].filter(x => remaining.has(x)).length, d = dependsOn[n].filter(x => remaining.has(x)).length;
      const score = b - d;
      const p = info.get(n);
      if (score > bestScore || (score === bestScore && best !== null && sz(p) < sz(info.get(best)))) { best = n; bestScore = score; }
    }
    order.push(best); remaining.delete(best);
  }
  pairs.sort((x, y) => x.a - y.a || x.b - y.b);
  return { pairs, blocks, dependsOn, dependents, order };
}

/** PRs que llevan blocks-others: top `blocksOthersTop` por dependientes con al menos `blocksOthersMinDependents`. Orden estable. */
function blocksOthersSet(dependents, priorityPolicy) {
  const { blocksOthersTop = 15, blocksOthersMinDependents = 2 } = priorityPolicy.p1;
  return new Set(Object.entries(dependents).filter(([, d]) => d >= blocksOthersMinDependents).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0])).slice(0, blocksOthersTop).map(([n]) => Number(n)));
}

// ── carga de políticas (fs, sin red) ───────────────────────────────────────
/** Lee policy/*.json y, si hay checkout de career-ops, su CODEOWNERS real; si no, los patrones de respaldo de trivial.json. */
function loadPolicies({ root, checkout = process.env.CO_CHECKOUT || path.join(process.env.HOME || '', 'code', 'career-ops') } = {}) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(root, 'policy', f), 'utf8'));
  const labelsPolicy = read('labels.json'), trivialPolicy = read('trivial.json'), priorityPolicy = read('priority.json');
  const co = trivialPolicy.codeowners || {};
  const file = checkout ? path.join(checkout, co.file || '.github/CODEOWNERS') : null;
  const found = file && fs.existsSync(file);
  trivialPolicy.codeownersRules = found ? parseCodeowners(fs.readFileSync(file, 'utf8')) : [];
  trivialPolicy.codeownersSource = found ? file : 'policy/trivial.json#codeowners.fallbackPatterns';
  return { labelsPolicy, trivialPolicy, priorityPolicy };
}
return { PR_QUERY, jevMarkerToSignals, normLogin, shape, globToRegex, matchGlob, areasFor, parseCodeowners, ownersFor, codeownerHits, ciStatus, sizeClass, evaluateGates, computePriority, classify, collisions, blocksOthersSet, loadPolicies };
})();

// ---- github-src/scripts/jev-marker.mjs (inlineado) ----
const { JEV_MARKER_RE, MAX_COMMENT_BYTES_JEV, round2, buildJevMarker, parseJevMarkers, parseJevMarker, upsertJevMarker } = (() => {
// Señal de Jev persistida en la PR como bloque oculto dentro del comentario de primera respuesta:
//   <!-- co:jev:<pr>:<sha7> {"v":"…","model":"…","domains":{…},"labelsApplied":[…],"ts":"…"} -->
// Un bloque por sha7 (se reemplaza, nunca se duplica); números a 2 decimales; comentario ≤ 60 KB.
// Lo usan la Action (github-src/scripts/triage.mjs, inlineado en el bundle) y la sesión (import directo).

const JEV_MARKER_RE = /<!--\s*co:jev:(\d+):([0-9a-f]{7})\s+(\{[\s\S]*?\})\s*--!?>/g; // `--!?>`: CodeQL js/bad-tag-filter
const MAX_COMMENT_BYTES_JEV = 60 * 1024;

/** Redondea todo número a 2 decimales, recursivamente. */
function round2(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v * 100) / 100;
  if (Array.isArray(v)) return v.map(round2);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round2(x)]));
  return v;
}
function buildJevMarker(pr, sha7, payload) {
  const json = JSON.stringify(round2(payload)).replace(/--!?>/g, (m) => m.slice(0, -1) + '\\u003e'); // "-->" y "--!>" dentro del JSON cerrarían el comentario (CodeQL js/bad-tag-filter); \u003e es un escape JSON válido
  return `<!-- co:jev:${pr}:${sha7} ${json} -->`;
}
/** Todos los bloques del cuerpo, en orden: [{pr, sha7, ...payload}]. Un JSON corrupto se salta. */
function parseJevMarkers(body) {
  const out = [];
  for (const m of String(body || '').matchAll(JEV_MARKER_RE)) {
    try { out.push({ pr: Number(m[1]), sha7: m[2], ...JSON.parse(m[3]) }); } catch { /* corrupto: se ignora */ }
  }
  return out;
}
/** El último bloque (señal más reciente) o null. Con `sha7`, el de ese sha o null. */
function parseJevMarker(body, sha7 = null) {
  const all = parseJevMarkers(body);
  return sha7 ? all.find((b) => b.sha7 === sha7) || null : all.at(-1) || null;
}
/** Inserta o reemplaza el bloque de ese sha7 al final del cuerpo. Si no cabe en 60 KB, quita los bloques más antiguos. */
function upsertJevMarker(body, pr, sha7, payload) {
  const block = buildJevMarker(pr, sha7, payload);
  const own = new RegExp(`\\n*<!--\\s*co:jev:${pr}:${sha7}\\s+\\{[\\s\\S]*?\\}\\s*--!?>`, 'g');
  let out = String(body || '').replace(own, '').replace(/\s+$/, '') + `\n\n${block}`;
  for (;;) {
    if (Buffer.byteLength(out) <= MAX_COMMENT_BYTES_JEV) return out;
    const oldest = [...out.matchAll(JEV_MARKER_RE)].find((m) => m[2] !== sha7);
    if (!oldest) throw new Error(`bloque jev de #${pr} supera 60 KB (${MAX_COMMENT_BYTES_JEV} bytes) por sí solo`);
    out = out.replace(oldest[0], '').replace(/\n{3,}/g, '\n\n');
  }
}
return { JEV_MARKER_RE, MAX_COMMENT_BYTES_JEV, round2, buildJevMarker, parseJevMarkers, parseJevMarker, upsertJevMarker };
})();

// ---- github-src/scripts/triage.mjs (sin dev-only) ----
// pr-triage: wrapper de Action alrededor de `classify(snapshot, {labelsPolicy, trivialPolicy, priorityPolicy, now})`
// (bin/lib/triage-core.mjs, función pura). Este fichero es la FUENTE; `build.mjs` genera `triage.bundle.mjs`
// (core + policy/*.json inlineados, sin imports externos) que es lo que se copia a .github/scripts/ del repo.
//
// Qué hace: lee el evento (GITHUB_EVENT_PATH), construye el snapshot de la PR con la MISMA query GraphQL que
// bin/lib/snapshot.mjs (fetch nativo, token GITHUB_TOKEN), llama a `classify`, aplica los labels de estado y
// publica la primera respuesta con marcador `<!-- co:first-reply:N:sha7 -->` (se busca antes: nunca duplica).
// En `schedule` hace el sweep: (1) PRs abiertas >20h y ≤TRIAGE_BACKLOG_HOURS sin comentario de maintainer ni marcador
// reciben labels + primera respuesta; (2) las más viejas (backlog) reciben labels + la misma primera respuesta con una disculpa
// por la espera y sin fechas (S18: el acuse es del bot, nunca de la cuenta de un maintainer); (3) las pegadas en
// `triage/new` >1h se re-triagean (la CI ya acabó).
// En `workflow_run` (Tests completada) re-triagea la PR de ese head: la label `triage/new` promete "en el siguiente sweep"
// y aquí no hay sweep hasta 6h después.
//
// Qué NO hace: prioridad (p0/p1/p2), direction/* ni maintainer-commitment. La prioridad necesita ledger
// (compromisos) y colisiones, que solo tiene la sesión; si la Action la recalculara sin eso, degradaría p1.
// Toca labels con who_sets/who_clears = "action" en policy/labels.json, más `triage/waiting-author` cuando
// classify la propone por señal objetiva (CHANGES_REQUESTED de un maintainer o CI en rojo): decisión del lead.
//
// Env: GITHUB_TOKEN · GITHUB_REPOSITORY · GITHUB_EVENT_NAME · GITHUB_EVENT_PATH
//      DRY_RUN=true → no escribe en GitHub; solo GITHUB_STEP_SUMMARY
//      JEV_API_KEY opcional → snapshot.signals con los catálogos PÚBLICOS quality (siempre) e intent (en issue_comment),
//        inlineados por build.mjs desde policy/jev/*.yaml (nunca direction.yaml). Sin clave o con fallo: null (`jev:unavailable`).
//        La señal se persiste en la PR como bloque oculto `<!-- co:jev:N:sha7 {…} -->` dentro del comentario de
//        primera respuesta (editándolo: sin entradas nuevas en el timeline; un bloque por sha7). Sin primera
//        respuesta (bot/borrador) no se crea comentario: la señal queda solo en el job summary.
//      TRIAGE_SWEEP_MAX (60) → tope de primeras respuestas por sweep (evita bombardeo y el rate limit de 1000 req/h)
//      TRIAGE_BACKLOG_HOURS (72) → a partir de esa edad la primera respuesta lleva la disculpa por la espera (backlogReply)
//      TRIAGE_RETRIAGE_MAX (30) → tope de re-triages (backlog + triage/new pegadas) por sweep
//      CODEOWNERS_PATH (.github/CODEOWNERS) → reglas reales para el gate no-codeowners (checkout de la base)


const MARKER_SLUG = 'first-reply';
const JEV_MODEL = 'jev-1.13.0';
const SWEEP_HOURS = 20;
const BACKLOG_HOURS = Number(process.env.TRIAGE_BACKLOG_HOURS || 72);
const STUCK_HOURS = 1; // triage/new más vieja que esto y sin evento: la CI acabó y nadie la reclasificó
const MAX_COMMENT_BYTES = 1600;
const DEFAULT_FIRST_REPLY = [
  'Thanks for the PR: it is in the queue and a maintainer will read it by hand.',
  '',
  'What happens next:',
  '- The `triage/*` label tells you where it stands. It is ours to move, not yours to worry about.',
  '- If we need something from you, it will be a concrete list, not a vague "please fix".',
  '- Nothing here gets closed by a bot.',
  '',
  'CONTRIBUTING.md has the rest. Thanks for the time you put into this.',
].join('\n');
/** Primera respuesta a una PR que esperó más de TRIAGE_BACKLOG_HOURS: la misma, con la disculpa delante. Sin fechas: el bot
 *  no puede registrar un compromiso, y el manifiesto no deja prometer lo que no se registra. */
export function backlogReply(days) {
  return [
    `Thanks for the PR, and sorry for the wait: it went ${days} days without a reply from us. That is on us, not on you.`,
    '',
    'It is in the queue and a maintainer will read it by hand. What happens next:',
    '- The `triage/*` label tells you where it stands. It is ours to move, not yours to worry about.',
    '- If we need something from you, it will be a concrete list, not a vague "please fix".',
    '- Nothing here gets closed by a bot.',
    '',
    'CONTRIBUTING.md has the rest. Thanks for the time you put into this, and for your patience.',
  ].join('\n');
}

// ---------- GitHub (fetch nativo, sin dependencias) ----------
const API = 'https://api.github.com';
const REPO = process.env.GITHUB_REPOSITORY || '';
const [OWNER, NAME] = REPO.split('/');
const TOKEN = process.env.GITHUB_TOKEN;
const DRY = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '');
const summaryLines = [];
function log(line) { summaryLines.push(line); process.stdout.write(line + '\n'); }
const headers = (extra = {}) => ({ authorization: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'career-ops-pr-triage', ...extra });

async function rest(method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : `${API}/${url.replace(/^\//, '')}`, { method, headers: headers(body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
async function graphql(query, variables = {}) {
  const res = await fetch(`${API}/graphql`, { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify({ query, variables }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors?.length) throw new Error(`graphql → ${res.status}: ${(json.errors || []).map((e) => e.message).join('; ') || 'sin detalle'}`.slice(0, 300));
  return json.data;
}
async function write(method, url, body, what) {
  if (DRY) { log(`DRY-RUN ${what}: ${method} ${url} ${body ? JSON.stringify(body).slice(0, 160) : ''}`); return null; }
  const r = await rest(method, url, body); log(`hecho ${what}`); return r;
}

// ---------- Snapshot (misma query que bin/lib/snapshot.mjs; la forma la da shape() del core) ----------
const norm = (login) => String(login || '').replace(/\[bot\]$/, '');
const isBotLogin = (login) => /\[bot\]$/.test(login || '') || (POLICIES.labels.bots || []).includes(norm(login));
const sha7 = (s) => String(s || '').slice(0, 7);
const marker = (pr, sha) => `<!-- co:${MARKER_SLUG}:${pr}:${sha7(sha)} -->`;

// PR_QUERY viene de triage-core.mjs (la misma que bin/lib/snapshot.mjs): una sola query, una sola forma.
const MORE = (field, sel) => `query($owner:String!,$name:String!,$number:Int!,$after:String){ repository(owner:$owner,name:$name){ pullRequest(number:$number){ ${field}(first:100, after:$after){pageInfo{hasNextPage endCursor} nodes{${sel}}} } } }`;
async function pageRest(field, sel, number, after) {
  const out = [];
  while (after) {
    const d = await graphql(MORE(field, sel), { owner: OWNER, name: NAME, number, after });
    const c = d.repository.pullRequest[field]; out.push(...c.nodes); after = c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null;
  }
  return out;
}
async function mergedCount(login) {
  try { const d = await graphql(`query($q:String!){ search(query:$q, type:ISSUE, first:1){ issueCount } }`, { q: `repo:${REPO} is:pr is:merged author:${login}` }); return d.search.issueCount; }
  catch (e) { log(`merges de ${login}: no pude contar (${e.message.slice(0, 60)})`); return null; }
}
// ---------- Jev (misma API y mismo recorte de estado que bin/lib/jev.mjs; solo catálogos públicos) ----------
const JEV_ENDPOINT = process.env.JEV_URL || 'https://api.typesafe.ai/v1/systemone';
const JEV_API_MODEL = 'jev-latest';
function jevStateText(state, spec) {
  const parts = [];
  for (const s of spec) {
    const m = /^([a-zA-Z][a-zA-Z0-9_]*)(?:\((\d+)\))?$/.exec(s); if (!m) continue;
    const key = m[1], n = m[2] ? Number(m[2]) : null;
    let v;
    if (key === 'diffHead') continue; // la Action no descarga el diff
    else if (key === 'files') v = Array.isArray(state.files) ? `${state.files.length} files:\n` + state.files.slice(0, n ?? 200).map((f) => `${f.path}${f.status && f.status !== 'MODIFIED' ? ` [${String(f.status).toLowerCase()}]` : ''}${f.additions != null ? ` (+${f.additions}/-${f.deletions ?? 0})` : ''}`).join('\n') : null;
    else v = state[key];
    if (v == null || v === '') continue;
    v = typeof v === 'string' ? v : JSON.stringify(v);
    if (n && key !== 'files' && v.length > n) v = v.slice(0, n) + ' […]';
    parts.push(`${key.toUpperCase()}:\n${v}`);
  }
  return parts.join('\n\n').slice(0, 24000 * 4);
}
function jevApiQuestion(q) {
  const base = { type: q.type, instructions: q.instructions };
  if (q.type === 'noul' && q.criteria) base.instructions += `\nAnswer YES when: ${q.criteria.yes}\nAnswer NO when: ${q.criteria.no}`;
  if (q.type === 'choice') base.criteria = q.criteria;
  if (q.type === 'score') base.criteria = q.scale;
  return base;
}
/** Normaliza una respuesta cruda a {p, value?, confidence?} (noul = número p). Formato jev-1.13.0, ver bin/lib/jev.mjs. */
export function jevAnswer(q, raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (q.type === 'noul') return typeof raw.noul === 'number' ? Math.max(0, Math.min(1, raw.noul)) : null;
  const probs = raw.probabilities && typeof raw.probabilities === 'object' ? raw.probabilities : null;
  if (q.type === 'choice') { if (!Object.hasOwn(q.criteria || {}, raw.choice)) return null; const p = probs && Number.isFinite(Number(probs[raw.choice])) ? Number(probs[raw.choice]) : Number(raw.confidence ?? 0); return { p, value: raw.choice, confidence: Number(raw.confidence ?? 0) }; }
  const score = Number(raw.score); if (!Number.isFinite(score)) return null;
  return { p: probs && Number.isFinite(Number(probs[Math.round(score)])) ? Number(probs[Math.round(score)]) : Number(raw.confidence ?? 0), value: Math.round(score), score, confidence: Number(raw.confidence ?? 0) };
}
async function askJev(domain, state, key) {
  const cat = JEV_CATALOG[domain]; if (!cat) return null;
  const today = new Date().toISOString().slice(0, 10);
  const qs = (cat.questions || []).filter((q) => !q.until || q.until > today);
  const groups = new Map();
  for (const q of qs) { const k = (q.state || cat.state_default).join('+'); if (!groups.has(k)) groups.set(k, { spec: q.state || cat.state_default, questions: [] }); groups.get(k).questions.push(q); }
  const answers = {}; let model = null;
  for (const g of groups.values()) {
    const req = { model: JEV_API_MODEL, state: jevStateText(state, g.spec), questions: Object.fromEntries(g.questions.map((q) => [q.id, jevApiQuestion(q)])) };
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(JEV_ENDPOINT, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(req), signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
      const json = await res.json(); model = json.model || model;
      for (const q of g.questions) { const a = jevAnswer(q, json.answers?.[q.id]); if (a !== null) answers[q.id] = a; }
    } finally { clearTimeout(t); }
  }
  return { version: cat.version, model, answers };
}
/** { v, model, domains: { quality: {...}, intent?: {...} } } o null (sin clave o fallo: `jev:unavailable`). */
async function collectSignals(snapshot, { comment = null } = {}) {
  const key = process.env.JEV_API_KEY;
  if (!key) return null;
  try {
    const domains = {}; const versions = []; let model = null;
    const q = await askJev('quality', { title: snapshot.title, body: snapshot.body, files: snapshot.files }, key);
    if (q) { domains.quality = q.answers; versions.push(`quality@${q.version}`); model = q.model || model; }
    if (comment) { const i = await askJev('intent', { comment, title: snapshot.title }, key); if (i) { domains.intent = i.answers; versions.push(`intent@${i.version}`); model = i.model || model; } }
    return { v: versions.join(','), model: model || JEV_MODEL, domains };
  } catch (e) { log(`jev #${snapshot.number}: unavailable (${e.message.slice(0, 80)})`); return null; }
}
export async function buildSnapshot(number) {
  const d = await graphql(PR_QUERY, { owner: OWNER, name: NAME, number });
  const pr = d.repository?.pullRequest;
  if (!pr) throw new Error(`PR #${number} no existe`);
  if (pr.files.pageInfo.hasNextPage) pr.files.nodes.push(...await pageRest('files', 'path additions deletions changeType', number, pr.files.pageInfo.endCursor));
  if (pr.comments.pageInfo.hasNextPage) pr.comments.nodes.push(...await pageRest('comments', 'author{login} body createdAt', number, pr.comments.pageInfo.endCursor));
  // shape() viene de triage-core.mjs (la misma que usa bin/lib/snapshot.mjs): una sola forma de snapshot.
  const snap = shape(pr, { authorMergedCount: await mergedCount(norm(pr.author?.login)), maintainers: POLICIES.labels.maintainers || [], parseJev: parseJevMarkers });
  snap.authorIsBot = pr.author?.__typename === 'Bot' || isBotLogin(pr.author?.login);
  snap.authorIsMaintainer = (POLICIES.labels.maintainers || []).includes(norm(pr.author?.login)); // a un maintainer no se le da primera respuesta
  snap.signals = null; // se rellena en triageOne (necesita el comentario del evento, si lo hay)
  return snap;
}

// ---------- Predicados puros (testeables) ----------
export function needsFirstReply(snapshot) {
  const marked = (snapshot.markers || []).some((m) => m.startsWith(`${MARKER_SLUG}:`));
  const maintainerSpoke = !!snapshot.lastMaintainerCommentAt;
  // Borradores: la primera respuesta llega en ready_for_review, no antes (mod-core: "borrador: no se toca").
  return { needs: !marked && !maintainerSpoke && !snapshot.authorIsBot && !snapshot.authorIsMaintainer && !snapshot.isDraft, marked, maintainerSpoke, draft: !!snapshot.isDraft, maintainer: !!snapshot.authorIsMaintainer };
}
/** La Action toca labels cuyo who_sets (añadir) / who_clears (quitar) sea "action", más ACTION_MAY_ALSO_SET. */
export const ACTION_MAY_ALSO_SET = new Set(['triage/waiting-author']);
export function planLabels(current, result, labelsPolicy) {
  const L = labelsPolicy.labels || {};
  const add = (result.labelsToAdd || []).filter((l) => !current.includes(l) && (L[l]?.who_sets === 'action' || (ACTION_MAY_ALSO_SET.has(l) && L[l] && !L[l].read_only)));
  const remove = (result.labelsToRemove || []).filter((l) => current.includes(l) && L[l]?.who_clears === 'action' && !L[l]?.read_only);
  return { add, remove };
}
export function policiesForAction({ codeownersText = null } = {}) {
  const trivialPolicy = { ...POLICIES.trivial };
  trivialPolicy.codeownersRules = codeownersText ? parseCodeowners(codeownersText) : [];
  return { labelsPolicy: POLICIES.labels, trivialPolicy, priorityPolicy: POLICIES.priority };
}

/** Payload del bloque co:jev a partir de snapshot.signals (forma libre de Jev: {v|catalogVersion, model, domains|<dominio>: {...}}). */
export function jevPayload(signals, labelsApplied, now = Date.now()) {
  if (!signals || typeof signals !== 'object') return null;
  const { v, catalogVersion, model, domains, ...rest } = signals;
  return { v: String(v || catalogVersion || 'unknown'), model: String(model || JEV_MODEL), domains: domains || rest, labelsApplied, ts: new Date(now).toISOString() };
}
async function persistJev(number, sha7v, payload) {
  const comments = []; let page = 1;
  for (;;) { const c = await rest('GET', `repos/${REPO}/issues/${number}/comments?per_page=100&page=${page++}`); comments.push(...c); if (c.length < 100) break; }
  const first = comments.find((c) => new RegExp(`<!--\\s*co:${MARKER_SLUG}:`).test(c.body || ''));
  if (!first) { log(`#${number}: señal jev solo en summary (sin primera respuesta)`); return; }
  const body = upsertJevMarker(first.body, number, sha7v, payload);
  if (body === first.body) { log(`#${number}: bloque jev ya al día`); return; }
  await write('PATCH', `repos/${REPO}/issues/comments/${first.id}`, { body }, `bloque jev en primera respuesta #${number}`);
}

// ---------- Aplicar ----------
let policies = null;
function loadPoliciesOnce() {
  if (policies) return policies;
  const p = process.env.CODEOWNERS_PATH || '.github/CODEOWNERS';
  const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  if (!text) log(`sin ${p}: gate no-codeowners con patrones de respaldo`);
  return (policies = policiesForAction({ codeownersText: text }));
}
async function triageOne(number, { now, firstReply, backlog = false, since = null, comment = null }) {
  const snapshot = await buildSnapshot(number);
  if (snapshot.state !== 'OPEN') { log(`#${number}: ${snapshot.state.toLowerCase()}, nada que hacer`); return; }
  snapshot.signals = await collectSignals(snapshot, { comment });
  const result = classify(snapshot, { ...loadPoliciesOnce(), now });
  const { add, remove } = planLabels(snapshot.labels, result, POLICIES.labels);
  log(`#${number}: ${result.state} : ${result.why[0] || 'sin porqué'}`);
  if (add.length) await write('POST', `repos/${REPO}/issues/${number}/labels`, { labels: add }, `labels +${add.join(',')} #${number}`);
  for (const l of remove) await write('DELETE', `repos/${REPO}/issues/${number}/labels/${encodeURIComponent(l)}`, null, `label -${l} #${number}`);
  const jev = jevPayload(snapshot.signals, add, now);
  if (jev) log(`#${number}: jev ${JSON.stringify(jev.domains).slice(0, 200)}`);
  const fr = needsFirstReply(snapshot);
  if (firstReply && fr.needs) {
    const days = Math.max(1, Math.floor((now - (since || new Date(snapshot.createdAt))) / 864e5));
    let body = `${backlog ? backlogReply(days) : DEFAULT_FIRST_REPLY}\n\n${marker(number, snapshot.headSha)}`;
    if (jev) body = upsertJevMarker(body, number, sha7(snapshot.headSha), jev);
    if (Buffer.byteLength(body) > MAX_COMMENT_BYTES && !jev) throw new Error(`primera respuesta #${number} supera ${MAX_COMMENT_BYTES} bytes`);
    await write('POST', `repos/${REPO}/issues/${number}/comments`, { body }, `primera respuesta #${number}`);
    return true; // publicada: cuenta para el tope del sweep
  }
  if (firstReply) log(`#${number}: sin primera respuesta (${fr.marked ? 'ya tiene marcador' : fr.maintainerSpoke ? 'ya habló un maintainer' : fr.draft ? 'borrador' : fr.maintainer ? 'autor maintainer' : 'autor bot'})`);
  if (jev && fr.marked) await persistJev(number, sha7(snapshot.headSha), jev);
}

const SWEEP_QUERY = `query($owner:String!,$name:String!,$after:String){ repository(owner:$owner,name:$name){
  pullRequests(states:OPEN, first:50, after:$after, orderBy:{field:CREATED_AT, direction:ASC}){ pageInfo{hasNextPage endCursor}
    nodes{ number createdAt updatedAt isDraft author{login __typename} labels(first:30){nodes{name}} comments(first:100){nodes{author{login} body}} reviews(first:50){nodes{author{login}}} timelineItems(itemTypes:[READY_FOR_REVIEW_EVENT], last:1){nodes{... on ReadyForReviewEvent{createdAt}}} } } } }`;
/** Desde cuándo espera una PR a un maintainer: su creación o, si fue borrador, su último ready_for_review (un borrador no espera
 *  a nadie: la disculpa del backlog no puede contar esos días). */
export const waitingSince = (p) => Math.max(Date.parse(p.createdAt) || 0, Date.parse(p.timelineItems?.nodes?.[0]?.createdAt || '') || 0);
/** Orden de primeras respuestas con hueco para el backlog: las recientes hasta max - reserva, el backlog entero, el resto de recientes. */
export function backlogFirstOrder(reply, backlog, max) {
  const reserve = Math.min(backlog.length, Math.ceil(max / 3));
  const r = reply.map((p) => ({ p, backlog: false })), b = backlog.map((p) => ({ p, backlog: true }));
  return [...r.slice(0, Math.max(0, max - reserve)), ...b, ...r.slice(Math.max(0, max - reserve))];
}
export function sweepCandidates(prs, now, labelsPolicy = POLICIES.labels) {
  const maintainers = new Set(labelsPolicy.maintainers || []);
  return prs.filter((p) => {
    if (p.isDraft || (now - waitingSince(p)) / 36e5 <= SWEEP_HOURS) return false;
    if (p.author?.__typename === 'Bot' || isBotLogin(p.author?.login)) return false;
    const author = norm(p.author?.login);
    const spoke = [...p.comments.nodes, ...p.reviews.nodes].some((c) => maintainers.has(norm(c.author?.login)) && norm(c.author?.login) !== author);
    const marked = p.comments.nodes.some((c) => new RegExp(`<!--\\s*co:${MARKER_SLUG}:`).test(c.body || ''));
    return !spoke && !marked;
  });
}
/** Plan del sweep, puro. reply: sin respuesta y ≤backlogHours (labels + primera respuesta) · backlog: sin respuesta y más viejas
 *  (labels + primera respuesta con disculpa, backlogReply) · stuck: `triage/new` sin tocar >stuckHours (la CI acabó, reclasificar). */
export function sweepPlan(prs, now, labelsPolicy = POLICIES.labels, { backlogHours = BACKLOG_HOURS, stuckHours = STUCK_HOURS } = {}) {
  const cands = sweepCandidates(prs, now, labelsPolicy);
  const age = (p) => (now - waitingSince(p)) / 36e5;
  const reply = cands.filter((p) => age(p) <= backlogHours), backlog = cands.filter((p) => age(p) > backlogHours);
  const seen = new Set(cands.map((p) => p.number));
  const stuck = prs.filter((p) => !p.isDraft && !seen.has(p.number) && (p.labels?.nodes || []).some((l) => l.name === 'triage/new') && (now - new Date(p.updatedAt || p.createdAt)) / 36e5 > stuckHours);
  return { reply, backlog, stuck };
}
async function sweep(now) {
  const max = Number(process.env.TRIAGE_SWEEP_MAX || 60), maxRe = Number(process.env.TRIAGE_RETRIAGE_MAX || 30);
  const all = []; let after = null;
  do {
    const d = await graphql(SWEEP_QUERY, { owner: OWNER, name: NAME, after });
    const c = d.repository.pullRequests; all.push(...c.nodes); after = c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null;
  } while (after);
  const { reply, backlog, stuck } = sweepPlan(all, now);
  log(`sweep: ${all.length} abiertas · ${reply.length} sin respuesta >${SWEEP_HOURS}h y ≤${BACKLOG_HOURS}h (tope ${max}) · ${backlog.length} en backlog >${BACKLOG_HOURS}h (con disculpa) · ${stuck.length} pegadas en triage/new (tope ${maxRe} re-triages)`);
  let done = 0, re = 0;
  // Tope por pasada con un hueco reservado para el backlog (un tercio), para que las viejas no se queden sin acuse si siempre hay
  // recientes: primero las recientes hasta su parte, luego el backlog de la más vieja a la más nueva, y el hueco sobrante, a las recientes.
  const firsts = backlogFirstOrder(reply, backlog, max);
  for (const [i, { p, backlog: late }] of firsts.entries()) {
    if (done >= max) { log(`sweep: tope ${max} alcanzado, quedan ${firsts.length - i} para la próxima pasada`); break; }
    try { if (await triageOne(p.number, { now, firstReply: true, backlog: late, since: waitingSince(p) })) done++; } // solo cuenta lo publicado
    catch (e) { log(`#${p.number}: fallo (${e.message.slice(0, 120)})`); }
  }
  for (const p of stuck) {
    if (re >= maxRe) { log(`sweep: tope ${maxRe} re-triages alcanzado`); break; }
    try { await triageOne(p.number, { now, firstReply: false }); re++; }
    catch (e) { log(`#${p.number}: fallo (${e.message.slice(0, 120)})`); }
  }
  log(`sweep: ${done} primeras respuestas · ${re} re-triages`);
}

/** PRs abiertas de un workflow_run. El payload trae `pull_requests` solo para ramas del propio repo y `commits/{sha}/pulls`
 *  devuelve [] para commits de fork: se busca por head `owner:rama` (viene en el payload) y, si no, por `sha:` en search.
 *  Un run de la rama por defecto (push a main) no es una PR: nada. `fetchPulls(run)` → [{number, state, headSha}]. */
export async function prsFromWorkflowRun(event, fetchPulls, { defaultBranch = 'main' } = {}) {
  const run = event.workflow_run || {};
  if (!run.head_sha || run.head_branch === defaultBranch) return [];
  let list = (run.pull_requests || []).map((p) => ({ number: p.number, state: 'open', headSha: p.head?.sha || run.head_sha }));
  if (!list.length) list = (await fetchPulls(run)) || [];
  const open = list.filter((p) => p.state === 'open');
  const numbers = [...new Set(open.filter((p) => !p.headSha || p.headSha === run.head_sha).map((p) => p.number))];
  // head desfasado: la PR recibió un push después de este run; su run nuevo llegará solo (no es "sin PR")
  const superseded = open.filter((p) => p.headSha && p.headSha !== run.head_sha && !numbers.includes(p.number)).map((p) => ({ number: p.number, headSha: p.headSha }));
  return Object.assign(numbers, { superseded });
}
async function pullsForRun(run) {
  const owner = run.head_repository?.owner?.login, branch = run.head_branch;
  if (owner && branch) {
    const byHead = await rest('GET', `repos/${REPO}/pulls?state=open&per_page=20&head=${encodeURIComponent(`${owner}:${branch}`)}`);
    const list = (byHead || []).map((p) => ({ number: p.number, state: p.state, headSha: p.head?.sha }));
    if (list.length) return list;
  }
  const s = await rest('GET', `search/issues?q=${encodeURIComponent(`repo:${REPO} is:pr is:open sha:${run.head_sha}`)}`);
  return (s?.items || []).map((i) => ({ number: i.number, state: i.state, headSha: null }));
}

async function main() {
  if (!TOKEN || !REPO) throw new Error('faltan GITHUB_TOKEN o GITHUB_REPOSITORY');
  const now = Date.now();
  const eventName = process.env.GITHUB_EVENT_NAME;
  const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
  log(`pr-triage ${eventName}${DRY ? ' (DRY_RUN: no escribe en GitHub)' : ''}`);
  if (eventName === 'schedule' || eventName === 'workflow_dispatch') await sweep(now);
  else if (eventName === 'workflow_run') { // Tests completada: reclasificar (triage/new → ready/trivial/waiting-author) sin esperar al sweep
    const nums = await prsFromWorkflowRun(event, pullsForRun);
    if (!nums.length) {
      const sup = nums.superseded || [];
      log(sup.length ? `workflow_run ${String(event.workflow_run?.head_sha).slice(0, 7)}: ${sup.map((p) => `PR #${p.number} con head más nuevo (${p.headSha.slice(0, 7)})`).join(', ')}: se espera su run` : `workflow_run ${event.workflow_run?.head_sha?.slice(0, 7) || '?'} (${event.workflow_run?.head_repository?.full_name || '?'}:${event.workflow_run?.head_branch || '?'}): sin PR abierta, nada`);
      return;
    }
    for (const n of nums) await triageOne(n, { now, firstReply: false });
  }
  else if (eventName === 'pull_request_target') await triageOne(event.pull_request.number, { now, firstReply: ['opened', 'ready_for_review'].includes(event.action) });
  else if (eventName === 'issue_comment') {
    if (!event.issue?.pull_request) { log('comentario en issue, no en PR: nada'); return; }
    if (event.comment?.user?.type === 'Bot' || isBotLogin(event.comment?.user?.login)) { log('comentario de bot: nada'); return; }
    await triageOne(event.issue.number, { now, firstReply: false, comment: event.comment?.body || null });
  } else log(`evento ${eventName} no gestionado`);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().then(() => {
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### pr-triage\n\n${summaryLines.map((l) => `- ${l}`).join('\n')}\n`);
  }).catch((e) => { process.stderr.write(`pr-triage: ${e.message}\n`); process.exit(1); });
}
