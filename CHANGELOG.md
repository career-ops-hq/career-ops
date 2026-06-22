# Changelog

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
