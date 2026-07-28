# Mode: pipeline -- URL Inbox (Second Brain)

`data/pipeline.md` में accumulated offer URLs process करता है। Candidate जब चाहे URLs add करता है और फिर एक बार में सब process करने के लिए `/career-ops pipeline` run करता है।

## Workflow

1. **पढ़ें** `data/pipeline.md` → "Pending" / "En attente" / "Pendientes" / "Offen" / "लंबित" section में `- [ ]` items ढूंढें
2. **हर pending URL के लिए**:
   a. `node reserve-report-num.mjs` run करके atomically अगला `REPORT_NUM` reserve करें (और report लिखने के बाद `node reserve-report-num.mjs --release <num>` run करके sentinel release करें)
   b. **Offer extract करें** Playwright से (`browser_navigate` + `browser_snapshot`) → WebFetch → WebSearch
   c. URL accessible नहीं → `- [!]` mark करें note के साथ और continue करें
   d. **Complete auto-pipeline run करें**: A-F Evaluation → Report .md → PDF (यदि score >= 3.0) → Tracker
   e. **"Pending" से "Processed" में move करें**: `- [x] #NNN | URL | Company | Role | Score/5 | PDF हाँ/नहीं`
3. **यदि 3+ URLs pending हों**, maximum speed के लिए parallel agents launch करें (Agent tool with `run_in_background`)
4. **अंत में**, summary table display करें:

```
| # | Company | Role | Score | PDF | Recommended Action |
```

## pipeline.md Format

```markdown
## लंबित
- [ ] https://jobs.example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | Acme India | Senior PM
- [!] https://private.url/job -- Error: login required

## संसाधित
- [x] #143 | https://jobs.example.com/posting/789 | Tech Corp | AI PM | 4.2/5 | PDF हाँ
- [x] #144 | https://boards.greenhouse.io/xyz/jobs/012 | Startup XYZ | SA | 2.1/5 | PDF नहीं
```

> Note: Section headers EN ("Pending"/"Processed"), ES ("Pendientes"/"Procesadas"), DE ("Offen"/"Verarbeitet"), FR ("En attente"/"Traitées"), HI ("लंबित"/"संसाधित") में से किसी में भी हो सकते हैं। पढ़ते समय flexible रहें, लिखते समय existing style follow करें।

## URL से Offer की Intelligent Detection

1. **Playwright (preferred):** `browser_navigate` + `browser_snapshot`। सभी SPAs के साथ काम करता है।
   - **वैकल्पिक — CLI एक्सट्रैक्टर (`config/profile.yml` में `scan.extractor: cli`):** इसके बजाय `node browser-extract.mjs <url>` (`--mode jd`) चलाएँ — कॉम्पैक्ट `{ "url", "title", "text" }`, कम टोकन (पोर्टल पर निर्भर)। त्रुटि या अनुपलब्ध होने पर **चुपचाप** `browser_navigate` + `browser_snapshot` पर लौटें।
2. **WebFetch (fallback):** Static pages के लिए या जब Playwright available न हो।
3. **WebSearch (last resort):** Secondary portals पर search करें जो offer index करते हैं।

**Special cases:**
- **LinkedIn**: Login require हो सकता है → `[!]` mark करें और candidate से text paste करने को कहें
- **PDF**: यदि URL PDF की तरफ point करे, Read tool से directly पढ़ें
- **`local:` prefix**: Local file पढ़ें। Example: `local:jds/naukri-pm-ai.md` → `jds/naukri-pm-ai.md` पढ़ें
- **Naukri.com / Instahyre / Cutshort**: Common Indian job portals। Playwright usually cookie banners handle करता है
- **LinkedIn India / Wellfound India**: Well-structured pages। WebFetch often sufficient

## Automatic Numbering

1. `node reserve-report-num.mjs` run करें atomically अगला sequential number reserve करने के लिए (stdout `{###}` return करता है)।
2. उस number से report लिखें।
3. Report लिखने के बाद `node reserve-report-num.mjs --release {###}` run करें sentinel release करने के लिए।

## Source Sync

किसी URL को process करने से पहले sync check करें:

```bash
node cv-sync-check.mjs
```

Desync पर, continue करने से पहले candidate को alert करें।
