# Changelog

## [1.22.0](https://github.com/santifer/career-ops/compare/career-ops-v1.21.0...career-ops-v1.22.0) (2026-07-21)


### Features

* **cv:** Chinese minimal CV template ([#1990](https://github.com/santifer/career-ops/issues/1990)) ([7cefd61](https://github.com/santifer/career-ops/commit/7cefd616da4700984982b325d9fa817cf5c1eee9))
* **cv:** improve profile-photo configuration and preview ([#1991](https://github.com/santifer/career-ops/issues/1991)) ([7e90f46](https://github.com/santifer/career-ops/commit/7e90f46c1ce9cbb1bdcf679d6d5b249c0f3eaaa0))
* **expand:** add /expand mode to discover missing CV competencies ([#1533](https://github.com/santifer/career-ops/issues/1533)) ([1ea5ee6](https://github.com/santifer/career-ops/commit/1ea5ee6379a90dfb1bec17b01aa538a624953848)), closes [#1521](https://github.com/santifer/career-ops/issues/1521)
* **gemini-eval:** static prefix as systemInstruction for implicit caching ([#1840](https://github.com/santifer/career-ops/issues/1840)) ([bb748d8](https://github.com/santifer/career-ops/commit/bb748d8c6064127ca4ce23b55d59f58984fac2d2))
* **i18n:** Simplified Chinese interview modes (plan/practice/debrief) ([#1977](https://github.com/santifer/career-ops/issues/1977)) ([1634f01](https://github.com/santifer/career-ops/commit/1634f0163a666da438c0b828b7efbbca38d3a3b5))
* **oferta:** Block G signal 9 — third-party platform location tag mismatch ([#1938](https://github.com/santifer/career-ops/issues/1938)) ([add8497](https://github.com/santifer/career-ops/commit/add849703ec66fc64633c519c3e1fc46f93b7386))
* **openai-eval:** host-gated prompt-cache breakpoint for the static prefix ([#1839](https://github.com/santifer/career-ops/issues/1839)) ([4aad129](https://github.com/santifer/career-ops/commit/4aad1292b7767ce2ce10c749b7368d7f1181d394))
* **pdf:** first-class zh-CN typography support ([#1989](https://github.com/santifer/career-ops/issues/1989)) ([ed487f2](https://github.com/santifer/career-ops/commit/ed487f280fbd6dfd6c1cfefe3d80fa5e4cebf28b))
* **pdf:** warn on rendered page overflow, --strict-pages opt-in hard limit ([#1797](https://github.com/santifer/career-ops/issues/1797)) ([f630914](https://github.com/santifer/career-ops/commit/f630914e8b557f1385fb7c98bdc3442b93c058df))
* **pipeline:** per-step token breakdown at end of run ([#2022](https://github.com/santifer/career-ops/issues/2022)) ([8fca469](https://github.com/santifer/career-ops/commit/8fca469745aa99f77da6cc8b64f8f6cf0eb9565d))
* **providers:** add Alibaba Group careers provider ([#2055](https://github.com/santifer/career-ops/issues/2055)) ([cc2e567](https://github.com/santifer/career-ops/commit/cc2e567c3ccff885e24a462d1b1074819b3f7d63))
* **providers:** add Gem scanner provider ([#2024](https://github.com/santifer/career-ops/issues/2024)) ([6579bdf](https://github.com/santifer/career-ops/commit/6579bdfa9ec24c3d038ce283ab7ca25950facd3a))
* **providers:** add Jobvite zero-auth provider ([#1572](https://github.com/santifer/career-ops/issues/1572)) ([be07d6b](https://github.com/santifer/career-ops/commit/be07d6b8c903225e652ba0436f6f1fd24a2904e7))
* **providers:** add Welcome to the Jungle and Agentic Engineering Jobs providers ([#1808](https://github.com/santifer/career-ops/issues/1808)) ([e0a8dc7](https://github.com/santifer/career-ops/commit/e0a8dc73a2f882fd3b078ea24beb2df3927e2860))
* **scan:** --posted-after/--posted-before absolute posting-date filters ([#2067](https://github.com/santifer/career-ops/issues/2067)) ([e8ba1a4](https://github.com/santifer/career-ops/commit/e8ba1a42beec3a638f34a862d238f5e42174dcb1))
* **scan:** add visa_filter for surfacing visa-sponsoring roles ([#1662](https://github.com/santifer/career-ops/issues/1662)) ([995c1dd](https://github.com/santifer/career-ops/commit/995c1ddab6eb1b3aba2fb7ef3e41ff2eb601cc6b)), closes [#2057](https://github.com/santifer/career-ops/issues/2057)


### Bug Fixes

* **arbeitsagentur:** only tag nationwide-remote when homeofficetyp is VOLLSTAENDIG ([#1981](https://github.com/santifer/career-ops/issues/1981)) ([b3b466c](https://github.com/santifer/career-ops/commit/b3b466ca69ca8bb6eb9d7e6484ed340faa10a607))
* drop stale plugins-registry.json from updater path manifests ([#2070](https://github.com/santifer/career-ops/issues/2070)) ([44bf9f6](https://github.com/santifer/career-ops/commit/44bf9f68159fadabb871ce00b2c5e5bafb6918ab))
* honor output language in headless evaluators ([#1916](https://github.com/santifer/career-ops/issues/1916)) ([c2384cd](https://github.com/santifer/career-ops/commit/c2384cdd17335c6bfec9b19ce655ea9cfe784c18))
* **ollama-eval:** move temperature into options where Ollama reads it ([#1842](https://github.com/santifer/career-ops/issues/1842)) ([77864e5](https://github.com/santifer/career-ops/commit/77864e537cdc7f08c6b888e13916e4c215529d84))
* **pdf:** drop empty Education section instead of rendering a bare header ([#2063](https://github.com/santifer/career-ops/issues/2063)) ([46d1585](https://github.com/santifer/career-ops/commit/46d15851a868d8b89c90437f7f8ed4cdf0029883))
* **pdf:** harden optional-section boundaries, extract shared cv-sections-core ([#2072](https://github.com/santifer/career-ops/issues/2072)) ([90c1ed4](https://github.com/santifer/career-ops/commit/90c1ed4c281cb30f2d49a31889984b730762100f))
* **pipeline:** recognize [#1799](https://github.com/santifer/career-ops/issues/1799) score sentinels in verify-pipeline ([#2069](https://github.com/santifer/career-ops/issues/2069)) ([df26599](https://github.com/santifer/career-ops/commit/df2659949fda33f71cceded4782cb592e93f7edd))
* **providers:** build public SmartRecruiters URLs without /postings/ ([#2047](https://github.com/santifer/career-ops/issues/2047)) ([4624242](https://github.com/santifer/career-ops/commit/4624242367056d7c118249279c80b8bb8da62b04))
* **scan-ats-full:** wire content_filter into reverse scans ([#1848](https://github.com/santifer/career-ops/issues/1848)) ([f710ce9](https://github.com/santifer/career-ops/commit/f710ce992758cb6d3644565e818cb6920fdc1cb2))
* **scan:** hide unconfigured salary/content filter summaries ([#1947](https://github.com/santifer/career-ops/issues/1947)) ([b5659a1](https://github.com/santifer/career-ops/commit/b5659a1754c1f90c0e1eaadae3ec08fd8c54000a))
* **scan:** normalize cosmetic URL variants for dedup ([#2079](https://github.com/santifer/career-ops/issues/2079)) ([9ba7f2e](https://github.com/santifer/career-ops/commit/9ba7f2e0fce55ef6c5c63810162413edf185bee5))
* **scan:** seed the company+role dedupe key from all three seen-sources ([#2080](https://github.com/santifer/career-ops/issues/2080)) ([9c2b426](https://github.com/santifer/career-ops/commit/9c2b426d7473b49c7f9562413f9c3c75b675a06e))
* serialize all tracker writers through the shared lock ([#1912](https://github.com/santifer/career-ops/issues/1912)) ([a953da2](https://github.com/santifer/career-ops/commit/a953da2ade0c2585c80832ef77d4fe718ef69afa))
* **test:** keep discovered suites from terminating the run mid-suite ([32dcee0](https://github.com/santifer/career-ops/commit/32dcee07472795cc94258753411861ca0365e322))
* **tracker:** recognize the Hired canonical status in merge-tracker and stats ([#2050](https://github.com/santifer/career-ops/issues/2050)) ([feabcb4](https://github.com/santifer/career-ops/commit/feabcb45003875c6f0bbd1e3e88676a539744e8d))
* **verify-cv-facts:** stop a bare '&lt;' from swallowing source evidence ([#1995](https://github.com/santifer/career-ops/issues/1995)) ([050828b](https://github.com/santifer/career-ops/commit/050828b339f27cc398bf335d6f1c2b8ff2712145))

## [1.21.0](https://github.com/santifer/career-ops/compare/career-ops-v1.20.0...career-ops-v1.21.0) (2026-07-17)


### Features

* **apply:** warn before reapplying to a repeat company ([#1921](https://github.com/santifer/career-ops/issues/1921)) ([6cdca85](https://github.com/santifer/career-ops/commit/6cdca856bfeb6017abbb826afeb0f7282d9dc6f9)), closes [#1920](https://github.com/santifer/career-ops/issues/1920)
* **cover-letter:** support --format and --report CLI arguments ([#1830](https://github.com/santifer/career-ops/issues/1830)) ([88c75cf](https://github.com/santifer/career-ops/commit/88c75cf47a35ea9c41ed803d89f1d288989f2699)), closes [#1828](https://github.com/santifer/career-ops/issues/1828)
* **dashboard:** manifesto shortcut, help entry and footer link ([64e81de](https://github.com/santifer/career-ops/commit/64e81dee1ee0be48475d32248b26d928089f5d50))
* **email:** add confirmed-time no-show follow-up variant ([#1860](https://github.com/santifer/career-ops/issues/1860)) ([c77d138](https://github.com/santifer/career-ops/commit/c77d138faf84e22422d8cb80195d8b4f524eff23)), closes [#1859](https://github.com/santifer/career-ops/issues/1859)
* **interview-prep:** cross-reference coffee chat notes against interview intel ([#1941](https://github.com/santifer/career-ops/issues/1941)) ([2692051](https://github.com/santifer/career-ops/commit/269205162c4af846ca216b611b32d71ff920e012)), closes [#1940](https://github.com/santifer/career-ops/issues/1940)
* **interview-redflag:** flag scope/compensation mismatch as a separate fifth dimension ([#1943](https://github.com/santifer/career-ops/issues/1943)) ([ea57b82](https://github.com/santifer/career-ops/commit/ea57b82652cd7b261935f80001c80b3984843e0f)), closes [#1942](https://github.com/santifer/career-ops/issues/1942)
* **interview-redflag:** suggest a ready-to-copy blacklist row at Reconsider level ([#1856](https://github.com/santifer/career-ops/issues/1856)) ([b645e69](https://github.com/santifer/career-ops/commit/b645e69ab96af5fe5483938da390108bfd816070)), closes [#1854](https://github.com/santifer/career-ops/issues/1854)
* **interview/plan:** wire the existing Panel Intel table into multi-panelist rounds ([#1858](https://github.com/santifer/career-ops/issues/1858)) ([a8ceed2](https://github.com/santifer/career-ops/commit/a8ceed2b79c102cc33c0309f7201b385ec8ab091)), closes [#1857](https://github.com/santifer/career-ops/issues/1857)
* **ledger:** immutable n: ordinal per signature + first-contribution question for new signers ([8ec80b5](https://github.com/santifer/career-ops/commit/8ec80b50d87c0ed3f145a74d62ce7f6771d929d1))
* **liveness:** add Workday to the zero-token ATS liveness API rung ([#1928](https://github.com/santifer/career-ops/issues/1928)) ([f6afdf9](https://github.com/santifer/career-ops/commit/f6afdf97c745de3fe9b6bdc3bb3198a6f412f3b0))
* **oferta:** Block G signal for benefits terminology country mismatch ([#1936](https://github.com/santifer/career-ops/issues/1936)) ([3f0985d](https://github.com/santifer/career-ops/commit/3f0985d3eaea97d6c3d6bc1468e092bcb0bc4ec3)), closes [#1935](https://github.com/santifer/career-ops/issues/1935)
* **onboarding:** route to the manifesto from the README and the first successful scan ([e3a82e0](https://github.com/santifer/career-ops/commit/e3a82e07dff4955d23dd97ea61aeccfc10810a9c))
* **pdf:** add role name to the tailored PDF filename for multi-role tracking ([#1890](https://github.com/santifer/career-ops/issues/1890)) ([e878096](https://github.com/santifer/career-ops/commit/e8780965d93f4d699d79b8d86d8e0c1f68f66437))
* **providers:** add Oracle Recruiting Cloud zero-auth provider ([#1929](https://github.com/santifer/career-ops/issues/1929)) ([52db048](https://github.com/santifer/career-ops/commit/52db0484b7a506173b055bf23edcba4593233bb9))
* **reports:** unified Risk Summary block joining the five company-risk signals ([#1738](https://github.com/santifer/career-ops/issues/1738)) ([f0c742a](https://github.com/santifer/career-ops/commit/f0c742a835dd03411b193d28540a3dd300cb2dc0)), closes [#1737](https://github.com/santifer/career-ops/issues/1737)
* **salary-gap:** track compensation figures stated per interview round ([#1853](https://github.com/santifer/career-ops/issues/1853)) ([8308cd1](https://github.com/santifer/career-ops/commit/8308cd1bbdf2231c743085062e049f0c751c1727)), closes [#1852](https://github.com/santifer/career-ops/issues/1852)
* **scan:** persist and surface the scanner trust signal to pipeline and history ([#1765](https://github.com/santifer/career-ops/issues/1765)) ([16c8497](https://github.com/santifer/career-ops/commit/16c84976b1d39187edd22f6610c48049d00c79d6)), closes [#1743](https://github.com/santifer/career-ops/issues/1743)
* **scan:** track portal health over time and surface coverage decay ([#1768](https://github.com/santifer/career-ops/issues/1768)) ([9bc82e2](https://github.com/santifer/career-ops/commit/9bc82e28620d1db6702b075f651a4ff991208bed)), closes [#1744](https://github.com/santifer/career-ops/issues/1744)


### Bug Fixes

* **cv-template:** keep role header with its bullets when a location line is present ([#1903](https://github.com/santifer/career-ops/issues/1903)) ([66b1024](https://github.com/santifer/career-ops/commit/66b102490943d93ed3afd384b6fbc1e47c5d7d48))
* **doctor:** warn when Node is below 22.5 instead of passing silently ([#1831](https://github.com/santifer/career-ops/issues/1831)) ([30e470d](https://github.com/santifer/career-ops/commit/30e470dea58f06e077d920c0cf1f70f24f74bbbc)), closes [#1829](https://github.com/santifer/career-ops/issues/1829)
* **envrc:** only load the Nix flake when Nix is installed ([#1863](https://github.com/santifer/career-ops/issues/1863)) ([ca23af6](https://github.com/santifer/career-ops/commit/ca23af67b40d83bac3f705467f1fb322a7cefe54))
* **interview-redflag:** drop GitHub PR references from candidate-facing output templates ([aa35162](https://github.com/santifer/career-ops/commit/aa35162f47b09f92e892cb0d6aa9c59dffb8673b))
* **ledger-bot:** make the first-contribution confirmation copy match what ships ([89e1741](https://github.com/santifer/career-ops/commit/89e17418bcf8d177f27a768c5282f0ecdb81cd85))
* **ledger-bot:** restore the 'done' confirmation now that the certificate render is live ([9c033d2](https://github.com/santifer/career-ops/commit/9c033d20f319b412e879539cee4aef864582084a))
* **onboarding:** relay the manifesto note in agent-mediated updates ([0a3abed](https://github.com/santifer/career-ops/commit/0a3abeddfa66ceb2f3e63f5f951fbbcb85481a4b))
* **pdf:** drop empty Projects section instead of rendering a bare header ([#1879](https://github.com/santifer/career-ops/issues/1879)) ([a64d590](https://github.com/santifer/career-ops/commit/a64d59063d234ed65175491da37f83a47f0a35b4))
* **role-matcher:** keep base titles distinct from specialized-suffix siblings ([#1922](https://github.com/santifer/career-ops/issues/1922)) ([723f727](https://github.com/santifer/career-ops/commit/723f727f739e56fe8ad147c124f01851d1649f4d)), closes [#1881](https://github.com/santifer/career-ops/issues/1881)
* **scan-ats-full:** respect data/blacklist.md ([#1914](https://github.com/santifer/career-ops/issues/1914)) ([6512870](https://github.com/santifer/career-ops/commit/65128701a062d30c7754405c687eef4a710a49c8)), closes [#1911](https://github.com/santifer/career-ops/issues/1911)
* **scan:** quiet dotenv so --json stdout stays parseable ([#1907](https://github.com/santifer/career-ops/issues/1907)) ([2e0b29e](https://github.com/santifer/career-ops/commit/2e0b29ebd1a8a2e67c249c65aa132749c99098f9)), closes [#1906](https://github.com/santifer/career-ops/issues/1906)
* unify atomic report number allocation ([#1910](https://github.com/santifer/career-ops/issues/1910)) ([3b265cb](https://github.com/santifer/career-ops/commit/3b265cb765ed7f85aded5ef2daa30ffec0bf42f3)), closes [#1733](https://github.com/santifer/career-ops/issues/1733) [#1801](https://github.com/santifer/career-ops/issues/1801) [#1835](https://github.com/santifer/career-ops/issues/1835) [#1895](https://github.com/santifer/career-ops/issues/1895)
* **update-system:** attribute the post-update manifesto link (utm_source=updater) ([a363ec4](https://github.com/santifer/career-ops/commit/a363ec45ec2fd101d80ca9cf5ba2f882f65cb029))
* **update-system:** surface commit failures instead of silently swallowing them ([#1855](https://github.com/santifer/career-ops/issues/1855)) ([2ad3453](https://github.com/santifer/career-ops/commit/2ad3453980d49a44ce10470b21cd2434db9701fa)), closes [#1844](https://github.com/santifer/career-ops/issues/1844)
* **upskill:** keep fetched JD text as a string in the targeted --url-text path ([#1917](https://github.com/santifer/career-ops/issues/1917)) ([c7e9ff5](https://github.com/santifer/career-ops/commit/c7e9ff5993026131c67fa69077f0b54c293bb059)), closes [#1894](https://github.com/santifer/career-ops/issues/1894)

## [1.20.0](https://github.com/santifer/career-ops/compare/career-ops-v1.19.0...career-ops-v1.20.0) (2026-07-14)


### Features

* **onboarding:** surface the CareerOps Manifesto after updates and setup ([84f2e53](https://github.com/santifer/career-ops/commit/84f2e534dfba7ac3831f0fda670bc6c3eaced788))


### Bug Fixes

* **upskill:** correct inverted known-skill suppression in targeted mode ([#1851](https://github.com/santifer/career-ops/issues/1851)) ([4d95d70](https://github.com/santifer/career-ops/commit/4d95d70704762dabcc540fe1f0b93cc9a2d78c41))

## [1.19.0](https://github.com/santifer/career-ops/compare/career-ops-v1.18.0...career-ops-v1.19.0) (2026-07-13)


### Features

* **batch:** apply compensation reliability checks to batch workers ([#1588](https://github.com/santifer/career-ops/issues/1588)) ([d6cbb2a](https://github.com/santifer/career-ops/commit/d6cbb2a126ef3e9361cb8ff331413df7db8ebd58))
* **browser-extract:** configurable jd-mode text cap via --max-chars ([#1810](https://github.com/santifer/career-ops/issues/1810)) ([7b13dc9](https://github.com/santifer/career-ops/commit/7b13dc9fc0fa5aaf5e8086fa38fd72c629fde080))
* **calibration:** funnel-velocity.mjs — own funnel vs market benchmarks ([#1693](https://github.com/santifer/career-ops/issues/1693), part 1) ([#1694](https://github.com/santifer/career-ops/issues/1694)) ([ff6a022](https://github.com/santifer/career-ops/commit/ff6a02258a25a8b7f6105a5c2104f9baf6acdf70))
* **cv:** fact validator — block invented metrics in generated CVs ([#682](https://github.com/santifer/career-ops/issues/682)) ([b9decee](https://github.com/santifer/career-ops/commit/b9decee90eb00140b89912681deb34d7ecf48f94))
* **dashboard:** add Spanish (es) locale to the i18n catalog ([#1783](https://github.com/santifer/career-ops/issues/1783)) ([2ddb9ce](https://github.com/santifer/career-ops/commit/2ddb9ce548667a0a8adb68e2bdac098d3b3310ff)), closes [#1764](https://github.com/santifer/career-ops/issues/1764)
* **dashboard:** discard reason picker with learning loop ([#1465](https://github.com/santifer/career-ops/issues/1465)) ([7845b11](https://github.com/santifer/career-ops/commit/7845b11efc8d3dc58f1978096e6d4cd7c1cbc650)), closes [#1380](https://github.com/santifer/career-ops/issues/1380)
* **dashboard:** i18n extraction for the Go TUI (split from [#1666](https://github.com/santifer/career-ops/issues/1666)) ([#1672](https://github.com/santifer/career-ops/issues/1672)) ([3b5ef4f](https://github.com/santifer/career-ops/commit/3b5ef4f1052ae2029a2b3f0a024a57809ac36189))
* **email:** ATS-broken fallback scenario — recover a stuck application ([#1741](https://github.com/santifer/career-ops/issues/1741)) ([#1745](https://github.com/santifer/career-ops/issues/1745)) ([4caabf0](https://github.com/santifer/career-ops/commit/4caabf04cf68036039b2112177ca95a4e06aa6f9))
* **i18n:** add Traditional Chinese (zh-TW) modes ([#1371](https://github.com/santifer/career-ops/issues/1371)) ([#1760](https://github.com/santifer/career-ops/issues/1760)) ([d9c338d](https://github.com/santifer/career-ops/commit/d9c338db88b868bb63549f2c998ae2dbb5d71ad7))
* **i18n:** Chinese salary reliability checks — zh mirror of the compensation tiers ([#1589](https://github.com/santifer/career-ops/issues/1589)) ([5771478](https://github.com/santifer/career-ops/commit/5771478c808435fff1ec0666bc0245dc7213d162))
* **img-to-pdf:** convert a screenshot into a PDF for ATS uploads ([#1730](https://github.com/santifer/career-ops/issues/1730)) ([#1731](https://github.com/santifer/career-ops/issues/1731)) ([6b3b4e8](https://github.com/santifer/career-ops/commit/6b3b4e824c480e8d1e3204c4a5a34c75d114e9f0))
* **interview-prep:** URL entry path for a role that was never evaluated ([#1817](https://github.com/santifer/career-ops/issues/1817)) ([b9b54b8](https://github.com/santifer/career-ops/commit/b9b54b8205515e66a41dc3461381dc895f4d9b2f)), closes [#1816](https://github.com/santifer/career-ops/issues/1816)
* **invite-match:** fuzzy-match interview-invite emails to tracker entries ([#1495](https://github.com/santifer/career-ops/issues/1495)) ([10de9d4](https://github.com/santifer/career-ops/commit/10de9d4ab48130d7c794028f00604ae8b9f56223))
* language.output preference — output language decoupled from market modes ([#1035](https://github.com/santifer/career-ops/issues/1035)) ([4f512fb](https://github.com/santifer/career-ops/commit/4f512fbdfa67057d7c06a37437a67f6f55428d45))
* **latex:** opt-in latex-tex in-place tailoring of user-owned .tex CVs ([#695](https://github.com/santifer/career-ops/issues/695)) ([d7128ad](https://github.com/santifer/career-ops/commit/d7128adfc877c39a82bc0f8edef83b4a5bc0bc0c))
* make CLAUDE.md a thin @AGENTS.md wrapper — single canonical agent spec ([#272](https://github.com/santifer/career-ops/issues/272)) ([09528a3](https://github.com/santifer/career-ops/commit/09528a34c46a9914a255489729bdc79b0940ae9b))
* **modes:** wire the opt-in CLI extractor into the oferta + auto-pipeline JD paths ([#1804](https://github.com/santifer/career-ops/issues/1804)) ([3cb7c5b](https://github.com/santifer/career-ops/commit/3cb7c5bdac2ada5ead4edb5bdadd1c2d769ac3f4))
* **oferta:** Block G signal 7 — AI-buzzword vs infrastructure mismatch ([#1683](https://github.com/santifer/career-ops/issues/1683)) ([#1685](https://github.com/santifer/career-ops/issues/1685)) ([7dda430](https://github.com/santifer/career-ops/commit/7dda4302bbadd376444734bed36925072d0c3b97))
* **oferta:** company-type + compensation-reliability tiers in evaluations ([#1587](https://github.com/santifer/career-ops/issues/1587)) ([160093c](https://github.com/santifer/career-ops/commit/160093cbcc4b44cc22af34160a17422bd58a88b5))
* **openrouter:** prompt-cache the static system prefix via cache_control ([#1766](https://github.com/santifer/career-ops/issues/1766)) ([4dacfc8](https://github.com/santifer/career-ops/commit/4dacfc8b172653ecd99ea2223489cdf0c09df192))
* **pdf:** deterministic HTML CV renderer to cut PDF-step token burn ([#557](https://github.com/santifer/career-ops/issues/557)) ([#1681](https://github.com/santifer/career-ops/issues/1681)) ([1e08297](https://github.com/santifer/career-ops/commit/1e082972be2368d61937a05c681f7f0737b91eb9))
* **pdf:** JD skill-gap checker before CV generation, zero-LLM ([#1559](https://github.com/santifer/career-ops/issues/1559)) ([8afdf0b](https://github.com/santifer/career-ops/commit/8afdf0be0e3d8fa3e0fb351750a34fb08fcf3e39)), closes [#1558](https://github.com/santifer/career-ops/issues/1558)
* **pipeline:** openai-tailor.mjs — headless CV tailoring for the no-agent path ([#1669](https://github.com/santifer/career-ops/issues/1669)) ([#1671](https://github.com/santifer/career-ops/issues/1671)) ([4abce71](https://github.com/santifer/career-ops/commit/4abce712a3809aebabd30750d288c758dfad9d2b))
* **providers:** 4dayweek auto-detect with spoof-safe host matching ([#1657](https://github.com/santifer/career-ops/issues/1657) follow-up) ([333d620](https://github.com/santifer/career-ops/commit/333d6203f770efcd52c5a7cf05ce5d5cb0811337))
* **providers:** add LaraJobs zero-auth RSS provider ([0f046b5](https://github.com/santifer/career-ops/commit/0f046b5bd7f24a7ec13ba4a027183ca765d869ca))
* **providers:** add Meituan careers provider ([#1818](https://github.com/santifer/career-ops/issues/1818)) ([0f6b096](https://github.com/santifer/career-ops/commit/0f6b0966ab0f3fef22209513d1af3c949abdd787))
* **providers:** add Tencent careers zero-auth provider ([#230](https://github.com/santifer/career-ops/issues/230)) ([95ba35c](https://github.com/santifer/career-ops/commit/95ba35cfe3f7b6163959d21a493ba156bf524536))
* **registry:** register serper and theirstack provider plugins ([#1645](https://github.com/santifer/career-ops/issues/1645), [#1697](https://github.com/santifer/career-ops/issues/1697)) ([2958a2c](https://github.com/santifer/career-ops/commit/2958a2c4b8d3c851758728b6e17e5b739d077c09))
* **registry:** split plugins-registry.json into per-plugin files ([#1401](https://github.com/santifer/career-ops/issues/1401)) ([6d08316](https://github.com/santifer/career-ops/commit/6d08316722f96af88f74959992d8bbab8c1d4228))
* **reply-watch:** paste-reply.mjs manual input path for users without Gmail ([#1803](https://github.com/santifer/career-ops/issues/1803)) ([4f9e924](https://github.com/santifer/career-ops/commit/4f9e9244ef556286993d9ef6bc8c49cd59f98275)), closes [#1802](https://github.com/santifer/career-ops/issues/1802)
* **scan:** data/blacklist.md — user-owned do-not-apply list ([#1742](https://github.com/santifer/career-ops/issues/1742)) ([#1748](https://github.com/santifer/career-ops/issues/1748)) ([9867d0e](https://github.com/santifer/career-ops/commit/9867d0e7fa33fce009511acebe526755e326c244))
* **scan:** opt-in max_posting_age_days freshness gate ([#1578](https://github.com/santifer/career-ops/issues/1578)) ([8b60a8c](https://github.com/santifer/career-ops/commit/8b60a8cfbe487ce0254432695bab1c2989041df9))
* **scan:** persist provider postedAt to pipeline and scan-history ([#1578](https://github.com/santifer/career-ops/issues/1578)) ([300b6cb](https://github.com/santifer/career-ops/commit/300b6cb613aff388eea632960c3d15110ee9411b))
* **scan:** suppress duplicate roles via company aliases ([#1750](https://github.com/santifer/career-ops/issues/1750)) ([b203ea4](https://github.com/santifer/career-ops/commit/b203ea4183d78b22ca57045a9f9f94d716ef6036))
* spend_tier config for model-agnostic model routing + batch pre-screen gate ([#1007](https://github.com/santifer/career-ops/issues/1007)) ([4dec7eb](https://github.com/santifer/career-ops/commit/4dec7eb2da549ad4712111eaece4719390efbe94))
* **templates:** config-selectable CV and cover-letter templates ([#1690](https://github.com/santifer/career-ops/issues/1690)) ([#1691](https://github.com/santifer/career-ops/issues/1691)) ([7576cfd](https://github.com/santifer/career-ops/commit/7576cfd8deb28eb0b7dd1a7c96cae8f44a91091d))
* **tracker:** assessment-log.mjs — skills-assessment events with staleness signal ([#1684](https://github.com/santifer/career-ops/issues/1684)) ([#1687](https://github.com/santifer/career-ops/issues/1687)) ([d1be88b](https://github.com/santifer/career-ops/commit/d1be88bb7b15839a4ee89841ee6ae582df7eb0ee))
* **tracker:** recognize "—"/"-" as valid score-cell N/A sentinels ([#1800](https://github.com/santifer/career-ops/issues/1800)) ([7280df2](https://github.com/santifer/career-ops/commit/7280df2b84e734a2080552d77d9d1afefe8b67cb)), closes [#1799](https://github.com/santifer/career-ops/issues/1799)
* **upskill:** aggregate skill-gap analysis from tracked reports ([#1520](https://github.com/santifer/career-ops/issues/1520), phase 1) ([fd1f3c9](https://github.com/santifer/career-ops/commit/fd1f3c957b4ab138850c0ceccef7c4d3a9720093))
* **upskill:** targeted &lt;URL&gt; single-posting mode with SSRF-guarded fetch ([#1796](https://github.com/santifer/career-ops/issues/1796)) ([72e5983](https://github.com/santifer/career-ops/commit/72e59839f8cce573f41031f41499ed63104b1d57)), closes [#1739](https://github.com/santifer/career-ops/issues/1739)


### Bug Fixes

* **analyzer:** resolve report paths relative to the tracker file ([#1679](https://github.com/santifer/career-ops/issues/1679)) ([568025c](https://github.com/santifer/career-ops/commit/568025c4677772b0882afbce3609c30ac1a3f7e8))
* **cover:** resolve the cover-letter template through the shared resolver ([#1777](https://github.com/santifer/career-ops/issues/1777)) ([7e1775c](https://github.com/santifer/career-ops/commit/7e1775c483c70da7dc4e63cd9e78cbb286d7c8cf))
* gitignore data/active-interviews.md (user interview data) ([267dfb7](https://github.com/santifer/career-ops/commit/267dfb7079877e2beb2a949eb7b404b7bd257332))
* ignore logo cache directory ([#1577](https://github.com/santifer/career-ops/issues/1577)) ([f51b948](https://github.com/santifer/career-ops/commit/f51b948fb9a7902d4da017840ea83e9dd1d21f6c))
* **liveness:** treat off-posting redirects as uncertain, not active ([c1cd458](https://github.com/santifer/career-ops/commit/c1cd4586606f67aa87f263ee21bc165443851bca))
* load profile and custom rules deterministically in all mode paths ([#1736](https://github.com/santifer/career-ops/issues/1736)) ([#1759](https://github.com/santifer/career-ops/issues/1759)) ([738a5c7](https://github.com/santifer/career-ops/commit/738a5c7969ffc51ec4546e0e8b33a9cbe6cf0fe0))
* **merge-tracker:** preserve empty interior cells in tracker-row parsing ([#1824](https://github.com/santifer/career-ops/issues/1824)) ([a477638](https://github.com/santifer/career-ops/commit/a477638b30a19d95a4a47db5938fb600fb0f75da))
* **pdf:** clean temporary HTML when browser launch fails ([#1786](https://github.com/santifer/career-ops/issues/1786)) ([2c17f04](https://github.com/santifer/career-ops/commit/2c17f04b842910725ae34ff93bdd62c7aeabd7d7))
* **pdf:** render markdown bold in CV summary as &lt;strong&gt; (ATS-safe) ([b12cf41](https://github.com/santifer/career-ops/commit/b12cf41016974d5edce45e346021b3b3861a7fde))
* **portals:** validator accepts provider-plugin ids like the runtime does ([#1756](https://github.com/santifer/career-ops/issues/1756)) ([eee7ec0](https://github.com/santifer/career-ops/commit/eee7ec0546e319ca93140608fc125669fbb737b2))
* **providers:** support explicit api: override for ashby/lever with host-pinned guards ([6e010fe](https://github.com/santifer/career-ops/commit/6e010fe9613ae16fa08b6a291473128c1097af2e))
* **reserve-report-num:** support report numbers past 999 ([#1785](https://github.com/santifer/career-ops/issues/1785)) ([e53b08e](https://github.com/santifer/career-ops/commit/e53b08e9ba7a48ed50da69bb58d7a463318821ea))
* **scan:** restore browser-like headers on Workday CXS requests ([#1813](https://github.com/santifer/career-ops/issues/1813)) ([14022de](https://github.com/santifer/career-ops/commit/14022de87cdfa858c137553e4cd1f8b61a02f755)), closes [#1811](https://github.com/santifer/career-ops/issues/1811)
* **templates:** allowlist the template format to prevent path traversal ([#1776](https://github.com/santifer/career-ops/issues/1776)) ([54fc973](https://github.com/santifer/career-ops/commit/54fc9733ba167228460cc1d6b346e61b030ab08b))
* **test:** normalize CRLF at read time for doc assertions ([#1771](https://github.com/santifer/career-ops/issues/1771)) ([#1772](https://github.com/santifer/career-ops/issues/1772)) ([b7a1ea1](https://github.com/santifer/career-ops/commit/b7a1ea12f3c079b17dee61d9f77f47c36b462ed8))
* **tests:** close CodeQL command-injection findings in the test harness ([9cd6dbc](https://github.com/santifer/career-ops/commit/9cd6dbc0c0dc17361d0babdece2803979f183069))
* **tests:** skip web-reader tests when web/ is absent on core-only installs ([#1675](https://github.com/santifer/career-ops/issues/1675)) ([32dde78](https://github.com/santifer/career-ops/commit/32dde7849b117f2c7c37205327af313f31dc7a5c))
* **tracker:** detect and prevent duplicate tracker # numbers ([#1704](https://github.com/santifer/career-ops/issues/1704)) ([d9cc272](https://github.com/santifer/career-ops/commit/d9cc272c76f69cbf9708477dfadc813abc8d6e23))
* **update-system:** add .claude/hooks/ to USER_PATHS ([#1676](https://github.com/santifer/career-ops/issues/1676)) ([e9bacc4](https://github.com/santifer/career-ops/commit/e9bacc484185f56cec210ea821bf1774e989acea))
* **update-system:** keep the updater self-loading to survive old→new re-exec ([#1706](https://github.com/santifer/career-ops/issues/1706)) ([ce72879](https://github.com/santifer/career-ops/commit/ce7287960b3d16224f8af17ea2f5a5e5e7590543))

## [1.18.0](https://github.com/santifer/career-ops/compare/career-ops-v1.17.0...career-ops-v1.18.0) (2026-07-07)


### Features

* classify application replies and generate review digest ([#1620](https://github.com/santifer/career-ops/issues/1620)) ([f33f9e7](https://github.com/santifer/career-ops/commit/f33f9e74a5bffcefe7c1433730f1275f3d71060e)), closes [#1585](https://github.com/santifer/career-ops/issues/1585)
* **dashboard:** Hired canonical status + job-landed celebration flow ([58736bc](https://github.com/santifer/career-ops/commit/58736bc9b2a643f25f72758bc10c4d7ca45be651))
* **i18n:** add German translations of interview modes ([#1610](https://github.com/santifer/career-ops/issues/1610)) ([a6b6180](https://github.com/santifer/career-ops/commit/a6b618012045fc543e3ced0db10bb1ad37cd75f9))
* **i18n:** add Hindi language support with dedicated modes and documentation ([7463d75](https://github.com/santifer/career-ops/commit/7463d75013149c745f204c21c7823ded4e3f416a))
* **i18n:** add Indonesian (id) modes ([#1474](https://github.com/santifer/career-ops/issues/1474)) ([6262d53](https://github.com/santifer/career-ops/commit/6262d532494e01964c99a30c8ea1347bcd9de730))
* **interview-prep:** structured Panel Intel table ([#1502](https://github.com/santifer/career-ops/issues/1502)) ([72b1d5e](https://github.com/santifer/career-ops/commit/72b1d5e8c442288b59c6455ce2eb25b99b283b4d))
* **interview:** company red-flag detector from transcript signal ([0f4f16f](https://github.com/santifer/career-ops/commit/0f4f16fafc941c0ed326a1344fb915eb649d83ed))
* match employer reply candidates to application tracker ([#1607](https://github.com/santifer/career-ops/issues/1607)) ([30df267](https://github.com/santifer/career-ops/commit/30df267615c205ee5e2506af15288009808a9205)), closes [#1584](https://github.com/santifer/career-ops/issues/1584)
* **oferta:** employment classification risk signal in Block G ([#1631](https://github.com/santifer/career-ops/issues/1631)) ([1d084a2](https://github.com/santifer/career-ops/commit/1d084a2d6c813e7e51e7a9c8c0d5dfe21ef2d820)), closes [#1630](https://github.com/santifer/career-ops/issues/1630)
* offer-prep mode — contract reading companion at Offer stage ([#1634](https://github.com/santifer/career-ops/issues/1634)) ([4490c4b](https://github.com/santifer/career-ops/commit/4490c4b0dda09638592a51c522fb7a6f1e3c9f22)), closes [#1608](https://github.com/santifer/career-ops/issues/1608)
* **offer-prep:** negotiation reply-draft step — draft-only email from Items to raise ([0e79229](https://github.com/santifer/career-ops/commit/0e79229772a7a2bebf38f04179d4702642fa885f))
* **patterns:** per-agency advance-rate analysis from the Via channel ([b6ce551](https://github.com/santifer/career-ops/commit/b6ce551e4404f15b20404ecc642886cfe8a2c4c5))
* **pdf:** allow intentional CV section reordering via --allow-reorder ([1a615d9](https://github.com/santifer/career-ops/commit/1a615d9ced3a5ea23afe17ddef031d85861f8b3b))
* **providers:** add Lever EU instance (jobs.eu.lever.co) ([#1571](https://github.com/santifer/career-ops/issues/1571)) ([bd81e37](https://github.com/santifer/career-ops/commit/bd81e37181c0dab0a9d4c7e4c09a3e74997a7515))
* **providers:** Cornerstone OnDemand (csod) + Rheinmetall ([#1549](https://github.com/santifer/career-ops/issues/1549)) ([ffbbf41](https://github.com/santifer/career-ops/commit/ffbbf41fb35df1a7b97cdcffecc3438d5e64ec86))
* **providers:** EchoJobs zero-auth JSON aggregator provider ([#1655](https://github.com/santifer/career-ops/issues/1655)) ([9509882](https://github.com/santifer/career-ops/commit/95098823e1150af51e9811c796f5a43d8ad8f5a7))
* **providers:** Phenom People (phenom) + Radancy TalentBrew (radancy) ([#1554](https://github.com/santifer/career-ops/issues/1554)) ([e638fed](https://github.com/santifer/career-ops/commit/e638fed2c00ceef9475e79922ac85fed1302a0b7))
* **providers:** TKMS, Heckler & Koch, and Deutsche Bahn providers ([#1555](https://github.com/santifer/career-ops/issues/1555)) ([1422846](https://github.com/santifer/career-ops/commit/14228466983f11a19bef1d311e92dbd365b4f221))
* **registry:** add career-ops-plugin-markdown v0.1.0 ([708fa8b](https://github.com/santifer/career-ops/commit/708fa8b34069d30c74a7dc73b0e58cd4c9339eb7))
* **salary:** mode wiring — advertised_comp + observation appends ([f0414ec](https://github.com/santifer/career-ops/commit/f0414ec0f0e0ae2b86fa6a6e4bba602a721d1749))
* **salary:** salary-gap.mjs — append-only compensation observation analyzer ([8c6dcdd](https://github.com/santifer/career-ops/commit/8c6dcddaaa14f61308b21b04004d2523f7514357))
* **scan:** JD-content fingerprinting — flag agency+direct cross-listings ([#1601](https://github.com/santifer/career-ops/issues/1601)) ([52154fd](https://github.com/santifer/career-ops/commit/52154fd8544fcf949be7c430daa8def5c9319471)), closes [#1597](https://github.com/santifer/career-ops/issues/1597)
* **scan:** opt-in CLI page extractor (browser-extract.mjs) ([557a97d](https://github.com/santifer/career-ops/commit/557a97d44d7b6574fab8c5b61f448caba8bc08e2))
* **scan:** persist per-run scan counters to data/scan-runs.tsv ([#1606](https://github.com/santifer/career-ops/issues/1606)) ([d0d9bd0](https://github.com/santifer/career-ops/commit/d0d9bd05d75e87d2ab21a6ca440cc4ddd92c919b))
* **scan:** scope content_filter per title-category via by_title_keyword ([9c5791b](https://github.com/santifer/career-ops/commit/9c5791bf934d8e909944f6b8e232fc8326954774))
* **scoring:** culture-screen dimension with structural capping ([dc2a8d8](https://github.com/santifer/career-ops/commit/dc2a8d86464bdc719c709f6e0ab5554d83993074))
* **stats:** lifetime pipeline stats aggregator ([#1605](https://github.com/santifer/career-ops/issues/1605)) ([1b23baa](https://github.com/santifer/career-ops/commit/1b23baa1159c01884a6dab54136031a1b5945097))
* titles mode — suggest adjacent job titles from the CV ([#1637](https://github.com/santifer/career-ops/issues/1637)) ([2d7bb04](https://github.com/santifer/career-ops/commit/2d7bb04247950ec4fbcf1f956895334b04daf349)), closes [#1632](https://github.com/santifer/career-ops/issues/1632)
* **tracker:** set-status.mjs — canonical CLI for tracker status updates ([#1460](https://github.com/santifer/career-ops/issues/1460)) ([1750e4c](https://github.com/santifer/career-ops/commit/1750e4c2f26b92b4b7bfd9013c03198361a93b1e)), closes [#1428](https://github.com/santifer/career-ops/issues/1428)
* **tracker:** Via channel — end employer vs recruiter/agency intermediary ([#1599](https://github.com/santifer/career-ops/issues/1599)) ([b66c0b4](https://github.com/santifer/career-ops/commit/b66c0b4a76e9f3738bbddac2ebeb612053e0a9cc))


### Bug Fixes

* **dashboard:** duplicate tracker headers resolve last-occurrence to match JS reader ([#1602](https://github.com/santifer/career-ops/issues/1602)) ([edbfd8d](https://github.com/santifer/career-ops/commit/edbfd8d4e4a395ced64fef13fea6d72c010dab08))
* **deps:** update npm dependencies ([#1593](https://github.com/santifer/career-ops/issues/1593)) ([253c571](https://github.com/santifer/career-ops/commit/253c5719df403cdaa493db27cdd17349f54f7889))
* **modes:** enforce modes/_custom.md overrides across mode files ([#1621](https://github.com/santifer/career-ops/issues/1621)) ([1d87f1e](https://github.com/santifer/career-ops/commit/1d87f1e208d3ca5e38d7afdd76b44d24b976597b)), closes [#1618](https://github.com/santifer/career-ops/issues/1618)
* **modes:** wire modes/_custom.md into the read path — house rules were write-only ([76b45a8](https://github.com/santifer/career-ops/commit/76b45a8997135d8bfaf245876a987264d803b7cb))
* **pdf:** explain the agentic HTML flow in generate-pdf.mjs usage output ([7ae6eb0](https://github.com/santifer/career-ops/commit/7ae6eb0fba5702638518da7e141cdfbb68491582))
* prevent role-matcher from collapsing different seniorities ([#1622](https://github.com/santifer/career-ops/issues/1622)) ([dd45bcb](https://github.com/santifer/career-ops/commit/dd45bcbbdb425caa61183fe02336c51d440598b3)), closes [#1616](https://github.com/santifer/career-ops/issues/1616)
* **scan-ats-full:** reject unrecognized CLI flags with usage help ([#1635](https://github.com/santifer/career-ops/issues/1635)) ([06fa92b](https://github.com/santifer/career-ops/commit/06fa92b021d9b790df1eb28df160daf7501c1493))
* **tracker:** retrofit remaining positional readers onto the shared header-aware parser ([#1598](https://github.com/santifer/career-ops/issues/1598)) ([369a5ff](https://github.com/santifer/career-ops/commit/369a5ffcf6623750fcbedbd16be7d3c1c84f1111))
* **update:** raise local git timeout default 30s -&gt; 120s for cloud-evicted trees ([a7b5dfd](https://github.com/santifer/career-ops/commit/a7b5dfd8c8c42c00f73b1bfa1c51338880637bf8))
* **web:** 44px tap-targets at the component level ([#1629](https://github.com/santifer/career-ops/issues/1629)) ([388542f](https://github.com/santifer/career-ops/commit/388542f3c0a2f82eeac83be8db5b616c213225b9))
* **web:** contrast tokens — AA across both themes ([#1627](https://github.com/santifer/career-ops/issues/1627)) ([ee89bea](https://github.com/santifer/career-ops/commit/ee89bea997702d40d1cc01620f727bbb66146b9b))
* **web:** portals copy + analytics semantics ([#1628](https://github.com/santifer/career-ops/issues/1628)) ([f8daa19](https://github.com/santifer/career-ops/commit/f8daa19d8ea164dd2bbb63834f2d048a34ccaa63))
* **web:** ux-audit cleanup — CostBadge global CSS + last sub-44 stragglers ([#1648](https://github.com/santifer/career-ops/issues/1648)) ([786b960](https://github.com/santifer/career-ops/commit/786b960c2761e88a534886eafdc9d59f82aba56b))

## [1.17.0](https://github.com/santifer/career-ops/compare/career-ops-v1.16.0...career-ops-v1.17.0) (2026-07-05)


### Features

* add the opt-in experimental web UI surface (web/) — isolated versioning, CI and packaging ([432c3c5](https://github.com/santifer/career-ops/commit/432c3c523a13bf0a5053b5d1f3c28c17ef1296eb))
* **add:** /career-ops add — fetch a project/paper/role into cv.md and article-digest.md ([#1476](https://github.com/santifer/career-ops/issues/1476)) ([933c353](https://github.com/santifer/career-ops/commit/933c3536959f29534769fcb92af37c3a60551475))
* **agent-inbox:** queue requests for the next session ([#1472](https://github.com/santifer/career-ops/issues/1472)) ([182554d](https://github.com/santifer/career-ops/commit/182554d1401f0be91b8474df9918dfaf5491c684))
* **apply:** pre-scan forms for knock-out questions before drafting ([#1463](https://github.com/santifer/career-ops/issues/1463)) ([05a85b8](https://github.com/santifer/career-ops/commit/05a85b8bb1b32991a6bed16c19080e47f19a414b))
* **contacto:** short-greeting variant for chat-style outreach ([#1477](https://github.com/santifer/career-ops/issues/1477)) ([8cf19a7](https://github.com/santifer/career-ops/commit/8cf19a76ad381eeebfb7d35abd9d282006c24214))
* **email:** formal application email drafts — draft-only, never sends ([#1515](https://github.com/santifer/career-ops/issues/1515)) ([f7dfb88](https://github.com/santifer/career-ops/commit/f7dfb88f4d18a598db3d1d327648194d98807ef9))
* experimental local-first web UI (opt-in alpha) ([#1451](https://github.com/santifer/career-ops/issues/1451)) ([1791dc4](https://github.com/santifer/career-ops/commit/1791dc4e3a14aeb10decd852c927bb636aefe00d))
* **find:** resolve a company/role/number query to its full pipeline identity ([#1439](https://github.com/santifer/career-ops/issues/1439)) ([3fd0a06](https://github.com/santifer/career-ops/commit/3fd0a06c14481633d28db5a47f9c9317205e9a7d))
* **followup:** seed a pinned first follow-up when a row turns Applied ([#1468](https://github.com/santifer/career-ops/issues/1468)) ([ea6f608](https://github.com/santifer/career-ops/commit/ea6f6086696c68d5437cf6c5007c4a90b161b011))
* **i18n:** add Korean career-ops modes ([#1457](https://github.com/santifer/career-ops/issues/1457)) ([ced5f74](https://github.com/santifer/career-ops/commit/ced5f74b0eadde187e7de76e70f9ab1ce7918d64))
* **i18n:** translate interview modes to French ([#1526](https://github.com/santifer/career-ops/issues/1526)) ([53f77a0](https://github.com/santifer/career-ops/commit/53f77a09000c3437285a77d3ad86e5e1c619a596)), closes [#1489](https://github.com/santifer/career-ops/issues/1489)
* **i18n:** translate interview modes to Spanish ([#1523](https://github.com/santifer/career-ops/issues/1523)) ([3657bf0](https://github.com/santifer/career-ops/commit/3657bf0e8eb0cb2dc922ad43a94c7365c54250dc)), closes [#1490](https://github.com/santifer/career-ops/issues/1490)
* **oferta:** flag 'remote' location contradicted by JD-body signals ([#1459](https://github.com/santifer/career-ops/issues/1459)) ([74b8fcb](https://github.com/santifer/career-ops/commit/74b8fcb1d0bdf0ae6b8563ff805a7b814919b9c1))
* **patterns:** recruiting-process friction signal at company level ([#1467](https://github.com/santifer/career-ops/issues/1467)) ([dde05bc](https://github.com/santifer/career-ops/commit/dde05bc9427e0752723be0c07ae3621aa46ed67d))
* **patterns:** transcript-driven targeting correction (Step 1b) — closes [#960](https://github.com/santifer/career-ops/issues/960) ([#961](https://github.com/santifer/career-ops/issues/961)) ([ed497fb](https://github.com/santifer/career-ops/commit/ed497fb71d67bc1ad03c57d466e1463e205a4fc7))
* **pipeline:** optional per-offer note in the pipeline writer ([#1483](https://github.com/santifer/career-ops/issues/1483)) ([6435b1a](https://github.com/santifer/career-ops/commit/6435b1a4dc93a9d441df8768e481d878e3309ae3))
* **portals:** probe non-ATS boards through the provider layer ([#1529](https://github.com/santifer/career-ops/issues/1529)) ([ba83606](https://github.com/santifer/career-ops/commit/ba836064cea7a99873fc383b254c32a59d07f4dc))
* **profile:** candidate contact-channel preference for outreach CTAs ([#1557](https://github.com/santifer/career-ops/issues/1557)) ([03a17b5](https://github.com/santifer/career-ops/commit/03a17b5874578aab54e2ef9d36702e9c73ba6cf7)), closes [#1556](https://github.com/santifer/career-ops/issues/1556)
* **providers:** add Get on Board (getonbrd) zero-auth provider ([#1442](https://github.com/santifer/career-ops/issues/1442)) ([c53a61c](https://github.com/santifer/career-ops/commit/c53a61c7998f7cdfbf59500deb27493ad3d4ce18))
* **providers:** Amazon (amazon.jobs) and Avature zero-token providers ([#1480](https://github.com/santifer/career-ops/issues/1480)) ([494e947](https://github.com/santifer/career-ops/commit/494e9476cf215e336c255ac5a06fab231a2b256a))
* **providers:** avature self-heals jobOffset→offset pagination ([#1547](https://github.com/santifer/career-ops/issues/1547)) ([7f1a171](https://github.com/santifer/career-ops/commit/7f1a171c23c8f57096223fdf8220e274f2f5c1bc))
* **providers:** beesite (milch & zucker) + softgarden providers ([#1551](https://github.com/santifer/career-ops/issues/1551)) ([220288e](https://github.com/santifer/career-ops/commit/220288e93753933ceafe12f7bcb71ae6788bdeb0))
* **providers:** Dassault Systèmes zero-token provider (Exalead XML) ([#1498](https://github.com/santifer/career-ops/issues/1498)) ([46c0e89](https://github.com/santifer/career-ops/commit/46c0e894daf93d3ac1c683f98fb3bd27e8b1da24))
* **providers:** honour api: on workday and smartrecruiters ([#1496](https://github.com/santifer/career-ops/issues/1496)) ([f77f846](https://github.com/santifer/career-ops/commit/f77f8465a5dc79faed00c6e9510eea3fba76a4ca))
* **providers:** SAP SuccessFactors (RMK) zero-token provider ([#1475](https://github.com/santifer/career-ops/issues/1475)) ([67253c4](https://github.com/santifer/career-ops/commit/67253c49638ef565a32a4aa9f98ef2c895adee5b))
* **providers:** SuccessFactors CSB strategy + bounded health-probe budget ([#1548](https://github.com/santifer/career-ops/issues/1548)) ([81ab0ed](https://github.com/santifer/career-ops/commit/81ab0ede1ac8592ced56b7904627f588092f837e))
* **registry:** add startup boards plugin ([#1413](https://github.com/santifer/career-ops/issues/1413)) ([f2e1d08](https://github.com/santifer/career-ops/commit/f2e1d080ca9eaa8022a53cc91eef313071892aa7))
* **reserve-report-num:** --count N contiguous range reservation ([#1454](https://github.com/santifer/career-ops/issues/1454)) ([a70dd61](https://github.com/santifer/career-ops/commit/a70dd61391d6ee4c7706b9d001dcd833b84547a9))
* **scan:** report unreachable boards with error classification + doctor sweep ([#1455](https://github.com/santifer/career-ops/issues/1455)) ([fd3635f](https://github.com/santifer/career-ops/commit/fd3635f67fc4a83be922306c7d18fb6fb74a296e))
* **verify:** detect duplicate and orphan reports ([#1425](https://github.com/santifer/career-ops/issues/1425)) ([#1441](https://github.com/santifer/career-ops/issues/1441)) ([5c42df3](https://github.com/santifer/career-ops/commit/5c42df3613c4839055a769f81be595677a973c74))
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
* **dedup:** require exact company+role match so distinct same-company roles survive ([#1458](https://github.com/santifer/career-ops/issues/1458)) ([4f387f0](https://github.com/santifer/career-ops/commit/4f387f04e44253c43462c5083e298cfb09a3c844))
* **infra:** exempt web/ from the SYSTEM_PATHS coverage guard (isolation contract) ([8a23564](https://github.com/santifer/career-ops/commit/8a235649881dc5fa5f4511accf154355da155ade))
* **merge-tracker:** detect TSV score/status column order by header ([#1517](https://github.com/santifer/career-ops/issues/1517)) ([423fc1f](https://github.com/santifer/career-ops/commit/423fc1f45ed9e6a5b6e1ed623e14a67a028ccea7)), closes [#1427](https://github.com/santifer/career-ops/issues/1427)
* **merge-tracker:** guard tier-3 fuzzy dedup with req/job number ([#1525](https://github.com/santifer/career-ops/issues/1525)) ([fdb4376](https://github.com/santifer/career-ops/commit/fdb4376f39051db7102bf48eb0ec8d73cafb7ef9)), closes [#1524](https://github.com/santifer/career-ops/issues/1524)
* **onboarding:** auto-copy template seeds in doctor --json ([#782](https://github.com/santifer/career-ops/issues/782), [#1369](https://github.com/santifer/career-ops/issues/1369)) ([#1369](https://github.com/santifer/career-ops/issues/1369)) ([3c06b46](https://github.com/santifer/career-ops/commit/3c06b461903ce2d8c935862b433a1ff2b65039dc))
* **paths:** prefer cygpath over wslpath in toBashPath() ([#1503](https://github.com/santifer/career-ops/issues/1503)) ([b4f5a83](https://github.com/santifer/career-ops/commit/b4f5a83618de4ef90c26ea2130c0bb6dc44d2a85))
* **pdf:** use CSS [@page](https://github.com/page) setup for margins ([#1563](https://github.com/santifer/career-ops/issues/1563)) ([d057218](https://github.com/santifer/career-ops/commit/d057218e0aa1124002b38134e277e8c76e575b38))
* **plugins:** harden manifest path containment against symlink traversal ([#1532](https://github.com/santifer/career-ops/issues/1532)) ([9d0be62](https://github.com/santifer/career-ops/commit/9d0be62f20c45d3b4892a54f780f28a0baf399f0))
* prevent notion plugin from mangling slash-formatted scores ([#1414](https://github.com/santifer/career-ops/issues/1414)) ([#1417](https://github.com/santifer/career-ops/issues/1417)) ([6ea2e5f](https://github.com/santifer/career-ops/commit/6ea2e5f63a172d00e5e64712bc8fb72d6562b680))
* **providers:** avature parser tolerates two live tenant markup variants ([#1541](https://github.com/santifer/career-ops/issues/1541)) ([1f59f2b](https://github.com/santifer/career-ops/commit/1f59f2b6ade03883372e4acb011e8194e43e7a2a))
* **providers:** harden workday pagination against 429s, API caps, and dateless tenants ([#1419](https://github.com/santifer/career-ops/issues/1419)) ([13f80d5](https://github.com/santifer/career-ops/commit/13f80d5643f360b1702d40d449ca330a07752b0d))
* **providers:** update Glints API to v2-alc/searchJobsV3, document Jobstreet GraphQL migration ([#1173](https://github.com/santifer/career-ops/issues/1173)) ([cf863f7](https://github.com/santifer/career-ops/commit/cf863f721585bba32ee6409d708a59afe37b1631))
* **providers:** workday honors ctx.maxPages so the liveness probe stops cleanly ([#1553](https://github.com/santifer/career-ops/issues/1553)) ([39216f0](https://github.com/santifer/career-ops/commit/39216f0661b861d78c5d6700d864a0b9b83e6478))
* **scan:** load .env credentials via optional dotenv import ([#1507](https://github.com/santifer/career-ops/issues/1507)) ([5066b28](https://github.com/santifer/career-ops/commit/5066b284400cbc51b246eeff64c42af9f34e5c43))
* **update:** make updater timeout budgets configurable ([#1564](https://github.com/santifer/career-ops/issues/1564)) ([525c9c0](https://github.com/santifer/career-ops/commit/525c9c0cbc8b6ab5b23a0e612537c75cab83b114))
* **update:** preserve local CLAUDE.md additions during /career-ops update ([#1446](https://github.com/santifer/career-ops/issues/1446)) ([e5f5d25](https://github.com/santifer/career-ops/commit/e5f5d2517ef598350065af1d2475e08bb28c02da))
* **updater:** add .claude/settings.json to USER_PATHS ([#1471](https://github.com/santifer/career-ops/issues/1471)) ([aa8000d](https://github.com/santifer/career-ops/commit/aa8000d84c397145196f8f494beefe86777e1090)), closes [#1408](https://github.com/santifer/career-ops/issues/1408)
* **web:** bump FOLLOW-UPS DUE tap-targets to 44px on mobile ([#1568](https://github.com/santifer/career-ops/issues/1568)) ([f5e8362](https://github.com/santifer/career-ops/commit/f5e836268c8a16707566becb51675d0b52a670dd))
* **web:** pin turbopack.root to prevent Windows postcss OOM ([#1530](https://github.com/santifer/career-ops/issues/1530)) ([8560153](https://github.com/santifer/career-ops/commit/8560153ad8aa37a3993418d32f951f25c868c6c4))
* **web:** point the 'Get one free' link at the free-AI-engine guide ([#1540](https://github.com/santifer/career-ops/issues/1540)) ([8369b40](https://github.com/santifer/career-ops/commit/8369b4001ba63be78818240b9dbc3aa94aebe2e8))
* **web:** restore the report-a-bug kit lost between the RC branch and main ([#1456](https://github.com/santifer/career-ops/issues/1456)) ([b11231f](https://github.com/santifer/career-ops/commit/b11231ffc77dfbd36b745b35df0b6ded3bb73720))

## [1.16.0](https://github.com/santifer/career-ops/compare/career-ops-v1.15.0...career-ops-v1.16.0) (2026-07-02)


### Features

* add interview skill modes — plan, practice, debrief ([#956](https://github.com/santifer/career-ops/issues/956)) ([e17a829](https://github.com/santifer/career-ops/commit/e17a829b0a69262fcf3eacab01791aadf1e42154))
* **apply:** ATS auto-fill for Greenhouse / Ashby / Lever — prepare, don't submit ([#1248](https://github.com/santifer/career-ops/issues/1248)) ([215e6d1](https://github.com/santifer/career-ops/commit/215e6d12f51e3f677c834ee81494320cf887a570))
* **discovery:** seed company universe from VC portfolios (YC / a16z)… ([#1375](https://github.com/santifer/career-ops/issues/1375)) ([9a816f5](https://github.com/santifer/career-ops/commit/9a816f5488e9bfbee616b51f7121441ed2be07c3))
* **patterns:** ATS channel yield analysis — algorithmic-monoculture aware ([#1405](https://github.com/santifer/career-ops/issues/1405)) ([c3b5d9a](https://github.com/santifer/career-ops/commit/c3b5d9a815fdd5831d77c07a0c5767f4ae123a0c))
* **plugins:** seed/successor model — community plugins can supersede a bundled reference ([fa61b0c](https://github.com/santifer/career-ops/commit/fa61b0cfcb84b16c01c07ea3ade0b03a0bae5061))
* **providers:** add HigherEdJobs RSS provider ([#1350](https://github.com/santifer/career-ops/issues/1350)) ([d280a7d](https://github.com/santifer/career-ops/commit/d280a7dee24e9225c03f30cd0f47b78c56a14e76))
* **providers:** add JibeApply provider ([#1400](https://github.com/santifer/career-ops/issues/1400)) ([311ed4a](https://github.com/santifer/career-ops/commit/311ed4a0319d8ad4e8437c5c906d4d97255317f1))
* **providers:** add NoDesk provider ([#1330](https://github.com/santifer/career-ops/issues/1330)) ([7fca4dd](https://github.com/santifer/career-ops/commit/7fca4dd264d6ddbc58978cb079c25d63119bf744))
* **providers:** add Teamtailor zero-auth RSS provider ([#1376](https://github.com/santifer/career-ops/issues/1376)) ([eea80e9](https://github.com/santifer/career-ops/commit/eea80e960a845645e7b68a5057227d26ff834713))
* **registry:** add career-ops-plugin-obsidian v0.1.0 ([#1399](https://github.com/santifer/career-ops/issues/1399)) ([1b26648](https://github.com/santifer/career-ops/commit/1b26648b148fd4efc345ad098c5f46d261e81d83))
* **registry:** add career-ops-plugin-tavily v0.1.0 ([#1348](https://github.com/santifer/career-ops/issues/1348)) ([b5aa464](https://github.com/santifer/career-ops/commit/b5aa464857ee141b03f376eb70c8614b2a24ca98))
* **registry:** add google-calendar plugin v0.1.0 ([#1347](https://github.com/santifer/career-ops/issues/1347)) ([1ebc81f](https://github.com/santifer/career-ops/commit/1ebc81fe17087efd4d318345b7b90d627e0b3c27))
* **scan:** add seniority-tier classifier with optional skip_tiers fi… ([#1361](https://github.com/santifer/career-ops/issues/1361)) ([db6cbce](https://github.com/santifer/career-ops/commit/db6cbce03e9290549488a801544ad4a74746c7b5))


### Bug Fixes

* **cv-template:** keep role titles from orphaning at page breaks ([#1366](https://github.com/santifer/career-ops/issues/1366)) ([cbde5c4](https://github.com/santifer/career-ops/commit/cbde5c4d5c5e6a0c420ad550bfadcdaf78a1e6ca))
* **dashboard:** map tracker columns by header name ([#1327](https://github.com/santifer/career-ops/issues/1327)) ([#1328](https://github.com/santifer/career-ops/issues/1328)) ([8257f69](https://github.com/santifer/career-ops/commit/8257f697ef0c0d5b9e0804344cb0275c80075059))
* **followup-cadence:** schedule first responded follow-up with responded_initial ([#1352](https://github.com/santifer/career-ops/issues/1352)) ([e30dd0b](https://github.com/santifer/career-ops/commit/e30dd0b3ec3a360dfa3d68f81f845c0269a8cf9a))
* **liveness:** add Ashby API rung so live jobs.ashbyhq.com postings aren't false-expired ([#1372](https://github.com/santifer/career-ops/issues/1372)) ([b7bc6f3](https://github.com/santifer/career-ops/commit/b7bc6f38497ff423de3865f6ad729b0f511a8adf))
* **pdf:** anchor the output path-traversal guard to the repo root, not cwd ([5ba3c83](https://github.com/santifer/career-ops/commit/5ba3c83))
* **pdf:** keep a right gutter so right-aligned CV content isn't clipped ([#1341](https://github.com/santifer/career-ops/issues/1341)) ([#1351](https://github.com/santifer/career-ops/issues/1351)) ([37c0703](https://github.com/santifer/career-ops/commit/37c07033de3cf872a9f40cc2ca33f400a1192db7))
* **pdf:** thread manifest metadata through render options ([#1367](https://github.com/santifer/career-ops/issues/1367)) ([c7e2439](https://github.com/santifer/career-ops/commit/c7e2439c1b7d2a031900404439dc2d27d93f1f88))

## [1.15.0](https://github.com/santifer/career-ops/compare/career-ops-v1.14.0...career-ops-v1.15.0) (2026-06-29)


### Features

* add opt-in plugin system (engine + supply-chain governance + registry) ([5ae518a](https://github.com/santifer/career-ops/commit/5ae518a371a62a7dac190d98ffd1685880b782f4))
* add optional profile photo support for resume template ([#264](https://github.com/santifer/career-ops/issues/264)) ([#1221](https://github.com/santifer/career-ops/issues/1221)) ([ec18624](https://github.com/santifer/career-ops/commit/ec18624ca6deb1defe205e8e3e7ea3c8107dabc6))
* **dashboard:** add cover letter hotkey to report viewer ([#994](https://github.com/santifer/career-ops/issues/994)) ([8a5cc51](https://github.com/santifer/career-ops/commit/8a5cc51d57bad926e97a4a4011ddd945ffbbfa51))
* **dashboard:** hotkeys to view (d) and regenerate (D) the CV PDF ([#797](https://github.com/santifer/career-ops/issues/797)) ([07e4014](https://github.com/santifer/career-ops/commit/07e4014b39006dce52d750d23110c3dcc18c717b))
* OpenRouter runner — free models, auto-blacklist, no Claude CLI required ([#53](https://github.com/santifer/career-ops/issues/53)) ([bf380c7](https://github.com/santifer/career-ops/commit/bf380c77c6fe74849482978c62b75db355c9b5f1))
* **providers:** add 4 Day Week provider (public zero-auth API) ([#1318](https://github.com/santifer/career-ops/issues/1318)) ([575da5f](https://github.com/santifer/career-ops/commit/575da5f2e99cf8ffd0ed74df229274a42679dd29))
* **providers:** add Arbeitnow provider ([#1301](https://github.com/santifer/career-ops/issues/1301)) ([c018bfa](https://github.com/santifer/career-ops/commit/c018bfac4810103ce4c59f07a7b4c0f98e21380a))
* **providers:** add Hacker News "Who is hiring?" provider (Algolia API) ([#1309](https://github.com/santifer/career-ops/issues/1309)) ([011aeb4](https://github.com/santifer/career-ops/commit/011aeb47b2089af91f23f02a7806018cdc3508fb))
* **providers:** add Himalayas provider ([#1249](https://github.com/santifer/career-ops/issues/1249)) ([1a6f13a](https://github.com/santifer/career-ops/commit/1a6f13a25db340ff5d29c516efb078cbe10ffac4))
* **providers:** add Jobicy provider ([#1260](https://github.com/santifer/career-ops/issues/1260)) ([5a5782e](https://github.com/santifer/career-ops/commit/5a5782ee68f77b9f5a41de79ff7de9acdf20bd65))
* **providers:** add Jobspresso provider ([#1320](https://github.com/santifer/career-ops/issues/1320)) ([dd06e76](https://github.com/santifer/career-ops/commit/dd06e76ffb37ca7d4bffa7ef2217b69bebff4781))
* **providers:** add Landing.jobs provider ([#1307](https://github.com/santifer/career-ops/issues/1307)) ([c60c1eb](https://github.com/santifer/career-ops/commit/c60c1eb824130d27c1fc82ce15b1435491dd480a))
* **providers:** add Pinpoint ATS provider ([#1287](https://github.com/santifer/career-ops/issues/1287)) ([38271b2](https://github.com/santifer/career-ops/commit/38271b2bc538c419c7b76ac120c8d291da57db5f))
* **providers:** add Rippling ATS provider ([#1303](https://github.com/santifer/career-ops/issues/1303)) ([922ec5f](https://github.com/santifer/career-ops/commit/922ec5fdd1fafcc59e91195723734a9c11ed272a))
* **providers:** add The Hub provider ([#1305](https://github.com/santifer/career-ops/issues/1305)) ([19f221f](https://github.com/santifer/career-ops/commit/19f221f60c7db881ba62fcd91127302b2844e9c7))
* **providers:** add The Muse provider ([#1283](https://github.com/santifer/career-ops/issues/1283)) ([e0db3d7](https://github.com/santifer/career-ops/commit/e0db3d74a98ab3d3a31123c6681329f8f72138c9))
* **scan:** add detect-reposts.mjs repost detection from scan-history.tsv ([#1212](https://github.com/santifer/career-ops/issues/1212)) ([112f632](https://github.com/santifer/career-ops/commit/112f6327cb08ce8461a5367be53a876968583df6))
* **scan:** add JustJoin and NoFluffJobs providers ([#989](https://github.com/santifer/career-ops/issues/989)) ([7d1ca07](https://github.com/santifer/career-ops/commit/7d1ca0750aabd8918a21bd4feebccec1e0389ee2))
* **scan:** persist compensation to pipeline.md ([#1017](https://github.com/santifer/career-ops/issues/1017)) ([8a4567d](https://github.com/santifer/career-ops/commit/8a4567d39d8d93c9854d4be24086d50b36a49de1))
* **scripts:** add build:dashboard and serve:dashboard npm scripts ([#796](https://github.com/santifer/career-ops/issues/796)) ([51f6ee4](https://github.com/santifer/career-ops/commit/51f6ee4fe8e7af146c361ff831549f67d9de5f46))
* **updater:** structural SYSTEM_PATHS coverage check ([#1190](https://github.com/santifer/career-ops/issues/1190)) ([cc44f78](https://github.com/santifer/career-ops/commit/cc44f781270685ab2dcb5b6ba17d88b645412f97))


### Bug Fixes

* **deps:** update dependency playwright to v1.61.1 ([#1296](https://github.com/santifer/career-ops/issues/1296)) ([88ebcf9](https://github.com/santifer/career-ops/commit/88ebcf99d891c1592da12ee8335a9a78148fbac3))
* **eval:** bound research budget to a single-pass query cap ([#1262](https://github.com/santifer/career-ops/issues/1262)) ([771577c](https://github.com/santifer/career-ops/commit/771577cf47ec89b8162da6d6f2ef8f17d2628b42))
* **scan:** tighter company matching and dedup order for cooldown filter ([#1201](https://github.com/santifer/career-ops/issues/1201)) ([7d76fc7](https://github.com/santifer/career-ops/commit/7d76fc7061841db9bcf58acf05c38aa489ffbf3e))
* **security:** harden batch tmpfile, PDF output path, and tracker cells ([#1315](https://github.com/santifer/career-ops/issues/1315)) ([ec3023b](https://github.com/santifer/career-ops/commit/ec3023b6ac9a47932d5e543edd176c72ecdf23f0))
* **tracker:** share header-name column mapping across all readers ([#1293](https://github.com/santifer/career-ops/issues/1293)) ([c54ba3b](https://github.com/santifer/career-ops/commit/c54ba3b5feff3627aec07434230f8434f7de6f3d))

## [1.14.0](https://github.com/santifer/career-ops/compare/career-ops-v1.13.0...career-ops-v1.14.0) (2026-06-28)


### Features

* add modes/_custom.md for user custom instructions ([#1198](https://github.com/santifer/career-ops/issues/1198)) ([3cc8844](https://github.com/santifer/career-ops/commit/3cc8844c51975e2bcd94cb9078bc734a75626c71))
* **apply:** ATS behavioural question matcher from story-bank.md ([#1228](https://github.com/santifer/career-ops/issues/1228)) ([9d79931](https://github.com/santifer/career-ops/commit/9d7993153ffa914f80c3f5198d2deec1f963e49f))
* **archive:** add archive-posting.mjs to save live job postings as PDF ([#697](https://github.com/santifer/career-ops/issues/697)) ([571b114](https://github.com/santifer/career-ops/commit/571b114bb56aedc5d32a4ecd9a5861854acd4ae0))
* **batch:** add --limit flag + budget guide ([0607ee5](https://github.com/santifer/career-ops/commit/0607ee57e176c93422732ee1ad1530cd606f70b6))
* **cli:** add first-class Codex support ([#1269](https://github.com/santifer/career-ops/issues/1269)) ([43a7d0e](https://github.com/santifer/career-ops/commit/43a7d0eb6d7c24232f47a482c7ea0178b00c824d))
* **cli:** add Grok Build CLI support ([0a89381](https://github.com/santifer/career-ops/commit/0a8938186ed8a4787a84b2e5bc1680a55aac59ca))
* **cli:** register Kimi as a supported CLI host ([#1193](https://github.com/santifer/career-ops/issues/1193)) ([d3d34f3](https://github.com/santifer/career-ops/commit/d3d34f38ecabd2fbbe4b387c53504577a6255b6f))
* **cv:** add opt-in profile photo for DACH/European CVs ([fcccd58](https://github.com/santifer/career-ops/commit/fcccd58abf4be7b2d620576ffe754861cab933d4))
* **eval:** add openai-eval.mjs for any OpenAI-compatible endpoint ([#1278](https://github.com/santifer/career-ops/issues/1278)) ([5838391](https://github.com/santifer/career-ops/commit/58383910c365e81f41deed34f6340636674d73f8))
* **modes:** add Danish (da) locale ([5407811](https://github.com/santifer/career-ops/commit/54078118a70fa6b42123a68450bb584206af8ac4))
* **modes:** add EU SWE application calibration mode ([f024317](https://github.com/santifer/career-ops/commit/f02431721ad1cbb7e49882b23ebb4dec00eaafff))
* **modes:** add recruiter-side application heuristics ([2ea0814](https://github.com/santifer/career-ops/commit/2ea0814b8436aeae76200a70d2df6be795e498e0))
* **ollama:** add local interactive Ollama evaluator ([#681](https://github.com/santifer/career-ops/issues/681)) ([1b44790](https://github.com/santifer/career-ops/commit/1b447901198fa4defba79062acc3ce1e219373f5))
* **providers:** add Comeet ATS provider ([#1222](https://github.com/santifer/career-ops/issues/1222)) ([f5af817](https://github.com/santifer/career-ops/commit/f5af81760436b38901ba4f1c090c1f077b90941e))
* **providers:** add Personio ATS provider ([#1223](https://github.com/santifer/career-ops/issues/1223)) ([f25570b](https://github.com/santifer/career-ops/commit/f25570b3a5ecbaa18adf6ef6579e167ed3b68294))
* **providers:** add WeWorkRemotely RSS provider ([#1243](https://github.com/santifer/career-ops/issues/1243)) ([39ea2d4](https://github.com/santifer/career-ops/commit/39ea2d4324b1279737f7640e9d0b447a2608e159)), closes [#1241](https://github.com/santifer/career-ops/issues/1241)
* **scan:** add early trust validation and job trust metadata ([#985](https://github.com/santifer/career-ops/issues/985)) ([ef07461](https://github.com/santifer/career-ops/commit/ef07461a8d3c4b29418e39a450c0fae4450257f7))
* **scan:** preserve job location in pipeline.md ([#1015](https://github.com/santifer/career-ops/issues/1015)) ([7671517](https://github.com/santifer/career-ops/commit/76715172f3abc23c62af963977306f3ec721408e))


### Bug Fixes

* **batch:** single-worker lock fallback + exit-127 shim-swap retry ([#910](https://github.com/santifer/career-ops/issues/910)) ([9a6e2ce](https://github.com/santifer/career-ops/commit/9a6e2ce5eaaa841b6ffdeaa04af034e2ee063a0a))
* **modes:** bound subagent delegation to prevent research fan-out ([#1268](https://github.com/santifer/career-ops/issues/1268)) ([1cf34a9](https://github.com/santifer/career-ops/commit/1cf34a91f6840440de5d641805d118c4c65d29cc)), closes [#1235](https://github.com/santifer/career-ops/issues/1235)
* **plugin:** drop non-schema skills/permissions keys from plugin.json ([5ff910c](https://github.com/santifer/career-ops/commit/5ff910c0014a9d0f6061b65acd2472d15a72487b))
* **scan:** trim title-filter keywords before the length check ([#1261](https://github.com/santifer/career-ops/issues/1261)) ([0842bbf](https://github.com/santifer/career-ops/commit/0842bbf2beb1a6601bbdf2e06bc9b0a5a77e5cb2))
* **template:** scope break-inside to atomic units to prevent CV pagination breaks ([7ef8182](https://github.com/santifer/career-ops/commit/7ef81821684b9959acc0f9e76bef2169ca5d6ec0))
* **updater:** resolve self-reexec checkout from the import closure ([#1267](https://github.com/santifer/career-ops/issues/1267)) ([0a830b5](https://github.com/santifer/career-ops/commit/0a830b5092076b2c7037e4d24ea2b86067b400a9)), closes [#1245](https://github.com/santifer/career-ops/issues/1245)

## [1.13.0](https://github.com/santifer/career-ops/compare/career-ops-v1.12.0...career-ops-v1.13.0) (2026-06-25)


### Features

* **arbeitsagentur:** config-driven remoteMatch + server-side homeoffice filter ([#1189](https://github.com/santifer/career-ops/issues/1189)) ([a463308](https://github.com/santifer/career-ops/commit/a4633080f4444a06f4b01b875a79137b534115fc))
* **batch:** add --skip-pdf flag to batch-runner.sh ([#1182](https://github.com/santifer/career-ops/issues/1182)) ([256a289](https://github.com/santifer/career-ops/commit/256a289de8bac8ed134a556b62c8ef2bffc3d713))
* **dashboard:** add in-viewer status picker overlay ([#1195](https://github.com/santifer/career-ops/issues/1195)) ([cc53485](https://github.com/santifer/career-ops/commit/cc534858f5a52bfe0af50c1188c2665488b20c94))
* **dashboard:** customizable columns with column picker ([#979](https://github.com/santifer/career-ops/issues/979)) ([9d1404f](https://github.com/santifer/career-ops/commit/9d1404f32022b552e2dea1d773e0a10a22e2c004))
* **dashboard:** recognize EUR/GBP/CHF pay and international cities in pipeline derive ([#1157](https://github.com/santifer/career-ops/issues/1157)) ([a1c7ce2](https://github.com/santifer/career-ops/commit/a1c7ce296afc0ab2657caefb63323ef544bf745b))
* **liveness:** zero-token ATS API check before Playwright (closes [#574](https://github.com/santifer/career-ops/issues/574)) ([#1181](https://github.com/santifer/career-ops/issues/1181)) ([44f9e64](https://github.com/santifer/career-ops/commit/44f9e6438f8eeaa4dd9f7c36844354256c94f6ae))
* **modes:** add Polish (pl) locale modes ([#1129](https://github.com/santifer/career-ops/issues/1129)) ([51711b3](https://github.com/santifer/career-ops/commit/51711b34ad6764283308245f21023f6337926c12))
* **modes:** optional voice-dna.md writing guardrail ([#998](https://github.com/santifer/career-ops/issues/998)) ([018eb0f](https://github.com/santifer/career-ops/commit/018eb0f692b801104959739151a4303cf5d2717e))
* **portals:** add verify-portals.mjs ATS slug validator ([#1016](https://github.com/santifer/career-ops/issues/1016)) ([7aeb016](https://github.com/santifer/career-ops/commit/7aeb01652d1b6c00ce31f561aa40b61c631515d0))
* **providers:** add BambooHR provider ([#1141](https://github.com/santifer/career-ops/issues/1141)) ([39bb6b2](https://github.com/santifer/career-ops/commit/39bb6b26151e9d1fae8dd6f55aa0deecd467d055))
* **providers:** add Breezy HR scanner provider ([#1185](https://github.com/santifer/career-ops/issues/1185)) ([6249bcb](https://github.com/santifer/career-ops/commit/6249bcb41be7ce0d05209d237e967cc910e46302))
* **scan:** add --json output, --include-undated, and --shuffle to scan-ats-full ([#1199](https://github.com/santifer/career-ops/issues/1199)) ([12206f7](https://github.com/santifer/career-ops/commit/12206f7e7b1bd9bafe0c8258b4951cab667e9f2e))
* **tracker:** add `delete --num N` to remove an application row safely ([#1200](https://github.com/santifer/career-ops/issues/1200)) ([a644392](https://github.com/santifer/career-ops/commit/a64439297e820f7de52d533eaa66b38ed5d08701))


### Bug Fixes

* auto-create data/pipeline.md and harden Playwright doctor check ([#1059](https://github.com/santifer/career-ops/issues/1059)) ([188cf76](https://github.com/santifer/career-ops/commit/188cf7601aa5d776b10a0c33c035e4d0f6199dfe))
* **batch:** harden status score handling ([#1133](https://github.com/santifer/career-ops/issues/1133)) ([fbce3f2](https://github.com/santifer/career-ops/commit/fbce3f28db22a07750082514e4fbf456b379bf5a))
* **batch:** use awk instead of bc for score math ([#735](https://github.com/santifer/career-ops/issues/735)) ([afa74c2](https://github.com/santifer/career-ops/commit/afa74c2b8755b2e0f33d164c92e0beccf528dc88))
* **contract:** expand interview-prep/* coverage in DATA_CONTRACT ([#1060](https://github.com/santifer/career-ops/issues/1060)) ([d19db79](https://github.com/santifer/career-ops/commit/d19db79554362cdd26736fef10bdaa9afaba4624))
* **dashboard:** rewrite only the Status cell on status update ([#1186](https://github.com/santifer/career-ops/issues/1186)) ([b1cba0f](https://github.com/santifer/career-ops/commit/b1cba0feb1e6a8aa1bec2fdb143f3f53ff01fd11))
* images not rendering in PDF output due to about:blank origin ([#1165](https://github.com/santifer/career-ops/issues/1165)) ([81752df](https://github.com/santifer/career-ops/commit/81752df3889a7fa6bce76c5f406482203c1cfdab))
* normalize report links from data files ([#1134](https://github.com/santifer/career-ops/issues/1134)) ([6ae011f](https://github.com/santifer/career-ops/commit/6ae011f22813b63879707f35affc9584fffdb891))
* **providers:** harden lever/ashby/workday against SSRF via redirect ([950aad5](https://github.com/santifer/career-ops/commit/950aad59475a95ddcf842f1556c0de839d5b50a1))
* **recruitee:** keep offer URLs on tenant custom domains ([#1116](https://github.com/santifer/career-ops/issues/1116)) ([7c7fd99](https://github.com/santifer/career-ops/commit/7c7fd994d005557c0f14c4f29376ead33ced4d9f))
* **scan:** guard title-filter keyword normalization against malformed config ([#1187](https://github.com/santifer/career-ops/issues/1187)) ([68c0cdf](https://github.com/santifer/career-ops/commit/68c0cdf340a6066c21038ae6e8665ffc4d8c22d2))
* **scan:** match short acronym title-filter keywords on word boundaries ([#1102](https://github.com/santifer/career-ops/issues/1102)) ([424f864](https://github.com/santifer/career-ops/commit/424f8645d2339b76eaf427629029d34627ac7ccd))
* **template:** emit mailto:/tel: links for email and phone in CV header ([#1167](https://github.com/santifer/career-ops/issues/1167)) ([7a4b3b6](https://github.com/santifer/career-ops/commit/7a4b3b6b3d508c9e2d2064df2a45e942a6a78335))
* **templates:** disable fi/fl ligatures for ATS-clean PDF text extraction ([#1175](https://github.com/santifer/career-ops/issues/1175)) ([#1176](https://github.com/santifer/career-ops/issues/1176)) ([51ef241](https://github.com/santifer/career-ops/commit/51ef24101bd2684ddb4103c51f1ac0df6c9f26ee))

## [1.12.0](https://github.com/santifer/career-ops/compare/career-ops-v1.11.0...career-ops-v1.12.0) (2026-06-18)


### Features

* **batch:** add --status and --watch progress monitoring to batch-runner.sh ([#922](https://github.com/santifer/career-ops/issues/922)) ([#966](https://github.com/santifer/career-ops/issues/966)) ([802552f](https://github.com/santifer/career-ops/commit/802552ff72809d36f42c00ff4cd36affb0f6bf1f))
* **cli:** add Antigravity CLI compatibility ([61de18d](https://github.com/santifer/career-ops/commit/61de18db165cf864c11afd7d4e3224bc7fe6596b))
* **i18n:** add Chinese language modes for China-market job seekers ([#934](https://github.com/santifer/career-ops/issues/934)) ([#965](https://github.com/santifer/career-ops/issues/965)) ([207f960](https://github.com/santifer/career-ops/commit/207f9600e4cf15718ae44d064c9e9ec7cc7a77b3))
* **pdf:** render Japanese CVs with a lang="ja" CJK font fallback ([#1053](https://github.com/santifer/career-ops/issues/1053)) ([d0d57d1](https://github.com/santifer/career-ops/commit/d0d57d184649615b638812156a24c87ceafab8a2))
* **providers:** add Jobstreet and Glints providers for the Indonesian market ([728d547](https://github.com/santifer/career-ops/commit/728d54777dd546fef37373b400aa13cfee38f374)), closes [#1085](https://github.com/santifer/career-ops/issues/1085)
* **providers:** add RemoteOK, Remotive, Working Nomads, IBM board providers ([349bacc](https://github.com/santifer/career-ops/commit/349bacc9d9ad377d6d85ae35fe87625c1b3a6114)), closes [#1075](https://github.com/santifer/career-ops/issues/1075)
* **providers:** port Arbeitsagentur to an in-process provider ([#1095](https://github.com/santifer/career-ops/issues/1095)) ([504a2f0](https://github.com/santifer/career-ops/commit/504a2f054625c16f777693a56c789599c0bacdfa))
* **scan:** add content/description filter for providers ([#974](https://github.com/santifer/career-ops/issues/974)) ([21d6c86](https://github.com/santifer/career-ops/commit/21d6c86f12071217aefbcbca397ebb957f361f92))


### Bug Fixes

* **ashby:** include secondaryLocations so EU-eligible roles surface ([a84d3f5](https://github.com/santifer/career-ops/commit/a84d3f51e436e8b36305c38d2ed5dd8438aa5f90)), closes [#1073](https://github.com/santifer/career-ops/issues/1073)
* **batch:** reconcile pipeline.md inbox after batch runs ([#712](https://github.com/santifer/career-ops/issues/712)) ([34c3d0e](https://github.com/santifer/career-ops/commit/34c3d0ea60e1dcfda4985112ef4577bbb8b1faf3))
* **dashboard:** archetype regex matches English and Spanish reports ([#977](https://github.com/santifer/career-ops/issues/977)) ([d619d3b](https://github.com/santifer/career-ops/commit/d619d3b5ca24fda2ab94cf90111f2b42b2f2691a))
* **dashboard:** open Windows targets without shell ([#987](https://github.com/santifer/career-ops/issues/987)) ([6dc36fb](https://github.com/santifer/career-ops/commit/6dc36fb0792d1157ec96bfb5c3ac4f10cf303305))
* **dashboard:** report last-contact in calendar days, not hours-since-midnight ([#1057](https://github.com/santifer/career-ops/issues/1057)) ([4e05cfd](https://github.com/santifer/career-ops/commit/4e05cfda98b5dccfd2c664c12335ee20812b451b))
* **followup:** resolve report path relative to tracker directory ([752f3b9](https://github.com/santifer/career-ops/commit/752f3b9d598686e56227d8c48063213fdd302a85)), closes [#1070](https://github.com/santifer/career-ops/issues/1070)
* **followup:** use the real application date from notes, not the eval date ([#1096](https://github.com/santifer/career-ops/issues/1096)) ([#1097](https://github.com/santifer/career-ops/issues/1097)) ([53785c8](https://github.com/santifer/career-ops/commit/53785c895750b5c69876ed5b1d6d05fb86c022be))
* **gemini:** validate evaluation report shape ([#819](https://github.com/santifer/career-ops/issues/819)) ([a0aa264](https://github.com/santifer/career-ops/commit/a0aa26421b9abc14079f950519bad934134db66c))
* **latex:** language-agnostic section validation + CJK guard ([#1054](https://github.com/santifer/career-ops/issues/1054)) ([b147504](https://github.com/santifer/career-ops/commit/b147504ade6f1f6fb0445dbe09dfcf380ab01260))
* **merge-tracker:** require company match for number-based dedup ([2bb514f](https://github.com/santifer/career-ops/commit/2bb514f31b38c7a520545da0c4d3567f7103f608)), closes [#912](https://github.com/santifer/career-ops/issues/912)
* **pdf:** auto-install Playwright chromium after update ([eb504ad](https://github.com/santifer/career-ops/commit/eb504adec46ac7b144d1cbc8ca6e2cc6f18173e3))
* **pdf:** use ATS-safe system fonts for clean CV text extraction ([17033e8](https://github.com/santifer/career-ops/commit/17033e8213a519aa082e790b3cc4702f5bd7266b)), closes [#1074](https://github.com/santifer/career-ops/issues/1074)
* **pipeline:** add batch liveness sweep for unconfirmed entries ([#750](https://github.com/santifer/career-ops/issues/750)) ([#973](https://github.com/santifer/career-ops/issues/973)) ([e9eba87](https://github.com/santifer/career-ops/commit/e9eba87367740080e2330b0c6f1e025231e01d86))
* **scan:** sanitize external metadata before writes ([#1098](https://github.com/santifer/career-ops/issues/1098)) ([61bad36](https://github.com/santifer/career-ops/commit/61bad36fc4547c7f28b1ed92e963c9f8143c35c5))
* **security:** harden local-parser against command/arg injection and scan-ats against SSRF ([721f1a8](https://github.com/santifer/career-ops/commit/721f1a863a83d188242a474df3e54c2b673e5b99))
* **tracker:** preserve notes column when rewriting rows without a trailing pipe ([#1004](https://github.com/santifer/career-ops/issues/1004)) ([0569518](https://github.com/santifer/career-ops/commit/0569518b22eae190df0eeb6675536aaa89c71840))
* **update:** materialize skill entrypoints without symlinks ([#1067](https://github.com/santifer/career-ops/issues/1067)) ([3ef63c8](https://github.com/santifer/career-ops/commit/3ef63c8531c60c3cd1a5f8a6088097f914b89907))
* **updater:** git-safety on abort + preserve user files on safety-violation rollback ([#915](https://github.com/santifer/career-ops/issues/915)) ([#1099](https://github.com/santifer/career-ops/issues/1099)) ([deef636](https://github.com/santifer/career-ops/commit/deef6365fa01604f7d6abcd14e1817e22c0d2b05))

## [1.11.0](https://github.com/santifer/career-ops/compare/career-ops-v1.10.0...career-ops-v1.11.0) (2026-06-15)


### Features

* add first-class OpenCode support alongside Claude Code ([#707](https://github.com/santifer/career-ops/issues/707)) ([2710fbe](https://github.com/santifer/career-ops/commit/2710fbe9b31cd0c6d1a8765cd5e04c255ede4ca3))
* **cover:** add optional salutation/greeting to cover letters ([#1010](https://github.com/santifer/career-ops/issues/1010)) ([99346c1](https://github.com/santifer/career-ops/commit/99346c148fbd19e4040be457f860b27fe678e8d7))
* **cover:** load _profile.md so personalization governs the letter ([#1012](https://github.com/santifer/career-ops/issues/1012)) ([dff56d3](https://github.com/santifer/career-ops/commit/dff56d3903c85251e6fdd008feb02ba464a5d0dc))
* **doctor:** warn when Playwright MCP tools are not configured ([#938](https://github.com/santifer/career-ops/issues/938)) ([0222224](https://github.com/santifer/career-ops/commit/0222224c108c210d715ef4f5cac42a2edac24809))
* **tracker:** map tracker columns by header name ([#954](https://github.com/santifer/career-ops/issues/954)) ([57b34c0](https://github.com/santifer/career-ops/commit/57b34c07e01cd106528936398507e1b4552ca295))
* **tracker:** SQLite derived index over applications.md — phase 1 ([#919](https://github.com/santifer/career-ops/issues/919)) ([5465f16](https://github.com/santifer/career-ops/commit/5465f162bb71dec8a25391265bdd498db2d6b512))


### Bug Fixes

* **cv:** align certification org column width across rows ([#931](https://github.com/santifer/career-ops/issues/931)) ([e27b051](https://github.com/santifer/career-ops/commit/e27b051eaf1d96ea56ebbeabd7535d19225922d2))
* **deps:** update npm dependencies to v1.61.0 ([#1023](https://github.com/santifer/career-ops/issues/1023)) ([5407247](https://github.com/santifer/career-ops/commit/54072470ab440b1b358a18ab6de9672cc4cb5649))
* **eval:** gate dead links before evaluation in oferta and auto-pipeline ([#937](https://github.com/santifer/career-ops/issues/937)) ([ebf9a13](https://github.com/santifer/career-ops/commit/ebf9a13762f5bbb2e0d9bdf17c7f0b96e32c4e94))
* **generate-pdf:** inline local fonts as data: URLs so they actually embed ([#952](https://github.com/santifer/career-ops/issues/952)) ([08d1e9a](https://github.com/santifer/career-ops/commit/08d1e9a504cfa8198fb1c84ee824b80de2324df8))
* **merge-tracker:** serialize concurrent tracker merges with a filesystem lock ([#941](https://github.com/santifer/career-ops/issues/941)) ([0d57994](https://github.com/santifer/career-ops/commit/0d579944d99276cf85d0d2280cc2697ee7a95140))
* **pdf:** wait for load instead of networkidle during render ([#929](https://github.com/santifer/career-ops/issues/929)) ([fd2ce04](https://github.com/santifer/career-ops/commit/fd2ce043713874f354980dca0e5778272cdb96a0))
* remove story-bank.md from git tracking ([#944](https://github.com/santifer/career-ops/issues/944)) ([67662b9](https://github.com/santifer/career-ops/commit/67662b9dad68175a06c631baac523437a93d44f2))
* **skill:** surface latex mode in command menus ([#928](https://github.com/santifer/career-ops/issues/928)) ([2803348](https://github.com/santifer/career-ops/commit/2803348129078960d752c34e75bf253cd32aec06))
* **tests:** run tracker-mutating scripts with --dry-run in script checks ([#925](https://github.com/santifer/career-ops/issues/925)) ([1acf27d](https://github.com/santifer/career-ops/commit/1acf27d2d154b8d12c246c8c5fed443dec08384b))
* **tracker:** prevent dedup from deleting distinct same-company roles ([#950](https://github.com/santifer/career-ops/issues/950)) ([98b32a4](https://github.com/santifer/career-ops/commit/98b32a445abe1bb464dbc15ebb1c450a82772564))
* **update:** distribute missing runtime paths ([#991](https://github.com/santifer/career-ops/issues/991)) ([85ae717](https://github.com/santifer/career-ops/commit/85ae717b8dd331a87ffb58f66181465f4509a17c))
* **update:** match Release Please component-prefixed tags in version check ([#926](https://github.com/santifer/career-ops/issues/926)) ([6f0e289](https://github.com/santifer/career-ops/commit/6f0e2890e91b178cdc82a403427152247516e559))
* **update:** rebuild dashboard binary after Go source changes ([#953](https://github.com/santifer/career-ops/issues/953)) ([5382d37](https://github.com/santifer/career-ops/commit/5382d37f65dde222d73ce059f804be9f4853d922))
* **update:** use target updater manifest during apply ([#983](https://github.com/santifer/career-ops/issues/983)) ([539e47b](https://github.com/santifer/career-ops/commit/539e47bdc59462c883964549a01e312d58e996e1))

## [1.10.0](https://github.com/santifer/career-ops/compare/career-ops-v1.9.0...career-ops-v1.10.0) (2026-06-11)


### Features

* **apply:** add preflight liveness and role-match gate ([#887](https://github.com/santifer/career-ops/issues/887)) ([42bb9ab](https://github.com/santifer/career-ops/commit/42bb9ab1aa73397d88a6759def9d4579c979eac3))
* **batch:** pause batch runner on Claude session limits ([#874](https://github.com/santifer/career-ops/issues/874)) ([ae6beec](https://github.com/santifer/career-ops/commit/ae6beec28b83fb184325f3fd261816684613b3ae))
* **cover:** add cover letter generation mode ([#807](https://github.com/santifer/career-ops/issues/807)) ([493f822](https://github.com/santifer/career-ops/commit/493f82268608b447fab2a4b5f60d8ee169bc2679))
* **cv:** add build-cv-latex.mjs structured JSON to LaTeX renderer ([#905](https://github.com/santifer/career-ops/issues/905)) ([b4af01f](https://github.com/santifer/career-ops/commit/b4af01f0858ecd707bcd168b3771a6d3cd76f2ba))
* **dashboard:** keep discard reason visible in pipeline preview ([#914](https://github.com/santifer/career-ops/issues/914)) ([3200dfe](https://github.com/santifer/career-ops/commit/3200dfe34805b5e5f2cfc1850da31bdad1c627fa))
* **dashboard:** sortable Location, Pay, and Last-contact columns in pipeline view ([#798](https://github.com/santifer/career-ops/issues/798)) ([265a95b](https://github.com/santifer/career-ops/commit/265a95befd4f5d0b42ecee104446129898f4ad0c))
* dockerize project for hosts blocked from native Playwright install ([#625](https://github.com/santifer/career-ops/issues/625)) ([66404a8](https://github.com/santifer/career-ops/commit/66404a81a617ad0b076df2a8607aad03996124a7))
* **doctor:** adopt doctor --json as the single onboarding state source ([#888](https://github.com/santifer/career-ops/issues/888)) ([35e2124](https://github.com/santifer/career-ops/commit/35e212429ec98442d83fe47b08636c5688f90055))
* **followup:** read cadence settings from profile.yml ([#889](https://github.com/santifer/career-ops/issues/889)) ([8050c37](https://github.com/santifer/career-ops/commit/8050c37870fe2e3fe14c1da836f00d1a7a8819fe))
* **i18n:** add full Arabic language support and modes ([#764](https://github.com/santifer/career-ops/issues/764)) ([333bb81](https://github.com/santifer/career-ops/commit/333bb81bcc4e3d7e93928ba1b6d155110ce79cd7))
* **modes:** add interactive interview onboarding subcommand ([#909](https://github.com/santifer/career-ops/issues/909)) ([46a5c59](https://github.com/santifer/career-ops/commit/46a5c5914aab6389ab51d4d393d5575a06f229e6))
* **scan:** add --rediscover-404 fallback for moved tracked postings ([#808](https://github.com/santifer/career-ops/issues/808)) ([7096dbc](https://github.com/santifer/career-ops/commit/7096dbc31067963f0a08d95185f7a2b4c5539f91))
* **scan:** add configurable salary filtering to the zero-token scanner ([#677](https://github.com/santifer/career-ops/issues/677)) ([a6ea02e](https://github.com/santifer/career-ops/commit/a6ea02ea354de05f6cb50a6c578fab3e1c5c0dd8))
* **scan:** add portals.yml schema validator ([#886](https://github.com/santifer/career-ops/issues/886)) ([3340695](https://github.com/santifer/career-ops/commit/33406955e5c619c088a0e3063b6e08d445dc1105))
* **scan:** add scan-ats-full.mjs — reverse-discover jobs from public ATS APIs ([#746](https://github.com/santifer/career-ops/issues/746)) ([7801dc7](https://github.com/santifer/career-ops/commit/7801dc7ecdc1ef1a3385fe6eb0797bb03cf6d047))
* **scan:** add scan-history TTL and recheck policy ([#895](https://github.com/santifer/career-ops/issues/895)) ([1db4cf2](https://github.com/santifer/career-ops/commit/1db4cf2072bdb235bb423b61d2d4da4773c9fa49))
* **scan:** add SolidJobs provider and job_boards support ([#853](https://github.com/santifer/career-ops/issues/853)) ([79862a9](https://github.com/santifer/career-ops/commit/79862a9e0ed0938576e91f6785c7fbc5dc2c4d7c))


### Bug Fixes

* **apply:** preserve form field contracts ([#821](https://github.com/santifer/career-ops/issues/821)) ([2b38fd0](https://github.com/santifer/career-ops/commit/2b38fd09e59e5b709069a1f504f3a8553a1cc0f7))
* **batch:** append profile context to worker prompts ([#815](https://github.com/santifer/career-ops/issues/815)) ([4989afc](https://github.com/santifer/career-ops/commit/4989afc112e9fa052b3d489cb5ba198ee0a552ee))
* **batch:** isolate workers from inherited MCP to prevent parallel deadlock ([#809](https://github.com/santifer/career-ops/issues/809)) ([c8c0dbd](https://github.com/santifer/career-ops/commit/c8c0dbd5f96874530f70a2e490f261ee5eaa3ed0))
* **batch:** stop after min-score skip instead of falling through to completed ([#873](https://github.com/santifer/career-ops/issues/873)) ([888ca31](https://github.com/santifer/career-ops/commit/888ca3139411feb5282a3a2ec53c5f8a8390f0e4))
* **dashboard:** resolve tracker-relative report links against the tracker directory ([#780](https://github.com/santifer/career-ops/issues/780)) ([858fc93](https://github.com/santifer/career-ops/commit/858fc9334f38f8767ec3d93cdac4bdb5e754aeff)), closes [#779](https://github.com/santifer/career-ops/issues/779)
* **doctor:** single source of truth for onboarding state via doctor --json ([#765](https://github.com/santifer/career-ops/issues/765)) ([eb536c4](https://github.com/santifer/career-ops/commit/eb536c49580ba17a9e63064f3893248a4c58c576))
* **flake:** declare systems so the devShell resolves on macOS ([#848](https://github.com/santifer/career-ops/issues/848)) ([e5f0903](https://github.com/santifer/career-ops/commit/e5f09038e7cd9135db535927db219813d94a71ce)), closes [#334](https://github.com/santifer/career-ops/issues/334)
* **liveness:** stop false-expiring postings behind anti-bot walls ([#783](https://github.com/santifer/career-ops/issues/783)) ([a667c33](https://github.com/santifer/career-ops/commit/a667c337acc4b68e3e937fd4ce5280bb77b3ce4a))
* **merge-tracker:** require company match on exact entry-number dedup ([#867](https://github.com/santifer/career-ops/issues/867)) ([10ad2de](https://github.com/santifer/career-ops/commit/10ad2de161f7d45ee51e7895c4a47aa556207cb3))
* **merge-tracker:** use token-union ratio in roleFuzzyMatch to stop cross-role dedup ([#793](https://github.com/santifer/career-ops/issues/793)) ([cfa7505](https://github.com/santifer/career-ops/commit/cfa750573a8dfbcc3b825311e6c910d51719e54f)), closes [#751](https://github.com/santifer/career-ops/issues/751)
* **patterns:** parse header-style and Detected-archetype formats in analyze-patterns ([#723](https://github.com/santifer/career-ops/issues/723)) ([abf603c](https://github.com/santifer/career-ops/commit/abf603c885eab6b3741b0cf41297ac2b9a960cc4))
* **pdf:** reject CV section ordering that diverges from cv.md source ([#817](https://github.com/santifer/career-ops/issues/817)) ([9f6acc2](https://github.com/santifer/career-ops/commit/9f6acc2acf5e77ab504990bb483d0e2c29c9b313))
* **pipeline:** atomic report-number reservation for parallel workers ([#803](https://github.com/santifer/career-ops/issues/803)) ([c42368c](https://github.com/santifer/career-ops/commit/c42368c189b611044a666d7d11fe81ba5a78c6ad))
* **release:** auto-sync VERSION via release-please generic extra-file ([214f5f8](https://github.com/santifer/career-ops/commit/214f5f8a7ca06f8b1225aed49709022e4c9f32e8))
* **release:** sync VERSION file to 1.9.0 ([461e3d9](https://github.com/santifer/career-ops/commit/461e3d91f6a48419c5b51fa17e6765bf8d174a3c))
* **security:** close SSRF guard bypasses in liveness-browser ([#917](https://github.com/santifer/career-ops/issues/917)) ([1f525c4](https://github.com/santifer/career-ops/commit/1f525c4e4a661c1153b526e3e210a444007e388e))
* **update:** bootstrap tracker-links.mjs and scaffolder/ for v1.8.x to v1.9.0 upgrades ([#921](https://github.com/santifer/career-ops/issues/921)) ([1d3a18b](https://github.com/santifer/career-ops/commit/1d3a18be5822fe40feb3e5629890a3eb7d752bcf))
* **update:** run curl version checks concurrently in check() ([#896](https://github.com/santifer/career-ops/issues/896)) ([8f0ed38](https://github.com/santifer/career-ops/commit/8f0ed384245f8f859da08e188d873367ffc394f6))
* **update:** use curl in check() so updates work inside the Claude Code sandbox ([#802](https://github.com/santifer/career-ops/issues/802)) ([8cac7f3](https://github.com/santifer/career-ops/commit/8cac7f33deeba69674682c5d77883b0e5b3eaba2)), closes [#754](https://github.com/santifer/career-ops/issues/754)

## [1.9.0](https://github.com/santifer/career-ops/compare/career-ops-v1.8.0...career-ops-v1.9.0) (2026-06-09)


### Features

* add npx career-ops scaffolder for one-command install ([#856](https://github.com/santifer/career-ops/issues/856)) ([ce4fa58](https://github.com/santifer/career-ops/commit/ce4fa5825c74c50506e5cdb5018d79840e2e2fe5)), closes [#855](https://github.com/santifer/career-ops/issues/855)
* add structured machine summaries to evaluations ([#444](https://github.com/santifer/career-ops/issues/444)) ([19a1820](https://github.com/santifer/career-ops/commit/19a1820f99e05db68508a2b769379384636a9e83))
* add Ukrainian language and market support ([#323](https://github.com/santifer/career-ops/issues/323)) ([06d70d3](https://github.com/santifer/career-ops/commit/06d70d30b26754228e7560e6477f94e8d5360874))
* **batch:** add --model flag to batch-runner.sh ([#504](https://github.com/santifer/career-ops/issues/504)) ([44def35](https://github.com/santifer/career-ops/commit/44def35c23c43e91d9633951d90f4ff50773c931))
* **dashboard:** /-key live search across pipeline rows ([#526](https://github.com/santifer/career-ops/issues/526)) ([433f34f](https://github.com/santifer/career-ops/commit/433f34f20aec61c68fda5dd9274a06919d0d7fc2))
* **i18n:** add Turkish (TR) language modes ([#341](https://github.com/santifer/career-ops/issues/341)) ([e87eb57](https://github.com/santifer/career-ops/commit/e87eb576df3aa394a7e28acd9f04a805ca0ca696))
* **interview-prep:** split prep by interviewer audience ([#489](https://github.com/santifer/career-ops/issues/489)) ([d86b86c](https://github.com/santifer/career-ops/commit/d86b86c93ada6cd8d74213357a1566f17dccd280))
* make PDF auto-generation configurable via auto_pdf_score_threshold ([#715](https://github.com/santifer/career-ops/issues/715)) ([fdbf4e1](https://github.com/santifer/career-ops/commit/fdbf4e13ef6143294b22cc42fb3e03294905880c))
* **scan:** add --verify flag to drop expired postings before pipeline append ([#487](https://github.com/santifer/career-ops/issues/487)) ([82f0c2e](https://github.com/santifer/career-ops/commit/82f0c2ef9ee2155cf70300c2f64e15eeaf40a69e))
* **scan:** add local-parser provider and agent skip rules ([#595](https://github.com/santifer/career-ops/issues/595)) ([b3ef0ae](https://github.com/santifer/career-ops/commit/b3ef0ae3d7ca9ebffc1d8a524408c5dfa42e3446))
* **scan:** add optional always_allow tier to location_filter ([#652](https://github.com/santifer/career-ops/issues/652)) ([d152da3](https://github.com/santifer/career-ops/commit/d152da36e7625c229d15f6f2ef92ab43d4398cc8)), closes [#650](https://github.com/santifer/career-ops/issues/650)
* **scan:** add Workable, SmartRecruiters, Recruitee ATS parsers ([#653](https://github.com/santifer/career-ops/issues/653)) ([ea7b2a6](https://github.com/santifer/career-ops/commit/ea7b2a673eab73e258f33f64fcb0844df0b36d9d)), closes [#651](https://github.com/santifer/career-ops/issues/651)


### Bug Fixes

* **batch:** wait and retry batch workers on rate limits ([#816](https://github.com/santifer/career-ops/issues/816)) ([f498ccf](https://github.com/santifer/career-ops/commit/f498ccf5e1027032de8402715e1483d780a7ad84)), closes [#505](https://github.com/santifer/career-ops/issues/505)
* **dashboard:** width-aware Markdown rendering with table wrapping in viewer ([#513](https://github.com/santifer/career-ops/issues/513)) ([dc3a247](https://github.com/santifer/career-ops/commit/dc3a247733d9fb7eb7159836bed743a587231192))
* **gemini:** auto-merge Gemini evals into the tracker instead of a manual-edit reminder ([#820](https://github.com/santifer/career-ops/issues/820)) ([6efac1a](https://github.com/santifer/career-ops/commit/6efac1a27b64e546a9a3ef31b25478cce571a365))
* make tracker report links relative to the tracker file ([#760](https://github.com/santifer/career-ops/issues/760)) ([#761](https://github.com/santifer/career-ops/issues/761)) ([c0d42cd](https://github.com/santifer/career-ops/commit/c0d42cda026d902dfc226364e018a8fd5c8d94b3))
* **pdf:** don't spell out ambiguous ¥ currency symbol ([4c415a9](https://github.com/santifer/career-ops/commit/4c415a9128c2ecaf2150e6e484324bc53a524dc6))
* **pdf:** normalize arrows, middots, and currency symbols for ATS extraction ([#731](https://github.com/santifer/career-ops/issues/731)) ([f164eba](https://github.com/santifer/career-ops/commit/f164ebadbb1430af8bdc541e1af70af52d05c81e)), closes [#730](https://github.com/santifer/career-ops/issues/730)
* register the career-ops skill in Claude Code via user_invocable key ([#801](https://github.com/santifer/career-ops/issues/801)) ([3ddb00c](https://github.com/santifer/career-ops/commit/3ddb00ce14cd7dd7af42410e4f3f3a1311ef787d)), closes [#763](https://github.com/santifer/career-ops/issues/763)
* **release:** sync VERSION file to 1.8.0 ([541917f](https://github.com/santifer/career-ops/commit/541917f627f3f328e5411a54685f5e8706761499))
* **scaffolder:** don't pre-create user config so agent onboarding triggers ([#858](https://github.com/santifer/career-ops/issues/858)) ([cd827be](https://github.com/santifer/career-ops/commit/cd827bed557b96ab2dba7a0496c73827ba51277a)), closes [#855](https://github.com/santifer/career-ops/issues/855)
* **scan:** bootstrap providers/ on update + harden greenhouse detect() ([#696](https://github.com/santifer/career-ops/issues/696)) ([4b12081](https://github.com/santifer/career-ops/commit/4b120817fc1a07d4664ff764bf2a1c51e443b524))
* **scan:** raise Ashby provider timeout + add backoff retry ([#755](https://github.com/santifer/career-ops/issues/755)) ([1aa6c63](https://github.com/santifer/career-ops/commit/1aa6c63a34b448414826d0c7a7cfa161583c256f))
* **scan:** surface websearch-handoff companies in the run summary ([#814](https://github.com/santifer/career-ops/issues/814)) ([137c7b3](https://github.com/santifer/career-ops/commit/137c7b3f3149f2aac9a2c7c1e9120c90d073d79b)), closes [#747](https://github.com/santifer/career-ops/issues/747)
* scope npm package as @santifer/career-ops ([#857](https://github.com/santifer/career-ops/issues/857)) ([87ef561](https://github.com/santifer/career-ops/commit/87ef561b63ca7221ed0476326a96c41421f01103))
* **update-system:** add tracker-links.mjs to SYSTEM_PATHS ([8287cf4](https://github.com/santifer/career-ops/commit/8287cf4eaa00ae40bb236020e9d2892c0d539f76))
* **update-system:** apply() safety violation reverts cleanly and releases lock ([#484](https://github.com/santifer/career-ops/issues/484)) ([980153c](https://github.com/santifer/career-ops/commit/980153c315ec3fbbe6f9195c77d2f865b5a2e1a0))
* **update-system:** bootstrap liveness-browser.mjs for v1.7→v1.8 upgrades ([#725](https://github.com/santifer/career-ops/issues/725)) ([1ea95f2](https://github.com/santifer/career-ops/commit/1ea95f293e742945fb4ba9befee4db8c50df6d2f)), closes [#704](https://github.com/santifer/career-ops/issues/704)
* **update-system:** rollback() removes paths absent from backup branch ([#483](https://github.com/santifer/career-ops/issues/483)) ([f94a3be](https://github.com/santifer/career-ops/commit/f94a3be25890d83ee2664175bbe1bebf1f3eb033))
* **update:** distribute missing modes, locales and CLI configs via update-system ([#868](https://github.com/santifer/career-ops/issues/868)) ([03b2c94](https://github.com/santifer/career-ops/commit/03b2c948cf5340f1c31a7711e8858fe0d30b86fd))
* **update:** timestamp backup branches and roll back to the newest ([#813](https://github.com/santifer/career-ops/issues/813)) ([1717f9c](https://github.com/santifer/career-ops/commit/1717f9c3167cee942c99ca290cdf58398e466863)), closes [#733](https://github.com/santifer/career-ops/issues/733)

## [1.8.0](https://github.com/santifer/career-ops/compare/career-ops-v1.7.1...career-ops-v1.8.0) (2026-05-15)


### Features

* **scan:** optional location_filter in portals.yml + persist location to scan-history ([#570](https://github.com/santifer/career-ops/issues/570)) ([d692647](https://github.com/santifer/career-ops/commit/d692647c253a0bf92a4f9f3b8043afe2c8161853))


### Bug Fixes

* **batch:** workers read modes/_profile.md and config/profile.yml ([#537](https://github.com/santifer/career-ops/issues/537)) ([150e223](https://github.com/santifer/career-ops/commit/150e223ba679246a378e7815da95b6b6d1c5e6ad)), closes [#534](https://github.com/santifer/career-ops/issues/534)
* **deps:** update dotenv to v17 ([#499](https://github.com/santifer/career-ops/issues/499)) ([ce1330e](https://github.com/santifer/career-ops/commit/ce1330efc45e9da462e81ccce3d5f27db9f8a623))
* **gemini-eval:** include profile.yml and _profile.md in evaluation ([#618](https://github.com/santifer/career-ops/issues/618)) ([73dc603](https://github.com/santifer/career-ops/commit/73dc6038d2e723997426d73d3a0c5040c48dd033)), closes [#617](https://github.com/santifer/career-ops/issues/617)
* **gemini-eval:** redact API key from error logs, harden summary parsing ([#582](https://github.com/santifer/career-ops/issues/582)) ([fdca4de](https://github.com/santifer/career-ops/commit/fdca4ded87e1dbde0571fe740da061da491f46c7))
* **gemini-eval:** switch default model to non-deprecated endpoint, surface 429 guidance ([#615](https://github.com/santifer/career-ops/issues/615)) ([dd3e036](https://github.com/santifer/career-ops/commit/dd3e0366d26719af7be234786a16512f46ac9e85)), closes [#614](https://github.com/santifer/career-ops/issues/614)
* **manifest:** align plugin.json skills field with Claude Code plugin schema ([#612](https://github.com/santifer/career-ops/issues/612)) ([a77d3f6](https://github.com/santifer/career-ops/commit/a77d3f6aa3f5c278665c95c5a12048e4df66d337))
* **merge-tracker:** preserve short specialty acronyms, require non-baseline overlap ([#634](https://github.com/santifer/career-ops/issues/634)) ([5ed3b3d](https://github.com/santifer/career-ops/commit/5ed3b3d7ea693547153ef734ab5f6016414c3301)), closes [#633](https://github.com/santifer/career-ops/issues/633)
* **modes:** make /career-ops deep respect user language, not JD language ([#568](https://github.com/santifer/career-ops/issues/568)) ([e5f0508](https://github.com/santifer/career-ops/commit/e5f0508b94299a0e6b46918ecca2f483de0a58c6))
* **portals:** update Weights & Biases entry to CoreWeave acquisition ([#493](https://github.com/santifer/career-ops/issues/493)) ([1411cdc](https://github.com/santifer/career-ops/commit/1411cdc461de05a6772c854188053bcaeeb4ee32))
* **release:** sync VERSION file to 1.7.1 ([2ebfcab](https://github.com/santifer/career-ops/commit/2ebfcabdb4cf7973e279e56f8eae001a8dadc5ed))
* **scan:** validate Greenhouse URL hostname against allowlist to prevent SSRF ([#602](https://github.com/santifer/career-ops/issues/602)) ([988f7bb](https://github.com/santifer/career-ops/commit/988f7bb2a642f91d6cce1e2fc94f08658b72e099))
* **templates:** align CV certification rows on a 3-column grid ([#638](https://github.com/santifer/career-ops/issues/638)) ([082cd11](https://github.com/santifer/career-ops/commit/082cd11c32b917fe3aeef709ff4f386371af3e64))
* **update-system:** allow writing-samples/README.md as system-owned file ([#562](https://github.com/santifer/career-ops/issues/562)) ([207fd07](https://github.com/santifer/career-ops/commit/207fd076da3b2a30f0384fdb19312078ebdcf71f))
* **update-system:** bootstrap .agents/ for v1.6→v1.7 migration ([#654](https://github.com/santifer/career-ops/issues/654)) ([4714504](https://github.com/santifer/career-ops/commit/47145048716d3716a2f1cb0b46377a88e5df73c0))
* **update-system:** defensive VERSION parsing for release-please marker ([#547](https://github.com/santifer/career-ops/issues/547)) ([bf84886](https://github.com/santifer/career-ops/commit/bf848860cb2c7976f6e77e1b5d7b60ed5e9d0d14))

## [1.7.1](https://github.com/santifer/career-ops/compare/career-ops-v1.7.0...career-ops-v1.7.1) (2026-05-12)


### Bug Fixes

* **release:** sync VERSION file to 1.7.0 ([8e554cc](https://github.com/santifer/career-ops/commit/8e554cc4437c3a58e813378abb9b35e2e08a007e))
* **update-system:** include .agents/ in SYSTEM_PATHS ([#600](https://github.com/santifer/career-ops/issues/600)) ([3a71469](https://github.com/santifer/career-ops/commit/3a714695c63ca01a6581b4307885be2055319784))

## [1.7.0](https://github.com/santifer/career-ops/compare/career-ops-v1.6.0...career-ops-v1.7.0) (2026-05-06)


### Features

* adapt contacto mode by contact type (recruiter/HM/peer/interviewer) ([9fd5a90](https://github.com/santifer/career-ops/commit/9fd5a90896f20020f48455cd079b64fed491b89f))
* add --min-score flag to batch runner ([#249](https://github.com/santifer/career-ops/issues/249)) ([cb0c7f7](https://github.com/santifer/career-ops/commit/cb0c7f7d7d3b9f3f1c3dc75ccac0a08d2737c01e))
* add {{PHONE}} placeholder to CV template ([#287](https://github.com/santifer/career-ops/issues/287)) ([e71595f](https://github.com/santifer/career-ops/commit/e71595f8ba134971ecf1cc3c3420d9caf21eed43))
* add Block G — posting legitimacy assessment ([3a636ac](https://github.com/santifer/career-ops/commit/3a636ac586659bb798ef46a0a9798478a1e28b0a))
* add Claude Code plugin manifests (path-stable) ([62b767d](https://github.com/santifer/career-ops/commit/62b767dcc56e4c875ed70bf4fe799c254ecf8eea))
* add follow-up cadence tracker mode ([4308c37](https://github.com/santifer/career-ops/commit/4308c375033c6df430308235f4324658a8353b81))
* add Gemini CLI native integration and evaluator script  ([#349](https://github.com/santifer/career-ops/issues/349)) ([0853486](https://github.com/santifer/career-ops/commit/0853486d2c01a35adafea2cc6b6d8c429b843588))
* add Gemini CLI native integration and evaluator script (closes [#344](https://github.com/santifer/career-ops/issues/344)) ([0853486](https://github.com/santifer/career-ops/commit/0853486d2c01a35adafea2cc6b6d8c429b843588))
* add GitHub Actions CI + auto-labeler + welcome bot + /run skill ([2ddf22a](https://github.com/santifer/career-ops/commit/2ddf22a6a2731b38bcaed5786c4855c4ab9fe722))
* add LaTeX/Overleaf CV export mode with pdflatex compilation ([#362](https://github.com/santifer/career-ops/issues/362)) ([b824953](https://github.com/santifer/career-ops/commit/b824953d0e3b7f8c6105dfcce7e17257c95ce6cd))
* add LaTeX/Overleaf CV export mode with pdflatex compilation (closes [#47](https://github.com/santifer/career-ops/issues/47)) ([b824953](https://github.com/santifer/career-ops/commit/b824953d0e3b7f8c6105dfcce7e17257c95ce6cd))
* add Nix flake devshell with Playwright support ([c579fcd](https://github.com/santifer/career-ops/commit/c579fcddebf793f00cfad8534fd74085c09017fb))
* add OpenCode slash commands for career-ops ([#67](https://github.com/santifer/career-ops/issues/67)) ([93caaed](https://github.com/santifer/career-ops/commit/93caaed49cbc9f3214f9beb66fb2281c3f2370e6))
* add scan.mjs — zero-token portal scanner ([8c19b2b](https://github.com/santifer/career-ops/commit/8c19b2b59f7087689e004f3d48e912f291911373))
* add writing-samples folder for AI-detection-evading voice calibration ([9ae201d](https://github.com/santifer/career-ops/commit/9ae201d0682a17e7006ed7902b42db8234212e97))
* **cv:** add cv.output_format to route between html and latex generation ([b82bb5f](https://github.com/santifer/career-ops/commit/b82bb5fb7c86ab3074a54eaf0f3186f81d41f417))
* **dashboard:** add Catppuccin Latte light theme with auto-detection ([ff686c8](https://github.com/santifer/career-ops/commit/ff686c8af97a7bf93565fe8eeac677f998cc9ece))
* **dashboard:** add manual refresh shortcut ([#246](https://github.com/santifer/career-ops/issues/246)) ([4b5093a](https://github.com/santifer/career-ops/commit/4b5093a8ef1733c449ec0821f722f996625fcb84))
* **dashboard:** add progress analytics screen ([623c837](https://github.com/santifer/career-ops/commit/623c837bf3155fd5b7413554240071d40585dd7e))
* **dashboard:** add rejected and discarded pipeline tabs ([7d05967](https://github.com/santifer/career-ops/commit/7d05967389fb6185f0d6e566a4ba583ee3824e1e))
* **dashboard:** add vim motions to pipeline screen ([#262](https://github.com/santifer/career-ops/issues/262)) ([d149e54](https://github.com/santifer/career-ops/commit/d149e541402db0c88161a71c73899cd1836a1b2d))
* **dashboard:** aligned tables and markdown syntax rendering in viewer ([dbd1d3f](https://github.com/santifer/career-ops/commit/dbd1d3f7177358d0384d6e661d1b0dfc1f60bd4e))
* **dashboard:** show tracker IDs in pipeline list ([8d289c6](https://github.com/santifer/career-ops/commit/8d289c64e31f81cf447f75105b500d1feca21058))
* expand portals.example.yml with 8 dev-tools companies + 23 search queries ([#140](https://github.com/santifer/career-ops/issues/140)) ([b7f555d](https://github.com/santifer/career-ops/commit/b7f555d7b9a7b23c875fa0d35584df534961dabe))
* **i18n:** add Japanese README + language modes for Japan market ([20a2c81](https://github.com/santifer/career-ops/commit/20a2c817486968ca42a534aa86838c797d599c10))
* **latex:** add tectonic engine auto-detect with pdflatex fallback ([4b71b2c](https://github.com/santifer/career-ops/commit/4b71b2cbf4fd49d3882cdd8767e31727337fab34))
* multi-CLI support via open agent skill standard ([#572](https://github.com/santifer/career-ops/issues/572)) ([7605a5e](https://github.com/santifer/career-ops/commit/7605a5ed68d0fd559374afec1cd8798c487e3ead))
* **portals:** add Canada/Vancouver and automation companies to example template ([590ba6e](https://github.com/santifer/career-ops/commit/590ba6e1b4b9d2d9d03893b7f5fdae920d4f9a0b))


### Bug Fixes

* 10 bug fixes — resource leaks, command injection, Unicode, navigation ([cb01a2c](https://github.com/santifer/career-ops/commit/cb01a2c2e3b7fc334b1c4594749ea40b0da8fc62))
* add data/ fallback to UpdateApplicationStatus ([#55](https://github.com/santifer/career-ops/issues/55)) ([3512b8e](https://github.com/santifer/career-ops/commit/3512b8ef4eb8ca967bc967664f8798af42b58a52))
* add stopword filtering and overlap ratio to roleMatch ([#248](https://github.com/santifer/career-ops/issues/248)) ([4da772d](https://github.com/santifer/career-ops/commit/4da772d3a4996bc9ecbe2d384d1e9d2ed75b9819))
* align portals.example.yml indentation for new companies ([26a6751](https://github.com/santifer/career-ops/commit/26a675173e64dac09fd1524ff9a7c7061520e057))
* **ci:** correct first-interaction@v3 input names ([c5196a8](https://github.com/santifer/career-ops/commit/c5196a8dd8ff05da51c72ea151f67e481f12c329))
* **ci:** gracefully handle missing dependency graph in dependency-review ([#343](https://github.com/santifer/career-ops/issues/343)) ([7c5fecb](https://github.com/santifer/career-ops/commit/7c5fecb00d60521f77b33724eb345a28257d8832))
* **ci:** gracefully handle missing dependency graph in dependency-review workflow ([#352](https://github.com/santifer/career-ops/issues/352)) ([7c5fecb](https://github.com/santifer/career-ops/commit/7c5fecb00d60521f77b33724eb345a28257d8832))
* **ci:** use pull_request_target for labeler on fork PRs ([#260](https://github.com/santifer/career-ops/issues/260)) ([2ecf572](https://github.com/santifer/career-ops/commit/2ecf57206c2eb6e35e2a843d6b8365f7a04c53d6))
* correct _shared.md → _profile.md reference in CUSTOMIZATION.md (closes [#137](https://github.com/santifer/career-ops/issues/137)) ([a91e264](https://github.com/santifer/career-ops/commit/a91e264b6ea047a76d8c033aa564fe01b8f9c1d9))
* correct dashboard launch path in docs ([#80](https://github.com/santifer/career-ops/issues/80)) ([2b969ee](https://github.com/santifer/career-ops/commit/2b969eea5f6bbc8f29b9e42bedb59312379e9f02))
* **dashboard:** show dates in pipeline list ([#298](https://github.com/santifer/career-ops/issues/298)) ([e5e2a6c](https://github.com/santifer/career-ops/commit/e5e2a6cffe9a5b9f3cec862df25410d02ecc9aa4))
* ensure data/ and output/ dirs exist before writing in scripts ([#261](https://github.com/santifer/career-ops/issues/261)) ([4b834f6](https://github.com/santifer/career-ops/commit/4b834f6f7f8f1b647a6bf76e43b017dcbe9cd52f))
* filter expired WebSearch links before they reach the pipeline ([#57](https://github.com/santifer/career-ops/issues/57)) ([ce1c5a3](https://github.com/santifer/career-ops/commit/ce1c5a3c7eea6ebce2c90aebba59d6e26b790d3f))
* improve default PDF readability ([#85](https://github.com/santifer/career-ops/issues/85)) ([10034ec](https://github.com/santifer/career-ops/commit/10034ec3304c1c79ff9c9678c7826ab77c0bcbf7))
* liveness checks ignore nav/footer Apply text, expired signals win ([3a3cb95](https://github.com/santifer/career-ops/commit/3a3cb95bdf09235509df72e30b3077623f571ea1))
* **liveness:** detect closed postings with applications-closed banner variants ([7f8217e](https://github.com/santifer/career-ops/commit/7f8217e057b327980a797a682c4f01d3318edbbe))
* **merge-tracker:** filter seniority and location stopwords + require overlap ratio in roleFuzzyMatch ([7821113](https://github.com/santifer/career-ops/commit/7821113261eeb32f99639ff076651ab2e7757209))
* **pt:** restore diacritical marks in PT-BR modes ([#358](https://github.com/santifer/career-ops/issues/358)) ([3a4c596](https://github.com/santifer/career-ops/commit/3a4c596cb0a522f562ba38b35c210facaf38a503))
* **pt:** restore diacritical marks in PT-BR modes ([#359](https://github.com/santifer/career-ops/issues/359)) ([3a4c596](https://github.com/santifer/career-ops/commit/3a4c596cb0a522f562ba38b35c210facaf38a503))
* **release:** sync VERSION and package.json via release-please-config ([6a3dc22](https://github.com/santifer/career-ops/commit/6a3dc224337a1942bf2ebf18b9b275d94fc06e7a))
* remove wellfound, lever and remotefront from portals.example.yml ([#286](https://github.com/santifer/career-ops/issues/286)) ([ecd013c](https://github.com/santifer/career-ops/commit/ecd013cc6f59e3a1a8ef77d34e7abc15e8075ed3))
* replace grep -P with POSIX-compatible grep in batch-runner.sh ([637b39e](https://github.com/santifer/career-ops/commit/637b39e383d1174c8287f42e9534e9e3cdfabb19))
* test-all.mjs scans only git-tracked files, avoids false positives ([47c9f98](https://github.com/santifer/career-ops/commit/47c9f984d8ddc70974f15c99b081667b73f1bb9a))
* **update-system:** cross-check GitHub Releases API when VERSION file is stale ([b0ee6eb](https://github.com/santifer/career-ops/commit/b0ee6ebfcec7920ea7590ada61f3c39324d22ebc))
* **update-system:** expand SYSTEM_PATHS to cover all language modes and current scripts ([34fe3fb](https://github.com/santifer/career-ops/commit/34fe3fbd5782f7f57faf8ef4a245fbee6275a040))
* use candidate name from profile.yml in PDF filename ([7bcbc08](https://github.com/santifer/career-ops/commit/7bcbc08ca6184362398690234e49df0ac157567f))
* use execFileSync to prevent shell injection in test-all.mjs ([c99d5a6](https://github.com/santifer/career-ops/commit/c99d5a6526f923b56c3790b79b0349f402fa00e2))
* use fileURLToPath for cross platform compatible paths in tracker scripts ([#32](https://github.com/santifer/career-ops/issues/32)) ([#58](https://github.com/santifer/career-ops/issues/58)) ([ab77510](https://github.com/santifer/career-ops/commit/ab775102f4586ae4663a593b519927531be27122))
* use hi@santifer.io in English README ([5518d3d](https://github.com/santifer/career-ops/commit/5518d3dd07716137b97bb4d8c7b5264b94e2b9e9))


### Performance Improvements

* compress hero banner from 5.7MB to 671KB ([dac4259](https://github.com/santifer/career-ops/commit/dac425913620fe0a66916dda7ba8d8fc4c427d51))

## [1.6.0](https://github.com/santifer/career-ops/compare/v1.5.0...v1.6.0) (2026-04-26)


### Features

* add Gemini CLI native integration and evaluator script  ([#349](https://github.com/santifer/career-ops/issues/349)) ([0853486](https://github.com/santifer/career-ops/commit/0853486d2c01a35adafea2cc6b6d8c429b843588))
* add Gemini CLI native integration and evaluator script (closes [#344](https://github.com/santifer/career-ops/issues/344)) ([0853486](https://github.com/santifer/career-ops/commit/0853486d2c01a35adafea2cc6b6d8c429b843588))
* add LaTeX/Overleaf CV export mode with pdflatex compilation ([#362](https://github.com/santifer/career-ops/issues/362)) ([b824953](https://github.com/santifer/career-ops/commit/b824953d0e3b7f8c6105dfcce7e17257c95ce6cd))
* add LaTeX/Overleaf CV export mode with pdflatex compilation (closes [#47](https://github.com/santifer/career-ops/issues/47)) ([b824953](https://github.com/santifer/career-ops/commit/b824953d0e3b7f8c6105dfcce7e17257c95ce6cd))
* **cv:** add cv.output_format to route between html and latex generation ([b82bb5f](https://github.com/santifer/career-ops/commit/b82bb5fb7c86ab3074a54eaf0f3186f81d41f417))
* **dashboard:** add rejected and discarded pipeline tabs ([7d05967](https://github.com/santifer/career-ops/commit/7d05967389fb6185f0d6e566a4ba583ee3824e1e))
* **dashboard:** show tracker IDs in pipeline list ([8d289c6](https://github.com/santifer/career-ops/commit/8d289c64e31f81cf447f75105b500d1feca21058))
* **latex:** add tectonic engine auto-detect with pdflatex fallback ([4b71b2c](https://github.com/santifer/career-ops/commit/4b71b2cbf4fd49d3882cdd8767e31727337fab34))
* **portals:** add Canada/Vancouver and automation companies to example template ([590ba6e](https://github.com/santifer/career-ops/commit/590ba6e1b4b9d2d9d03893b7f5fdae920d4f9a0b))


### Bug Fixes

* **ci:** correct first-interaction@v3 input names ([c5196a8](https://github.com/santifer/career-ops/commit/c5196a8dd8ff05da51c72ea151f67e481f12c329))
* **ci:** gracefully handle missing dependency graph in dependency-review ([#343](https://github.com/santifer/career-ops/issues/343)) ([7c5fecb](https://github.com/santifer/career-ops/commit/7c5fecb00d60521f77b33724eb345a28257d8832))
* **ci:** gracefully handle missing dependency graph in dependency-review workflow ([#352](https://github.com/santifer/career-ops/issues/352)) ([7c5fecb](https://github.com/santifer/career-ops/commit/7c5fecb00d60521f77b33724eb345a28257d8832))
* **liveness:** detect closed postings with applications-closed banner variants ([7f8217e](https://github.com/santifer/career-ops/commit/7f8217e057b327980a797a682c4f01d3318edbbe))
* **merge-tracker:** filter seniority and location stopwords + require overlap ratio in roleFuzzyMatch ([7821113](https://github.com/santifer/career-ops/commit/7821113261eeb32f99639ff076651ab2e7757209))
* **pt:** restore diacritical marks in PT-BR modes ([#358](https://github.com/santifer/career-ops/issues/358)) ([3a4c596](https://github.com/santifer/career-ops/commit/3a4c596cb0a522f562ba38b35c210facaf38a503))
* **pt:** restore diacritical marks in PT-BR modes ([#359](https://github.com/santifer/career-ops/issues/359)) ([3a4c596](https://github.com/santifer/career-ops/commit/3a4c596cb0a522f562ba38b35c210facaf38a503))
* **update-system:** cross-check GitHub Releases API when VERSION file is stale ([b0ee6eb](https://github.com/santifer/career-ops/commit/b0ee6ebfcec7920ea7590ada61f3c39324d22ebc))
* **update-system:** expand SYSTEM_PATHS to cover all language modes and current scripts ([34fe3fb](https://github.com/santifer/career-ops/commit/34fe3fbd5782f7f57faf8ef4a245fbee6275a040))

## [1.5.0](https://github.com/santifer/career-ops/compare/v1.4.0...v1.5.0) (2026-04-14)


### Features

* add --min-score flag to batch runner ([#249](https://github.com/santifer/career-ops/issues/249)) ([cb0c7f7](https://github.com/santifer/career-ops/commit/cb0c7f7d7d3b9f3f1c3dc75ccac0a08d2737c01e))
* add {{PHONE}} placeholder to CV template ([#287](https://github.com/santifer/career-ops/issues/287)) ([e71595f](https://github.com/santifer/career-ops/commit/e71595f8ba134971ecf1cc3c3420d9caf21eed43))
* **dashboard:** add manual refresh shortcut ([#246](https://github.com/santifer/career-ops/issues/246)) ([4b5093a](https://github.com/santifer/career-ops/commit/4b5093a8ef1733c449ec0821f722f996625fcb84))


### Bug Fixes

* add stopword filtering and overlap ratio to roleMatch ([#248](https://github.com/santifer/career-ops/issues/248)) ([4da772d](https://github.com/santifer/career-ops/commit/4da772d3a4996bc9ecbe2d384d1e9d2ed75b9819))
* **dashboard:** show dates in pipeline list ([#298](https://github.com/santifer/career-ops/issues/298)) ([e5e2a6c](https://github.com/santifer/career-ops/commit/e5e2a6cffe9a5b9f3cec862df25410d02ecc9aa4))
* ensure data/ and output/ dirs exist before writing in scripts ([#261](https://github.com/santifer/career-ops/issues/261)) ([4b834f6](https://github.com/santifer/career-ops/commit/4b834f6f7f8f1b647a6bf76e43b017dcbe9cd52f))
* remove wellfound, lever and remotefront from portals.example.yml ([#286](https://github.com/santifer/career-ops/issues/286)) ([ecd013c](https://github.com/santifer/career-ops/commit/ecd013cc6f59e3a1a8ef77d34e7abc15e8075ed3))

## [1.4.0](https://github.com/santifer/career-ops/compare/v1.3.0...v1.4.0) (2026-04-13)


### Features

* add GitHub Actions CI + auto-labeler + welcome bot + /run skill ([2ddf22a](https://github.com/santifer/career-ops/commit/2ddf22a6a2731b38bcaed5786c4855c4ab9fe722))
* **dashboard:** add Catppuccin Latte light theme with auto-detection ([ff686c8](https://github.com/santifer/career-ops/commit/ff686c8af97a7bf93565fe8eeac677f998cc9ece))
* **dashboard:** add progress analytics screen ([623c837](https://github.com/santifer/career-ops/commit/623c837bf3155fd5b7413554240071d40585dd7e))
* **dashboard:** add vim motions to pipeline screen ([#262](https://github.com/santifer/career-ops/issues/262)) ([d149e54](https://github.com/santifer/career-ops/commit/d149e541402db0c88161a71c73899cd1836a1b2d))
* **dashboard:** aligned tables and markdown syntax rendering in viewer ([dbd1d3f](https://github.com/santifer/career-ops/commit/dbd1d3f7177358d0384d6e661d1b0dfc1f60bd4e))


### Bug Fixes

* **ci:** use pull_request_target for labeler on fork PRs ([#260](https://github.com/santifer/career-ops/issues/260)) ([2ecf572](https://github.com/santifer/career-ops/commit/2ecf57206c2eb6e35e2a843d6b8365f7a04c53d6))
* correct _shared.md → _profile.md reference in CUSTOMIZATION.md (closes [#137](https://github.com/santifer/career-ops/issues/137)) ([a91e264](https://github.com/santifer/career-ops/commit/a91e264b6ea047a76d8c033aa564fe01b8f9c1d9))
* replace grep -P with POSIX-compatible grep in batch-runner.sh ([637b39e](https://github.com/santifer/career-ops/commit/637b39e383d1174c8287f42e9534e9e3cdfabb19))
* test-all.mjs scans only git-tracked files, avoids false positives ([47c9f98](https://github.com/santifer/career-ops/commit/47c9f984d8ddc70974f15c99b081667b73f1bb9a))
* use execFileSync to prevent shell injection in test-all.mjs ([c99d5a6](https://github.com/santifer/career-ops/commit/c99d5a6526f923b56c3790b79b0349f402fa00e2))
