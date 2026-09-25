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
