---
name: career-ops-plugin-notion
description: How to mirror the career-ops tracker to a Notion database and read records back as job leads.
license: MIT
---

# notion plugin

Mirrors your application tracker to a Notion database (export) and reads records
back into the pipeline (search). `data/applications.md` stays the source of
truth — Notion is an additive mirror.

## Commands

- `node plugins.mjs run notion export` — push each tracker row (company / role /
  status / score) to the "Applications" database under your Career Ops page.
  Add `--dry-run` to preview without writing.
- `node plugins.mjs run notion search "<query>"` — return Notion records that
  carry a job URL, matching the query, and append them to the pipeline.

## Setup

A "Career Ops" parent page in Notion containing an "Applications" database with
Company / Role / Status / Score / URL properties, shared with your internal
integration. Put `NOTION_ACCESS_TOKEN` + `NOTION_PARENT_PAGE_ID` in `.env`.

## Data it produces

`search` returns `Job[]` ({ title, url, company, location }) for records that
have a job URL; the engine writes them to the pipeline. `export` returns
{ pushed: N } — it never writes local files.
