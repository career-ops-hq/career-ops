# linkedin-title-fix — One-shot LinkedIn inbox title repair

Fix wrong **role / company / location** on LinkedIn alert rows in `data/pipeline.md`.

## Problem

Digest emails often assign **one subject title** to many job links. Each URL is a different posting; the inbox row must match the **live LinkedIn job page**.

## Input

You receive a batch TSV at `batch/linkedin-title-fix-<N>.tsv`:

```
lineIdx	url	company	title	location
```

`lineIdx` is the **0-based line index** in `data/pipeline.md` for that row.

## What to do (each row)

1. Fetch the job URL (curl or browser). LinkedIn public pages expose `og:title` like `Acme hiring Product Manager in Bengaluru | LinkedIn`.
2. If the page is a generic search listing (`11,000+ jobs`) or expired, **skip** — do not overwrite.
3. If stored `title` or `company` differs from the live posting, update the pipeline line.
4. Pipeline format: `- [ ] URL | Company | Role | Location [| labels]`
5. Use `sanitizeMarkdownField` rules: no raw `|` in fields.

## How to apply updates

Preferred — call the helper (zero extra tokens):

```bash
cd /home/shiva/Desktop/SigmaX/sigmax-jobs/career-ops
node linkedin-job-enrich-apply.mjs --from-fetch --tsv batch/linkedin-title-fix-<N>.tsv
```

Or patch lines manually with `rewritePipelineLine` from `linkedin-job-enrich.mjs`.

## Rules

- **Do not** evaluate jobs, generate CVs, or touch `applications.md`.
- **Do not** remove or dedupe rows.
- Only edit lines listed in the batch TSV.
- After the batch, print: `DONE batch <N> updated=<count> skipped=<count>`
