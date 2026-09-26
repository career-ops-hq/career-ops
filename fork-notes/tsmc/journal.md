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
