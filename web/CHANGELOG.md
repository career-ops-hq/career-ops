# Changelog

## [0.16.0](https://github.com/career-ops-hq/career-ops/compare/web-v0.15.0...web-v0.16.0) (2026-10-23)


### Features

* **debrief:** update score, contacts, and the next follow-up after a debrief ([#5509](https://github.com/career-ops-hq/career-ops/issues/5509)) ([43bd09e](https://github.com/career-ops-hq/career-ops/commit/43bd09e6860fbeb1300f582fffd34c5d666d7ae9))
* **explore:** add an opt-in China employer discovery preset ([#5431](https://github.com/career-ops-hq/career-ops/issues/5431)) ([4fa03ae](https://github.com/career-ops-hq/career-ops/commit/4fa03aef3ea8810fbff9d41777e8585023b88683))
* remember the agent CLI for doctor, the ranker and the web ([#5467](https://github.com/career-ops-hq/career-ops/issues/5467)) ([79965b3](https://github.com/career-ops-hq/career-ops/commit/79965b3c7878777d9b219d82efe7be2363197407))
* **reports:** show the decision line in translated reports ([#5500](https://github.com/career-ops-hq/career-ops/issues/5500)) ([fd16c50](https://github.com/career-ops-hq/career-ops/commit/fd16c50d9afedcd08e5a406d1b491541c7c65d75))
* **web:** add an apply checklist page for each application ([#5131](https://github.com/career-ops-hq/career-ops/issues/5131)) ([45dff32](https://github.com/career-ops-hq/career-ops/commit/45dff32688963da15370d5d651cf863f7448deee))
* **web:** add the cv studio page to review and customize a tailored cv ([#5233](https://github.com/career-ops-hq/career-ops/issues/5233)) ([fab622e](https://github.com/career-ops-hq/career-ops/commit/fab622e2bc8db72310f59a1a256a629d049f3f5e))
* **web:** download the shown Pipeline rows as a CSV file ([#5625](https://github.com/career-ops-hq/career-ops/issues/5625)) ([040ce2d](https://github.com/career-ops-hq/career-ops/commit/040ce2d404cd76236ddab77b36c5b28a23fcbca3))
* **web:** pdf-ready and follow-up seed actions for the apply checklist ([#5304](https://github.com/career-ops-hq/career-ops/issues/5304)) ([0818cae](https://github.com/career-ops-hq/career-ops/commit/0818cae8ce2120058078c8493edf01cdfb71fb83))
* **web:** rewrite a single cv studio bullet with the user's ai cli ([#5234](https://github.com/career-ops-hq/career-ops/issues/5234)) ([cd9ce14](https://github.com/career-ops-hq/career-ops/commit/cd9ce14011f3a698ea5317022496a017316afa26))
* **web:** scheduled scans on macOS and Linux ([#5401](https://github.com/career-ops-hq/career-ops/issues/5401)) ([02a5902](https://github.com/career-ops-hq/career-ops/commit/02a59029a7060fa0f9bbbf53413f3725e5e1747c))


### Bug Fixes

* **apply:** keep apply inside the project and off the user's Chrome ([#5499](https://github.com/career-ops-hq/career-ops/issues/5499)) ([60a68d4](https://github.com/career-ops-hq/career-ops/commit/60a68d4912db3d3f27a32be09b52db71b35db6da))
* **apply:** keep failed CV uploads out of other file fields ([#5089](https://github.com/career-ops-hq/career-ops/issues/5089)) ([4eb3cba](https://github.com/career-ops-hq/career-ops/commit/4eb3cbacf4171bca7afc60b16cd539b4249627ca))
* **doctor:** diagnose half-filled profile sections using core sectionState ([#5126](https://github.com/career-ops-hq/career-ops/issues/5126)) ([#5311](https://github.com/career-ops-hq/career-ops/issues/5311)) ([afefa44](https://github.com/career-ops-hq/career-ops/commit/afefa4408e9fb4357340c26a5b0b2180a2c6774a))
* **status:** stop web and dashboard Interview moves timing out on the JD archive ([#5487](https://github.com/career-ops-hq/career-ops/issues/5487)) ([e017968](https://github.com/career-ops-hq/career-ops/commit/e017968947152c9cc08186193e7b64816e17666e))
* **tracker:** read report links through the shared parser so parentheses survive ([#5482](https://github.com/career-ops-hq/career-ops/issues/5482)) ([#5483](https://github.com/career-ops-hq/career-ops/issues/5483)) ([ea3ede6](https://github.com/career-ops-hq/career-ops/commit/ea3ede6e94ca61a96bfa1ebdd967788473d5dcda))
* treat comment-only YAML config as empty instead of crashing ([#5464](https://github.com/career-ops-hq/career-ops/issues/5464)) ([9769f2a](https://github.com/career-ops-hq/career-ops/commit/9769f2ad4c49dc5e141079551a8dcb5b63b09c63))
* **web/apply:** insert typed text instead of pressing keys, so a line break never submits ([#5770](https://github.com/career-ops-hq/career-ops/issues/5770)) ([1f82b2f](https://github.com/career-ops-hq/career-ops/commit/1f82b2fbc57008c6ae8786f86fe1c0d33179e1e4))
* **web/scheduled:** record why a scheduled scan failed, not its first progress line ([#5661](https://github.com/career-ops-hq/career-ops/issues/5661)) ([889bdf3](https://github.com/career-ops-hq/career-ops/commit/889bdf3f995cffd215cb82122e46027aa8460b9d))
* **web:** a rate with nothing applied is absent, not 0.0% ([#5371](https://github.com/career-ops-hq/career-ops/issues/5371)) ([ffcb79b](https://github.com/career-ops-hq/career-ops/commit/ffcb79b1fc4ed2efe8b4f88e2596ed805beac5cc))
* **web:** a vendor rate from one application is not a rate ([#5372](https://github.com/career-ops-hq/career-ops/issues/5372)) ([9ad6a3e](https://github.com/career-ops-hq/career-ops/commit/9ad6a3e8bf7117e5281df3d0909ba30174bb4e3b))
* **web:** align URL hostname normalization with core ([#5532](https://github.com/career-ops-hq/career-ops/issues/5532)) ([2beeeb3](https://github.com/career-ops-hq/career-ops/commit/2beeeb30ce1e26b4f1d6202df4ffa0ff104af502))
* **web:** confirm before remember writes to the profile ([#5456](https://github.com/career-ops-hq/career-ops/issues/5456)) ([c6800db](https://github.com/career-ops-hq/career-ops/commit/c6800db4c333bd569033febe37aa9bd29ce27c83))
* **web:** cut redundant tracker row tab stops ([#5361](https://github.com/career-ops-hq/career-ops/issues/5361)) ([2e3e1f2](https://github.com/career-ops-hq/career-ops/commit/2e3e1f2e070f9fc33fe3610f9b7b25bb706567ff))
* **web:** drop known AI Explore offers on the server, not in the browser ([#5502](https://github.com/career-ops-hq/career-ops/issues/5502)) ([ddcb459](https://github.com/career-ops-hq/career-ops/commit/ddcb459f102c0c6ce3f02e84bb8cca1d6cf3efaf))
* **web:** expose Assistant request feedback and reply access ([#5245](https://github.com/career-ops-hq/career-ops/issues/5245)) ([35788de](https://github.com/career-ops-hq/career-ops/commit/35788de02abd364710830b58bc5b4ebe5da4faf8))
* **web:** expose worker state and coalesce terminal feedback ([#5356](https://github.com/career-ops-hq/career-ops/issues/5356)) ([4fe6ef5](https://github.com/career-ops-hq/career-ops/commit/4fe6ef5f1b855472b07e31ab89cd2d580c477b61))
* **web:** group a flagged posting on Today the way its report labels it ([#5332](https://github.com/career-ops-hq/career-ops/issues/5332)) ([7ac3233](https://github.com/career-ops-hq/career-ops/commit/7ac3233ccb6e3c23a6d654e63975898b88ef3828)), closes [#5300](https://github.com/career-ops-hq/career-ops/issues/5300)
* **web:** honor CAREER_OPS_PORTALS on portals page and API ([#5360](https://github.com/career-ops-hq/career-ops/issues/5360)) ([0013c09](https://github.com/career-ops-hq/career-ops/commit/0013c09ea46f6964e86ab917ac3d4582611735a9))
* **web:** keep an extracted posting url intact ([#5149](https://github.com/career-ops-hq/career-ops/issues/5149)) ([d91bbf2](https://github.com/career-ops-hq/career-ops/commit/d91bbf296aa10f95c6f0d3d219d258f384ec3ac9))
* **web:** keep portals.yml comments when /api/portals saves the role filters ([#5646](https://github.com/career-ops-hq/career-ops/issues/5646)) ([858cd44](https://github.com/career-ops-hq/career-ops/commit/858cd44bac9e4a489a5317c66b8632f39b260487))
* **web:** keep tracker search typing responsive on a large tracker ([#5504](https://github.com/career-ops-hq/career-ops/issues/5504)) ([6b5f91e](https://github.com/career-ops-hq/career-ops/commit/6b5f91ec3c00ff200c4161f52c4bcc1e76ba2e8f))
* **web:** match ai and pm as whole words when bucketing archetypes ([#5152](https://github.com/career-ops-hq/career-ops/issues/5152)) ([cd0a448](https://github.com/career-ops-hq/career-ops/commit/cd0a4486ef308b54f8811b67e6247277425460ef))
* **web:** match padded pipeline ids to tracker rows numerically ([#5156](https://github.com/career-ops-hq/career-ops/issues/5156)) ([37edc27](https://github.com/career-ops-hq/career-ops/commit/37edc277ac6020b8d1a7c162a4488471000f3b76))
* **web:** move the scheduled-jobs and chat locks onto the shared directory-lock protocol ([#5390](https://github.com/career-ops-hq/career-ops/issues/5390)) ([ca5e70b](https://github.com/career-ops-hq/career-ops/commit/ca5e70b9321daf4765f5143a4aa4d2d135f0d397))
* **web:** name the resolved profile path in agent prompts under CAREER_OPS_PROFILE ([#5588](https://github.com/career-ops-hq/career-ops/issues/5588)) ([ec35d1b](https://github.com/career-ops-hq/career-ops/commit/ec35d1b470e22d531a94cce33fa71d37612a470f))
* **web:** preserve failed status confirmations for human retry ([#5422](https://github.com/career-ops-hq/career-ops/issues/5422)) ([c48e595](https://github.com/career-ops-hq/career-ops/commit/c48e59536e4c325c8f5efa8bce9be7f7ce2d63d6))
* **web:** read a header-mapped tracker with fewer than eight columns ([#5635](https://github.com/career-ops-hq/career-ops/issues/5635)) ([1f9b281](https://github.com/career-ops-hq/career-ops/commit/1f9b281ea4346dee29dd0065869be2def6285a8a))
* **web:** read and write the profile CAREER_OPS_PROFILE names ([#5096](https://github.com/career-ops-hq/career-ops/issues/5096)) ([a7f3edf](https://github.com/career-ops-hq/career-ops/commit/a7f3edf3139f4bffd0ae6718e96ca811a4edc6fd))
* **web:** read only appended transcript bytes for the usage meter ([#5503](https://github.com/career-ops-hq/career-ops/issues/5503)) ([0b35a13](https://github.com/career-ops-hq/career-ops/commit/0b35a138fffa5335340070c2d13e0c8d1b804a2b))
* **web:** report a crashed pipeline writer instead of added:0 ([#5636](https://github.com/career-ops-hq/career-ops/issues/5636)) ([7ab2e8c](https://github.com/career-ops-hq/career-ops/commit/7ab2e8c66c3d89a9328982080e1f67103a73fafd))
* **web:** sample each Explore source instead of its alphabetical prefix ([#5465](https://github.com/career-ops-hq/career-ops/issues/5465)) ([34665f9](https://github.com/career-ops-hq/career-ops/commit/34665f9942dcf975bce51a9ca262ef12e15c18dc))
* **web:** show when the assistant's profile or scan-target write fails ([#5641](https://github.com/career-ops-hq/career-ops/issues/5641)) ([0bc362b](https://github.com/career-ops-hq/career-ops/commit/0bc362bb21a8a9532da7212d4f25268f68b14e28))
* **web:** show why a CV upload was refused instead of a generic error ([#5399](https://github.com/career-ops-hq/career-ops/issues/5399)) ([73dccb1](https://github.com/career-ops-hq/career-ops/commit/73dccb1bf791ca32545fd04eb5c3e1522ef28a7c)), closes [#5369](https://github.com/career-ops-hq/career-ops/issues/5369)
* **web:** stop reading account executive as an executive level ([#5155](https://github.com/career-ops-hq/career-ops/issues/5155)) ([6fb3b35](https://github.com/career-ops-hq/career-ops/commit/6fb3b35324c0600106b05d5c63c47ca7ad5c03f5))
* **web:** stop rewriting the stored job list on every streamed chunk ([#5501](https://github.com/career-ops-hq/career-ops/issues/5501)) ([ccb8d7e](https://github.com/career-ops-hq/career-ops/commit/ccb8d7ebd2cbc355be77ea6cc1027862a5fc567f))
* **web:** stop the analytics page parsing scan-history it never uses ([#5492](https://github.com/career-ops-hq/career-ops/issues/5492)) ([7fed20f](https://github.com/career-ops-hq/career-ops/commit/7fed20f7e8b3f81ece3a468851efe6bcdd3ceb3d))
* **web:** treat CAREER_OPS_PORTALS as the portals file in doctorState ([#5310](https://github.com/career-ops-hq/career-ops/issues/5310)) ([a1830c4](https://github.com/career-ops-hq/career-ops/commit/a1830c44583382581c4716b8ab970709e25fcc7e))
* **web:** turn off Next.js usage telemetry ([#5596](https://github.com/career-ops-hq/career-ops/issues/5596)) ([4251d7e](https://github.com/career-ops-hq/career-ops/commit/4251d7ee015e8a862d422792ac3c1b4509cb72b7))
* **web:** update next to 16.4.1 for GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr and GHSA-p3m5-59mp-jv5r ([#5771](https://github.com/career-ops-hq/career-ops/issues/5771)) ([0d244d8](https://github.com/career-ops-hq/career-ops/commit/0d244d85abd562ec12669f019264846b95c30b43))


### Performance Improvements

* **web:** send inbox postings only to the pipeline inbox tab ([#5221](https://github.com/career-ops-hq/career-ops/issues/5221)) ([602a3d5](https://github.com/career-ops-hq/career-ops/commit/602a3d525456c174b8628663041947c9a68c34c2))

## [0.15.0](https://github.com/career-ops-hq/career-ops/compare/web-v0.14.0...web-v0.15.0) (2026-10-15)


### Features

* add Assessment lifecycle and follow-up status controls ([#4317](https://github.com/career-ops-hq/career-ops/issues/4317)) ([8cb0161](https://github.com/career-ops-hq/career-ops/commit/8cb0161f73d1e6012976bdf2ba79dee6b91f40d1))
* **followups:** let users turn off follow-ups ([#5164](https://github.com/career-ops-hq/career-ops/issues/5164)) ([0a388c8](https://github.com/career-ops-hq/career-ops/commit/0a388c87ab647140e10fe36a2db0c9ae3956ed97))
* **test-all:** run the inline sections alongside the discovered suites ([#5146](https://github.com/career-ops-hq/career-ops/issues/5146)) ([#5150](https://github.com/career-ops-hq/career-ops/issues/5150)) ([9a2f8d2](https://github.com/career-ops-hq/career-ops/commit/9a2f8d2c5e594cb99f19178adcfa87a4c6994daa))
* **upskill:** show the requirements behind your recent skips ([#5242](https://github.com/career-ops-hq/career-ops/issues/5242)) ([f541063](https://github.com/career-ops-hq/career-ops/commit/f54106321286e0af1331577c6858ed1c57d08065))
* **web:** add an interview prep pack to each report ([#5216](https://github.com/career-ops-hq/career-ops/issues/5216)) ([4c94be4](https://github.com/career-ops-hq/career-ops/commit/4c94be42e63815df71e72df6e0f46e02d8b9a8e0))
* **web:** add generated documents dashboard ([#4856](https://github.com/career-ops-hq/career-ops/issues/4856)) ([#4958](https://github.com/career-ops-hq/career-ops/issues/4958)) ([ca7d047](https://github.com/career-ops-hq/career-ops/commit/ca7d047448aa5bf5b8adffb158315c20e1b66d00))
* **web:** add the cv studio edit model and api for tailored cvs ([#5232](https://github.com/career-ops-hq/career-ops/issues/5232)) ([1fcd8d1](https://github.com/career-ops-hq/career-ops/commit/1fcd8d1586fa506610c3bc6cf3fa4d7f90afb2c6))
* **web:** ATS keyword coverage on the report view ([#4579](https://github.com/career-ops-hq/career-ops/issues/4579)) ([886b834](https://github.com/career-ops-hq/career-ops/commit/886b834a9989e449587cf1ae9ae2ab39e50cab1e))
* **web:** company evidence card on the report (and fix the data root it reads from) ([#4581](https://github.com/career-ops-hq/career-ops/issues/4581)) ([bcfdcdc](https://github.com/career-ops-hq/career-ops/commit/bcfdcdcb37691a921e5c4a3bebb66366d16d3a1e))
* **web:** compare two or three selected pipeline rows side by side ([#5223](https://github.com/career-ops-hq/career-ops/issues/5223)) ([d396b19](https://github.com/career-ops-hq/career-ops/commit/d396b1961c79eb5f59e002fa97abad77b2f3a716))
* **web:** draft a cover letter from the report page ([#5258](https://github.com/career-ops-hq/career-ops/issues/5258)) ([49e14d4](https://github.com/career-ops-hq/career-ops/commit/49e14d4315c0af88b39241687c03a72ff050ea96))
* **web:** expand Analytics into progress and search stats ([#4310](https://github.com/career-ops-hq/career-ops/issues/4310)) ([6e0cd23](https://github.com/career-ops-hq/career-ops/commit/6e0cd23ac6b27faf22e39c16705e1da58316892e))
* **web:** fill modes/_profile.md from the assistant, confirm-gated, with a live onboarding panel ([#4256](https://github.com/career-ops-hq/career-ops/issues/4256)) ([93d1853](https://github.com/career-ops-hq/career-ops/commit/93d1853a971f84465efa00d9b1c83456b35b9d96))
* **web:** give each today card the evaluator's call and reason ([#5215](https://github.com/career-ops-hq/career-ops/issues/5215)) ([4ef7ade](https://github.com/career-ops-hq/career-ops/commit/4ef7adea15392876eea6eda2d5e3f855ba5692ce))
* **web:** list watched companies on the portals page before a health check ([#5220](https://github.com/career-ops-hq/career-ops/issues/5220)) ([b4864ee](https://github.com/career-ops-hq/career-ops/commit/b4864ee4fd5adc15559ca12cebf473e8dfbec82d))
* **web:** rank today's decisions by score with an apply next link ([#5235](https://github.com/career-ops-hq/career-ops/issues/5235)) ([9296142](https://github.com/career-ops-hq/career-ops/commit/92961425af10ab47c55e17a55e4c7113813176f0))
* **web:** recurring skill gaps on the CV page ([#4583](https://github.com/career-ops-hq/career-ops/issues/4583)) ([85fdac2](https://github.com/career-ops-hq/career-ops/commit/85fdac23d93ecb9e2c0246e03ffec5d0a52aeba3))
* **web:** set one status on several tracker rows from the pipeline table ([#5187](https://github.com/career-ops-hq/career-ops/issues/5187)) ([d319b4a](https://github.com/career-ops-hq/career-ops/commit/d319b4a5eeb1c711c64e3a5d85ab108dd1049e7c))
* **web:** show the posting url in the tracker view ([#5130](https://github.com/career-ops-hq/career-ops/issues/5130)) ([d79024c](https://github.com/career-ops-hq/career-ops/commit/d79024c32d7004c88db68d64da52047a3bfca960))


### Bug Fixes

* **analytics:** count only in-flight rows as active applications ([#5186](https://github.com/career-ops-hq/career-ops/issues/5186)) ([ed10c7a](https://github.com/career-ops-hq/career-ops/commit/ed10c7aaa391d8a1784830904515541b50b9d095))
* **scheduler:** preserve the original recurrence anchor ([#5006](https://github.com/career-ops-hq/career-ops/issues/5006)) ([1884acf](https://github.com/career-ops-hq/career-ops/commit/1884acff0162755a2c8d0c69b9f5455f56f04463))
* **test-harness:** link the dependency tree a worktree inherits, in both suites ([#5055](https://github.com/career-ops-hq/career-ops/issues/5055)) ([b528fe5](https://github.com/career-ops-hq/career-ops/commit/b528fe59fc139769d22f537b2dd25012d263ad76))
* **test-harness:** run the suite against a scratch data root and guard the real one ([#5137](https://github.com/career-ops-hq/career-ops/issues/5137)) ([2bebe32](https://github.com/career-ops-hq/career-ops/commit/2bebe32826d6f504652fb473c22e4df7124972a3))
* **web/scheduled:** a lock whose stat fails is not stale ([#5013](https://github.com/career-ops-hq/career-ops/issues/5013)) ([7f30002](https://github.com/career-ops-hq/career-ops/commit/7f300029b4bdcf798a500d953f0114610c600675))
* **web/scheduled:** retry Windows EPERM/EACCES on the lock mkdir instead of crashing ([#4917](https://github.com/career-ops-hq/career-ops/issues/4917)) ([291d53b](https://github.com/career-ops-hq/career-ops/commit/291d53babf306bd8440076447211b8578ecbccef))
* **web:** answer 400, not 500, when a JSON body is not an object ([#5188](https://github.com/career-ops-hq/career-ops/issues/5188)) ([9abcad3](https://github.com/career-ops-hq/career-ops/commit/9abcad356f5bc1e916ab355b39e5032b91bc78a9))
* **web:** attach the tailored cv to localized resume upload fields ([#5162](https://github.com/career-ops-hq/career-ops/issues/5162)) ([e632866](https://github.com/career-ops-hq/career-ops/commit/e632866aacef4ad89198f424663605a45760498d))
* **web:** deny Write/Bash when evaluating untrusted JDs ([#3629](https://github.com/career-ops-hq/career-ops/issues/3629)) ([a98717e](https://github.com/career-ops-hq/career-ops/commit/a98717ebaa75ace696db58cc7e77e94f9c8c856a))
* **web:** keep Assistant keyboard focus through open, send and close ([#5123](https://github.com/career-ops-hq/career-ops/issues/5123)) ([b5b136b](https://github.com/career-ops-hq/career-ops/commit/b5b136b01a9bbefcc9d8a169147f4c7109ae9bb3))
* **web:** keep colon location and pay cells in the inbox ([#5120](https://github.com/career-ops-hq/career-ops/issues/5120)) ([e6ed41e](https://github.com/career-ops-hq/career-ops/commit/e6ed41e8e6d052538fabf442f4d88095fbf86fe1))
* **web:** keep Discover running when the URL updates ([#3628](https://github.com/career-ops-hq/career-ops/issues/3628)) ([c78e14c](https://github.com/career-ops-hq/career-ops/commit/c78e14cdfd52f18a92e4a67694efab7ddef59385))
* **web:** keep failed inbox undo actions retryable ([#5050](https://github.com/career-ops-hq/career-ops/issues/5050)) ([63ec2fc](https://github.com/career-ops-hq/career-ops/commit/63ec2fcacc4becf883adce3eebee7409228db93a))
* **web:** keep places like Idaho Falls in the location breakdown ([#5153](https://github.com/career-ops-hq/career-ops/issues/5153)) ([cf26d04](https://github.com/career-ops-hq/career-ops/commit/cf26d04dd6ce7714566bee00dc418449a2e86af7))
* **web:** label application review fields and confirmation hints ([#4996](https://github.com/career-ops-hq/career-ops/issues/4996)) ([cdcd8c4](https://github.com/career-ops-hq/career-ops/commit/cdcd8c42c318cf8ea234dc98b507a3024877b8fc))
* **web:** label padded application numbers in assistant actions ([#5157](https://github.com/career-ops-hq/career-ops/issues/5157)) ([09f1399](https://github.com/career-ops-hq/career-ops/commit/09f139916433a474e3aaa4b3ce3b928d26b8f8b7))
* **web:** link an unscored inbox row to its posting ([#5122](https://github.com/career-ops-hq/career-ops/issues/5122)) ([662ca5c](https://github.com/career-ops-hq/career-ops/commit/662ca5cf649f22e20fc7004877e87c1ca66159ca))
* **web:** match admin as a word when bucketing archetypes ([#5154](https://github.com/career-ops-hq/career-ops/issues/5154)) ([9174770](https://github.com/career-ops-hq/career-ops/commit/917477029a0e134946190bcfdc4abefd68a268d1))
* **web:** name every explore filter field for screen readers ([#5222](https://github.com/career-ops-hq/career-ops/issues/5222)) ([523a205](https://github.com/career-ops-hq/career-ops/commit/523a205460ed1981a92955a6dfe2323e2a309b52))
* **web:** never inherit a stale console on Windows, and stop the doctor reporting a failed probe as all set up ([#4253](https://github.com/career-ops-hq/career-ops/issues/4253)) ([4e590f2](https://github.com/career-ops-hq/career-ops/commit/4e590f29bb7cec86885803a7bcd18287bd16fe8d)), closes [#3809](https://github.com/career-ops-hq/career-ops/issues/3809)
* **web:** open the inbox score on the saved report ([#2968](https://github.com/career-ops-hq/career-ops/issues/2968)) ([6a45392](https://github.com/career-ops-hq/career-ops/commit/6a45392563755fbd22244e1048afb12df82e0587))
* **web:** persist Today snoozes and confirm status writes ([#4106](https://github.com/career-ops-hq/career-ops/issues/4106)) ([a0bb5f0](https://github.com/career-ops-hq/career-ops/commit/a0bb5f03d5c29f1cf6eb2221cccf38552bbb0792))
* **web:** point an empty inbox at the roles already tracked ([#5171](https://github.com/career-ops-hq/career-ops/issues/5171)) ([4d1d57a](https://github.com/career-ops-hq/career-ops/commit/4d1d57a91e7e2bb464b16d38ac59b3c4a53a9b78))
* **web:** preserve company evidence scope and source certainty ([#5007](https://github.com/career-ops-hq/career-ops/issues/5007)) ([33c927c](https://github.com/career-ops-hq/career-ops/commit/33c927ca63fb4aea1e3f924444a74f0e3c3bc244))
* **web:** preserve context and focus for assistant confirmations ([#5017](https://github.com/career-ops-hq/career-ops/issues/5017)) ([d0a9bb5](https://github.com/career-ops-hq/career-ops/commit/d0a9bb5303348f1ab742ec09d7ea3588ed094f5b))
* **web:** preserve Pipeline filters when returning from a report ([#5049](https://github.com/career-ops-hq/career-ops/issues/5049)) ([4468aac](https://github.com/career-ops-hq/career-ops/commit/4468aacdfa1b49bc8be8a1a6df2ff31a38686b5a))
* **web:** preserve report identity when generating tailored PDFs ([#4104](https://github.com/career-ops-hq/career-ops/issues/4104)) ([a8b3340](https://github.com/career-ops-hq/career-ops/commit/a8b334080677580e813317172080d00d4c56ffbd))
* **web:** preview table-only report sections as fields, not separator residue ([#5218](https://github.com/career-ops-hq/career-ops/issues/5218)) ([5fe9b88](https://github.com/career-ops-hq/career-ops/commit/5fe9b886add73bd4ed9f17a74fbee1eb3fbb9555))
* **web:** recover interrupted application fills without losing answers ([#4109](https://github.com/career-ops-hq/career-ops/issues/4109)) ([2810471](https://github.com/career-ops-hq/career-ops/commit/281047155e8d5932bf24122be3f189776bbc8119))
* **web:** refuse submit buttons labeled in every shipped locale ([#5158](https://github.com/career-ops-hq/career-ops/issues/5158)) ([56867bd](https://github.com/career-ops-hq/career-ops/commit/56867bd59c0739e83898160612319f15a5f493ea))
* **web:** reject private URLs in Apply session ([#3627](https://github.com/career-ops-hq/career-ops/issues/3627)) ([3444fdd](https://github.com/career-ops-hq/career-ops/commit/3444fddf20307e7f7ef15c42493871594a12c719))
* **web:** say where cli evaluations go on the workers page ([#5172](https://github.com/career-ops-hq/career-ops/issues/5172)) ([6bf0667](https://github.com/career-ops-hq/career-ops/commit/6bf06676810013b89d7f291e162dac8defdd3dab))
* **web:** serve cv and cover pdfs whose filenames are not ascii ([#5163](https://github.com/career-ops-hq/career-ops/issues/5163)) ([6b55711](https://github.com/career-ops-hq/career-ops/commit/6b557110c762a38e137b02ae2957de54ed89dd5b))
* **web:** show inbox rows that are only a URL ([#3626](https://github.com/career-ops-hq/career-ops/issues/3626)) ([87ecfa2](https://github.com/career-ops-hq/career-ops/commit/87ecfa248deec495e7effc4ef6c283424aed3f96))
* **web:** show no success rate when no scan has run ([#5121](https://github.com/career-ops-hq/career-ops/issues/5121)) ([0756f03](https://github.com/career-ops-hq/career-ops/commit/0756f0317b443ddf6bfd5d37c64a6524de763fc4))
* **web:** show the "report left on disk" notice when deleting a tracker row ([#5067](https://github.com/career-ops-hq/career-ops/issues/5067)) ([ae9fdeb](https://github.com/career-ops-hq/career-ops/commit/ae9fdeb26f6dc05207b828f61542d6659a17bd4f))
* **web:** show the verdict reason without raw markdown markers ([#5169](https://github.com/career-ops-hq/career-ops/issues/5169)) ([ffebb75](https://github.com/career-ops-hq/career-ops/commit/ffebb7577839dc9ddd2856f130005f9be51ee523))
* **web:** show upcoming follow-ups on the follow-ups page ([#5129](https://github.com/career-ops-hq/career-ops/issues/5129)) ([685221f](https://github.com/career-ops-hq/career-ops/commit/685221faf953e1160f9d56cc5032f1732a0a57fc))
* **web:** show why a tailored cv was not generated next to the button ([#5240](https://github.com/career-ops-hq/career-ops/issues/5240)) ([8680fb7](https://github.com/career-ops-hq/career-ops/commit/8680fb7bc733beee98641a81f196272f01351fef))
* **web:** start each agent message on a new line so the cv envelope parses ([#5239](https://github.com/career-ops-hq/career-ops/issues/5239)) ([cc56d48](https://github.com/career-ops-hq/career-ops/commit/cc56d48faf282da8126982db005f0aeb91d7bded))
* **web:** stop calling a flagged posting recommended in the verdict card ([#5219](https://github.com/career-ops-hq/career-ops/issues/5219)) ([849a8b5](https://github.com/career-ops-hq/career-ops/commit/849a8b528f1c6c6aca457486ba6fe4677939b37f))
* **web:** stop the apply fill clicking a combobox option that only contains the answer ([#5160](https://github.com/career-ops-hq/career-ops/issues/5160)) ([b05b700](https://github.com/career-ops-hq/career-ops/commit/b05b7002cc7efc55513f0e3c42d243b310aa5d42))
* **web:** stop the sankey screen-reader table widening analytics on phones ([#5217](https://github.com/career-ops-hq/career-ops/issues/5217)) ([6899c17](https://github.com/career-ops-hq/career-ops/commit/6899c17f483b790826b260bfc75901961bc112cb))
* **web:** update source-map-js to 1.2.2 ([#5009](https://github.com/career-ops-hq/career-ops/issues/5009)) ([012c782](https://github.com/career-ops-hq/career-ops/commit/012c782b3bad67a1bbc963ba0afe085b3c93da46))

## [0.14.0](https://github.com/career-ops-hq/career-ops/compare/web-v0.13.0...web-v0.14.0) (2026-10-10)


### Features

* **cv-templates:** add atsLint, with the ATS rules as data in templates/ats-rules.yml ([#3900](https://github.com/career-ops-hq/career-ops/issues/3900)) ([6f1a74e](https://github.com/career-ops-hq/career-ops/commit/6f1a74e8e37119f01a68a397187025e7dacc804a))
* **i18n:** support language.modes_dir as a list of declared markets ([#3798](https://github.com/career-ops-hq/career-ops/issues/3798)) ([d31a138](https://github.com/career-ops-hq/career-ops/commit/d31a138e8b3dc1971a43e15931623112c8a83246))
* **templates:** let a template pack declare the sections it owns ([#3852](https://github.com/career-ops-hq/career-ops/issues/3852)) ([#3916](https://github.com/career-ops-hq/career-ops/issues/3916)) ([261d3c5](https://github.com/career-ops-hq/career-ops/commit/261d3c53bd836c14016cb93b6092180bca13f686))
* **web:** add local scheduled scans ([#2628](https://github.com/career-ops-hq/career-ops/issues/2628)) ([85b67f5](https://github.com/career-ops-hq/career-ops/commit/85b67f527c14ebd08c8aa00bedeff28182499978))
* **web:** add route-aware loading feedback ([#4338](https://github.com/career-ops-hq/career-ops/issues/4338)) ([e049608](https://github.com/career-ops-hq/career-ops/commit/e04960897029429c2dd23cc0a3bd3a8996d26ef1))
* **web:** Analytics progress + insights views, read from the core ([#4576](https://github.com/career-ops-hq/career-ops/issues/4576)) ([2d38488](https://github.com/career-ops-hq/career-ops/commit/2d38488012c172a1fbbb2d025d7b51eed8a3bbcb))
* **web:** edit application status inline in Pipeline ([#4701](https://github.com/career-ops-hq/career-ops/issues/4701)) ([b89ef7e](https://github.com/career-ops-hq/career-ops/commit/b89ef7e27ca7ccf8380c8a8571dbd8732b26b845))
* **web:** keep context during loading transitions ([#4473](https://github.com/career-ops-hq/career-ops/issues/4473)) ([e691fa6](https://github.com/career-ops-hq/career-ops/commit/e691fa68693abbed25eb301532c0294408e5edb9))
* **web:** preserve assistant conversations and earlier context ([#4495](https://github.com/career-ops-hq/career-ops/issues/4495)) ([f9e9139](https://github.com/career-ops-hq/career-ops/commit/f9e91394657a229b351df7ff451f6b6d59b08967))
* **web:** surface post-interview silence on the Follow-ups page ([#4586](https://github.com/career-ops-hq/career-ops/issues/4586)) ([9f0b533](https://github.com/career-ops-hq/career-ops/commit/9f0b5333fd6b2bf44a851814fe85b18c0c0b4a5e))


### Bug Fixes

* **funnel:** retain replies and historical stages across surfaces ([#4374](https://github.com/career-ops-hq/career-ops/issues/4374)) ([ead56e8](https://github.com/career-ops-hq/career-ops/commit/ead56e8c158ea8353636f85600062b0b1102cdb4))
* **liveness:** record the expired verdict so a dead posting stops resurfacing ([#3905](https://github.com/career-ops-hq/career-ops/issues/3905)) ([1a68591](https://github.com/career-ops-hq/career-ops/commit/1a6859146193413307c496895a408fc620779b19))
* **pipeline:** break sort ties on the row number, so newest-first reorders a date ([#4333](https://github.com/career-ops-hq/career-ops/issues/4333)) ([c4f2c3f](https://github.com/career-ops-hq/career-ops/commit/c4f2c3fcbd22979143a0e6115bd2718a820ac41b))
* **web/apply:** never hand the planner a ref to a submit control, and guard every action by element facts ([#3834](https://github.com/career-ops-hq/career-ops/issues/3834)) ([a6637dd](https://github.com/career-ops-hq/career-ops/commit/a6637ddf9a8025118187ac85c5af425fd80a6b55))
* **web:** bind the dashboard to loopback by default ([#3716](https://github.com/career-ops-hq/career-ops/issues/3716)) ([7062ed5](https://github.com/career-ops-hq/career-ops/commit/7062ed507ba07d3c876dc07f759897be8a4d82ea))
* **web:** confirm paid assistant fan-out with cost estimates ([#4746](https://github.com/career-ops-hq/career-ops/issues/4746)) ([b3b62b4](https://github.com/career-ops-hq/career-ops/commit/b3b62b4cdce4e982697547f1f3e961a33b0843a3))
* **web:** count cached input in usage meter ([#4744](https://github.com/career-ops-hq/career-ops/issues/4744)) ([088d0dd](https://github.com/career-ops-hq/career-ops/commit/088d0ddd1c90a07eb9df650dec7f7fec2f079e65))
* **web:** fall back from a stale saved cliId on every AI route, not just Run ([#4638](https://github.com/career-ops-hq/career-ops/issues/4638)) ([431f593](https://github.com/career-ops-hq/career-ops/commit/431f5933bcb14d178cdff47cc6faa2bcc600407b))
* **web:** pre-fill apply answers from the CV attached to the same form ([#4404](https://github.com/career-ops-hq/career-ops/issues/4404)) ([414ff23](https://github.com/career-ops-hq/career-ops/commit/414ff238679a186e74bcd3b0415f3fb4e49dce38))
* **web:** read the whole of modes/_profile.md, not just the managed block ([#4008](https://github.com/career-ops-hq/career-ops/issues/4008)) ([f4c52d1](https://github.com/career-ops-hq/career-ops/commit/f4c52d19a29c805ca7ad2e1f4ce767e6c70b8708))
* **web:** require confirmed worker stream completion ([#4107](https://github.com/career-ops-hq/career-ops/issues/4107)) ([7860d2f](https://github.com/career-ops-hq/career-ops/commit/7860d2f146769a730e185cbda808020d18d6723b))
* **web:** update vulnerable dependencies ([#4670](https://github.com/career-ops-hq/career-ops/issues/4670)) ([077ff80](https://github.com/career-ops-hq/career-ops/commit/077ff80bd0391db2df74dd57ee78002a580bc859))
* **web:** validate profile updates before writing ([#4500](https://github.com/career-ops-hq/career-ops/issues/4500)) ([b208464](https://github.com/career-ops-hq/career-ops/commit/b2084646acdc2bc34ad48ed8b7292d48c3aa3561))

## [0.13.0](https://github.com/career-ops-hq/career-ops/compare/web-v0.12.0...web-v0.13.0) (2026-10-01)


### Features

* add Hermes Agent headless CLI support ([#4623](https://github.com/career-ops-hq/career-ops/issues/4623)) ([a6b867a](https://github.com/career-ops-hq/career-ops/commit/a6b867adbc634cb61cc103ac8af350932878baf3))
* **cli:** register Pi as a supported CLI host ([#4157](https://github.com/career-ops-hq/career-ops/issues/4157)) ([#4157](https://github.com/career-ops-hq/career-ops/issues/4157)) ([74c5d17](https://github.com/career-ops-hq/career-ops/commit/74c5d178a631540a9966122fef29db02b28918dc))
* **explorer:** free banded title-vs-profile fit hint on discovery cards ([#3261](https://github.com/career-ops-hq/career-ops/issues/3261)) ([b080539](https://github.com/career-ops-hq/career-ops/commit/b0805395cc8d462bc9a6a36c0b2ea8921c522e50))
* **ui:** stream matched job cards into results during scan ([#4200](https://github.com/career-ops-hq/career-ops/issues/4200)) ([78e13ca](https://github.com/career-ops-hq/career-ops/commit/78e13ca707a567d2d6b2dc5df5c65828104ee20a))
* **web:** add city or location filter to Explore ([#4397](https://github.com/career-ops-hq/career-ops/issues/4397)) ([9a8667b](https://github.com/career-ops-hq/career-ops/commit/9a8667b39cb7c632e8b55dd62c836c8427e92069))
* **web:** add pipeline Sankey on Analytics ([#3373](https://github.com/career-ops-hq/career-ops/issues/3373)) ([508abb3](https://github.com/career-ops-hq/career-ops/commit/508abb3b46c421ce00eff6f136a181b4df369ff1))
* **web:** add shared theme provider and polish light-mode UX ([#4313](https://github.com/career-ops-hq/career-ops/issues/4313)) ([27a89b7](https://github.com/career-ops-hq/career-ops/commit/27a89b71af5c981e2ff7d05d085c14a3c8fe5270))
* **web:** make the evaluated-role report a decision, not a dump ([#4210](https://github.com/career-ops-hq/career-ops/issues/4210)) ([3ebcaf6](https://github.com/career-ops-hq/career-ops/commit/3ebcaf661c6f20d432d4a02fe7c35df14d64cff2))
* **web:** show tracker number in Pipeline ([#3477](https://github.com/career-ops-hq/career-ops/issues/3477)) ([bf2a764](https://github.com/career-ops-hq/career-ops/commit/bf2a764bb07acd30f6b8b372e6bbf659901c1ea6))


### Bug Fixes

* **apply:** the code-fence strip reached inside JSON string values ([#3302](https://github.com/career-ops-hq/career-ops/issues/3302)) ([c8e1777](https://github.com/career-ops-hq/career-ops/commit/c8e1777d087b2e7c5be729d6712c493e48540159))
* **deps:** update npm dependencies ([#3541](https://github.com/career-ops-hq/career-ops/issues/3541)) ([f067b13](https://github.com/career-ops-hq/career-ops/commit/f067b135716c7cc528c71720aac33554048114f6))
* **generate-pdf:** key the PDF manifest on report number and artifact kind ([#3959](https://github.com/career-ops-hq/career-ops/issues/3959)) ([10e789a](https://github.com/career-ops-hq/career-ops/commit/10e789a0363eba9f1aa73f8a1962e84e219aeb8d))
* **paths:** resolve user-layer files via the data root in batch-tailor, cv-templates and openrouter-runner ([#4570](https://github.com/career-ops-hq/career-ops/issues/4570)) ([cda5b0a](https://github.com/career-ops-hq/career-ops/commit/cda5b0aa75ed601307f90e4810d26dcf20758259))
* **tracker:** recognize localized headers across Node, web, and Go ([#3931](https://github.com/career-ops-hq/career-ops/issues/3931)) ([a827945](https://github.com/career-ops-hq/career-ops/commit/a827945b4a957976969b0a585019634f448ca44e))
* **web:** date run-route reports, tracker rows and PDFs with the local day ([#4615](https://github.com/career-ops-hq/career-ops/issues/4615)) ([ca4be23](https://github.com/career-ops-hq/career-ops/commit/ca4be231b124d43aaa8ce76c3e8cfff6272255b6))
* **web:** keep Explore results from sources that finished when another times out ([#4431](https://github.com/career-ops-hq/career-ops/issues/4431)) ([52d5ee5](https://github.com/career-ops-hq/career-ops/commit/52d5ee5342bfa110826dbedca8578561530bd3b3))
* **web:** launch npm CLIs on Windows ([#2626](https://github.com/career-ops-hq/career-ops/issues/2626)) ([71d31f5](https://github.com/career-ops-hq/career-ops/commit/71d31f5c728fdc175fdd2e23972cfe29700b2b6c))
* **web:** persist inbox Skip to pipeline.md ([#3632](https://github.com/career-ops-hq/career-ops/issues/3632)) ([fdaec05](https://github.com/career-ops-hq/career-ops/commit/fdaec0557fa5c79cbdac4b8f4cb13b9d5499e88b))
* **web:** preserve profiles with invalid YAML root shapes ([#4108](https://github.com/career-ops-hq/career-ops/issues/4108)) ([5e79805](https://github.com/career-ops-hq/career-ops/commit/5e79805be0134b000612771c26e7dbddd6ed981b))
* **web:** readInbox returns an empty inbox on a CRLF data/pipeline.md ([#3566](https://github.com/career-ops-hq/career-ops/issues/3566)) ([e0cad2e](https://github.com/career-ops-hq/career-ops/commit/e0cad2e0077da2e6e85fc6df0f03e7ff21243275))
* **web:** regenerate the lockfile for next 16.3.4 ([#4477](https://github.com/career-ops-hq/career-ops/issues/4477)) ([71554e8](https://github.com/career-ops-hq/career-ops/commit/71554e882d9f101b47f92c704a2613088e05a400))
* **web:** reject malformed follow-up IDs ([#3482](https://github.com/career-ops-hq/career-ops/issues/3482)) ([9fc269b](https://github.com/career-ops-hq/career-ops/commit/9fc269b24404409caaafc27a06eeb53988738e1a))
* **web:** resolve engine scripts from the checkout, not the data root ([#4518](https://github.com/career-ops-hq/career-ops/issues/4518)) ([ddb330a](https://github.com/career-ops-hq/career-ops/commit/ddb330a7be6c0b230f6f0f5d7f5bfee6f63a80b8))
* **web:** resolve the CV template from cv.template on dashboard runs ([#4035](https://github.com/career-ops-hq/career-ops/issues/4035)) ([5076dc0](https://github.com/career-ops-hq/career-ops/commit/5076dc0547bd81fbc12b1724e38a950084dfdcad))
* **web:** retain tracker guard until canceled worker closes ([#4113](https://github.com/career-ops-hq/career-ops/issues/4113)) ([026ef23](https://github.com/career-ops-hq/career-ops/commit/026ef2350b2d6b580ba258db5a4cb340359ea171))
* **web:** stop /api/apply/drive closing its stream twice on success ([#4039](https://github.com/career-ops-hq/career-ops/issues/4039)) ([dd34e28](https://github.com/career-ops-hq/career-ops/commit/dd34e28710265c78a91466617167e47dcb924999)), closes [#3966](https://github.com/career-ops-hq/career-ops/issues/3966)
* **web:** stop replacement when backups fail ([#4499](https://github.com/career-ops-hq/career-ops/issues/4499)) ([54cef96](https://github.com/career-ops-hq/career-ops/commit/54cef96c6b6472e545f49d7e96ae3b4a6967db0c))
* **web:** sync package-lock.json with next@16.3.4 so npm ci works again ([#4481](https://github.com/career-ops-hq/career-ops/issues/4481)) ([6326eb5](https://github.com/career-ops-hq/career-ops/commit/6326eb5d3804e8cb20d28acd5701a4e603a301f9))
* **web:** the logo resolver deletes accented letters to guess a domain, and caches the miss forever ([#3318](https://github.com/career-ops-hq/career-ops/issues/3318)) ([#3319](https://github.com/career-ops-hq/career-ops/issues/3319)) ([36e5056](https://github.com/career-ops-hq/career-ops/commit/36e5056004703e3d89a4b82600eadb6d36e0016d))
* **web:** the web tracker reader drops the Apply Link and Follow-up columns ([#3603](https://github.com/career-ops-hq/career-ops/issues/3603)) ([4be56a3](https://github.com/career-ops-hq/career-ops/commit/4be56a388dc53990015a17786c49453ac8d50b0f))
* **web:** validate the saved cliId against what is installed before a run ([#4019](https://github.com/career-ops-hq/career-ops/issues/4019)) ([00e2507](https://github.com/career-ops-hq/career-ops/commit/00e2507055e5a458b56d6e9956b30d8147b8b17d))


### Performance Improvements

* **web:** reuse home data reads and reduce queue payload ([#4105](https://github.com/career-ops-hq/career-ops/issues/4105)) ([6a14576](https://github.com/career-ops-hq/career-ops/commit/6a14576ee1cf06f66a0d1b8b2b4ab5df827a891b))

## [0.12.0](https://github.com/career-ops-hq/career-ops/compare/web-v0.11.0...web-v0.12.0) (2026-09-24)


### Features

* **web:** resizable assistant panel and a composer that grows with its content ([#4258](https://github.com/career-ops-hq/career-ops/issues/4258)) ([8be08ce](https://github.com/career-ops-hq/career-ops/commit/8be08ce362d45556b12bb659fd66360cd409ebb3))


### Bug Fixes

* run the web test suite on the minimum supported Node ([#4065](https://github.com/career-ops-hq/career-ops/issues/4065)) ([533a4a8](https://github.com/career-ops-hq/career-ops/commit/533a4a8dc0802fffc5a87afb3d380776bde6da14))
* **web/explore:** honest, configurable scan timeout with partial results ([#4191](https://github.com/career-ops-hq/career-ops/issues/4191)) ([220ecd8](https://github.com/career-ops-hq/career-ops/commit/220ecd876bcb49152068ecc098f55e5be0f8b542))
* **web:** a failed atomic write leaves a full copy of cv.md behind, unignored ([#3245](https://github.com/career-ops-hq/career-ops/issues/3245)) ([#3246](https://github.com/career-ops-hq/career-ops/issues/3246)) ([2d37f77](https://github.com/career-ops-hq/career-ops/commit/2d37f77fb6b29db1c43970e39df5f5f918ddc7e6))
* **web:** add vertical padding to pipeline facet chips ([#4038](https://github.com/career-ops-hq/career-ops/issues/4038)) ([b6bc5ff](https://github.com/career-ops-hq/career-ops/commit/b6bc5ffb92e847e43b91042d4b828c99ce5960a2))
* **web:** let report tables use the screen on large displays ([e571f2c](https://github.com/career-ops-hq/career-ops/commit/e571f2cb9de3f8952863e5c51adc437a09b83fef))
* **web:** make CLI choices fully clickable ([b4be24f](https://github.com/career-ops-hq/career-ops/commit/b4be24f2b9e476888dedb5ee85d29df68baf53df))
* **web:** make CLI choices fully clickable ([977bb11](https://github.com/career-ops-hq/career-ops/commit/977bb1144fec223f98b66984a9dfeb508d73f08f))
* **web:** persist the default CLI at any installed count, not only a sole one ([#4151](https://github.com/career-ops-hq/career-ops/issues/4151)) ([ecbe651](https://github.com/career-ops-hq/career-ops/commit/ecbe651320d5da9a97ea29a0ee7e39cbd14207ed))
* **web:** pluralize the Analytics evaluation count ([#3161](https://github.com/career-ops-hq/career-ops/issues/3161)) ([7c91c6d](https://github.com/career-ops-hq/career-ops/commit/7c91c6d9682c0441b8fdd1c0a6ce983524be02fd))
* **web:** resolve the data root exactly as the core does ([#4064](https://github.com/career-ops-hq/career-ops/issues/4064)) ([1704575](https://github.com/career-ops-hq/career-ops/commit/17045758851f7c7294e23669f4e6c8d34edf1712))
* **web:** surface a successful render's warnings instead of dropping them ([#3995](https://github.com/career-ops-hq/career-ops/issues/3995)) ([89ec0ec](https://github.com/career-ops-hq/career-ops/commit/89ec0ecf49052650cb9d3e53d3dae98ee0cba444))

## [0.11.0](https://github.com/career-ops-hq/career-ops/compare/web-v0.10.0...web-v0.11.0) (2026-09-16)


### Features

* **web:** opt-in origin allowlist for the local dashboard API ([#3597](https://github.com/career-ops-hq/career-ops/issues/3597)) ([0754973](https://github.com/career-ops-hq/career-ops/commit/075497329a55d7c1e5184cfffb21fd0efeaf13ba))


### Bug Fixes

* **tracker:** resolve addition columns by name so score and status cannot transpose ([00b0296](https://github.com/career-ops-hq/career-ops/commit/00b0296c6071eb955f38404e60a10ceaccad45b5))
* **url-key:** preserve existing fragment comparison params ([02e632e](https://github.com/career-ops-hq/career-ops/commit/02e632e634280ef7224ec268279adbbe9f0650ce))
* **url-key:** preserve hash-route posting identity ([52f314c](https://github.com/career-ops-hq/career-ops/commit/52f314cd268bd0b2de56b71ba236ce288138dac0))
* **url-key:** preserve hash-route posting identity ([965fff3](https://github.com/career-ops-hq/career-ops/commit/965fff30149eff1da2f6b1a937ca3738260b9a2e))
* **web:** detect a real tailored CV/cover on disk, not just the tracker flag ([0fb2080](https://github.com/career-ops-hq/career-ops/commit/0fb2080db1a5c90b3655bff7fdf74593026adf04))
* **web:** don't let a failed fetch become a scored report ([#3826](https://github.com/career-ops-hq/career-ops/issues/3826)) ([10ede60](https://github.com/career-ops-hq/career-ops/commit/10ede60522f1abd71dfd8c93266f9176180213ac))
* **web:** fence agent CLIs at the spawn boundary ([1d2cb1e](https://github.com/career-ops-hq/career-ops/commit/1d2cb1e125ea3034ff01b464e9a5e2628c0e315f))
* **web:** give grok a parser, and make the token fold per-CLI ([#2689](https://github.com/career-ops-hq/career-ops/issues/2689)) ([c7549fb](https://github.com/career-ops-hq/career-ops/commit/c7549fb3593f9ee456d7118beb80b0ee6e76747c))
* **web:** identify the verdict block by its heading, not by the letter ([#3502](https://github.com/career-ops-hq/career-ops/issues/3502)) ([0ef1bfb](https://github.com/career-ops-hq/career-ops/commit/0ef1bfbe2385551af415e05858900710d0aadd23))
* **web:** parseCliJson misses set-status.mjs's pretty-printed success ([#3602](https://github.com/career-ops-hq/career-ops/issues/3602)) ([848ca44](https://github.com/career-ops-hq/career-ops/commit/848ca440fb2d243ae08205ab3d0bc12903a36c65))
* **web:** resolve the tailored cover for THIS application, not the company's newest ([8fc2bb4](https://github.com/career-ops-hq/career-ops/commit/8fc2bb41db2aad7bf50902ad8a26e726c9637eec))

## [0.10.0](https://github.com/career-ops-hq/career-ops/compare/web-v0.9.0...web-v0.10.0) (2026-09-03)


### Features

* **oferta:** add evidence-tiered requirement importance to Block B ([#3596](https://github.com/career-ops-hq/career-ops/issues/3596)) ([14710e2](https://github.com/career-ops-hq/career-ops/commit/14710e29a6a801ea3ae52bb3f15756dc9ada7d29))
* **providers:** add Feishu Jobs and MokaHR scanner providers ([#3491](https://github.com/career-ops-hq/career-ops/issues/3491)) ([1696bec](https://github.com/career-ops-hq/career-ops/commit/1696bec4d021768e7359f9aad6b329cba883da20))


### Bug Fixes

* **web,dashboard:** point two user-facing references at the repository's new home ([6c0e68d](https://github.com/career-ops-hq/career-ops/commit/6c0e68d472d4ee1e0082fd861c133778f262ecfe))
* **web:** a company with no usable slug must not match every tailored CV ([#3214](https://github.com/career-ops-hq/career-ops/issues/3214)) ([880c58b](https://github.com/career-ops-hq/career-ops/commit/880c58b999033b7f38439f20246943e9342e7fdf))
* **web:** enable apply from the generated pdf index ([ac761fa](https://github.com/career-ops-hq/career-ops/commit/ac761fa612fc943b1ef9458f704fefd653954955))
* **web:** find Grok in its default install dirs, not only on PATH ([77657dc](https://github.com/career-ops-hq/career-ops/commit/77657dcd0bcb7c2e9a9950148d337d160aa5b459))
* **web:** order the Today action queue before truncating it ([3a067ee](https://github.com/career-ops-hq/career-ops/commit/3a067ee580b7982cf5dd6edf7895112e4e99600b))
* **web:** preserve a malformed portals.yml instead of overwriting it with the example ([07ed4f3](https://github.com/career-ops-hq/career-ops/commit/07ed4f31295bee9d03ce1ab61d6d59c835431ff7))
* **web:** rank "Awaiting your decision" by every EVALUATED alias, not an English prefix ([d7573e1](https://github.com/career-ops-hq/career-ops/commit/d7573e189193993c56d19c9216313f0fd4cebee2))
* **web:** require the cv- prefix so the tailored-CV resolvers stop returning the cover letter ([#2156](https://github.com/career-ops-hq/career-ops/issues/2156)) ([414d340](https://github.com/career-ops-hq/career-ops/commit/414d340b4425bf199ddad36dfc0a551da4e99fe0))
* **web:** resolve the tailored CV for THIS application, not the newest for the company ([ca11627](https://github.com/career-ops-hq/career-ops/commit/ca116279d3a5ba9a18e57e3f03f056066c178649))
* **web:** self-host the production fonts so the app starts without Google ([a2e46c3](https://github.com/career-ops-hq/career-ops/commit/a2e46c329fa9819ca6748a437c4ecdbdac4a6ec2))
* **web:** tell the beta reporter's user when the dupe search could not run ([77bf490](https://github.com/career-ops-hq/career-ops/commit/77bf4906abc5c5f63ac07a6c27a7f24c1d03683d))

## [0.9.0](https://github.com/santifer/career-ops/compare/web-v0.8.1...web-v0.9.0) (2026-08-31)


### Features

* **web:** add a global "Back to Top" button ([#2821](https://github.com/santifer/career-ops/issues/2821)) ([e5e786b](https://github.com/santifer/career-ops/commit/e5e786b1116e6c5e4c5bd2020f3bc1f6e5dd2058))


### Bug Fixes

* **deps:** refresh web lockfile for Next update ([2ca6c00](https://github.com/santifer/career-ops/commit/2ca6c00fa9d18cb45caef99fea0b97b05971bf55))
* **web:** honour language.modes_dir and language.output on web-triggered runs ([#3253](https://github.com/santifer/career-ops/issues/3253)) ([316906e](https://github.com/santifer/career-ops/commit/316906e64cc779d7580122b1d345c4c06f503a4b))
* **web:** ignore nonfatal CLI stderr on clean run exit ([#1974](https://github.com/santifer/career-ops/issues/1974)) ([7f430ee](https://github.com/santifer/career-ops/commit/7f430eeab07b8bd514295fd02aec571c42699d1e))
* **web:** only surface follow-ups that are actually due ([#2157](https://github.com/santifer/career-ops/issues/2157)) ([82e1055](https://github.com/santifer/career-ops/commit/82e10559beb8c80d8a50bcd456e1a893e8ba76f8))
* **web:** regenerate the nested web/ lockfile on postcss bumps ([dba2a2e](https://github.com/santifer/career-ops/commit/dba2a2ed7e6317e5962be51c2fe680376221e0de))
* **web:** show a cause-specific hint on job failure instead of an always-auth prompt ([#2158](https://github.com/santifer/career-ops/issues/2158)) ([d372908](https://github.com/santifer/career-ops/commit/d37290897f15f5284788c34cafcdabd3bd56f5bf))
* **web:** show Via attribution for confidential employers ([f749939](https://github.com/santifer/career-ops/commit/f7499392ff75bf966693bdae535f785743ad300d))
* **web:** stop evaluation tables collapsing to one word per line ([#3254](https://github.com/santifer/career-ops/issues/3254)) ([b3c1e12](https://github.com/santifer/career-ops/commit/b3c1e127e02c588aeefb8d02d14759706ecf1fc2))
* **web:** stop tracing runtime data paths ([0a9d71f](https://github.com/santifer/career-ops/commit/0a9d71fe94286bfe26cdd99e5d7b3d50b27a948a))
* **web:** tab label spacing and report table word-breaking ([#3160](https://github.com/santifer/career-ops/issues/3160)) ([102560b](https://github.com/santifer/career-ops/commit/102560bb904f5d107338719f8ce3bdce8d9399e5))
* **web:** use next/link for decision-card report link ([#1931](https://github.com/santifer/career-ops/issues/1931)) ([e7b38b3](https://github.com/santifer/career-ops/commit/e7b38b3e086540060f5f5704afd55ea5fa4a4a3c))

## [0.8.1](https://github.com/santifer/career-ops/compare/web-v0.8.0...web-v0.8.1) (2026-08-27)


### Bug Fixes

* **web:** classify a tracker-lock filesystem failure as itself, not as contention ([#3138](https://github.com/santifer/career-ops/issues/3138)) ([cf880eb](https://github.com/santifer/career-ops/commit/cf880eb55945019663e1b423499041097cb24ccd))
* **web:** key company logos with the Unicode-aware normalizer so non-Latin names don't collide ([#3134](https://github.com/santifer/career-ops/issues/3134)) ([7b9f858](https://github.com/santifer/career-ops/commit/7b9f8588f57d3313265c49f37d2055bb533a7d08))
* **web:** salvage truncated JSON at each prefix's own depth, not one global pad ([#3142](https://github.com/santifer/career-ops/issues/3142)) ([a308bc5](https://github.com/santifer/career-ops/commit/a308bc5cc96197f3ed84ac75493d75c45a770f02))
* **web:** stop hiding an employer's whole board after one evaluation ([b56cde5](https://github.com/santifer/career-ops/commit/b56cde551d84ad5c28d7ea8b99edcc450a2b8b4c))
* **web:** stop killing evaluate runs at 285s and misreporting the kill ([#3124](https://github.com/santifer/career-ops/issues/3124)) ([8a245ed](https://github.com/santifer/career-ops/commit/8a245edd677598aa539e74c7565be44b7676e4ab))

## [0.8.0](https://github.com/santifer/career-ops/compare/web-v0.7.1...web-v0.8.0) (2026-08-25)


### Features

* **web:** restrict the local dashboard API to same-origin and loopback ([b3974e6](https://github.com/santifer/career-ops/commit/b3974e6104d83c2714fd0d071898a7c7b9f68726))


### Bug Fixes

* **deps:** update web npm dependencies (major) ([1207eae](https://github.com/santifer/career-ops/commit/1207eae4b5799cb92602c99737fd2f0cee1319c9))
* **web:** give the methodology link a real tap target and a new-tab cue ([#3023](https://github.com/santifer/career-ops/issues/3023)) ([344a116](https://github.com/santifer/career-ops/commit/344a116de15fd98c1e1d48aae9bf08bbdc4f067e))
* **web:** keep child stderr out of the status response on the crash path ([#3022](https://github.com/santifer/career-ops/issues/3022)) ([883ebec](https://github.com/santifer/career-ops/commit/883ebec33c1c775bb295c4b4eecca31fc53066da))
* **web:** keep the query string in the Explore dedup key so distinct postings don't collapse ([#3082](https://github.com/santifer/career-ops/issues/3082)) ([275e213](https://github.com/santifer/career-ops/commit/275e2137fb804a762caed8bed34194c5920b71c4))
* **web:** keep the run stream alive during silent agent phases ([#3026](https://github.com/santifer/career-ops/issues/3026)) ([aaeb114](https://github.com/santifer/career-ops/commit/aaeb114238283ce3cc44b7b3e2168ed2d22c56a8))
* **web:** report the uncapped weekly match count while keeping the render bounded ([#2662](https://github.com/santifer/career-ops/issues/2662)) ([6e9f029](https://github.com/santifer/career-ops/commit/6e9f0299dff6fc0903b97b349390408d1f859571))
* **web:** stamp pipeline first_seen with the local day, not UTC ([#3081](https://github.com/santifer/career-ops/issues/3081)) ([809e93b](https://github.com/santifer/career-ops/commit/809e93b419094dcc77c8f3d3f1a1c31c578a547a))

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
