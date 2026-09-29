<!-- Live acceptance ledger for the OII-338 local cutover. -->

# OII-338 acceptance ledger

## Pre-cutover evidence (2026-09-28 to 2026-09-29)

The observations in this section were recorded before the approved empty-store
cutover. The later cutover status is recorded at the end of this ledger.

- OII-334 through OII-337 and OII-339 through OII-345 are Done in Linear. OII-338 is In Progress. Issue slices were committed separately; nothing has been pushed.
- Hermes scan `504a0b3c252c` and score `9ff33a7a6d12` remain paused. Their configured scripts are `career-ops-scan.sh` and `career-ops-score.sh`, which enter Python. This does not prove the Python execution chain is free of Node orchestration.
- The package scripts and workflow README now use `python -m workflow.career_ops`, matching the Hermes entrypoint. Both npm command help routes and the repository syntax gate pass; direct file invocation remains supported for existing callers.
- Current `data/opportunities.db` is retained and read only during acceptance: 87 opportunities, 5 tasks and 4 results at this audit. There are 52 `workday-api`, 22 `smartrecruiters-api`, 6 `successfactors-api`, 4 `jibeapply-api`, 2 `workday`, and 1 `phenom-api` opportunities. These counts are historical observations, not proof that each configured provider works now.
- `workflow.discover` now enters Python from `workflow.career_ops discover` and runs collection, decision and publication as LangGraph nodes before the separate scan/score graphs. `providers/_collect.mjs` only collects raw provider results and handoffs; Python performs filtering, trust annotation, deduplication, cooldown, optional URL verification routing, JD capture orchestration, fingerprinting, Stage 0 placeholder evaluation, SQLite ingestion and run summaries. Guarded Node browser reads remain collection tools. `scan.mjs` directly dispatches its CLI to Python; the old Node decision helpers now live only in test fixtures as the parity oracle.
- The latest OII-333 decision permits Node provider and collector tools while requiring the principal prompt-driven orchestration, decisions and handoffs in Python/LangGraph. OII-338 acceptance therefore checks the active ownership boundary and provider results, not removal of every Node provider. Independent scan/score/apply model review remains removed under the accepted `1c905b95` decision; deterministic publication gates and apply human review remain required.
- `hermes cron list --all` on 2026-09-29 confirms the two original jobs (`504a0b3c252c` scan and `9ff33a7a6d12` score) are paused, with their original schedules and repository workdir intact. Plain `hermes cron list` reports no scheduled jobs because it hides disabled jobs; the gateway is running with no active jobs. Neither schedule has been resumed.
- The iCIMS provider's `icimsTruncated` cap reaches Python as `capped`; configured discovery now reports `partial/coverage_warning` and incomplete source health for that case. A cross-boundary fixture retains the fetched job while rejecting a false complete run.
- A whole-process provider collector timeout, launch failure or invalid response now records a failed configured scan run in the SQLite business store. It adds no per-source health observation because the failed collector provides no trustworthy source-level result; isolated tests verify both the failed row and dry-run non-persistence.
- Collector failures now use the configured graph's run ID for the same idempotent business write as successful publication. An isolated injected crash after the failed run commits but before its graph checkpoint resumes with one `scan_runs` row; the prior unkeyed failure write could duplicate that row.
- Decision-stage exceptions now also record a failed configured scan run using the graph run ID. An isolated malformed-provider result fails during decision, then resumes from the collected checkpoint with exactly one failed `scan_runs` row. The configured discovery graph, workflow scan and Node syntax checks pass; the canonical database hash is unchanged.
- Publication-stage exceptions now use a separate idempotent failure run ID, leaving the success run ID free for retry. An injected crash after an opportunity commit failed twice under the same graph run, retained one failed scan row and one opportunity, then resumed to one completed scan row without refetching.
- The 2026-09-29 sweep of all 43 `tests/workflow-*-test.py` scripts passes after correcting one stale scan capability test to use changed JD input for its second model result. Reusing the exact first input correctly returns LangGraph's cached completion; the changed-input test now exercises the missing-core-evidence wait. The 311-file Node syntax gate also passes.
- The first 2026-09-29 full Node `node --test tests/*.test.mjs tests/providers/*.test.mjs` run showed that legacy `helpers.fail()` printed `❌` without failing the process. The helper now sets `process.exitCode=1`. The js-yaml sweep excludes intentionally deleted tracked files, the prompt-contract test checks the current Python router, and the obsolete test for `ollama-eval.mjs` (removed under OII-304) is gone. The remaining actual failure exposed a missing call to the already-implemented Claude plugin MCP detector in `doctor.mjs`; that call is restored. The final permitted-environment run passed all 201 Node test files with no printed `❌`; `node scripts/check-syntax.mjs` passed 310 active `.mjs` files and the required workflow scan test passed. The first sandboxed run could not start Chromium or loopback listeners, so only the permitted-environment run is counted as the full gate.
- A post-collection exception or Ctrl-C now also records a failed scan summary with observed counters and `newAdded=0` as a failure sentinel. An injected failure after an opportunity commit leaves one failed run and the committed opportunity; a rerun deduplicates that opportunity and records one completed run. A collector-stage Ctrl-C writes a failed run before preserving the interrupt. Source health is not inferred from an interrupted Python processing phase.
- The configured collector's Python process budget now covers its ten-worker batches and each worker's 600-second per-target bound, rather than imposing a fixed 900 seconds on any number of sources. A bridge process that has written a complete result before its process timeout can still hand that result to Python; isolated 11-target and completed-output fixtures exercise both cases. This removes a potential whole-run data loss when slow later batches remain within their per-source bounds.
- The same process-budget gap existed in Python `global` directory batches: up to 50 boards with only six workers for Greenhouse/Lever/Ashby could not always finish under a fixed 900-second bridge deadline. The raw bridge now restores Node's five-minute per-board watchdog, and the Python process budget scales with worker waves and that 300-second limit. It writes each completed board to a progress sidecar. After a process timeout without a complete output, Python uses the completed prefix, checkpoints the first unfinished board, and replays later results rather than skipping them. Isolated three-board interruption/resume, completed-output and output-free timeout tests pass; no new full-directory live run has yet exercised the adjusted deadline.
- The historical reverse scanner's five-minute watchdog enclosed both provider fetch and iCIMS detail-date enrichment for one board. The collector now reports the original per-board deadline, and Python gives iCIMS enrichment only the time left after fetch and batch handoff. The enrichment bridge records each completed posting; after a timeout, Python retains the completed prefix and excludes the unfinished posting and its successors. Isolated near-expiry, expired-deadline, partial-progress and guarded-URL cases pass. The Node collector still owns its fetch timeout; Python marks an expired enrichment budget as a partial source failure.
- A timed-out raw bridge can return completed VC-seed boards alongside `None` for unfinished boards. The seed node now records those missing boards as failures, retains completed jobs, and publishes an incomplete source-health result; a three-board isolated test covers the mixed batch without an `AttributeError`.
- Python's YC portfolio bridge previously imposed a fixed 900-second deadline on Node's guarded walk of up to 500 pages at 20 seconds per request. Its outer budget now covers that source-owned page limit; a16z keeps the 900-second ceiling. A complete output file remains usable after a late process timeout, while an output-free timeout is still a source failure. Isolated tests cover both sources and the missing-output path; the earlier complete 6,258-company YC live capture remains a separate observation rather than proof of the new worst-case budget.
- Reverse-scan title profile resolution now matches Node for absent, null and explicitly empty `title_filter_full` values. Checkpoint tests also reject malformed `current` offsets and accept the completed-source `current: null` marker; these cases are deterministic parity checks, not a full-directory live sweep.
- A fresh Python reverse sweep now warns and starts from a new cutoff when an old unfinished checkpoint exists, matching Node's non-`--resume` path. It only replaces that checkpoint after new progress is recorded, so an earlier source-load failure leaves the prior resume state intact. Isolated tests distinguish resumed, fresh-preview and fresh committed runs; preview leaves the original checkpoint untouched.
- Both Python discovery CLIs now reject repeated `--since` occurrences before network collection, matching the old Node parser's fail-closed date-window contract. A mixed positional/equals-form duplicate is exercised for each CLI.
- CLI parity checks now keep `discover --company=` from silently becoming a full scan, use the Node default ATS set for `global --ats=`, and treat `global --md-out=` as no digest path instead of the current directory. A mocked CLI test confirms no collection starts for the empty company and inspects the exact global arguments without network access.
- `global --limit=0` now retains the Node CLI's unlimited default instead of raising a Python validation error. The CLI fixture verifies the value handed to reverse discovery without starting a sweep.
- The Python `discover` and `global` CLI entries now honor Node's `CAREER_OPS_PORTALS` input override. Configured discovery also honors `CAREER_OPS_PROFILE` separately from the portals location, and binds Stage 0 candidate fingerprints to that selected profile while keeping CV, targeting rules and blacklist rooted in the input workspace. An isolated local-parser CLI run proves an alternate portals file is used when the default is invalid; a separate committed run checks the selected profile hash. `--directory` remains the SQLite lane boundary.
- Python's `discover --verify --throttle=0` now uses the old Node CLI's 5,000 ms default instead of disabling the request gap. Isolated CLI checks cover absent, bare, zero and custom throttle values without opening a browser.
- The Python `--verify` bridge no longer imposes a fixed 900-second process deadline on arbitrarily many sequential browser checks. Its budget now scales with candidate count and the maximum throttle gap, allowing the existing Node verifier's bounded navigation, headed fallback and 404 rediscovery to finish. A complete output file remains usable if the process times out after writing it; an output-free timeout still fails the run. Isolated tests cover a 20-offer throttled batch and both timeout outcomes; a large live verification run is still pending.
- A current full enabled-source Python `discover --dry-run` checked all 34 configured sources and 34,365 public postings, with 99 candidates and 15 duplicates. It returned `partial`: NVIDIA and Walmart China hit Workday page caps, while Qualcomm, HSBC and Kering returned HTTP 403 during this shared scan. The run did not retain candidates or call the model. Exact counters, source/config hashes and limitations are in `evidence/oii-338-full-enabled-dry-run-2026-09-28.json`; the failing sources need isolated rechecks before complete acceptance can be claimed.
- A later current-code all-source dry-run checked 36,983 postings across the same 34 enabled sources and found 102 candidates, but remained `partial` with nine failure records. NVIDIA and Walmart China still hit Workday page caps; Microsoft and IKEA reported coverage gaps; Qualcomm and Kering retained partial fetched pages before auth failures; HSBC returned HTTP 403. The canonical database hash stayed unchanged at `c7a8d44e…`. See `evidence/oii-338-full-enabled-recheck-2026-09-28.json`; the source failures require isolated rechecks and cannot be counted as complete coverage.
- A full current-code configured LangGraph run against all 34 enabled sources wrote to an isolated SQLite store: 36,084 postings checked, 96 opportunities and source-evidence rows, one scan run, and 34 source-health rows. It remained `partial` with eight failure records. Qualcomm hit the raw bridge's 300-second reverse-scan watchdog, revealing that this limit had leaked into the configured lane. The bridge now uses a 600-second configured budget while retaining the reverse scan's 300-second bound. An isolated Qualcomm graph recheck finished after the old threshold, checked 2,021 postings, retained six, and reported the actual upstream `coverage_gap` rather than a timeout. Both runs' artifacts, hashes and limits are recorded in `evidence/oii-338-full-configured-graph-2026-09-29.json`.
- The post-budget-fix 34-source configured graph rerun finished in a fresh isolated store: 32,722 postings checked, 100 opportunities and source-evidence rows, one run and 34 health rows. It remained `partial` with ten failure records, including upstream Workday caps, Microsoft/Qualcomm/Kering coverage or auth gaps, HSBC HTTP 403, IBM changing search count and IKEA's empty page 103. Qualcomm no longer hit the 300-second bridge limit. Checkpoint references and exact source failures are in `evidence/oii-338-full-configured-graph-post-budget-2026-09-29.json`; the canonical database hash stayed unchanged. This proves all-source graph execution and honest partial reporting, not complete source coverage.
- The new IBM and IKEA live failures exposed a data-loss path inside their raw providers: a later changed count or empty page threw away earlier valid pages. Both providers now retain earlier trusted jobs, mark the batch `collectionTruncated`, and propagate `coverage_gap` into Python's incomplete-source health. A first-page failure still raises. Provider fixtures cover IBM's changed count and IKEA's later empty page; the generic configured-discovery bridge test already proves partial jobs and coverage warnings reach SQLite. No post-fix live IBM/IKEA recheck has yet exercised those exact branches.
- Initial 2026-09-29 isolated IBM and IKEA dry runs omitted the repository's documented `CAREER_OPS_ALLOW_FAKE_IP_RANGE=1` setting for the local transparent proxy. The provider guard rejected the proxy's virtual address and both returned `fetch failed` with zero checked rows, while direct permitted reads of the official public domains returned HTTP 200. These attempts are invalid as evidence of upstream provider failure; corrected live rechecks must use the documented setting. IBM, IKEA and shared collector regression tests passed independently.
- Corrected 2026-09-29 isolated dry runs used that setting. IBM checked 1,895 public postings, completed with zero errors and zero retained under current filters. IKEA preserved and checked 1,515 public postings but reported `partial/coverage_gap`. A separate raw provider probe confirmed the exact live branch: pages 1–102 advertised 1,532 results over 103 pages, but page 103 reset its count to zero and returned no jobs; the provider kept its 1,515 unique earlier jobs and marked them truncated. This verifies preservation after a later empty page, while correctly refusing complete source coverage. Commands, counts and limitations are in `evidence/oii-338-ibm-ikea-recheck-2026-09-29.json`; the canonical business database hash is unchanged.
- A cutover audit found that the old Node `scan.mjs` loaded the repository `.env` before provider collection, while Hermes enters `workflow.career_ops` directly and the Python CLI did not. The paused Hermes jobs have no job-specific environment field; without this setting, this machine's transparent-proxy fake IP is rejected by the provider address guard. The Python CLI now loads the project `.env` without overwriting inherited values, using locked `python-dotenv==1.2.3`. An isolated live IBM dry-run explicitly removed `CAREER_OPS_ALLOW_FAKE_IP_RANGE` from the inherited environment and still completed all 1,895 public postings with zero errors. The installed Hermes script copies remain older than the repository scripts and must be synchronized at cutover; neither job has been resumed.
- The integrated OII-345 notification graph checks the current score fingerprint, published report bytes, eligibility projection and alert threshold before claiming one Discord delivery. Timeout or crash after claim leaves an uncertain business row and cannot automatically resend. The scheduled score wrapper invokes this graph only when `CAREER_OPS_NOTIFICATIONS_ENABLED=1`; direct `cron-score` and read-only preview do not send. The OII-341 and OII-343 modules were also integrated and adapted to the accepted removal of separate scan/score reviews, while retaining their own draft reviews. All `tests/workflow-*-test.py` scripts pass after integration.
- A read-only notification preview over the accepted isolated AIA score returned the current published report hash `11d18ba3…`, 3.0–4.0 interval, 75% coverage, AIA role title and the retained report path. It sent no message. The integration gates then passed 52 Python workflow scripts, 199 permitted-environment Node tests, the 303-file Node syntax check and the required workflow scan test.
- Qualcomm's first isolated recheck no longer returned HTTP 403, but its PCSX feed repeated a page before the advertised count and the provider threw away all already fetched jobs. Public read-only offset probes showed the count changing from 2,019 to 2,018 between adjacent requests and a repeated job at the page boundary. The provider now returns its fetched rows with `collectionTruncated/coverage_gap` when a page has no new jobs or the unique row count falls short of the reported count; deterministic tests cover both cases. A corrected isolated Python dry-run retained 2,005 fetched rows and five passing candidates while reporting `partial/coverage_gap`, rather than falsely accepting complete coverage or dropping the batch. See `evidence/oii-338-qualcomm-pagination-recheck-2026-09-28.json`.
- A current-code isolated Microsoft Python dry-run checked 2,309 postings and found 14 candidates, but correctly reported `partial/coverage_gap`. A separate read-only official API probe saw 2,321 raw rows across 233 pages, including 15 duplicate URLs; the advertised count changed from 2,320 to 2,321 during pagination. It retained 2,306 unique postings and also reported `coverage_gap`. This is a changing offset-paginated feed, so the earlier complete Microsoft sample remains historical evidence and the current recheck is not complete coverage. See `evidence/oii-338-microsoft-pagination-recheck-2026-09-28.json`.
- PCSX now also preserves valid earlier pages when a later page fails after bounded HTTP retries. It returns a partial batch tagged `auth`, `server` or `network`; Python retains the fetched candidates and records the matching source-health status. A first-page failure still returns no fabricated jobs and remains an error. Node and Python isolation tests cover a later HTTP 403 and its business projection; no new live source run has exercised this branch yet.
- Workday's date-window early stop is disabled when the caller accepts undated postings: even an all-dated stale page cannot prove that later pages contain no undated jobs. Provider fixtures retain the following page after both mixed and all-dated stale pages; the early-stop optimization still passes for callers that exclude undated rows. The Python configured scanner continues to accept undated rows under its final date filter. No new live source run has exercised the later-page branch.
- HSBC and Kering each completed a separate current-code Python dry-run after their shared-run HTTP 403s. HSBC checked 1,507 postings and selected eight with zero errors; Kering checked 1,046 and selected none with zero errors. These separate successes show the 403s were not persistent single-source failures at recheck time, but they do not make the concurrent 34-source run complete. See `evidence/oii-338-hsbc-kering-isolated-recheck-2026-09-28.json`.
- IKEA China also completed a separate current-code Python dry-run after the shared-run `coverage_gap`: 1,486 official postings checked, none selected, zero errors. The canonical database stayed unchanged. This resolves the isolated recheck but does not make the earlier concurrent run complete. See `evidence/oii-338-ikea-isolated-recheck-2026-09-28.json`.
- Isolated bridge tests now exercise a failed local-parser fetch followed by a successful API provider fallback. The Python handoff retains the API source, one opportunity and source evidence, records the parser warning as a partial run, and keeps the successfully fetched source reachable for health streaks.
- `node scan.mjs` and `node scan.mjs configured` now dispatch to Python/LangGraph `discover`; `node scan.mjs global` dispatches to Python `global`. All three preserve the caller's data directory and portal inputs. Isolated CLI tests confirm configured preview, global JSON output and SQLite persistence in a temporary caller directory. The old configured `main()` implementation and its private fetch/verification loop have been deleted. An import audit found no production caller of the remaining Node scan helpers, so the 75-line production `scan.mjs` now contains only CLI routing; historical helper tests and the Node/Python dedup differential import `tests/fixtures/legacy-scan-helpers.mjs`. Python also has `resolve-company` with isolated tests for directory/seed sampling, fresh-date policy, resume, vendor probing, preview and opt-in writes. The obsolete `discover-ats.mjs` resolver CLI and `scan.mjs resolve` routes have been removed after their meaningful self-test cases moved to Python. The direct `scan-ats-full.mjs` entry and its Node-only tests have also been removed: Python checkpoint/source/reverse-runner tests cover dataset drift, iCIMS source guards, title override, outage stop/resume, counters, page caps and business replay; provider bridge tests cover out-of-order progress callbacks. `scan.mjs hn` had no dispatch branch and was removed from help; unknown positional operations now fail closed.
- The configured CLI retains fail-closed flag parsing before Python dispatch, including unknown flags paired with `--help`, missing operands and negative `--since` values. Python validates date operands before opening the portal configuration. The old TSV/pipeline output-path test and Node scanner's end-to-end dedup test were removed because SQLite is the decided business store; the Python discovery test verifies same-lane dedup, separate-lane isolation and business replay. A historical Node/Python differential fixture was removed from the active test after the Node command itself switched to Python; its earlier observed facts remain in this ledger and the original Git baseline.
- The old `scan.mjs` pipeline and scan-history writers, their formatting functions and their writer-only lock test were removed after the CLI moved to SQLite. Historical pipeline/history readers remain only in the test oracle for Node/Python parity and golden output checks; no active discovery command reads or writes those files.
- The old scan-run and portal-health TSV writers and their dedicated lock/tests were removed after confirming no active production caller. The Python business store records run summaries and source health in SQLite; configured discovery computes persistent-failure streaks from those rows, including the current run. Its isolated tests cover incomplete and auth status escalation, cross-source independence, and reset after a reachable-but-empty result. The generic lock module remains for tracker/follow-up writers; no active discovery command writes the retired TSV files.
- Deterministic checks passed for title/tier behavior over all 675 recall-corpus titles, representative Node/Python dedup and fingerprint comparisons, isolated local-parser discovery with duplicate and failure cases, optional verification routing, posted-date filtering with the same provider pagination bound, blacklist audit annotation, read-only dry-run against existing dedup state, a business-commit-before-run-summary crash and replay, and evidence handoff. One isolated differential run matched Node and Python on canonical opportunity rows, persisted run summary, source payload, and page evidence for the same local-parser fixture. A differential over all 32,306 jobs in the saved 34-source provider matrix found zero first-filter mismatches under the current portal policy, including title, tier, location, posting age/date, salary, content, country eligibility and visa gates. Its source/config hashes and excluded later gates are recorded in `evidence/oii-338-configured-filter-differential-2026-09-28.json`. The guarded browser returned a real `blocked_host` observation for a loopback URL in escalated local execution. A copy of the current business database accepted a local-parser run. Provider truncation now crosses the Node/Python boundary as a coverage failure, and consecutive source-health failures are reported. This does not establish parity for every Node option or real provider. Initial public provider fetches failed in the network sandbox; later authorized collection used the documented fake-IP-range exception while retaining other DNS guards.
- The current real AIA Workday opportunity has a retained scan JD report and score result; the score task has both a waiting and a completed attempt. Bosch has a retained scan JD report. These records need an acceptance audit of input URLs, source hashes, deterministic evidence gates and report quality before counting as end-to-end acceptance. The independent model review stage was removed in `1c905b95`, and the user confirmed that decision remains in force.
- The earlier AIA score result predates the Python business projection fix: its isolated opportunity remains `discovered` with no `evaluations` row. The fresh current-code run below verifies projection; existing results still need an explicit carry-forward decision at cutover.
- Score recovery now meters elapsed time even when the model process exits successfully but emits malformed JSON. An isolated process fixture records two durable model calls, sleeps, emits invalid output, and verifies both calls and elapsed seconds remain in the task budget after the expected failure.
- The score model process now runs a checkpointed LangGraph subgraph with explicit prescreen, research, assessment and report-render nodes, while the outer task graph retains its business publish boundary. Research and assessment behavior moved from a single imperative runner function without changing the model prompts or deterministic report validation. An interrupted-assessment fixture deletes the old research cache before resume and still reaches assessment without a second research call, proving recovery from the LangGraph checkpoint itself. A second fixture interrupts report rendering after a successful repair; recovery uses the saved repaired assessment without repeating a model call. The pre-existing outer workflow checkpoint format remains unchanged.
- The scan model process now uses a checkpointed LangGraph subgraph for JD evidence extraction, deterministic prescreen and canonical JD report construction. Isolated cases cover active, source-Unknown, incomplete, expired and hard-gate failures; an interrupted prescreen resumes from extracted evidence without another model call. The old outer scan task and business publish boundary remain unchanged. A later real AIA run through this subgraph is recorded below.
- The first real AIA run through the new scan subgraph exposed a runtime interpreter mismatch: the outer workflow used `workflow/.venv`, while the default model subprocess used the Hermes venv without LangGraph. The model subprocess now uses the workflow interpreter and loads Hermes's installed agent dependencies for model access. The same isolated scan task resumed and completed after one model call, with five scan checkpoints, the unchanged 5,873-character official JD hash, active liveness and uncertain prescreen. At that checkpoint no score, application or delivery had been produced; the canonical database stayed unchanged. See `evidence/oii-338-aia-live-scan-graph-2026-09-28.json`.
- The same isolated AIA lane subsequently exercised score and apply. Score kept its research and assessment checkpoints across invalid `research` citations and failed repair responses; a shorter, explicit frozen-source repair prompt produced a valid report. With no retrieved web page evidence, compensation, team and company remain Unknown; its 2.00–5.00 interval and 0.25 coverage are a technical sample, not a replacement for the separately accepted score. Apply exposed a model-produced `basics` grouping that the package boundary failed to normalize; the corrected boundary and same-task recovery generated a readable three-page PDF and stopped at `user_review`. This new v001 package is unreviewed; the accepted v002 from the earlier isolation remains the quality sample. The canonical database is unchanged, with no notification, submission or message. See `evidence/oii-338-aia-live-graph-chain-2026-09-28.json`.
- Apply failure recovery now allows a bare same-task resume only for `failure:` waiting reasons, preserves the current attempt's budget, and follows the pending outer LangGraph checkpoint when present. A direct `run` on a `user_review` waiting task returns waiting without starting evaluation. The default model runner now trusts child-persisted calls instead of charging a subgraph's cumulative `tool_calls` again on replay; mocked boundary tests cover both the interpreter and counter. A public-CLI fixture also fails PDF export once, resumes the outer task, and verifies that the model-runner process was called only once. A prior isolated apply retry had already overcounted before this fix, so the corrected counter still lacks a fresh live AIA run.
- The three completed model subgraphs now return their saved result for the same input fingerprint instead of starting a new model run after an outer publish or PDF failure. Score additionally checks the report file's hash and rerenders if it has been lost or changed. Deterministic tests cover completed and interrupted reentry; the real isolated AIA scan, score and apply subgraphs were replayed with model calls disabled and all returned their saved outcomes, including the unchanged score report hash. This proves no additional model dispatch from those completed subgraphs; the older isolated apply task's already inflated tool counter remains a historical test artifact.
- The accepted real AIA scan's frozen model response was replayed through the new scan subgraph in a separate ignored directory with no external model call. All 13 JD report fields matched the original acceptance result after excluding the fresh prescreen `generated_at` timestamp. The source SQLite store was opened read-only; this is real-artifact decision parity, not a new live extraction or business publish. See `evidence/oii-338-aia-scan-graph-replay-2026-09-28.json`.
- The apply model process now runs a checkpointed LangGraph subgraph for drafting, revision-patch merge, package validation, one bounded repair and final package output. Tests interrupt validation after a completed draft and finalization after a completed repair; each resumes without another model call. The accepted AIA v002 revision patch was replayed against its v001 package in a separate ignored directory with all model calls disabled; the full package hash matched exactly. PDF rendering and user confirmation remain in the outer task graph, and no application was submitted. See `evidence/oii-338-aia-apply-graph-replay-2026-09-28.json`.
- The accepted real AIA score's frozen assessment was replayed through the new score subgraph in a separate ignored directory with all model calls disabled. The rendered report hash exactly matched the accepted report (`11d18ba3…`), as did the 3.0–4.0 interval and 0.75 coverage. The source SQLite store was opened read-only; this is real-artifact rendering parity, not a new live research or assessment run. See `evidence/oii-338-aia-score-graph-replay-2026-09-28.json`.
- A new AIA isolation copied only the prior public discovery evidence and cleared workflow attempts, leaving the earlier acceptance database and canonical database untouched. Current-code LangGraph scan captured the 5,873-character official JD as active with `uncertain` prescreen, score committed `evaluated` state, `unknown` eligibility, evaluation, report artifact and business checkpoint, and apply produced a two-page PDF package. The first PDF exposed an actual Reactive Resume line-end hyphen; a layout fix and one feedback revision produced v002 with only the affected bullet changed. The user accepted v002 and its accompanying materials as the OII-338 real-job apply sample; isolated resume confirmation completed with `package_confirmed`. Application state remains `none` and deliveries remain zero. Score research searched three times but yielded no retrieved findings, so compensation, team and company evidence remain unknown. The artifact hashes and limits are in `evidence/oii-338-aia-current-code-2026-09-28.json`.

## Isolated live acceptance, 2026-09-28

- User authorized sending CV, career profile and AIA JD to the configured `deepseek-v4.1-flash` endpoint for this scan/score/apply acceptance. No application was submitted and no message was sent.
- The user accepted the current AIA score report as the real-job score acceptance sample. Its compensation score of 3 rests on a general Shanghai Data Analyst market benchmark and role-level inference, not verified AIA pay; the team dimension remains Unknown. This acceptance covers the report's stated evidence limits and does not establish a verified employer salary.
- The isolated application lifecycle, reply, follow-up cadence and statistics tests pass against the current Python code. OII-339's later decision accepts these isolated post-application business samples; `docs/acceptance/oii-339.md` now states that boundary instead of the obsolete real-submission gate. A read-only `insights stats` query over the current canonical store returned the expected aggregate sections, and the database hash remained unchanged. OII-344's wider Node/Python insights parity audit remains open.
- Full current HKEX Workday collection returned 174 of 174 postings. Python discovery rejected 173 by title and 1 by location. The capture manifest is `evidence/oii-338-hkex-workday-2026-09-28.json`.
- Full current Bosch SmartRecruiters collection returned 4,804 postings without truncation. Python dry-run checked all 4,804 and accepted 21. The capture manifest is `evidence/oii-338-bosch-smartrecruiters-2026-09-28.json`. Raw collection remains in the ignored isolated acceptance directory.
- AIA Workday discovery checked 1,005 current postings and retained four accepted roles in the ignored isolated database. All four have guarded browser JD snapshots and source evidence. `evidence/oii-338-aia-discovery-2026-09-28.json` records identities and hashes. The canonical database was not changed.
- A further public-provider matrix is recorded in `evidence/oii-338-provider-matrix-2026-09-28.json`. SAP SuccessFactors returned 819 postings, Schneider JibeApply 631, ABB Phenom 2,053, and Honeywell Oracle Cloud 999; each passed an isolated Python discovery replay against the real collected rows. Siemens Avature returned exactly its configured 40×6 page window and Mercedes-Benz Beesite exactly its 1,000-job cap. After provider-to-Python cap signalling was added, both real collections reported `page_cap` and isolated Python discovery returned `partial/coverage_warning`. Microsoft returned HTTP 429, HSBC's configured Eightfold URL could not resolve to an allowed tenant, Qualcomm had only a websearch handoff, and MTR/IKEA configured provider IDs with no plugin. These were gaps at the time of that matrix, not successful samples.
- HSBC's official branded Eightfold API was separately verified and narrowly pinned in the provider. Raising its configured cap to 200 pages yielded all 1,474 advertised postings without truncation; isolated Python discovery checked all rows and accepted seven. See `evidence/oii-338-hsbc-eightfold-2026-09-28.json`. The initial HSBC configuration error in the matrix above was resolved; Microsoft, Qualcomm, MTR and IKEA were still open at that checkpoint.
- MTR's missing Taleo provider now parses its official public list and form-backed pagination. The live list declares 28 jobs, but the second page repeats three IDs from page one; the collector stops on the repeated page and reports 25 unique rows with `coverage_gap`. Python discovery returns `partial`, so this source remains unaccepted. See `evidence/oii-338-mtr-taleo-2026-09-28.json`.
- A fresh MTR pagination capture showed that page 1 contains 25 rows and page 2 contains the remaining three list rows, all duplicate job IDs. The same result held with the site's session cookie, and later page requests yielded no new IDs. The provider now counts processed list rows for coverage, keeps unique jobs for business ingestion, and rejects a response whose current-page field does not match the requested page. A real provider rerun returned 25 unique jobs without truncation; isolated Python discovery checked all 25, rejected each by title and reported `completed` with zero errors. See `evidence/oii-338-mtr-taleo-duplicate-check-2026-09-28.json`. The prior `coverage_gap` observation remains in the preceding historical record.
- IKEA's missing provider now walks its official public search pages. The first page observed 1,485 advertised results; a full pass produced 1,479 unique job URLs. The collector reports `coverage_gap` instead of silently calling the source complete, and isolated Python discovery returns `partial`. See `evidence/oii-338-ikea-2026-09-28.json`. A source-level reason for the count difference remains to be established.
- A later IKEA audit read all 100 public pages: 1,486 declared results, 1,486 parsed rows, 1,486 unique URLs, with no page/count shifts or invalid rows. A fresh provider run returned 1,486 without truncation, and Python dry-run checked all 1,486 with `completed`/zero errors (1,472 title and 14 location rejections). See `evidence/oii-338-ikea-full-recheck-2026-09-28.json`. This demonstrates a complete current pass; the cause of the earlier 1,479/1,485 shortfall remains unknown and that historical partial result is retained.
- The raised Mercedes-Benz Beesite limit reached all 2,595 advertised postings with no truncation; isolated Python discovery checked all and accepted one. Siemens Avature still filled 200 pages and returned 1,198 unique postings with `page_cap`, so it remains partial. See `evidence/oii-338-cap-recheck-2026-09-28.json`.
- Siemens' Avature provider was dropping the configured API query string when adding its page offset. A public first-page comparison proved the region filter changes the job set. Preserving those parameters reduced the configured source to 209 jobs without truncation; isolated Python discovery checked all 209 and retained two current roles with source evidence in a separate acceptance database. See `evidence/oii-338-siemens-filtered-2026-09-28.json`. The preceding 1,198-job capped run is historical evidence of the unfiltered bug.
- The provider matrix has complete isolated passes for HSBC, MTR, IKEA, Mercedes-Benz, Siemens, Qualcomm and Microsoft after the corrections recorded here.
- A later isolated Python `discover --company Microsoft --dry-run` again returned `HTTP 429 Too Many Requests`, with no postings checked or retained. The Microsoft provider now signals `page_cap` through the shared collection contract if a future successful response exceeds its configured page window; the pure provider and collection boundary tests pass. This fixes silent truncation but does not resolve the live 429 or satisfy Microsoft acceptance.
- A configured Qualcomm differential is recorded in `evidence/oii-338-qualcomm-handoff-2026-09-28.json`: both old Node and Python emit the same WebSearch handoff query with zero provider-scanned companies. Python reports the isolated dry-run as failed because no posting was collected; Node exits zero after printing the handoff. This establishes handoff parity, not a live Qualcomm discovery or scan result.
- Qualcomm's official careers site exposes a public PCSX search API. The former Microsoft-only PCSX provider now pins both official employer hosts and domains, and Qualcomm uses it directly. The first fast full pass hit HTTP 429; bounded retry and slower Qualcomm pagination then collected all 2,014 advertised jobs without truncation. Isolated Python discovery checked all 2,014 and retained five under the current rules. A page-shell JD capture led to a content-readiness wait in the guarded browser; a fresh isolated run retained substantive browser snapshots for all five jobs. URLs, hashes, counts and the earlier failures are recorded in `evidence/oii-338-qualcomm-pcsx-2026-09-28.json`. This supersedes the handoff-only gap above, but does not itself prove scan/score/apply quality.
- A later complete Microsoft PCSX collection fetched all 2,301 advertised jobs with 2,301 unique URLs and no truncation. The official posting HTML supplies exact-URL `JobPosting` structured data; the guarded browser now reads that data when the visible page remains a shell. A fresh isolated Python replay checked all 2,301 jobs, retained nine, and stored substantive official JD text for each. The raw collection hash, JD hashes, counts and earlier 429/page-shell failures are recorded in `evidence/oii-338-microsoft-pcsx-2026-09-28.json`. This supersedes the Microsoft gap above, but does not itself prove scan/score/apply quality.
- A full raw pass over all 34 enabled configured sources is recorded in `evidence/oii-338-enabled-provider-matrix-2026-09-28.json`: 27 nonempty/uncapped, two page-capped, two errors, two websearch handoffs and one empty source. This is raw collection evidence, not Python or workflow acceptance. NVIDIA fetched 1,996 against a reported 2,000; Walmart China fetched 2,000 against a reported 2,000. Direct public CXS probes showed both sources repeat their first page at offset 2,000, so raising `max_pages` would mask the upstream coverage limit. Microsoft timed out in this 34-source concurrent pass and SAP aborted, while their earlier isolated captures remain separate evidence. Kering returned zero from its configured Workday endpoint despite jobs on its official public site.
- Ericsson's official public PCSX API was added to the pinned-host provider. It returned all 576 advertised jobs without truncation; isolated Python discovery checked all 576 and correctly rejected them under current title, tier and location policy, with zero errors or handoffs. See `evidence/oii-338-ericsson-pcsx-2026-09-28.json`. This resolves its handoff-only collection path but supplies no positive retained role.
- SAP's concurrent network abort was followed by an isolated public SuccessFactors recheck: 817 jobs returned without truncation. See `evidence/oii-338-sap-recheck-2026-09-28.json`; the earlier Python replay for SAP remains in the provider matrix evidence.
- Kering's official jobs page links applications to `careers.kering.com`, whose public PCSX API covers the group and its houses. The obsolete configured Workday board returned zero; the corrected pinned API fetched all 1,047 advertised jobs without truncation. Isolated Python discovery checked all 1,047 and rejected them under the current title, location and age rules with zero errors. See `evidence/oii-338-kering-pcsx-2026-09-28.json`. No Kering role was retained for downstream quality review.
- IBM's official careers page calls its public scoped search API. A pinned IBM provider now uses a stable document-ID sort and checks all 1,885 advertised jobs; the site's default relevance/pageview sort had duplicated pages and exposed only 1,600 unique URLs. Its separate country field is included in each raw location, so a US-only remote role with a `Multiple Cities` label no longer passes the China/Hong Kong filter. A fresh isolated Python replay checked all 1,885 with zero errors, zero handoffs and zero retained roles. The guarded browser captured the rejected role's substantive official JD after the locale redirect, confirming the country restriction; Python's scan input now accepts that exact same-job locale redirect as current evidence. See `evidence/oii-338-ibm-careers-2026-09-28.json`. This resolves the IBM websearch handoff but supplies no positive retained role.
- The two capped Workday sources were replayed through Python in separate isolated stores: NVIDIA returned `partial/page_cap` after checking 1,996 rows and retaining 19 fetched candidates; Walmart China returned `partial/page_cap` after checking 2,000 and retaining none. Public offset-0/2,000 probes for both repeated the same first three paths. The replays intentionally skipped JD capture, and neither source is a complete collection sample. See `evidence/oii-338-capped-workday-2026-09-28.json`.
- The first isolated AIA `JR-70003` LangGraph scan completed with a JD report. Its first score attempt exposed a model response without the required `findings` field; the adapter now retries incomplete research and fails explicitly if it remains incomplete. The same score task resumed and completed. It retained unknown compensation, team and company dimensions where the available web evidence could not be grounded in retrieved pages; its reported coverage was 0.25. That first apply package had a three-page resume PDF and waited for review. A later current-code isolation fixed the PDF layout, produced v002, and received the user's acceptance and confirmation as recorded above. This is one real-job workflow sample, not full quality acceptance of all enabled providers and workflow branches.
- Score research now has a separate input- and output-hashed checkpoint, so an assessment failure can resume from the frozen research artifact. Model and web-tool dispatches also charge the SQLite task budget before execution; isolated process-failure and successful-run checks show the count survives failure without double charging, and the 20-call cap rejects a further call. A fresh authorized AIA scan and score used the current code in a separate isolated store. The scan retained the same official JD hash. The score's first attempt charged six calls and rejected a company-page quote mislabelled as JD evidence after one repair; the same task resumed, reused frozen research, charged one further repair call and published an evidence-valid report. SQLite shows seven total score calls, one score result/evaluation, an identical business checkpoint/report hash, `unknown` eligibility, no delivery and no application. The report rates direction 5, compensation 3 on a broader Shanghai analyst benchmark plus role-level inference, team Unknown and company 3, yielding 3.0–4.0/5 at 75% evidence coverage. The compensation inference is not verified AIA pay. The user reviewed and accepted this report as the real score acceptance sample. See `evidence/oii-338-aia-current-budget-2026-09-28.json`.
- Python `resolve-company` now makes the board, deduplication, preview and opt-in write decisions; Node `_probe.mjs` only calls the selected provider. A 316-slug candidate/guard differential exposed and corrected Workable, Rippling and Pinpoint shape differences. Python and old Node both resolved the public Stripe Greenhouse board as 700 jobs with identical API URL and pending YAML at the first comparison, and the AIA Workday hint as 20 first-page jobs with the same board URL. All four runs were read-only; the first sandbox-only Stripe attempt returned an unknown `fetch failed` and was not counted. The shared Node provider session then resolved Stripe (now 701 live jobs) and AIA (20) concurrently in one Python preview, preserving process-level DNS/cache/rate-limit behavior; AIA was correctly identified as already tracked. Another ten live public board samples cover Workable, SmartRecruiters, Recruitee, Breezy, Pinpoint, Ashby, Rippling, Join, BambooHR and Lever; Python and old Node matched each resolved address and job count exactly. Mistral's Lever board returned zero jobs in a separate Python sample, then a live Until board supplied the Lever positive case. See `evidence/oii-338-resolver-vendor-samples-2026-09-28.json`. Isolated tests cover all eleven candidate URL shapes, vendor order, host confinement, Workday hints, first-live-board priority, mixed definitive/transient failures, empty boards, preview, duplicate suppression, idempotent atomic write and multiplexed probe replies. The old Node resolver self-test still passes 50 checks; old Node CLI retirement and its direct process-test migration remain pending.
- The reverse sweep's deterministic date/title/location/content order, intra-run URL and company-role deduplication, blacklist handling, directory host guards, 24-hour cache fallback and dataset fingerprint are now in Python modules. A 600-job differential under current `portals.yml` settings found zero first-rejection mismatches; source URL construction and one ordered dataset fingerprint matched the Node baseline. The Node provider collector now carries synthetic-entry, undated, cap and resolver-failure observations as raw collection facts, and iCIMS detail-date enrichment has a host-guarded raw tool.
- Python `global` now runs directory batches with an original-window checkpoint, Workday's quiet-line retry, Python filters, and isolated SQLite ingestion. A 51-board fixture interrupted after 50, resumed at board 51 and replayed a business commit ahead of checkpoint removal without duplicate opportunities or scan runs; guarded iCIMS date enrichment and Workday retry branches also passed. The public Greenhouse directory returned 8,333 entries; its first five yielded zero matches and three unreachable boards, so that dry-run is a degraded sample. AIA's `aia|wd3|external` entry was verified in the public Workday directory (12,884 entries), then one selected-entry isolated Python run retained the current real `JR-70003` Shanghai role with source evidence and a completed run. See `evidence/oii-338-global-aia-2026-09-28.json`. This selected-entry run does not prove a full-directory sweep. Python now owns VC seed URL/provider selection, shared job filters, optional liveness routing, and Markdown digest writing; a synthetic isolated seed run verified uncertain and expired URL branches. A full real source sweep remains pending.
- Reverse directory and VC-seed sweeps with `--limit` now return `partial` when fewer companies were selected than available, retain `capHit=true`, and write `incomplete` source health while removing the completed sample's checkpoint. Fixtures verify one scanned board or seed company out of two available. Earlier selected-entry runs remain valid samples, not full-directory acceptance.
- Reverse checkpoint v3 retains health for completed sources and the interrupted current source. On resume, each source replaces its previous health observation, so replay cannot duplicate rows or turn a recovered outage into a false `reachable` history. Two-source and mixed directory/seed interruption fixtures verify page caps, outages and completed seed health through the business-run rewrite. No active canonical or acceptance reverse checkpoint existed when the version changed.
- A Python full-run differential for the old Node resolver-breaker contract now distinguishes 50 consecutive resolver failures from ordinary missing boards. The outage run stops at 50/51 with a persisted resume offset and `network` checkpoint health; the missing-board run checks all 51, reports partial coverage, and removes its finished checkpoint.
- VC seed board errors, page caps and collector-batch failures now leave the selected seed `partial` with incomplete source health instead of falsely reporting `reachable` or aborting the entire reverse sweep. A three-company fixture retains two fetched jobs while recording one unavailable board and one page cap; a separate failed-batch fixture counts each uncollected board. The previous Node seed scanner already continued after per-company fetch errors, so these Python paths preserve that failure isolation while making coverage explicit. A real one-company Python sample from the saved complete YC catalogue probed Mantle's inferred Greenhouse board, received HTTP 404, stored one `incomplete` source-health row and one run, and returned `partial` with no opportunity; see `evidence/oii-338-yc-first-negative-2026-09-28.json`. This does not imply the full YC sweep is complete.
- The old configured scanner's separate output-path lanes now map to separate Python `--directory` SQLite stores. A local-parser fixture proves that each directory independently retains the same eligible posting, while rescanning either shared store deduplicates it. SQLite transactions and unique keys replace the old TSV/pipeline append-lock boundary; no legacy Markdown output path is used for business state.
- Configured discovery's collection, decision and business-publish stages now execute as LangGraph nodes. Saved collector batches are 1.5 MB for the provider matrix and 7.7 MB for the full enabled-source matrix, so the graph checkpoints durable artifact references and hashes instead of serializing raw postings into SQLite checkpoints. The explicit empty `--ats=` option retains Node's default-source behavior; `--ats=,` selects an empty set for the isolated CLI test.
- The business store now has a nullable, indexed scan-run ID separate from the historical summary JSON. Its `scan_run_once` method finds either a current indexed run or an older reverse-sweep run whose ID lives only in the summary, and replaces health observations on replay. The configured graph uses this ID. A same-run resume after a committed scan run returns the original decision without collecting or duplicating business facts; a resume after an opportunity commit also reuses the saved decision. A completed graph also checks the business run and recreates it from the saved decision if missing. Legacy-schema migration, all configured discovery tests, and reverse discovery tests pass. The large-artifact test keeps a multi-megabyte collector batch out of SQLite checkpoints and rejects a changed decision artifact. Full enabled-source graph acceptance remains pending.
- A fresh, isolated live HSBC run exercised configured discovery through all three LangGraph nodes: one source completed, 1,526 postings checked, eight retained, zero errors, one business run and one source-health row. The collected artifact is 321,107 bytes, its decision artifact is 3,800 bytes, and the SQLite checkpoint database is 28,672 bytes. The same-run `--resume` returned the identical result without adding business rows. The canonical `data/opportunities.db` hash remained `c7a8d44e…`. Exact run ID, hashes and limitations are in `evidence/oii-338-hsbc-configured-graph-2026-09-28.json`. This is one real configured source, not full enabled-source or scan/score/apply acceptance.
- The first public a16z portfolio dry-run returned zero parsed companies because the source page now embeds its 860-company catalogue in `window.a16z_portfolio_companies`, which the old parser did not read. The source reader now parses that field; the saved real page yielded 860 records, and a fresh isolated `--limit 1` Python run reported 860 available and one attempted. The sampled 11x Greenhouse guess failed to fetch, so this is positive live seed-source evidence but not positive job-retention evidence. Empty seed responses now report `partial`. A mixed directory/seed interruption fixture verifies that completing the seed does not overwrite the pending directory resume offset.
- The first public YC dry-run did not finish fetching its paginated portfolio before interruption, so it supplied no positive seed evidence at that time. `--limit 1` applies after the source reader finishes pagination. The raw reader marks a later-page failure or a hit on its 500-page guard as partial while preserving companies already fetched; Python retains those rows but reports partial coverage. Deterministic pagination, failure and Python propagation checks pass.
- A later complete public YC directory fetch returned 6,258 parsed companies with `partial=false`; its hash and isolated capture are recorded in `evidence/oii-338-yc-seed-2026-09-28.json`. Stripe was selected from that capture for a one-company Python `global --seeds yc` sample. The raw Greenhouse collector fetched 701 jobs without truncation; the Python run reported the 6,258-company source as complete, one company scanned, zero errors, a reachable source-health row and zero jobs retained under the current 30-day/title/location policy. This validates the complete seed read and selected real provider rejection path, but not a positive retained seed job or a full-company sweep.
- A saved YC/Greenhouse directory intersection identified 281 candidate boards. A bounded public collection fetched 140 and produced three currently eligible roles: two Nex Hong Kong engineering jobs and one Flexport Shanghai engineering job. A fresh isolated Python `global --seeds yc --limit 1 --liveness` run selected Nex from the complete 6,258-company official YC capture, fetched its live Greenhouse board, retained both jobs and wrote two opportunities, two source-evidence rows, one run and a Markdown digest. The result correctly reported `partial`, `capHit=true` and `incomplete` source health because only one company was selected; a separate guarded recheck found both retained URLs active with visible apply controls. Exact hashes and limits are in `evidence/oii-338-yc-nex-positive-2026-09-28.json`. This is a real positive seed sample, not a complete portfolio sweep.
- A local Node/Python differential over all 6,258 saved YC companies and 860 saved a16z companies found zero differences in each entry's selected careers URL or first detected Greenhouse/Lever/Ashby provider. This verifies seed targeting over the saved real catalogues; it does not imply that every board was fetched.
- A second 32,306-posting differential retained source order and composed the configured filters with URL and company-role deduplication from an empty prior-history snapshot. Node and Python agreed on every row: 96 accepted, 26 duplicate roles, 30,987 title, 1,118 location, 62 posting-age and 17 tier rejections. The current blacklist and reapplication windows are empty; four synthetic company windows applied to the same real postings produced 2,209 matching cooldown skips with zero mismatches. Inputs, counts and limits are in `evidence/oii-338-decision-chain-differential-2026-09-28.json`.
- A read-only backup of the canonical SQLite business store gave Node and Python identical existing dedup snapshots: 87 seen URLs, 87 company-role identities, zero recheck-eligible rows and zero fingerprint-history rows. The canonical file hash was unchanged before and after the comparison; `evidence/oii-338-canonical-dedup-snapshot-2026-09-28.json` records the hash and limits. The current config has no recheck window, so a separate parser regression now checks Node-style `parseInt` handling of `7days`, `3.5` and boolean `true` before Python seeds a snapshot.
- A permanent cross-runtime SQLite fixture now covers the missing aged-row branch: old and recent `added` opportunities, an old processed opportunity, permanent URL rejection, and active/expired cooldown outcomes. With a seven-day recheck window, Node and Python agree on all five retained URL keys, two role keys, two recheck-eligible rows and the fingerprint list. The test leaves the canonical database untouched.
- Databricks appears in the saved a16z catalogue. Its public Greenhouse board returned 888 jobs from a direct API read. A selected-company Python `global --seeds a16z` run with the documented local fake-IP proxy exception completed in an isolated SQLite store with zero retained roles under the current China/Hong Kong filters, one scan run and one source-health row. A 30-day rerun also retained zero. The first guarded attempt without that exception failed at the local DNS guard and is not a product failure. This verifies a real source-to-provider rejection path, not a positive retained seed job. The source hash and local compressed capture are indexed in `evidence/oii-338-a16z-seed-2026-09-28.json`.
- The saved official a16z page parsed into 860 companies; Flexport appears there and in the public Greenhouse directory. A fresh isolated Python `global --seeds a16z --limit 1 --liveness` run selected Flexport, fetched its live Greenhouse board, retained a Shanghai Senior Software Engineer role and wrote one opportunity, one source-evidence row, one run and a Markdown digest. The run correctly reported `partial`, `capHit=true` and `incomplete` source health; a separate guarded recheck found the retained URL active with a visible apply control. Exact hashes and limits are in `evidence/oii-338-a16z-flexport-positive-2026-09-28.json`. This is a real positive a16z seed sample, not a full portfolio sweep.
- `global --dry-run --resume` now copies the checkpoint and directory cache into a temporary store before resuming, retaining the original cutoff and leaving the source checkpoint untouched. The interrupted 51-board fixture exercises this option before the actual resume.
- Reverse discovery runs its directory sweep, VC-seed sweep, final blacklist/liveness decision, and business/digest publication as four LangGraph nodes with SQLite stage checkpoints. The original JSON checkpoint retains the date window, directory fingerprint, per-board resume offset, source health and offers; the graph checkpoint retains stage progress and hashed decision/result artifact references rather than the full offer batch. Interruption after the directory or decision node resumes without refetching or repeating liveness verification; publication keeps the JSON checkpoint until graph completion so a business commit before graph persistence can be replayed idempotently. A stopped sweep starts a new graph attempt under the same business run ID when resumed. Isolated resume, 51-board, mixed source-health, decision, artifact-integrity and checkpoint tests pass. The later full live run and its partial-coverage limit are recorded below.
- A current-code isolated live reverse-graph run fetched Flexport's public Greenhouse board with the repository's local fake-IP proxy exception. It retained one Shanghai Senior Software Engineer role, reported `completed` with one company scanned and zero errors, and wrote one opportunity, one source-evidence row, one scan run and one reachable health row. Six SQLite graph checkpoint rows contain hashed decision/result references; the batch checkpoint was removed after success, and the canonical database hash was unchanged. See `evidence/oii-338-reverse-graph-live-2026-09-29.json`. This one-board sample does not prove full directory or VC-seed coverage.
- A permitted-network isolated run selected the previously verified public AIA Workday coordinate and Flexport a16z/Greenhouse coordinate, then exercised both source nodes and final decision/publication in one reverse LangGraph. It completed with seven retained postings, seven source-evidence rows, one scan run, reachable health for both sources, six graph checkpoint rows and no remaining batch checkpoint. The first sandboxed attempt recorded two network failures and no opportunities; it is not counted as provider behavior. Source-loader outputs were fixed to these two coordinates, while provider HTTP collection and downstream decisions were live. See `evidence/oii-338-mixed-reverse-live-2026-09-29.json`; full public directory/portfolio sweeps remain unproven.
- A reverse parity audit found two partial-coverage holes after raw provider collection. A Workday quiet retry can return `None` when its bridge times out with only incomplete progress; the runner now treats that as a failed retry while retaining the first pass's jobs. Any non-cap truncated directory response outside a recovered Workday network retry now marks the source incomplete, including auth/server truncations. Isolated lost-retry and auth-truncation fixtures both retain the fetched job and publish `partial` with one unreachable board rather than crashing or claiming `completed`.
- The shared browser liveness classifier called AIA's concurrently API-listed `JR-70003` posting `expired/insufficient_content` because the browser saw a short shell, while Flexport's page showed an apply control. A short shell cannot prove a posting is gone. The shared classifier now returns `uncertain/insufficient_content`, so configured verification and reverse liveness retain it for later recheck; explicit 404/410 and hard-expired evidence still reject. The Node classifier test, Python verification/reverse tests and a fresh live AIA browser recheck pass. See `evidence/oii-338-liveness-aia-2026-09-29.json`.
- A later permitted-network isolated reverse graph selected one previously verified public board for each Greenhouse, Lever, Ashby and Workday directory plus an a16z seed pointing again to Flexport's Greenhouse board. All five source-health rows were reachable with zero errors or caps, seven opportunities and seven source-evidence rows were published, and the duplicated Flexport seed did not add duplicate opportunities. Lever and Ashby fetched successfully but current title/location/content filters retained no jobs from those boards. The source lists were selected subsets; see `evidence/oii-338-reverse-provider-matrix-2026-09-29.json`. iCIMS still lacks a live reverse sample, and full public directory sweeps remain unproven.
- Public iCIMS samples returned seven ISACA jobs, 91 IntraStaff jobs, 126 Ed Morse jobs, nine Blanchard jobs and 101 WaFd jobs without caps or truncation. An isolated current-code reverse graph then scanned the ISACA board, reported `completed` with reachable iCIMS health and zero errors, and retained no jobs under the current filters. This establishes live iCIMS provider collection and the empty-result path, not a retained iCIMS opportunity or full-directory sweep. See `evidence/oii-338-reverse-icims-2026-09-29.json`.
- The old reverse scanner permits `--resume` with a changed liveness or blacklist decision input. If a graph run already checkpointed the decision but not publication, the Python runner now starts a new graph attempt from the retained batch checkpoint when these inputs change, skipping completed provider fetches and recomputing the final decision. Isolated tests cover an active role becoming expired under newly enabled liveness and a newly blacklisted company being filtered; unchanged inputs still reuse the verified decision artifact.

## Required evidence before cutover

| Scope | Node baseline | Python entry | Positive and rejection | Recovery | Real sample | Node exit |
|---|---|---|---|---|---|---|
| Configured discovery/provider collection | historical `scan.mjs` configured operation and active provider modules | `workflow.discover` active | configured CLI options, local-parser positive/duplicate and partial/error paths pass; selected provider matrix exercised | success and failure business-commit replay pass in isolation | 34-source isolated graph run checked 32,722 postings and returned partial; Qualcomm retained partial rows with a coverage gap, two Workday caps remain | Python owns decisions; Node providers remain callable tools under the latest OII-333 decision |
| Reverse ATS and VC-seed discovery | historical `scan.mjs global` → `scan-ats-full.mjs` | Python `global` directory, seed, liveness and digest entry active | date/title/location/content, blacklist, dedup, iCIMS enrichment, Workday retry, seed resolution and liveness checks pass | 51-board interruption/resume and commit-before-checkpoint replay pass in isolation | selected boards gave live positive and rejection samples; a full five-directory plus YC/a16z isolated sweep checked 45,979 companies, retained 35 and truthfully reported partial coverage | legacy `scan.mjs` CLI retired; Python `global` is direct |
| Company-to-ATS resolution | historical `scan.mjs resolve`/`resolve-company` → `discover-ats.mjs` | Python `resolve-company` active | slug/host guards, Workday hints, preview/dedup and opt-in write pass in isolation; all 11 slug vendors plus hinted Workday have live positive samples | idempotent rerun/atomic write pass in isolation | Stripe Greenhouse, AIA Workday and ten further public boards match Node/Python | old resolver CLI removed |
| Scan and JD handoff | `scan.mjs`, `lib/scan-jd.mjs`, old scan contracts | LangGraph scan and `scan-discovered` | rejection and recovery tests plus current-code AIA active/uncertain path pass | isolated recovery tests pass | AIA and Bosch retained; AIA current-code JD hash recorded | scheduled scan enters Python; guarded Node browser read remains a collection tool |
| Score and evidence validation | historical Node score contracts, with independent review removed by `1c905b95` under the current decision | LangGraph score/`cron-score` with deterministic evidence gates and atomic business projection | trigger-constrained tests and current-code AIA projection pass | business-commit-before-checkpoint replay, process-group timeout cleanup and same-task real AIA citation repair pass | current AIA score accepted by user with compensation benchmark inference disclosed and team Unknown | scheduled score enters Python; old Node scorer removed |
| Scored action decisions | historical Node `scoring-decisions.mjs`, updated by current apply/verify/deprioritize policy | Python `decisions` derives current action from frozen prescreen, score and separate acceptable line | threshold, unknown, hard-failure and ordering tests pass; stale scores withheld | current-input fingerprints invalidate old actions; isolated stale queue recovery passes | Microsoft opportunity `2` current report returns `verify`; no notification or application sent | obsolete Node shortlist CLI retired |
| Apply package and human review | old application drafting contracts | LangGraph apply | rejection tests and current-code AIA v002 package pass | PDF failure then same-task feedback revision and user confirmation pass | AIA v002 PDF is readable, two pages and accepted by user as the real-job sample; no submission | apply enters Python; Node Reactive Resume remains a rendering tool |
| Post-application lifecycle and replies | OII-339 Node lifecycle, reply and cadence contracts | Python LangGraph `validate -> commit`, reply classification and follow-up views | isolated normal, rejection and conflict samples pass | business-commit-before-checkpoint replay and idempotency pass | isolated business samples accepted under the latest OII-339 decision; no real submission required | no active Node lifecycle entry in repository scripts or Hermes |
| Retained insights | OII-344 Node insight baseline | read-only Python `insights` commands | isolated stats, company, repost, salary, skill and preparation tests pass | read-only queries have no business checkpoint; salary recording uses an idempotent LangGraph | pre-cutover canonical `insights stats` read succeeded without changing the database | legacy `detect-reposts.mjs` remains a parser dependency of the historical migration script |
| User Discord notification | old threshold/delivery contract | `workflow.notifications` after scheduled `cron-score` when explicitly enabled | isolated current-input, report-file and at-most-once tests pass | timeout and crash after claim remain uncertain and do not resend | accepted AIA report preview matched hash, range and coverage; no message sent | score script defaults to no send during acceptance |

The full-provider sweep and wider parity audits in this ledger show the
coverage limits, not complete provider availability. The LangGraph boundaries,
rejection paths and recovery paths have been exercised in isolated stores;
the live AIA and provider samples establish real input behavior without
claiming every upstream feed is healthy.

## Local cutover disposition

Before cutover, authoritative `data/opportunities.db` passed `PRAGMA quick_check` and had 87 opportunities, 5 tasks, 4 results, 87 source-evidence rows, 3 scan runs and 81 source-health rows. Its SHA-256 was `c7a8d44e408b842cd5d8d4a0a133bb19885490476d7d6c4ae129ad8ca15e97ac`. The OII-334 archive separately retains the earlier 312-opportunity history. The historical 2026-09-20 `docs/acceptance/oii-338.md` records a previous empty-store restoration; it does not describe this cutover.

The user approved archive-and-empty-store cutover on 2026-09-29. The 87-opportunity
database and associated `data`, `output`, `reports`, and `jds` files were copied to
`/Users/oii/dev/career-ops-archives/20260929T122102+0800`. Its 1,027 files have
SHA-256 entries in `SHA256SUMS.json`; every archived hash was rechecked. The
archived SQLite database passed `PRAGMA quick_check`, retained the 87/5/4
opportunity/task/result counts, and matched the prior canonical SHA-256 exactly.
After that verification, the canonical business and execution databases were
reinitialized. All six checked business-table counts were zero, and `cron-score`
returned idle. The current scan and score scripts were copied byte-for-byte
to Hermes and their SHA-256 values matched. `hermes cron doctor` passed; only
the original scan `504a0b3c252c` and score `9ff33a7a6d12` jobs were resumed,
with their original workdir and schedule. The first direct Hermes score run
completed successfully on the empty store. The scheduled 12:40 score run
completed and published one formal scan task and `jd_report` result. The first
full configured scan process exited zero: its Python business run checked
36,809 raw postings, added 104 unique opportunities and 104 source-evidence
rows, and committed one configured `scan_runs` row with 34 source-health rows.
Health was 28 `reachable`, three `auth` and three `incomplete`; eight upstream
error or coverage records include Workday page caps and provider auth gaps.
The business database passed `PRAGMA quick_check` after that run. Hermes CLI
reported `Ran now: succeeded`, but its durable execution record remains
`unknown` because the gateway restarted while the long direct run was active.
This bookkeeping status cannot be counted as a durable scheduler success;
the process exit and business commit provide direct-run acceptance evidence.
The original jobs remain active on their unchanged schedules, and the next
built-in scan will supply a fresh durable scheduler observation.

The score wrapper now requires `CAREER_OPS_NOTIFICATIONS_ENABLED=1` before
running delivery; the installed Hermes copy matches it. A manual score call
in the restricted shell left a score task waiting because its model runner
could not write the Hermes log. The subsequent Hermes run selected a different
opportunity and failed when the scan model returned a `jobs` array instead of
the requested single-job fields. The adapter now checks those required fields
at the model boundary and retries one invalid response. These two waiting
tasks have not been counted as completed acceptance evidence.

The legacy score queue gives untried jobs priority over one failed attempt and
parks a job after its second failure. The Python `cron-score` selector had
excluded every failed waiting task, so no scheduled retry was possible. It now
selects first failures after fresh jobs, resumes the same task for attempt two,
and leaves second failures waiting for manual review. An isolated queue test
covers all three choices; the two live waiting tasks remain unverified.
The 13:00 built-in Hermes score execution `c342a9447c1f41d29194f2348d5d6967`
completed under the corrected code and committed a second scan result on a new
opportunity. The business database passed `PRAGMA quick_check`; it had two
completed scan results, no score result and no notification delivery. This
proves one scheduled scan handoff, not a completed scheduled score or a live
retry of either waiting task.

The subsequent direct Hermes score run selected the new Microsoft opportunity
`3` and saved research and an assessment, but that assessment contained only
`overview` and `capabilities` sections. Report rendering failed on the missing
`compensation` section. Hermes marked the run `unknown` after its gateway
restarted; the SQLite task recorded `failure:RuntimeError`. Both original jobs
were paused and read back as paused before recovery. A full-assessment repair
again omitted required sections. The score graph now requests only missing
sections, validates their presence, and merges them with the retained assessment.
The same task `e96a5d09-3b44-4c6b-a841-f52755128d78` resumed at the render
checkpoint, completed on attempt one with eight recorded calls, and committed
one score result for opportunity `3`. Its report hash is
`afe20941be068fc8010a7ca767c492098d512b2b837fdf8f9e84a0dfcff8dd20`;
the result is 2.75–3.75/5 with 75% coverage. The report file hash matches its
artifact row and the strict report validator passed. A repeated run returned
the completed task without a second evaluation or report artifact. SQLite
`PRAGMA quick_check` passed and `notification_deliveries` remained empty. The
jobs remain paused pending a clean scheduler run and remaining acceptance gates.

The two older first-failure tasks were then resumed by their original IDs in
the permitted runtime: scan task `26ef23fc-a368-4c85-8065-69a8c6094f38`
completed a JD report, and score task `c7438536-7576-42e7-b12e-380e91aa4899`
completed a report. A resumed Hermes score run next selected opportunity `2`
but failed because its section-completion model returned nonempty string lists
for `questions`, `risks` and `checklist`. Both jobs were paused again. The
LangGraph boundary now renders such lists as Markdown bullets without changing
their text, while still rejecting empty or unsupported shapes. A same-task
resume then exposed a model-produced compensation dimension as a plain string;
full-assessment repair stopped without a usable response. The graph now repairs
only malformed dimensions against frozen sources before report validation.
Score task `dda3f24c-1445-409b-9265-ba675dd82141` completed on attempt one
with ten recorded calls, one formal score result and a report artifact whose
stored and actual hashes match. The strict report validator and SQLite
`PRAGMA quick_check` passed; notification deliveries remained zero. Both Hermes
jobs remain paused until a clean scheduled execution is observed.

A later direct Hermes score execution selected opportunity `4`, returned
`succeeded` and committed its scan result with no notification delivery. Hermes
persisted that direct execution as `unknown` after another gateway restart, so
it is not counted as a clean scheduler run. The score job is active for its
14:00 built-in execution; the scan job remains paused. `hermes cron status`
reported a running gateway and a recent ticker heartbeat. The built-in run's
business and durable status must be read before restoring scan or closing this
issue.

Human quality inspection of the first opportunity `2` score report found two
contradictions: it called the work city undisclosed despite official structured
Shanghai/Suzhou location evidence, and denied a page snapshot despite the
retained `browser_snapshot` capture. Both Hermes jobs were paused before the
next built-in run. The report renderer now rejects these source-denial claims;
the score graph retains structured location, employment and capture-time facts
and requests only the conflicting sections again. Current scoring rules were
updated to state that source contract and remove obsolete independent
scan/score/apply model-review instructions. The rule change invalidated all
three earlier canonical score input fingerprints; no old result was deleted.
An explicit same-opportunity re-evaluation of opportunity `2` completed as task
`00a91f48-b374-424b-9755-021134389eff`. Its report hash is
`704f3248adf74796dcdf8ea165387569097529362885c6b074618586ec8bf382`.
The report now states Shanghai/Suzhou and the official browser snapshot;
source-claim rejection found no contradiction, the stored file hash and strict
report validator passed, and SQLite `PRAGMA quick_check` passed. `scores` marks
only opportunity `2` current; opportunities `1` and `3` remain stale pending
re-evaluation. Notification deliveries remain zero and both Hermes jobs remain
paused.

The score queue previously excluded every opportunity with any score result,
even when current candidate/rule inputs or the latest scan JD made that result
stale. `scores` now compares each result against the latest formal scan rather
than only the JD report embedded in its old score task. `cron-score` advances
unscored opportunities first, then explicitly re-evaluates one stale score
whose opportunity has no running or waiting task. An isolated store verifies
stale policy input selection, latest-JD invalidation, and suppression while a
new task waits. This restores the old queue's fresh-before-reassessment
ordering without using historical shortlist tiers.

The remaining Node shortlist action policy exposed another gap: Python `scores`
showed numeric ranges but offered no current apply/verify/deprioritize action
queue. The read-only `decisions` command now derives actions from current formal
score inputs, the frozen Stage 0 prescreen, and the profile's separate
`acceptable_line` (3.5/5, confirmed by the user); stale scores receive no action. Deterministic checks cover
threshold equality, unknown gates, hard failures, ordering and invalid dates.
The present JD report has no evidence-backed deadline or effort estimate, so
both ordering inputs remain null rather than fabricated. Adding the threshold
changes the policy fingerprint, which makes earlier canonical scores stale
until re-evaluated. No notification or application is sent by this view.

After the approved 3.5/5 profile setting, real Microsoft opportunity `2` was
re-evaluated from its retained scan result. Task
`6b43ec56-708d-4703-be72-62b0c1588195` completed and published report SHA-256
`86a229f6c65cfc7c326100778211672ae450f2cf5d3c9229d9b5ccf09df1207b`.
The current Python renderer independently re-read frozen packet, evidence and
assessment files, passed source and citation validation, and reproduced the
published report byte-for-byte. `decisions` returned `verify` for this current
2.25–4.25 score with 50% coverage; earlier opportunities `1` and `3` remained
stale without an action. SQLite `PRAGMA quick_check` was `ok`, notification
deliveries remained zero, and both Hermes schedules remained paused. The old
Node CLI validator requires the intentionally removed independent review JSON,
so it is not a valid gate for this current report contract.

The obsolete `scan.mjs` Python relay and `scoring-decisions.mjs` shortlist CLI
have been retired. Their wrapper-only tests were removed; a Python subprocess
test now checks discovery help, unknown and malformed flags, and the empty
global JSON route. The retained Node provider normalization assertion moved
to the provider contract test. `scoring-report.mjs` and its validation tests
remain because the historical SQLite migration script still imports that
validator. The permitted-environment Node suite passed 178/178 tests after
the retirement; targeted report and Python action tests also passed.
The first sandboxed full-suite attempt only failed where Chromium or a local
test listener lacked sandbox permission.

The active scoring rules still described the retired Node prescreen and report
validator, the Markdown pipeline as business authority, and three-worker
score publication despite the approved one-job Hermes budget. Their workflow
authority section now names the Python prescreen, LangGraph scan/score/apply,
SQLite facts, explicit user selection and whole-package confirmation while
preserving the evidence and scoring policy below it. The report rule now names
Python deterministic validation. This source-file change invalidates all
previous score fingerprints, including the newly checked opportunity `2`;
`decisions` correctly returns no current action until a new score completes.

The unused Node `prescreen.mjs` CLI was also retired after verifying the Python
Stage 0 placeholder and LangGraph scan prescreen rejection/recovery tests.
Its CLI-only Node cache test exited with it; the Node provider and retained
historical baseline suite passed 177/177 tests in the permitted environment.
The legacy Node prescreen helper remains only for differential fixtures, not
as a runtime entrypoint.

Following the active-rule cleanup, the same retained Microsoft scan produced
current score task `23a28afa-d043-411d-b7b3-79092f594e81` and published
report SHA-256
`7efb3410994a97674d917002ab5b71bf1b574aab50c4f3401b487212ffbde539`.
The Python renderer re-read the frozen packet, posting evidence and assessment,
passed deterministic validation, and reproduced the published report bytes.
`decisions` lists only opportunity `2` as current (`verify`, 2.75–4.75,
50% coverage); older scores `1` and `3` remain stale. SQLite quick_check is
`ok`, and notification deliveries remain zero.

The former Node `followup-seed.mjs` and `followup-cadence.mjs` CLIs had no active
callers after the OII-339 Python lifecycle and cadence migration. They were
retired along with two unused Node-specific profile fixtures. Python cadence
and application lifecycle checks passed; the retained lock protocol check and
the permitted-environment Node suite passed 177/177 tests. Historical
application data remains untouched.

The ATS portal repair command now runs in Python. A frozen Node output fixture
checks its line-preserving edits, including notes, comments, Greenhouse API
updates and Lever EU URLs. Python confirms candidate board ownership before
suggesting an unattended repair; the old `fix-slugs.mjs` entry was retired in
commit `597c9002`. A live public Greenhouse `stripe` probe returned 704 jobs.

Portal health verification now also runs in Python. The retained Node provider
tool returns bounded raw reachability facts through one sequential process, so
the former verifier's shared DNS cache and request budget remain effective.
Python owns live/empty/missing classification, error categories, candidate
selection, owner matching and the `--strict` result; `doctor --strict` reads
its ATS-only JSON result. Frozen Node slug and identity outputs and synthetic
positive, mismatch, partial-budget and failure checks pass. A current AIA
Workday probe returned the same `fetch failed` network result in both old and
new implementations; Bosch's new probe also returned `fetch failed`, so those
runs are not live-positive acceptance samples. Those direct probes did not
load the formal CLI's `.env`, so they cannot establish upstream reachability.
Correctly configured read-only rechecks returned `live` for AIA Workday with
20 first-page jobs and Bosch SmartRecruiters with 100 first-page jobs through
the Python health path. Both are bounded health probes, not full collections.
The standalone Python health and repair CLIs now load the project `.env`
without overriding inherited values. A subprocess with the fake-IP variable
removed from its inherited environment ran `workflow.portal_health` against
the public AIA board and returned `live` with 20 first-page jobs.

The Python ATS requests now use the Node provider's pinned User-Agent and
10-second timeout; board-owner HTML is limited to the first 8 KiB. The shared
Python identity also applies to public directory downloads, and the direct
file and package entrypoints both pass their scan tests.

The Python reverse sweep now reports source size and completed 50-board batches
to stderr while keeping `--json` stdout machine-readable. Its existing
partial/resume fixture passes with progress output. The already-running full
sweep began before this change, so its current process remains silent; its
checkpoint is the progress source for that run.

The public Workday directory has 12,884 entries but only 3,781 distinct
hosts; 6,643 entries share one of 21 hosts that each hold more than 20 sites.
In the `dd3dce319a911cff` dataset, `wd1.wd1.myworkdayjobs.com` alone carries
2,480 consecutive sites. The initial three-site diagnostic bypassed the
formal CLI's `.env` loading and hit the local fake-IP guard, so its `fetch
failed` results do not describe those boards. With the documented proxy
exception, two of that host's sites returned HTTP 422; AIA's distinct
Workday host fetched 983 jobs. An unguarded request to the shared host also
observed HTTP 429 during the sweep, but that observation alone does not
attribute the run's failures to rate limiting. The old 20-worker assumption
of one tenant per host does not hold for this directory. Python now serializes
batches containing repeated Workday hosts as a preventive coverage guard;
distinct-host batches keep 20-way collection. The live full sweep finished
Workday using its original concurrency and marked the source incomplete.
Its board-level error mix still needs a correctly configured diagnostic run.

The standalone portal configuration validator now runs as
`python -m workflow.portal_config`. It retains the old validator's ordered
errors and warnings for 11 frozen Node cases, including the
`title_filter_full.positve` rejection that prevents an unintended unbounded
reverse title match. The current `portals.yml` reports zero errors and zero
warnings; `--self-test` and the explicitly empty `--file=` rejection pass.
The old `validate-portals.mjs` command and its Node-only title-filter test
were retired. This validates the standalone config check, not an automatic
pre-scan config gate.

The read-only liveness CLI now selects current SQLite opportunities inside a
Python LangGraph node rather than reading the historical `data/pipeline.md`.
Its default includes discovered, evaluating, eligible, evaluated and preparing
opportunities, excluding submitted and ineligible rows; the current store
selects 104 distinct URLs. A raw Node collector retains the original ATS API
first, then sequential Playwright fallback and browser-only throttling. Python
owns selection, result validation, counts and exit status. Isolated tests cover
current-store selection, explicit URL/file inputs, the historical Node CLI
path, API-positive and API-expired results without modifying the store. The
public AIA `JR-70003` URL returned `active` through the Workday API rung in a
read-only current-code CLI run. A later full current-URL run selected 103 URLs
after business state changed; its results are recorded below.

The user subsequently authorized recurring Hermes score processing, including
future CV/JD model calls to the configured endpoint, while notifications remain
disabled. The original score schedule was resumed; scan remains paused. A
direct Hermes trigger created a real opportunity `4` score task but Hermes
again recorded the execution as `unknown` after a scheduler-owner restart.
The still-live child ran seven model calls, then the business task waited with
`failure:RuntimeError`. Its frozen assessment had all seven current report
sections plus unused legacy heading keys; a stale `Evaluation Checklist` under
one unused key denied retained location and snapshot evidence. The render
node now keeps only the seven contract sections and persists that normalized
assessment even when no model call was needed. A same-task resume completed
on attempt two without another model call. Re-rendering the retained frozen
materials reproduces published SHA-256
`19c6fb0c9fc165917c06297559ec13a9b43320b9381db38914337d20ffbf21a7`.
SQLite `PRAGMA quick_check` is `ok`, and notification deliveries remain zero.
The 17:20 built-in Hermes execution `af44caadd2a940ec87840f802bc1ba0a`
subsequently completed durably. It advanced opportunity `5` through one
LangGraph scan task, committed its scan result, and left notification
deliveries at zero. This is a clean scheduler-to-Python execution; that tick
did not run opportunity `5`'s score stage. The recurring score job remains
active under the user's authorization, while the scan job remains paused.

The next built-in score tick at 17:40 completed durably as Hermes execution
`5f43aee9fe7e448986923101eb775319`. It completed opportunity `6`'s
LangGraph scan task with a retained `jd_report` for an active Microsoft job;
the prescreen remains `uncertain` on undisclosed compensation and one adjacent
capability. SQLite `PRAGMA quick_check` is `ok` and notification deliveries
remain zero. This second scheduled tick confirms repeat execution after resume;
it does not establish a score result for opportunity `6`.

An uncapped isolated Python `global` run then completed the full public
Greenhouse, Lever, Ashby, Workday and iCIMS directories plus YC and a16z
portfolio seeds. It scanned all 45,979 listed companies, retained 35 dated
postings, and reported `partial`: 28,084 boards were unreachable and 32 were
capped. All seven source-health rows are `incomplete`; the five ATS directory
datasets loaded successfully, while both seed results are partial. The
isolated SQLite store has 35 matching opportunities/source-evidence rows,
one scan run, `PRAGMA quick_check=ok`, six LangGraph checkpoint rows and no
remaining batch checkpoint. Three sampled iCIMS batches show many HTTP 404s
alongside fewer 403, 500/503 and network errors; they do not explain the
whole error population. The running process had loaded the earlier Workday
concurrency code before the shared-host serialization fix. Exact result and
database hashes, counts, samples and limits are in
`evidence/oii-338-reverse-full-sweep-2026-09-29.json`. This establishes a
completed real full-source sweep with honest partial publication, not full
upstream availability or a live recheck of current Workday serialization.

The permitted-environment read-only Python LangGraph liveness command then
checked all 103 URLs selected from the current canonical store: 75 active,
zero confirmed expired and 28 uncertain, with 47 ATS API decisions. Of the
uncertain results, 27 pages had content but no visible apply control and one
had insufficient content. The command's exit code 1 reflects those uncertain
results; it did not fail to complete. A first sandboxed attempt could not
launch Chromium and produced no observations, so only the permitted run is
counted. The URL selection, output hash and host/reason counts are in
`evidence/oii-338-liveness-full-2026-09-29.json`. Uncertain pages remain
unconfirmed, not expired.

Current-store read-only `insights` commands for stats, reposts, salary,
upskill, company history, company signals and stated salary all exited zero.
Stats saw 104 scan observations, reposts saw no cluster, and upskill parsed
five reports. The store has no real application events or stated salary
observations, so those queries returned `source_missing` rather than invented
history. Output hashes and limits are in
`evidence/oii-338-insights-current-store-2026-09-29.json`; these runs add
runtime evidence but do not replace the isolated OII-344 parity cases.

The original Hermes scan task `504a0b3c252c` was then resumed with its
unchanged 06:00/18:00 schedule and Python `discover` script; no scan process
was in flight before resumption. A direct run completed the provider and
LangGraph business path: 34 configured sources, 39,119 postings checked,
16 new opportunities, 120 total opportunities and matching source-evidence
rows, two scan runs, 30 reachable and four incomplete source-health rows,
SQLite `PRAGMA quick_check=ok` and zero notification deliveries. The
remaining incomplete sources are Kering, Microsoft, NVIDIA and Walmart
China, with recorded coverage gaps or page caps. The direct command reported
success and Hermes task-list last run is `ok`, while its execution-detail row
remains `unknown` after a scheduler-owner restart. This metadata ambiguity
does not undo the verified business commit; the next natural 06:00 scan tick
has not yet occurred. Exact run ID, summary hash and limits are in
`evidence/oii-338-restored-scan-2026-09-29.json`. Both original Hermes tasks
are now active, with notifications disabled.
