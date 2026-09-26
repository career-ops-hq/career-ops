# TSMC job search journal

**English** · [繁體中文](journal.zh-TW.md) · [Playbook](playbook.md) · [fork-notes index](../README.md)

A dated, **privacy-safe** record of the TSMC search: what was done, what the system produced, what was
learned. Newest entry on top. Keep the zh-TW twin in sync in the same commit.

## What may and may not go here

| OK to record | Never record |
|--------------|--------------|
| Dates, stages, and state changes (`Evaluated` → `Applied` → `Interview`) | Your name, email, phone, national ID, address |
| Role *family* (e.g. "process integration", "IT / software") | Salary figures, offer amounts, bonus numbers |
| Report numbers (`#012`). They point into your gitignored `reports/` | Interviewer or recruiter names, contact details |
| Scores and which blocks drove them | CV text, cover-letter text, form answers |
| Commands run, problems hit, fixes | Screenshots of portals or emails |
| Lessons learned, process changes | Anything a recruiter told you in confidence |

## Entry template

```markdown
### YYYY-MM-DD — <short title>

- **Stage:** setup | sourcing | evaluation | application | interview | offer | closed
- **Done:** …
- **System output:** report #…, score …/5, EN + zh-TW twins generated (yes/no)
- **Commands:** `node …`
- **Learned / next:** …
```

---

## Entries

### 2026-09-26 — Re-score of #003 and a US role, report #004

- **Stage:** evaluation
- **Done:** The user confirmed several engineering practices and tools, and they were added to both CVs:
  AI coding tools, Agile with SDD, CI/CD and build systems, and hands-on architecture with PR review.
  The user also confirmed two facts that limit targeting: no US work authorization, and a small largest-team size.
  Report #003 was re-scored in place. `merge-tracker.mjs` updated the existing row by URL and did not add a duplicate.
  The manager-titled Arizona posting had closed, so a live TSMC Arizona AI tech-lead posting was evaluated instead.
- **System output:** #003 **3.5 → 3.8**, still "Research first" (HackerRank risk unchanged). Report #004
  **2.4/5, SKIP**. EN + zh-TW for both. `check-jd-archive.mjs` and `verify-pipeline.mjs` are clean.
- **Learned:** filling CV gaps with *confirmed* facts moves scores. A quantified fact can also expose a hard
  gap: #004 requires leading 7+ engineers. For US roles, silence about sponsorship is neutral in scoring,
  but in practice it now means an H-1B lottery and, from Sep 2026, a contested US$100,000 fee on new petitions for
  people abroad. So US roles are realistic only where the candidate clearly exceeds every bar.
- **Next:** the recruiter call for #001–#003 remains the deciding step.

### 2026-09-26 — Software-role sweep and third evaluation, report #003

- **Stage:** sourcing + evaluation
- **Done:** Triaged 10 more "software" postings. All 10 are individual-contributor engineer roles, so none meets the
  manager-level target. One (jobId 21610, Senior AI Software Engineer) directly manages a team, so it got a full A–H.
  A triage note that misread a "Master's or Ph.D." requirement as a gap was corrected: the user holds an M.S. in CSIE.
- **System output:** report #003, **3.5/5, "Research first"**, EN + zh-TW, tracker row.
- **Learned:** this is the best fit in direction so far (an agentic AI engineering lead), but also the highest
  coding-test risk: 2026 third-party accounts put HackerRank in TSMC's senior engineering hiring. Several stated
  requirements (SDD/DDD/TDD, AI coding tools, hands-on AI coding) aren't claimed in the CV, so the user needs to
  confirm them. A manager-titled "Agentic AI Engineering Lead" at TSMC Arizona surfaced during research.
- **Next:** recruiter call covering #001–#003; the user confirms which AI tools and practices they actually use;
  consider evaluating the Arizona manager role.

### 2026-09-26 — Second evaluation: Enterprise Business Systems PM, report #002

- **Stage:** evaluation
- **Done:** Full A–H evaluation of IT Product Manager of Enterprise Business Systems (jobId 16064). Cloudflare
  showed its bot check on the first load; opening the careers home page first and then the posting got through.
- **System output:** report #002, **3.3/5, "Research first"**, EN + zh-TW. Added a `URL` column to the tracker and ran
  `merge-tracker.mjs --backfill-urls`, so later TSMC postings dedupe by URL instead of fuzzy title matching.
- **Learned:** this posting states its complete interview process on the page, with no coding test, and names
  Hsinchu/Taipei. So it passes both hard rules. It loses on level (a "2+ years" bar) and domain (ERP-style
  enterprise systems). Comparison: #001 fits the product record better but has an unconfirmed coding test; #002 is
  process-safe but a lower grade.
- **Next:** one recruiter call covering both postings: coding test for #001, grade and base band for both.

### 2026-09-26 — First evaluation: IT Product Manager, report #001

- **Stage:** evaluation
- **Done:** Searched `careers.tsmc.com` through the headful browser for manager/director-level software roles:
  9 candidates, 3 worth a look, 6 out of scope (US semiconductor customer-technical and business roles, IT security).
  Ran a full A–H evaluation on IT Product Manager (Engineer Role), jobId 4981.
- **System output:** report #001, **3.4/5, "Research first"**. EN report in `reports/`, zh-TW twin in
  `output/zh-TW/reports/`, tracker row via `merge-tracker.mjs`. No PDF (below threshold).
  `check-jd-archive.mjs` and `verify-pipeline.mjs` are clean.
- **Learned:** strong fit on the work itself, but two open questions decide it. (1) Third-party accounts say TSMC's
  IT *engineer-track* process starts with a HackerRank test, and this role is labelled "Engineer Role". That's
  indirect evidence, so it's a recruiter question rather than a disqualification. A sibling PM posting (jobId 16064)
  lists its process with no coding test. (2) The engineer-track grade may sit below the director-level target.
- **Next:** ask the recruiter about the coding test and the grade before applying; consider evaluating jobId 16064.

### 2026-09-26 — Targeting rules settled

- **Stage:** setup
- **Done:** The user resolved the compensation open item. The profile now holds an ideal total annual range
  and a separate monthly-base floor. Because Taiwanese bonuses vary widely, offers are compared on total
  annual comp, with the guaranteed part reported separately. The older figure in the 104-exported CV is
  marked outdated.
- **Changed:** LeetCode-style coding tests went from a −0.5 soft flag to a **hard disqualifier** (免刷題).
  Only direct evidence disqualifies; indirect hints become a question for the recruiter.
- **Next:** evaluate the first real TSMC posting by URL.

### 2026-09-26 — Onboarding complete

- **Stage:** setup
- **Done:** Wrote `config/profile.yml`, `modes/_profile.md`, `modes/_brief.md`, `modes/_custom.md` (with the
  bilingual house rules), `portals.yml` and an empty tracker, all in the private data repo. Target: software
  roles at manager level and above at TSMC, in three acceptable locations. The user prefers hiring processes
  without LeetCode-style tests; that is a −0.5 soft flag, not a disqualifier.
- **System output:** `node doctor.mjs` reports `onboardingNeeded: false` with nothing unpersonalized.
  `validate-portals.mjs` and `validate-profile.mjs` are clean.
- **Open item:** the compensation target stated in chat and the one in the 104-exported CV disagree. The
  profile records both until the user confirms one.
- **Next:** evaluate the first real TSMC posting by URL.

### 2026-09-26 — Private data repo connected

- **Stage:** setup
- **Done:** Created a private GitHub repo for personal data and connected it to the cloud session. `CAREER_OPS_ROOT=../career-ops-max-rojarsmith`
  points `{DATA_ROOT}` at it, and `node doctor.mjs` then finds `cv.md` there. A committed `.career-ops-data`
  marker was tried first and rejected: it fails `test-all.mjs` section 20, which expects the default root
  when no variable is set. The environment variable passes the quick suite, but with it set some tests write fixtures into the
  data root, so run tests with `env -u CAREER_OPS_ROOT`.
- **System output:** none yet. Still missing: `config/profile.yml`, `modes/_profile.md`, `portals.yml`.
- **Learned:** the Claude GitHub App only sees the repos it was granted, so a new private repo has to be
  added under the app's repository access before a session can attach it.
- **Next:** set `CAREER_OPS_ROOT` in the cloud environment's settings; onboarding: profile, archetypes, portals, from the existing `cv.md` and `cv.zh-TW.md`.

### 2026-09-26 — Connectivity test from the cloud environment

- **Stage:** setup
- **Done:** Switched the cloud environment's network access to **Full**, then probed TSMC and 104 from a cloud session.
- **Found:**
  - Both sites sit behind **Cloudflare**. A plain HTTP request (curl, and therefore `scan.mjs` and
    `fetch-jd.mjs`) gets a 403 challenge page from the cloud environment.
  - **TSMC careers loads in a real, non-headless Chromium** (`xvfb-run`). It is an **Avature** site: the
    Avature markup is present, `/en_US/careers/SearchJobs` works and reported 797 results. This settles the
    "unverified ATS" note, but `scan.mjs`'s Avature provider uses plain HTTP, so it will still be
    challenged from the cloud.
  - **104 refuses even the real browser from the cloud** (403, 104's own error page). A block on
    non-Taiwan or datacenter IPs is the likely cause, but that's an inference, not proven.
  - Cloud Chromium needs the session proxy and its CA trusted
    (`--ignore-certificate-errors-spki-list=<proxy CA SPKI>`). Otherwise every HTTPS page fails with
    `ERR_CERT_AUTHORITY_INVALID`.
- **Next:** in the cloud, evaluate TSMC postings by URL through the headful browser. For 104, paste the JD
  text. On a machine in Taiwan, retry `node audit-portals.mjs` with the Avature entry.

### 2026-09-25 — Fork prepared for the TSMC search

- **Stage:** setup
- **Done:** Created `fork-notes/` as fork-only documentation and registered it in `config/local-paths.txt`,
  so neither `git merge` from upstream nor `update-system.mjs apply` touches it. Wrote the bilingual
  [playbook](playbook.md) and the configuration snippets.
- **System output:** none yet. `cv.md`, `config/profile.yml` and `portals.yml` don't exist yet.
- **Found:** career-ops ships a Taiwan market mode (`modes/zh-TW/`: labor law, benefits, local job boards).
  There is no 104 provider, so 104 postings go in by pasted URL or JD. TSMC's careers-site ATS is
  **unverified**: the cloud session that wrote these notes could not reach it.
- **Next:** export the 104 resume → `documents/cv/` → run intake → review `cv.md` + `local/cv.zh-TW.md`;
  set up `config/profile.yml` with the language snippet; add the TSMC portal and run `node audit-portals.mjs`.
