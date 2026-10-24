/**
 * lib/update-manifest.mjs — the system layer the updater ships (#5554).
 *
 * `node update-system.mjs apply` checks out exactly these paths from upstream
 * and nothing else. A PR that adds a file every install should receive (a
 * script, a mode, a provider, a doc) must add that file's entry here. A
 * trailing `/` makes an entry a directory prefix; every other entry names one
 * file.
 *
 * The updater READS this file; it does not import it. update-system.mjs must
 * stay self-loading (#1706): a pre-#1245 client re-execs the new updater with
 * only update-system.mjs checked out, so a static import of this module would
 * crash that upgrade before it starts. Instead the updater extracts the array
 * below from source with extractArrayFromSource(), the same parser it uses on
 * the TARGET release's manifest and on a rollback's backup ref. Keep the
 * declaration in that shape:
 *
 *   - one exported SYSTEM_PATHS array literal, closed by a bracket and a
 *     semicolon, holding quoted string literals only: no spread, no template
 *     literals, no computed entries, and no bracket-semicolon inside an entry;
 *   - comments anywhere (the parser blanks them first);
 *   - no imports in this file, so it loads wherever it is read.
 *
 * tests/update-manifest.test.mjs fails when the parsed list and the imported
 * one disagree, which is what an unparseable entry would look like.
 *
 * The user layer stays in update-system.mjs (USER_PATHS, LOCAL_PATHS_FILE and
 * MANIFEST_USER_PATH_OVERLAPS). Every entry here is checked against it at run
 * time — canonical form before any checkout, then rejectUserLayerPaths() per
 * entry in apply() and isSafeManifestPath() in rollback() — so an entry that
 * names user data is refused rather than shipped. Those checks cover the user
 * layer only. Some system files must stay out of this list for other reasons
 * (.gitignore, SIGNATURES.md: see their notes below and in update-system.mjs),
 * and the order matters for one entry (.gitattributes, first).
 */
export const SYSTEM_PATHS = [
  // .gitattributes governs how every other path below is written to disk, and
  // `apply` checks paths out one at a time in this order: if it landed later,
  // everything before it would be written under the old core.autocrlf setting
  // on an existing install, silently (once text=auto is live, git status stays
  // clean and only a second update would repair it).
  '.gitattributes',
  'dead-boards.mjs',
  'provider-id-cache.mjs',
  'modes/README.md',
  'modes/_shared.md',
  'modes/_writing.md',
  'modes/_profile.template.md',
  'modes/_custom.template.md',
  'modes/_brief.template.md',
  'voice-dna.template.md',
  'modes/oferta.md',
  'modes/oferta-signals/',
  'modes/master-profile.md',
  'modes/pdf.md',
  'modes/ats.md',
  'modes/text.md',
  'modes/pdf/',
  'modes/cover.md',
  'modes/email.md',
  'modes/add.md',
  'modes/expand.md',
  'modes/scan.md',
  'modes/discover.md',
  'modes/batch.md',
  'modes/apply.md',
  'modes/auto-pipeline.md',
  'modes/contacto.md',
  'modes/deep.md',
  'modes/ofertas.md',
  'modes/pipeline.md',
  'modes/triage.md',
  'modes/project.md',
  'modes/tracker.md',
  'modes/training.md',
  'modes/interview.md',
  'modes/interview-redflag.md',
  'modes/latex.md',
  'modes/latex-tex.md',
  'modes/followup.md',
  'modes/offer-prep.md',
  'modes/interview-prep.md',
  'modes/interview/',
  'interview-prep/sessions/.gitkeep',
  'interview-prep/sessions/README.md',
  'modes/patterns.md',
  'modes/calibrate.md',
  'modes/titles.md',
  'modes/upskill.md',
  'modes/intake.md',
  'modes/retro.md',
  'documents/.gitkeep',
  // Empty scaffolds are system-owned exceptions inside otherwise user-owned
  // directories. Ship only these exact files; the data they sit beside stays
  // in USER_PATHS and is never checked out by the updater.
  'data/.gitkeep',
  'data/offers/.gitkeep',
  'data/parser-output/.gitkeep',
  'jds/.gitkeep',
  'output/.gitkeep',
  'reports/.gitkeep',
  'documents/README.md',
  'modes/update.md',
  'modes/agent-inbox.md',
  'modes/reply-watch.md',
  'modes/outcome.md',
  'modes/ar/',
  'modes/da/',
  'modes/de/',
  'modes/de/interview/',
  'modes/fr/',
  'modes/fr/interview/',
  'modes/hi/',
  'modes/es/',
  'modes/es/interview/',
  'modes/id/',
  'modes/id/interview/',
  'modes/it/',
  'modes/it/interview/',
  'modes/ja/',
  'modes/ja/interview/',
  'modes/ko/',
  'modes/ko/interview/',
  'modes/nl/',
  'modes/pl/',
  'modes/pl/interview/',
  'modes/pt/',
  'modes/pt/interview/',
  'modes/ru/',
  'modes/ru/interview/',
  'modes/sg/',
  'modes/tr/',
  'modes/ua/',
  'modes/ua/interview/',
  'modes/vi/',
  'modes/heuristics/',
  'modes/regional/',
  'modes/zh/',
  'modes/zh/interview/',
  'modes/zh-TW/',
  'CLAUDE.md',
  'CODEX.md',
  'OPENCODE.md',
  'AGENTS.md',
  'GEMINI.md',
  'KIMI.md',
  'build-dashboard.mjs',
  'clean-markers.mjs',
  'cv-experience-order.mjs',
  'generate-pdf.mjs',
  'hired-share.mjs',
  'hired-wall-build.mjs',
  'HIRED.md',
  'theme-style.mjs',
  'generate-latex.mjs',
  'install-latex-engine.mjs',
  'extract-latex-content.mjs',
  'patch-latex-content.mjs',
  'lib/ascii-fold.mjs',
  'lib/cli-flags.mjs',
  'lib/cli-launch.mjs',
  'lib/failure-excerpt.mjs',
  'lib/gemini-node-floor.mjs',
  'lib/node-floor.mjs',
  'lib/chromium-launch-error.mjs',
  'lib/local-today.mjs',
  'lib/jd-archive-section.mjs',
  'lib/parse-date.mjs',
  'lib/personalization.mjs',
  'lib/reply-proposals.mjs',
  'lib/placeholder-cell.mjs',
  'lib/tracker-addition.mjs',
  'lib/scan-summary-marker.mjs',
  'lib/scan-history-columns.mjs',
  'lib/pipeline-sections.mjs',
  'lib/small-board.mjs',
  'lib/admission-gate.mjs',
  'lib/tsv-formula-escape.mjs',
  'lib/is-main-module.mjs',
  // This file. update-system.mjs reads it at run time (see the header), so it
  // ships like any other system file.
  'lib/update-manifest.mjs',
  'lib/mjs-files.mjs',
  'lib/syntax-check.mjs',
  'lib/syntax-check-child.mjs',
  'lib/walk-tree.mjs',
  'lib/dir-lock.mjs',
  'lib/run-bounded.mjs',
  'lib/status-hooks.mjs',
  'lib/scratch-dirs.mjs',
  'lib/story-bank.mjs',
  'lib/outcome-dir.mjs',
  'lib/outcome-types.mjs',
  'lib/latex-escape.mjs',
  'lib/cv-payload-schema.mjs',
  'lib/career-profile.mjs',
  'lib/profile-cv-selection.mjs',
  'lib/cv-markdown.mjs',
  'lib/page-format.mjs',
  'lib/template-manifest.mjs',
  'lib/agent-cli.mjs',
  'remember-cli.mjs',
  'lib/yaml-document.mjs',
  'scan-hn.mjs',
  'scripts/check-syntax.mjs',
  'scripts/export-ats-text.mjs',
  'scripts/followup-sweep.sh',
  'scripts/ui-server.mjs',
  'story-provenance-check.mjs',
  'lib/latex-content.mjs',
  'lib/context-budget.mjs',
  // Ships alongside doctor.mjs, which imports it: an upgraded install whose
  // updater had no entry for it would check out a doctor that cannot load.
  'lib/title-filter-conflicts.mjs',
  // Ships alongside liveness-api.mjs, which imports it.
  'lib/linkedin-url.mjs',
  // Retired 2026-09-05: the suite moved to tests/context-budget.test.mjs. The
  // entry stays so staleSystemFiles() prunes the orphan on an upgraded install;
  // drop it once a release has shipped past that move.
  'lib/context-budget.test.mjs',
  'lib/golden-budget-analysis.mjs',
  'img-to-pdf.mjs',
  'apply-scope.mjs',
  'archive-posting.mjs',
  'jd-capture.mjs',
  'application-answers.mjs',
  'generate-cover-letter.mjs',
  'merge-tracker.mjs',
  'persist-evaluation-report.mjs',
  'url-key.mjs',
  'sync-pdf-flags.mjs',
  'tracker-links.mjs',
  'tracker.mjs',
  'find.mjs',
  'verify-pipeline.mjs',
  'discard-analytics.mjs',
  'sync-batch-input.mjs',
  'reconcile-pipeline.mjs',
  'dedup-tracker.mjs',
  'precheck-duplicate.mjs',
  'add-entry.mjs',
  'github-evidence.mjs',
  'role-matcher.mjs',
  'tracker-utils.mjs',
  'tracker-parse.mjs',
  'tracker-aliases.json',
  'session-activity.mjs',
  'set-status.mjs',
  'onboard-write.mjs',
  'mark-pdf-ready.mjs',
  'normalize-statuses.mjs',
  'fix-report-links.mjs',
  'cv-sync-check.mjs',
  'i18n-drift.mjs',
  'verify-cv-facts.mjs',
  'verify-cv-structure.mjs',
  'verify-ats.mjs',
  'ats-payload.mjs',
  'update-system.mjs',
  'path-resolver.mjs',
  'ats-vendor.mjs',
  'history-ats-seeds.mjs',
  'branded-successfactors.mjs',

  'reserve-report-num.mjs',
  'scan.mjs',
  'migrate-scan-runs.mjs',
  'pipeline-lock.mjs',
  'portal-health-lock.mjs',
  'classify-tier.mjs',
  'scan-ats-full.mjs',
  'scan-interamt.mjs',
  'scan-dayforce.mjs',
  'company-funded.mjs',
  'match-star.mjs',
  'jd-skill-gap.mjs',
  'career-profile.mjs',
  'cv-title-check.mjs',
  'filter-audit.mjs',
  'prepare-application.mjs',
  'application-artifacts.mjs',
  'evaluation-cache.mjs',
  'batch-evaluate-gemini.mjs',
  'providers/',
  'data-static/',
  'seeds/',
  'tests/',

  // ── Retired paths ─────────────────────────────────────────────────────────
  // These files no longer exist upstream: #3765 moved four root suites into
  // tests/, and #4758 moved tracker-columns-tests.mjs once it no longer
  // needed its own timeout. They
  // stay in the manifest anyway, because SYSTEM_PATHS is what `apply()` prunes
  // AGAINST — `staleSystemFiles` (see pathMatchesManifest) only deletes a local
  // file that is gone from the remote tree AND matches an entry here. Drop the
  // entry and an upgrading install keeps its copy of the old root file forever,
  // where tests/root-tests-registration.test.mjs then reports it as an
  // unregistered suite and turns `node test-all.mjs` red on a healthy install.
  //
  // Probe on this list vs. the pre-#3765 one, with a local tree holding the
  // four and a remote tree without them: without these entries the prune
  // returns nothing at all; with them it returns all four.
  //
  // NB: keep square brackets out of every comment in this array. Several
  // assertions in test-all.mjs extract the manifest with a NON-GREEDY regex
  // that ends at the first closing bracket, so one inside a comment truncates
  // the parsed list and every entry below it reads as missing. That is not
  // hypothetical: the first draft of this block wrote the probe result as an
  // empty-array literal and turned the check-table-freshness assertion red.
  //
  // They are therefore expected to be ABSENT from the working tree, which is
  // why updater-migration-tests.mjs lists them in ALLOWED_MISSING_ENTRIES.
  // Safe to delete once no supported install can still be carrying them.
  'agent-inbox-tests.mjs',
  'followup-seed-tests.mjs',
  'paste-reply-tests.mjs',
  'set-status-tests.mjs',
  'tracker-columns-tests.mjs',
  // ── end retired paths ─────────────────────────────────────────────────────
  'user-agent.mjs',
  'doctor.mjs',
  'jsonc-parse.mjs',
  'check-liveness.mjs',
  'liveness-core.mjs',
  'liveness-api.mjs',
  'liveness-browser.mjs',
  'browser-extract.mjs',
  'fetch-jd.mjs',
  'analyze-patterns.mjs',
  'keyword-match.mjs',
  'calibrate.mjs',
  'upskill.mjs',
  'skill-extract.mjs',
  'skip-blockers.mjs',
  'intake.mjs',
  'learn.mjs',
  'stats.mjs',
  'funnel-stages.mjs',
  'detect-reposts.mjs',
  'rank-pipeline.mjs',
  'discover-ats.mjs',
  'discover-new-companies.mjs',
  'check-table-freshness.mjs',
  'check-jd-archive.mjs',
  'fingerprint-core.mjs',
  'listing-fingerprint.mjs',
  'process-quality.mjs',
  'company-history.mjs',
  'rejection-latency.mjs',
  'closing-soon.mjs',
  'close-stale.mjs',
  'reeval-candidates.mjs',
  'salary-gap.mjs',
  'negotiation-roi.mjs',
  'funnel-velocity.mjs',
  'assessment-log.mjs',
  'contacts.mjs',
  'contact-lookup.mjs',
  'linkedin-join.mjs',
  'weekly-digest.mjs',
  'tracker-sync-check.mjs',
  'followup-cadence.mjs',
  'invite-match.mjs',
  'ics-interview.mjs',
  'panelist-roles.mjs',
  'coverage-check.mjs',
  'agent-inbox.mjs',
  'followup-seed.mjs',
  'debrief-sync.mjs',
  'profile-language.mjs',
  'title-keywords.mjs',
  'gemini-eval.mjs',
  'ollama-eval.mjs',
  'openai-eval.mjs',
  'openai-tailor.mjs',
  'eval-golden.mjs',
  'evals/',
  'openrouter-runner.mjs',
  'jd-similarity.mjs',
  'test-all.mjs',
  // Retired 2026-10-04: the suite moved to tests/tracker-writer-lock.test.mjs
  // (#4759). The entry stays so staleSystemFiles() prunes the orphan on an
  // upgraded install; drop it once a release has shipped past that move.
  'tracker-writer-lock-tests.mjs',
  'validate-portals.mjs',
  'validate-profile.mjs',
  'verify-portals.mjs',
  'audit-portals.mjs',
  'fix-slugs.mjs',
  'updater-migration-tests.mjs',
  'validate-system-paths-coverage.mjs',
  'validate-untrusted-content-coverage.mjs',
  'reply-matcher.mjs',
  'reply-watch.mjs',
  'paste-reply.mjs',
  'contact-extract.mjs',
  // Retired 2026-10-04: the suite moved to tests/contact-extract.test.mjs. The
  // entry stays so staleSystemFiles() prunes the orphan on an upgraded install;
  // drop it once a release has shipped past that move.
  'contact-extract-tests.mjs',
  'outcome.mjs',
  'batch/batch-prompt.md',
  'batch/batch-runner.sh',
  'batch/company-scope.mjs',
  'batch/jd-rescue.mjs',
  'batch/aggregate-tokens.mjs',
  'batch/README.md',
  'utils/token-tracker.mjs',
  'batch-tailor.mjs',
  'dashboard/',
  'templates/',
  'config/cv-facts.example.json',
  'fonts/',
  'examples/',
  'config/profile.example.yml',
  'config/local-paths.example.txt',
  '.env.example',
  '.editorconfig',
  '.agents/',
  '.claude/skills/',
  '.opencode/skills/',
  '.opencode/commands/',
  '.claude-plugin/',
  '.codex-plugin/',
  '.qwen/',
  '.antigravitycli/skills/',
  '.grok/skills/',
  '.kimi/skills/',
  'docs/',
  'writing-samples/README.md',
  'VERSION',
  'DATA_CONTRACT.md',
  'MANIFESTO.md',
  'manifesto.mjs',
  // SIGNATURES.md cannot join SYSTEM_PATHS: unlike every other system file it
  // is a pure append-only ledger of who signed the manifesto, and it churns
  // far faster than the code it would ship beside (49 commits in the 30 days
  // before this was written). Nothing on an install reads it — manifesto.mjs
  // parses MANIFESTO.md and never opens it — so shipping it buys an install
  // nothing, while listing it here puts it in the pathspec check() diffs via
  // systemTreeDiffers, which turns every new signature into a
  // system-files-changed report on every install in the world that no apply
  // can clear for long (#4062). That is one cause of the #3149 class of
  // permanent update-available, beside the SHA-vs-content bug of #2630, the
  // ignore-rule route of #2756, and the symlinked skill entrypoints that a
  // core.symlinks=false checkout materialises into regular files. Do not fix
  // that last one the way this entry was fixed: the entrypoints must stay in
  // SYSTEM_PATHS and be excluded from the drift comparison instead, because
  // ensureSkillEntrypoints only refreshes an entry that still holds the
  // pointer, so an entrypoint dropped from the manifest silently freezes.
  // The SIGNATURES.md repo-only coverage is declared in
  // validate-system-paths-coverage.mjs, and the behaviour is pinned by
  // tests/updater-signature-ledger-drift.test.mjs.
  //
  // Keep this comment free of straight quotes: updater-migration-tests.mjs
  // parses this array with a comment-blind regex, so an apostrophe here
  // becomes a phantom manifest entry.
  'CONTRIBUTING.md',
  'MAINTAINERS.md',
  'ARCHITECTURE.md',
  'README.md',
  'README.ar.md',
  'README.cn.md',
  'README.da.md',
  'README.de.md',
  'README.es.md',
  'README.fr.md',
  'README.hi.md',
  'README.ja.md',
  'README.ko-KR.md',
  'README.pl.md',
  'README.pt-BR.md',
  'README.ru.md',
  'README.ta.md',
  'README.ua.md',
  'README.zh-TW.md',
  'README.tr.md',
  'README.vi.md',
  'README.id.md',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTORS.md',
  '.all-contributorsrc',
  'GOVERNANCE.md',
  'LEGAL_DISCLAIMER.md',
  'SECURITY.md',
  'SUPPORT.md',
  'TRADEMARK.md',
  'LICENSE',
  'CITATION.cff',
  'funding.json',
  '.well-known/',
  '.editorconfig',
  '.github/',
  'package.json',
  'build-cv-latex.mjs',
  'build-cv-html.mjs',
  'cv-sections-core.mjs',
  'cv-templates.mjs',
  'playwright.cv.config.mjs',
  'scaffolder/',
  'Dockerfile',
  'docker-compose.yml',
  '.dockerignore',
  'cops',
  'DOCKER.md',
  'plugins/',
  'plugins.mjs',
  'plugins-registry/',
  'plugin-install.mjs',
  'plugin-audit.mjs',
  'validate-plugin-registry.mjs',
  'config/plugins.example.yml',
  'opencode.example.json',
  'seed-fixture.mjs',
  'test-fixtures/',
  'upgrade-tests.mjs',
];

// Frozen after the literal, not with `Object.freeze([...])` around it, so the
// declaration keeps the `const NAME = [ ... ];` shape the parser matches.
Object.freeze(SYSTEM_PATHS);
