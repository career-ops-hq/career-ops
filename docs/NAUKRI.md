# Naukri

What career-ops does with Naukri: read a job-alert email into your pipeline, and
treat a Naukri link as an aggregator listing that has to be confirmed at the
employer. It does **not** scan Naukri, and cannot.

## Why there is no Naukri provider or scanner

Measured on 2026-11-20 from a plain HTTPS client (no login, no cookie, a
browser User-Agent):

| Check | Result |
| --- | --- |
| `GET https://www.naukri.com/python-jobs` | 200, ~38 KB, a Next.js shell: no `<title>`, no job cards, no JSON-LD |
| `GET https://www.naukri.com/job-listings-…-011026501721` | 200, ~38 KB, same shell; the flight payload ships `jobDetailsResp: {data: null, loading: true}` |
| `GET https://www.naukri.com/jobapi/v3/search?…&keyword=python` (the endpoint the page's own client calls, with `appid`/`systemid` headers) | **406** `{"message":"recaptcha required","statusCode":406}` |
| `GET https://m.naukri.com/job-listings-…` | 403 |
| `GET https://www.naukri.com/robots.txt` | 200; blocks AI crawlers by name (`GPTBot`, `ClaudeBot`, `Claude-User`, …) with `Disallow: /` |

Two of those are stops on their own under the
[Source Indexing Policy](../CONTRIBUTING.md#source-indexing-policy): the listing
data sits behind a **CAPTCHA**, and reading a posting needs a **signed-in
account**. A browser scanner cannot help — it would be a scanner that reports
the challenge and returns nothing, every run. Wrapping the challenge is out of
scope by policy and by choice.

So Naukri is not in `providers/`, and its verdict is recorded in the
[Source Indexing Log](SOURCE_INDEXING_LOG.md) and in
[SUPPORTED_JOB_BOARDS.md](SUPPORTED_JOB_BOARDS.md#evaluated-not-supported).

## What works: a job alert in your own inbox

Naukri mails matching jobs to registered candidates. That email is your mail,
not a crawl, so career-ops reads a paste of it and makes **no network request at
all** — the same shape as [LinkedIn job alerts](LINKEDIN_JOBS.md).

```bash
node naukri-import.mjs                 # paste, then Ctrl-D
node naukri-import.mjs --file alert.eml
node naukri-import.mjs --dry-run       # count only, writes nothing
node naukri-import.mjs --json          # one object: added / already / found
```

Each posting is added once to `data/pipeline.md` and once to
`data/scan-history.tsv`, with the title from the link's anchor text, the
employer from the line under it, and where the posting says a place. A posting
that is already in the pipeline or the tracker is skipped.

The URL is kept as Naukri served it, minus tracking parameters
(`https://www.naukri.com/job-listings-…`). Two spellings of one posting (the
slug is rewritten when a poster edits the title or city) carry the same trailing
posting id, and `url-key.mjs` dedups on that id, so they cannot become two
tracker rows.

If the paste has no anchor text and no usable line around a link, the row's
title is the URL slug's words with a `Job alert`-shaped fallback employer of
`Naukri`: the slug has no delimiter between the title and the employer, so
splitting it would be a guess, and a guess here sends the next step to the wrong
board.

## Then: confirm at the employer

Naukri is an aggregator, so the pipeline applies
[AGENTS.md → Aggregator Listings](../AGENTS.md) to every Naukri link it meets:
find the same role on the employer's own careers page or ATS, and evaluate it
there. The zero-token first pass is:

```bash
node confirm-at-employer.mjs --input posting.json --json
```

`posting.json` is `{"url": "…", "company": "…", "title": "…"}` — written with the
file tool, never through a shell. `naukri.com` is already one of the hosts that
script treats as an aggregator.

**Read the JD from the employer, not from Naukri.** A Naukri posting page is a
client-rendered shell, so `browser-extract.mjs`, WebFetch and
`lib/jd-page-fetch.mjs` all get nothing usable from it; the JD fetcher refuses
Naukri hosts outright rather than spending the source's requests. If the
employer has no careers page and you still want to evaluate the role, paste the
JD text into the conversation — that text is then the record, and the report
says the posting was confirmed nowhere.

## What is deliberately not here

- No `providers/naukri.mjs`, no `scan-naukri.mjs`: see the measurements above.
- No login, no session cookie, no CAPTCHA relay, no guest-endpoint or
  mobile-API workaround. If Naukri later serves its listings to a plain visitor,
  re-measure and open a [source proposal](https://github.com/career-ops-hq/career-ops/issues/new?template=source-proposal.yml).
- The companies that post on Naukri are often readable directly: many Indian
  employers run on Darwinbox, Keka, TurboHire, Zoho Recruit and Workday, all of
  which already have zero-auth providers. Adding the employer to
  `tracked_companies:` in `portals.yml` gets its board into every scan.
