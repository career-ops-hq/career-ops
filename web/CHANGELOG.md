# Changelog

## [0.7.1](https://github.com/santifer/career-ops/compare/web-v0.7.0...web-v0.7.1) (2026-08-20)


### Bug Fixes

* **web:** block_hard survives the Explore round-trip — type, URL params, seed and serializer ([#3102](https://github.com/santifer/career-ops/issues/3102)) ([89d6b1b](https://github.com/santifer/career-ops/commit/89d6b1b708454cca863bcf11464c87b76400b14e))
* **web:** persist the only installed CLI so jobs can start ([#2966](https://github.com/santifer/career-ops/issues/2966)) ([e80bf7e](https://github.com/santifer/career-ops/commit/e80bf7e60ce95e92dcd7501f97fda092b60b8f95))
* **web:** resolve 27 unmapped states.yml aliases and fix the Turkish status fold ([#2918](https://github.com/santifer/career-ops/issues/2918)) ([360ce49](https://github.com/santifer/career-ops/commit/360ce490c2e8d610a76767261679ed6b02880c9c))
* **web:** resolve company logos by name, not one guessed domain ([#2942](https://github.com/santifer/career-ops/issues/2942)) ([6096fc9](https://github.com/santifer/career-ops/commit/6096fc9497f3d8bd920d2eaa83c13c30fa989f3d))
* **web:** safe Codex AI-search exec with mtime-keyed capability cache ([#2361](https://github.com/santifer/career-ops/issues/2361)) ([699f506](https://github.com/santifer/career-ops/commit/699f506f62427cdb5a93bef8247eb6c1fd6418ef))
* **web:** stop first-run from claiming no setup ([#2965](https://github.com/santifer/career-ops/issues/2965)) ([f028012](https://github.com/santifer/career-ops/commit/f0280129e63a063a88b00598cc09747cd70bc19e))
* **web:** take the core followups lock so web writes cannot race the seeder ([#3034](https://github.com/santifer/career-ops/issues/3034)) ([3b761b0](https://github.com/santifer/career-ops/commit/3b761b09b2979eedf4eadbd9d3c24b9d61462f04))
* **web:** Today primary action opens the report ([#2967](https://github.com/santifer/career-ops/issues/2967)) ([74781e6](https://github.com/santifer/career-ops/commit/74781e6d66784bff97e15c507db7383a7fa2ab59))

## [0.7.0](https://github.com/santifer/career-ops/compare/web-v0.6.1...web-v0.7.0) (2026-08-18)


### Features

* **web:** give the Apply page a way back and a way to record that you applied ([#2735](https://github.com/santifer/career-ops/issues/2735)) ([05cc972](https://github.com/santifer/career-ops/commit/05cc972c2d45471ba45a8457c83f488915fc4fa6))


### Bug Fixes

* **deps:** make js-yaml imports work on both 4.x and 5.x ([#2656](https://github.com/santifer/career-ops/issues/2656)) ([6466b18](https://github.com/santifer/career-ops/commit/6466b18382aa2cb9390f5d2425a63ae36bcea085))
* **deps:** patch both HIGH advisories in web (js-yaml 4.3.1, nanoid 3.3.18) ([a094ec9](https://github.com/santifer/career-ops/commit/a094ec9ddbe8f21e8db6dba87f548532af2a820e))
* **deps:** raise the js-yaml floor to ^4.3.1 and guard it ([#2767](https://github.com/santifer/career-ops/issues/2767)) ([5b18a96](https://github.com/santifer/career-ops/commit/5b18a960da803477a475a1856138561f83edc035))
* **keys:** stop the dotted-I fix from collapsing Polish, Lithuanian and Maltese ([5df43e7](https://github.com/santifer/career-ops/commit/5df43e7133745ad814421f2dd4c5afce2e75c0e1))
* **keys:** stop the Turkish dotted capital from splitting one employer in two ([462d276](https://github.com/santifer/career-ops/commit/462d27653eda17c3305dfe74f2ecdc5b21fb79e6))
* **scan:** take the shared lock for scan-history.tsv appends ([#2639](https://github.com/santifer/career-ops/issues/2639)) ([8e264c4](https://github.com/santifer/career-ops/commit/8e264c4b24a04fc6f0799b2e5c9a0479ed4e16e0))
* **web:** add Grok Build CLI to the web runtime picker ([#2688](https://github.com/santifer/career-ops/issues/2688)) ([af0d818](https://github.com/santifer/career-ops/commit/af0d8183937a43397a127e75967b906fece86364))
* **web:** analytics tells an offer-holder they have 0 interviews (and nudges them to try harder) ([#2410](https://github.com/santifer/career-ops/issues/2410)) ([8f2b415](https://github.com/santifer/career-ops/commit/8f2b41505997c0f15d86ee617304701239328a12))
* **web:** anchor the fallback stderr classifier so a word can't fail a run ([#2882](https://github.com/santifer/career-ops/issues/2882)) ([be62e3e](https://github.com/santifer/career-ops/commit/be62e3ef28fcbcc18f1cddec3269c8da00be645c))
* **web:** carry the posted: segment so web evaluations reach the POSTED column ([#2899](https://github.com/santifer/career-ops/issues/2899)) ([6eece73](https://github.com/santifer/career-ops/commit/6eece731b36ea91286e984289518839d9ab5c342))
* **web:** detect OpenCode in its default install directory ([#1794](https://github.com/santifer/career-ops/issues/1794)) ([c10b887](https://github.com/santifer/career-ops/commit/c10b88764a793e4176688f60aa066e96eff1c3a4))
* **web:** emit the posting URL in the tracker-additions TSV so web runs join the dedup ([#2833](https://github.com/santifer/career-ops/issues/2833)) ([3c68721](https://github.com/santifer/career-ops/commit/3c68721fc28b98fc127ff9f5a36ac71188215750))
* **web:** enforce that no runtime grants itself blanket write permission ([#2875](https://github.com/santifer/career-ops/issues/2875)) ([9ba6ebf](https://github.com/santifer/career-ops/commit/9ba6ebf2f94dbd2772af9b32572af25429b303fc))
* **web:** finish Unicode company keys for explore + registry ([#2668](https://github.com/santifer/career-ops/issues/2668)) ([c294242](https://github.com/santifer/career-ops/commit/c294242dbb6a78a03bac738f397c568c02316971))
* **web:** fold Turkish dotted capitals in status keys, and stop hand-copying the state list ([#2786](https://github.com/santifer/career-ops/issues/2786)) ([e1a0961](https://github.com/santifer/career-ops/commit/e1a09616818d2dd84b249a7805078bbfeefae669))
* **web:** keep Codex JSONL + exit code authoritative for web scoring ([#2102](https://github.com/santifer/career-ops/issues/2102)) ([2d43601](https://github.com/santifer/career-ops/commit/2d436019b60484e97576dd36e9ce324d2585cd6a))
* **web:** let the pipeline table scroll horizontally instead of clipping on narrow screens ([#2363](https://github.com/santifer/career-ops/issues/2363)) ([632031c](https://github.com/santifer/career-ops/commit/632031c9cb8ae95311a36310bb6cd2713497136c))
* **web:** make the tracker reader agree with parseTrackerRow on row shape ([#2565](https://github.com/santifer/career-ops/issues/2565)) ([4fea438](https://github.com/santifer/career-ops/commit/4fea43835e940be62011f12afab4f35cb265c4ac))
* **web:** prevent Codex run jobs from waiting on stdin ([#1973](https://github.com/santifer/career-ops/issues/1973)) ([9a139a2](https://github.com/santifer/career-ops/commit/9a139a2aac44ae5e8da8e372a587a322ba99f149))
* **web:** read target_roles with the shape it is actually written in ([#2750](https://github.com/santifer/career-ops/issues/2750)) ([5f5c06d](https://github.com/santifer/career-ops/commit/5f5c06d4b257b4ef55dfedc2f1d1c0eb26bc9789))
* **web:** show the retry card, not the update-checkout panel, for runtime scan errors ([#1904](https://github.com/santifer/career-ops/issues/1904)) ([29c0d69](https://github.com/santifer/career-ops/commit/29c0d69cb0e2c2c3507e2712eaf04f1633244722))
* **web:** skip {n}-RESERVED.md sentinels when looking up reports ([#1967](https://github.com/santifer/career-ops/issues/1967)) ([5f4842e](https://github.com/santifer/career-ops/commit/5f4842e513fe45092395254ba51bc220676e598a))
* **web:** stop the 16-chip cap from truncating the user's own portals.yml ([#2749](https://github.com/santifer/career-ops/issues/2749)) ([a5af949](https://github.com/santifer/career-ops/commit/a5af94900b981105f2560ee271e22a00479093a9))
* **web:** strip the author letter from any lettered block, not just A-G ([#2420](https://github.com/santifer/career-ops/issues/2420)) ([630709a](https://github.com/santifer/career-ops/commit/630709a3cad0297b7305752cfdf6ed5b0469b4d8))
* **web:** take the core tracker lock in POST /api/status ([#2903](https://github.com/santifer/career-ops/issues/2903)) ([d9c4fd0](https://github.com/santifer/career-ops/commit/d9c4fd0a0fa191717f1f68663b5eaa11c0351ea6))

## [0.6.1](https://github.com/santifer/career-ops/compare/web-v0.6.0...web-v0.6.1) (2026-08-10)


### Bug Fixes

* **web:** derive company matching keys from the core, not an ASCII-only copy ([#2667](https://github.com/santifer/career-ops/issues/2667)) ([9b6582c](https://github.com/santifer/career-ops/commit/9b6582c01c381e6ab22ed674be7f7ef9f13d48df))
* **web:** re-read states.yml when it changes instead of caching it for the process lifetime ([#2590](https://github.com/santifer/career-ops/issues/2590)) ([2a2e09e](https://github.com/santifer/career-ops/commit/2a2e09e61275e18a2331c1fee39bec3225f9f01c))
* **web:** route Today's "See all N" link to the fresh-matches view ([#1790](https://github.com/santifer/career-ops/issues/1790)) ([5fcc727](https://github.com/santifer/career-ops/commit/5fcc72773b711be59f8212536df27ea6fd79f88d))
* **web:** take Write/Edit away from the dashboard's pdf mode ([#2508](https://github.com/santifer/career-ops/issues/2508)) ([1301ed4](https://github.com/santifer/career-ops/commit/1301ed4ccc4b1ead8b7eca024135ad4d1d63932c))

## [0.6.0](https://github.com/santifer/career-ops/compare/web-v0.5.0...web-v0.6.0) (2026-08-04)


### Features

* **web:** Follow-up Tracker page with logging, history, and cadence settings ([#1422](https://github.com/santifer/career-ops/issues/1422)) ([6554de6](https://github.com/santifer/career-ops/commit/6554de6dcd28b95556e95ae220aebc719cc7a2a0))


### Bug Fixes

* **dashboard:** localize the hired status label and buffer split stream openers ([#2295](https://github.com/santifer/career-ops/issues/2295)) ([8f5d10d](https://github.com/santifer/career-ops/commit/8f5d10d6aa97438a4ac3908814456df5a8cf4083))
* **deps:** update npm dependencies (+ Dockerfile playwright pins, web lockfile sync) ([f154f59](https://github.com/santifer/career-ops/commit/f154f5938fed43a37ab5e57efee1c45d664cdc3f))
* **web:** render PDFs from the backend instead of the spawned agent ([#2182](https://github.com/santifer/career-ops/issues/2182)) ([fef3ff2](https://github.com/santifer/career-ops/commit/fef3ff2e228cc14e55df4ced958e4b0aa630ec65))

## [0.5.0](https://github.com/santifer/career-ops/compare/web-v0.4.0...web-v0.5.0) (2026-07-30)


### Features

* **compliance:** check-table-freshness.mjs — staleness validator for jurisdiction tables (closes [#2036](https://github.com/santifer/career-ops/issues/2036)) ([1e83f67](https://github.com/santifer/career-ops/commit/1e83f6711e5e1587fc1d220b40eb925b8ef73542))
* **oferta/apply:** immigration-status requirement overreach — jurisdiction table + posting signal + form warning ([2a681d1](https://github.com/santifer/career-ops/commit/2a681d129a5ad2fb1b191072dac74a0a90ea6cb5))
* **oferta/apply:** jurisdiction-prohibited content signal — table + Block G + apply-form warning ([d8dac75](https://github.com/santifer/career-ops/commit/d8dac7589b228051abe79ca3acf4014cf8b9c6fb))
* **oferta:** agency licensing check — jurisdiction table + registry pointer for agency-mediated postings (closes [#2037](https://github.com/santifer/career-ops/issues/2037)) ([10bf77f](https://github.com/santifer/career-ops/commit/10bf77fb7c5c2f8eb6ca1a03ba91736f5bf95ca3))


### Bug Fixes

* **web:** add Hired to the states.ts FALLBACK so the degraded path accepts it ([#2282](https://github.com/santifer/career-ops/issues/2282)) ([fd112c9](https://github.com/santifer/career-ops/commit/fd112c972d23cf0028e0411f36f67b1adf5520db))
* **web:** label-aware pipeline.md reader — posted:/trust:/note: never misread as columns ([6c75d9a](https://github.com/santifer/career-ops/commit/6c75d9aa03c919803ffe6939b2ba6f1cf7238db6))
* **web:** propagate the Hired terminal-success state across the whole dashboard ([#2250](https://github.com/santifer/career-ops/issues/2250)) ([29503dc](https://github.com/santifer/career-ops/commit/29503dca07c4f1725675299db48685565f159acb))

## [0.4.0](https://github.com/santifer/career-ops/compare/web-v0.3.0...web-v0.4.0) (2026-07-28)


### Features

* **providers:** add VDAB zero-auth provider ([#2084](https://github.com/santifer/career-ops/issues/2084)) ([6164384](https://github.com/santifer/career-ops/commit/6164384768fa47b7e164e2c36f53e86b2fd620cc))


### Bug Fixes

* **deps:** update dependency next to v16.2.11 [security] ([#2198](https://github.com/santifer/career-ops/issues/2198)) ([b6d1c87](https://github.com/santifer/career-ops/commit/b6d1c871d985c278af51d26fa51ef09274c1076b))
* **web:** resolve nested postcss and sharp advisories via overrides ([#2216](https://github.com/santifer/career-ops/issues/2216)) ([ec02af8](https://github.com/santifer/career-ops/commit/ec02af816abc81b500475f81bf1c2753727a1e79))

## [0.3.0](https://github.com/santifer/career-ops/compare/web-v0.2.0...web-v0.3.0) (2026-07-07)


### Features

* **patterns:** per-agency advance-rate analysis from the Via channel ([b6ce551](https://github.com/santifer/career-ops/commit/b6ce551e4404f15b20404ecc642886cfe8a2c4c5))
* **tracker:** Via channel — end employer vs recruiter/agency intermediary ([#1599](https://github.com/santifer/career-ops/issues/1599)) ([b66c0b4](https://github.com/santifer/career-ops/commit/b66c0b4a76e9f3738bbddac2ebeb612053e0a9cc))


### Bug Fixes

* **deps:** update npm dependencies ([#1593](https://github.com/santifer/career-ops/issues/1593)) ([253c571](https://github.com/santifer/career-ops/commit/253c5719df403cdaa493db27cdd17349f54f7889))
* **tracker:** retrofit remaining positional readers onto the shared header-aware parser ([#1598](https://github.com/santifer/career-ops/issues/1598)) ([369a5ff](https://github.com/santifer/career-ops/commit/369a5ffcf6623750fcbedbd16be7d3c1c84f1111))
* **web:** 44px tap-targets at the component level ([#1629](https://github.com/santifer/career-ops/issues/1629)) ([388542f](https://github.com/santifer/career-ops/commit/388542f3c0a2f82eeac83be8db5b616c213225b9))
* **web:** contrast tokens — AA across both themes ([#1627](https://github.com/santifer/career-ops/issues/1627)) ([ee89bea](https://github.com/santifer/career-ops/commit/ee89bea997702d40d1cc01620f727bbb66146b9b))
* **web:** portals copy + analytics semantics ([#1628](https://github.com/santifer/career-ops/issues/1628)) ([f8daa19](https://github.com/santifer/career-ops/commit/f8daa19d8ea164dd2bbb63834f2d048a34ccaa63))
* **web:** ux-audit cleanup — CostBadge global CSS + last sub-44 stragglers ([#1648](https://github.com/santifer/career-ops/issues/1648)) ([786b960](https://github.com/santifer/career-ops/commit/786b960c2761e88a534886eafdc9d59f82aba56b))

## [0.2.0](https://github.com/santifer/career-ops/compare/web-v0.1.0...web-v0.2.0) (2026-07-05)


### Features

* experimental local-first web UI (opt-in alpha) ([#1451](https://github.com/santifer/career-ops/issues/1451)) ([1791dc4](https://github.com/santifer/career-ops/commit/1791dc4e3a14aeb10decd852c927bb636aefe00d))
* **pipeline:** optional per-offer note in the pipeline writer ([#1483](https://github.com/santifer/career-ops/issues/1483)) ([6435b1a](https://github.com/santifer/career-ops/commit/6435b1a4dc93a9d441df8768e481d878e3309ae3))
* **web:** Config microcopy humanized (P1.5) ([#1538](https://github.com/santifer/career-ops/issues/1538)) ([8ae3475](https://github.com/santifer/career-ops/commit/8ae347502b8380692a5f80f490bc59f20d1c8491))
* **web:** cost affordance — CostBadge muted (P1.6) ([#1536](https://github.com/santifer/career-ops/issues/1536)) ([b212bb3](https://github.com/santifer/career-ops/commit/b212bb3591de4c374347dec40fc400c4d6ab9bda))
* **web:** dedupe bug reports at write — stable fingerprint + click-gated similar-issue search ([#1473](https://github.com/santifer/career-ops/issues/1473)) ([e13a4f3](https://github.com/santifer/career-ops/commit/e13a4f37d6df9d21c0acca1d1716993df036e01d))
* **web:** empty-state free-scan button (P0.1) ([#1534](https://github.com/santifer/career-ops/issues/1534)) ([28f12e3](https://github.com/santifer/career-ops/commit/28f12e39e3e41104bb7a1f3650a0a508701f82fe))
* **web:** extract cleanChips to a tested module + tab/CR paste delimiter ([#1516](https://github.com/santifer/career-ops/issues/1516)) ([7e676f4](https://github.com/santifer/career-ops/commit/7e676f403e16c84231bb08669c79218615a88c83))
* **web:** inbox triage — Abundance → Triage → Shortlist → Opt-in Score ([#1569](https://github.com/santifer/career-ops/issues/1569)) ([f1e6cc0](https://github.com/santifer/career-ops/commit/f1e6cc0ef2dae1f134e9d6bbb152611107a36308))
* **web:** mobile tap-targets ≥44px + FAB clearance ([#1542](https://github.com/santifer/career-ops/issues/1542)) ([7f6fd1c](https://github.com/santifer/career-ops/commit/7f6fd1c8f34fd0137a995bd2bb4b1f295c8a9303))
* **web:** orange hierarchy — brand-soft Mark-applied + inbox cost legend (P1.4) ([#1537](https://github.com/santifer/career-ops/issues/1537)) ([85d8290](https://github.com/santifer/career-ops/commit/85d829018c7b7225a1bbd547c53b817fd165924d))
* **web:** report progressive disclosure (P0.3+P1.8) ([#1535](https://github.com/santifer/career-ops/issues/1535)) ([30fa1d1](https://github.com/santifer/career-ops/commit/30fa1d19d00bf9a269adcef6778c52a1627d668c))
* **web:** richer bug-report diagnostics — data-shape fingerprint, core version, API errors ([#1469](https://github.com/santifer/career-ops/issues/1469)) ([6a13d8a](https://github.com/santifer/career-ops/commit/6a13d8a7a5448c5f488cac1631a1da471c070335))


### Bug Fixes

* correctness sweep across tracker, providers, and eval reporting ([#1528](https://github.com/santifer/career-ops/issues/1528)) ([bd2a44f](https://github.com/santifer/career-ops/commit/bd2a44f4ee1ea6c6def70200d7750969e67ebadf)), closes [#1527](https://github.com/santifer/career-ops/issues/1527)
* **web:** bump FOLLOW-UPS DUE tap-targets to 44px on mobile ([#1568](https://github.com/santifer/career-ops/issues/1568)) ([f5e8362](https://github.com/santifer/career-ops/commit/f5e836268c8a16707566becb51675d0b52a670dd))
* **web:** pin turbopack.root to prevent Windows postcss OOM ([#1530](https://github.com/santifer/career-ops/issues/1530)) ([8560153](https://github.com/santifer/career-ops/commit/8560153ad8aa37a3993418d32f951f25c868c6c4))
* **web:** point the 'Get one free' link at the free-AI-engine guide ([#1540](https://github.com/santifer/career-ops/issues/1540)) ([8369b40](https://github.com/santifer/career-ops/commit/8369b4001ba63be78818240b9dbc3aa94aebe2e8))
* **web:** restore the report-a-bug kit lost between the RC branch and main ([#1456](https://github.com/santifer/career-ops/issues/1456)) ([b11231f](https://github.com/santifer/career-ops/commit/b11231ffc77dfbd36b745b35df0b6ded3bb73720))
