# Employer registry

A community-maintained list of employer job boards that the local scanner can
read. Each row is a pointer: **employer → ATS → board**. The registry holds no
job postings and no job titles, and its rows hold no personal data. The
contribution manifests do publish two things about people: the GitHub
username of whoever contributes, and the name of whoever grants the license
(`contributor` and `signed_by`, see [the manifest](#the-contribution-manifest)).
Postings are always read from the employer's own board, on your machine.

- [What a row looks like](#a-row)
- [Files](#files)
- [Contributing boards](#contributing-boards)
- [The contribution manifest](#the-contribution-manifest)
- [Validation](#validation)
- [Removal at an employer's request](#removal-at-an-employers-request)
- [License](#license)

## A row

One JSON object per line in `boards/<ats>/<initial>.ndjson`:

```json
{"ats":"greenhouse","region":"us","board":"vercel","careers_url":"https://job-boards.greenhouse.io/vercel","name":"Vercel","source":"community","contribution":"2026-11-08-santifer","added":"2026-11-08"}
```

| Field | Required | Rule |
|---|---|---|
| `ats` | yes | One of `greenhouse`, `ashby`, `lever`, `workable`, `smartrecruiters`, `rippling`, `join`, `recruitee`, `breezy`, `bamboohr`, `pinpoint`, `workday`. |
| `region` | greenhouse and lever only | `us` or `eu`. An EU board (`job-boards.eu.greenhouse.io`, `jobs.eu.lever.co`) is a different board from a US one with the same id. Absent on every other ATS. |
| `board` | yes | The board id, as it appears in the board's URL. Ashby ids keep their case (`AlephAlpha`, `DeepL`). `recruitee`, `breezy`, `bamboohr` and `pinpoint` ids are lowercase, because they are subdomains. Workday: `tenant/wdN/site`, with the site in the case of the careers page's canonical link (`<link rel="canonical">`), for example `nvidia/wd5/NVIDIAExternalCareerSite`. Numeric-only ids, placeholders and characters outside `A-Z a-z 0-9 . _ -` are rejected. |
| `workday_host` | workday only | `jobs` for `https://<tenant>.<wdN>.myworkdayjobs.com/<site>`, `site` for `https://<wdN>.myworkdaysite.com/recruiting/<tenant>/<site>`. |
| `careers_url` | yes | The canonical board URL. It must be exactly the URL built from `ats`, `region`, `board` and `workday_host` (`buildBoardUrl` in `lib/ats-board-url.mjs`, the same function the ATS discovery uses). It is the registry's unique key. |
| `name` | yes | The employer's name, up to 80 characters. No URL, email address, phone number or @handle. |
| `website` | no | The employer's registrable domain (`example.com`), without scheme, `www` or path. |
| `countries` | no | ISO 3166-1 alpha-2 codes. Stored; the scanner does not filter on them yet. |
| `tags` | no | Reserved. No tag is accepted until the vocabulary is defined. |
| `source` | yes | Where the pointer came from: `community`, `ats-directory`, `vc-portfolio`, `employer-list:<org>` or `prior-mit:<owner>/<repo>@<commit>`. It must match the manifest's `source`. |
| `contribution` | yes | The id of the manifest that added the row. |
| `added` | yes | The date the row was added (`YYYY-MM-DD`). |
| `retired`, `retired_reason` | maintainers only | `retired: true` with a reason: `gone`, `owner_request`, `moved`, `duplicate` or `policy`. |

There is no free text and no unknown key. Rows in a file are sorted by
`board` (case-insensitive), then `region`. The file is named after the
board's first character, lowercase: `boards/ashby/a.ndjson` holds `AlephAlpha`
and `attio`.

A retired row is never deleted. It stays in its file so the same board cannot
be added again by another contribution, and tools that read the registry skip
it.

## Files

```
employers/
├── README.md               this file
├── LICENSE                 CC BY 4.0
├── THIRD_PARTY_NOTICES.md  notices for data under a third party's license (none yet)
├── CHANGELOG.md            one credit line per contribution, generated from the manifests by maintainers
├── schema.json             JSON Schema of a row and of a manifest, for editors
├── contributions/          one manifest per contribution
├── boards/<ats>/<initial>.ndjson
└── inbox/                  contributions waiting to be folded in (only while there are some)
```

The registry lives in this repository only: a fresh clone has it, but the
career-ops updater does not copy it to existing installs. CI warns when
`boards/` passes 25 MB, so a maintainer can look at how the data is stored.

## Contributing boards

A contribution is one new file in `inbox/`, and nothing else. You do not edit
`boards/`, `contributions/` or `CHANGELOG.md`: after merging, maintainers fold
the inbox into them.

### The inbox file

Name it `inbox/<YYYY-MM-DD>-<github-username>.ndjson`, with the date and your
GitHub username in lowercase: `inbox/2026-11-20-octocat.ndjson`. A file holds
up to 5,000 boards. For a longer list, number the files:
`inbox/2026-11-20-octocat-001.ndjson`, `-002.ndjson`, and so on.

One board per line, one JSON object per line:

```json
{"ats":"greenhouse","board":"vercel","name":"Vercel","website":"vercel.com"}
{"ats":"ashby","board":"DeepL","name":"DeepL"}
{"ats":"workday","board":"nvidia/wd5/NVIDIAExternalCareerSite","name":"NVIDIA"}
```

| Key | Required | Rule |
|---|---|---|
| `ats` | yes | One of the ATS in [the row table](#a-row). |
| `board` | yes | The board id, as in [the row table](#a-row). Workday: `tenant/wdN/site`. |
| `name` | yes | The employer's name, up to 80 characters. No URL, email address, phone number or @handle. |
| `website` | no | The employer's registrable domain (`example.com`). |
| `region` | no | Greenhouse and Lever only: `eu` for a board on `job-boards.eu.greenhouse.io` or `jobs.eu.lever.co`. Without it, the board is on the US host. |
| `workday_host` | no | Workday only: `site` for a board on `<wdN>.myworkdaysite.com/recruiting/<tenant>/<site>`. Without it, the board is on `<tenant>.<wdN>.myworkdayjobs.com/<site>`. |

Any other key is an error. Each board appears once in the inbox. A board
that is already in the registry is a warning, not an error: it is skipped
when the inbox is folded in.

### From the browser

1. Open [`employers/`](https://github.com/career-ops-hq/career-ops/tree/main/employers)
   on GitHub and choose **Add file**, then **Create new file**.
2. Name the file `inbox/<YYYY-MM-DD>-<github-username>.ndjson` and paste your
   lines.
3. Commit it to a new branch and open the pull request.

### From a list, with the importer

If you have a list of board URLs, the importer writes the inbox files for you:

```bash
node seeds/employers-import.mjs boards.csv --login <github-username>
node seeds/employers-validate.mjs
```

The list is a CSV with a `url` column (and optionally `name` and `website`),
or plain text with one board URL per line. The importer reads each URL back
to its ATS and board, writes the canonical form, and splits the result into
files of 5,000. A URL it does not recognise, a duplicate, or a line with an
invalid name or website goes to `boards.csv.rejected.csv` with the reason,
and never into the inbox. Without a name column, it makes each name from the
board id: check those names before you open the pull request. It makes no
network request.

Then commit only the new files in `employers/inbox/` and open the pull
request.

### For an organization

An organization adds its manifest next to its boards files, under the same
name without a part number: `inbox/<YYYY-MM-DD>-<github-username>.json`. It
has the fields of [the contribution manifest](#the-contribution-manifest);
`contributor` is the username in the file name, and `rows` counts the lines
of all its files. Without a manifest, the contribution is credited to the
username in the file name, with source `community`.

### What happens next

The `Employer registry validate` workflow checks the new files, and reports
whether the pull request only adds files to `inbox/`. A maintainer reviews it
and merges it, then folds the inbox in: each line becomes a row with its
`source`, `contribution` and `added` date, boards already in the registry are
skipped, the manifest moves to `contributions/`, and `CHANGELOG.md` gets the
credit line. If the contribution id is already taken (the same username on
the same date), the fold adds `-2`, `-3`, and so on.

What does not get in:

- boards on an ATS outside the list above (more ATS will follow, each with its
  own board format);
- job aggregators and reposting sites (`data-static/aggregator-domains.txt`);
- lists taken from sites that need a login, or from LinkedIn or Indeed, even
  as hints;
- a bulk list without a written `origin`.

By opening the pull request you license the data you add under CC BY 4.0,
you also allow the maintainer to distribute it under ODbL 1.0 or CC0 (see
[License](#license)), and you confirm that no contract stops the list from
being redistributed and that it holds no personal data.

## The contribution manifest

Every contribution is recorded in one manifest,
`contributions/<YYYY-MM-DD>-<github-username>.json`, and each row it adds names
it in `contribution`. The manifest is the row's provenance: who contributed
it, where the list came from, and the license it was granted under. The pull
request that adds it is opened from the account named in `contributor`, and
opening it is how the manifest is signed.

An organization writes its manifest in `inbox/` with its boards (see
[For an organization](#for-an-organization)). For a contribution without
one, maintainers write a short manifest when they fold the inbox in: the
username in the file name is the `contributor`, `signed_by` is that
account, and the source is `community`. Both are public: the username and
`signed_by` appear in the manifest, and `attribution` in `CHANGELOG.md`.

```json
{"id":"2026-11-20-acme","contributor":"github-handle","on_behalf_of":"Acme Inc.","signed_by":"Name of a founder or officer",
 "rows":120,"source":"employer-list:acme","origin":"How and where the list was obtained, in one sentence",
 "no_conflicting_contract":true,"personal_data":false,"exclusive":false,
 "license":"CC-BY-4.0","also_permits":["ODbL-1.0","CC0-1.0"],
 "attribution":"Employer pages contributed by Acme","date":"2026-11-20"}
```

| Field | Rule |
|---|---|
| `id` | `<YYYY-MM-DD>-<slug>`, the same as the file name. |
| `contributor` | The GitHub username of the account that opens the pull request. |
| `on_behalf_of` | Optional: the organization the list comes from. |
| `signed_by` | Who grants the license. For an organization, a founder or an officer with authority to do so. |
| `rows` | How many rows the contribution adds. |
| `source` | The same value as each of its rows. |
| `origin` | How and where the list was obtained, in one sentence. |
| `no_conflicting_contract` | `true`: no contract stops the list from being redistributed. |
| `personal_data` | `false`: the list holds no personal data. |
| `exclusive` | `false`: the contribution is not exclusive to anyone. |
| `license`, `also_permits` | `"CC-BY-4.0"` and `["ODbL-1.0","CC0-1.0"]`. |
| `attribution` | The credit line in `CHANGELOG.md`. Credit, not advertising. |
| `date` | The contribution date, the same as in the id. |

## Validation

```bash
node seeds/employers-validate.mjs                    # check employers/, inbox included
node seeds/employers-validate.mjs --base <dir>       # also check the changes against another checkout
node seeds/employers-validate.mjs --write-changelog  # maintainers, on main: regenerate CHANGELOG.md, then check
node seeds/employers-validate.mjs --inbox-only --base <ref>  # does <ref>...HEAD only add inbox files? (JSON)
node seeds/employers-fold.mjs [--apply]              # maintainers: fold the inbox in (dry run without --apply)
```

Every error names the file, the line and the reason. In a pull request, each
one also appears as an annotation on the line it is about, with a summary on
the workflow run. The checks:

1. Every row and manifest matches the format above; unknown keys are errors.
2. `ats`, `region`, `workday_host` and `source` come from their closed lists,
   and `careers_url` is the canonical URL of the board.
3. Board ids have the shape their ATS uses.
4. No `careers_url` or `website` is on an aggregator domain.
5. No personal data: no email address, phone number or @handle.
6. Each board is listed once: `careers_url` is unique ignoring letter case,
   and a Workday board appears under one host form only. When a pull request
   adds a second spelling of a board, the row already merged stays and the new
   one is the error. A `website` on more than one row is a warning: one company
   can have several boards.
7. Each row is in its own file, in order.
8. Each row names a valid manifest; a pull request adds new rows only with a
   manifest of its own.
9. A contribution does not change `retired`, and no row is ever deleted.
10. A warning, not an error, when `boards/` passes 25 MB.
11. The inbox: file names, at most 5,000 lines a file, the line format above,
    the same board rules, each board once across the inbox, and an
    organization's manifest (same rules, `rows` equal to its lines,
    `contributor` equal to the username in the file name). A board already in
    the registry is a warning.

`CHANGELOG.md` is not checked against the manifests: a contribution does not
edit it, and maintainers regenerate it on main.

In a pull request, the `Employer registry validate` workflow runs the
validator from the base branch against the pull request's files, so a pull
request cannot change the rules it is checked by. It then reports whether
every change adds a new file directly in `inbox/`, with a valid name: no
edited, deleted or renamed file, and nothing outside `inbox/`. The answer is
in the job summary and in the job's `inbox_only` output; the workflow does
not act on it.

## Removal at an employer's request

An employer can ask for its row to be removed, either with the
[employer removal issue form](https://github.com/career-ops-hq/career-ops/issues/new?template=employer-removal.yml)
or by email to **hi@santifer.io**. Within 7 days a maintainer marks the row
`retired: true` with `retired_reason: owner_request`. The row stays in the
file, retired, so the board is not added again by a later contribution, and
tools that read the registry stop reading that board.

## License

The data in this directory is licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): see [LICENSE](LICENSE).
Contributors also allow the licensor to distribute their contributions under
ODbL 1.0 or CC0 1.0.

Licensor and database maker: Santiago Fernández de Valderrama

The career-ops code is MIT-licensed (the repository's root `LICENSE`).
