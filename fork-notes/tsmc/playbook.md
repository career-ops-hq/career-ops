# TSMC job search playbook

**English** · [繁體中文](playbook.zh-TW.md) · [Journal](journal.md) · [fork-notes index](../README.md)

Setup and workflow for targeting **TSMC (Taiwan Semiconductor Manufacturing Company)** from Taiwan with
career-ops, starting from a resume kept on the **104 Job Bank** (104人力銀行). Every output is produced
twice: **English (primary)** and **Taiwan Traditional Chinese (zh-TW)**.

> No private data in this file. Your CV, profile, reports and PDFs live in gitignored user-layer paths
> (table at the end).

---

## 0. The plan on one screen

```
104 resume ──export PDF──▶ documents/cv/ ──intake──▶ cv.md (EN, canonical)
                                                     └──▶ local/cv.zh-TW.md (zh-TW translation)
config/profile.yml  ◀── language: en + modes/zh-TW (Taiwan market rules)
modes/_custom.md    ◀── bilingual house rules (snippets/custom-bilingual.md)
portals.yml         ◀── TSMC careers entry (snippets/portals-tsmc.yml)

TSMC / 104 posting ──paste URL or JD──▶ evaluation report (EN) + zh-TW twin
                                        └──▶ tailored CV PDF (EN) + zh-TW PDF
                                             └──▶ you submit it yourself on TSMC's site
```

## 1. Console: first-time setup

You need **Node.js 18+**, **git**, and an AI coding CLI (these notes assume Claude Code, `claude`).
Windows users should also read [docs/WINDOWS.md](../../docs/WINDOWS.md).

```bash
# 1. Get the fork (skip if you already have it)
git clone https://github.com/rojarsmith/career-ops-max.git
cd career-ops-max

# 2. Dependencies and the PDF renderer
npm install
npx playwright install chromium

# 3. Optional but needed for PDF intake: pdftotext
#    macOS: brew install poppler   ·   Debian/Ubuntu: sudo apt install poppler-utils
#    Windows: install Poppler, or paste your CV as text instead (step 2)

# 4. Health check. It lists what is missing: cv.md, config/profile.yml, portals.yml, ...
node doctor.mjs

# 5. Open the AI CLI in this folder; onboarding continues in chat
claude
```

From here on, most work is plain language in the chat ("evaluate this posting", "make the CV") or the
`/career-ops` command. The console is for the checks listed in each step below.

## 2. Bring in the 104 resume

career-ops cannot log in to 104 and has no 104 provider. Move the resume across by hand:

1. On 104, open your resume and **download or print it to PDF**. If there's no download option,
   print the page to PDF from your browser.
2. Save it as `documents/cv/104-resume.pdf`. `documents/` is gitignored, so it never leaves your machine.
3. In the chat: **"Run intake mode."** The agent extracts the text locally and proposes a `cv.md`. It
   writes nothing until you confirm.
4. **English is canonical.** A 104 resume is usually in Chinese, so ask the agent to write `cv.md` in
   English and put a faithful zh-TW version at `local/cv.zh-TW.md` (`local/` is gitignored).
   **Check every fact in both files.** Translating may reword a line, but must never add a claim.
   If the two versions disagree, `cv.md` wins.

Fallback: a scanned or image-only PDF can't be extracted. Paste the resume text into the chat instead
and say "convert this into cv.md".

## 3. Profile and Taiwan market rules

```bash
cp config/profile.example.yml config/profile.yml     # skip if onboarding already did it
```

- Add the `language:` block from [snippets/profile-language.yml](../snippets/profile-language.yml):
  `output: en` keeps English as the primary output, and `modes_dir: modes/zh-TW` loads the Taiwan
  market rules. Those cover labor insurance, health insurance and pension, year-end bonus, employee
  profit sharing, non-compete (LSA art. 9-1), notice periods, and the "responsibility system" (art. 84-1).
- Fill in target roles, your location (TSMC fabs sit in several science parks; list the ones you'd
  accept), and a compensation target in TWD. The Taiwan mode converts annual pay as monthly × (12 +
  bonus months).
- Personalize `modes/_profile.md` (archetypes, narrative). **Before your first evaluation, run
  `node doctor.mjs` and make sure `unpersonalized` is empty.** Otherwise offers are scored against the
  template author's targeting.

## 4. Bilingual house rules

```bash
cp modes/_custom.template.md modes/_custom.md       # skip if it already exists
```

Append the contents of [snippets/custom-bilingual.md](../snippets/custom-bilingual.md) to
`modes/_custom.md`. It tells the agent to:

- write every human-facing artifact in English first, then a zh-TW twin that uses Taiwan vocabulary
  (履歷, 職缺, 面試, 薪資; never Mainland terms);
- store the twins under `output/zh-TW/` with the same relative path, so machine-checked folders
  like `reports/` keep one file per report. (`check-jd-archive.mjs` validates every `reports/*.md`);
- keep the tracker, TSV additions and status values English-only, because scripts parse them.

## 5. Portals: where TSMC postings come from

| Source | How career-ops uses it |
|--------|-----------------------|
| TSMC's own careers site | A `tracked_companies` entry in `portals.yml` (see [snippets/portals-tsmc.yml](../snippets/portals-tsmc.yml)). It runs on **Avature** behind Cloudflare (verified 2026-09-26). Plain-HTTP scanning is challenged from the cloud, where only a real browser gets through; see the [journal](journal.md). Run `node audit-portals.mjs` after adding it. If it errors, evaluate postings by URL instead. |
| 104 postings | No provider. Paste the posting URL or JD text into the chat. |
| Yourator | Provider exists (`provider: yourator`) for Taiwan startup and digital roles. Useful for comparison roles; TSMC itself is unlikely to be there. |

```bash
node audit-portals.mjs --summary     # does career-ops understand each board?
node scan.mjs                        # zero-token scan of the boards it does understand
```

Record the audit result in the [journal](journal.md): which provider claimed TSMC, or that none did.

## 6. Evaluate a posting

Paste a TSMC or 104 posting URL (or the JD text) into the chat. The auto-pipeline:

1. checks liveness, then scores blocks A–F plus G (posting legitimacy) on a 1–5 scale;
2. writes `reports/{###}-tsmc-{date}.md` in English, with the JD archived verbatim, and its zh-TW twin
   `output/zh-TW/reports/{###}-tsmc-{date}.md`;
3. adds a tracker row through `batch/tracker-additions/` + `node merge-tracker.mjs`.

**Below 4.0/5 the system recommends against applying.** Quality beats volume.

## 7. Tailored CV (English + zh-TW)

In the chat: **"Generate the CV PDF for report ###, in English and zh-TW."**

- English: `output/cv-{candidate}-tsmc-….pdf`, built from `cv.md`.
- zh-TW: `output/zh-TW/` with the same file name, built from `local/cv.zh-TW.md` with the same tailoring.
- Chinese glyphs come from the system font (Microsoft JhengHei on Windows, PingFang TC on macOS).
  On Linux, install `fonts-noto-cjk` first or the Chinese text renders as boxes.
- Optional check: `ats` mode for parseability of each PDF.

## 8. Apply, then track

- The `apply` mode can fill TSMC's application form with you, but **it never clicks Submit.** You
  review and submit.
- After you submit: `node set-status.mjs <report#> Applied`.
- Later states: `Responded` → `Interview` → `Offer` / `Rejected`. Interview prep (`interview-prep`
  mode) gets a zh-TW twin like everything else.
- Add a dated journal entry after each milestone.

## Where everything lives

| Artifact | Path | Committed? |
|----------|------|-----------|
| These notes | `fork-notes/` | Yes, public in this fork. No private data. |
| Canonical CV (EN) | `cv.md` | No (gitignored) |
| CV translation (zh-TW) | `local/cv.zh-TW.md` | No |
| 104 export | `documents/cv/` | No |
| Profile, archetypes, house rules | `config/profile.yml`, `modes/_profile.md`, `modes/_custom.md` | No |
| Reports (EN) | `reports/` | No |
| zh-TW twins, PDFs | `output/`, `output/zh-TW/` | No |
| Tracker | `data/applications.md` | No |

## Console cheat sheet

| Command | When |
|---------|------|
| `node doctor.mjs` | Anything feels off; before the first scan |
| `node update-system.mjs check` | Check for upstream releases (your data and `fork-notes/` are untouched) |
| `node audit-portals.mjs --summary` | After editing `portals.yml` |
| `node scan.mjs` | Look for new postings |
| `node set-status.mjs <#> <State>` | Update a tracker row |
| `node verify-pipeline.mjs` | Tracker and pipeline health |
| `node stats.mjs --summary` | Funnel numbers for the journal |
