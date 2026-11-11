# Employer registry

A community-maintained list of employer job boards that the local scanner can
read. Each row is a pointer: **employer → ATS → board**. The registry holds no
job postings, no job titles and no personal data. Postings are always read
from the employer's own board, on your machine.

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
└── boards/<ats>/<initial>.ndjson
```

The registry lives in this repository only: a fresh clone has it, but the
career-ops updater does not copy it to existing installs. CI warns when
`boards/` passes 25 MB, so a maintainer can look at how the data is stored.

## Contributing boards

Contributions open in a few days through a simpler path: one line with the
board's address and the employer's name, and a short form. You will not need
to edit these files by hand.

Until then, [open an issue](https://github.com/career-ops-hq/career-ops/issues/new/choose)
with the board's address and the employer's name, and a maintainer adds it.

What does not get in:

- boards on an ATS outside the list above (more ATS will follow, each with its
  own board format);
- job aggregators and reposting sites (`data-static/aggregator-domains.txt`);
- lists taken from sites that need a login, or from LinkedIn or Indeed, even
  as hints;
- a bulk list without a written `origin`.

A maintainer reviews every contribution before merging. Data contributed to
`employers/` is licensed under CC BY 4.0, and you also allow the
maintainer to distribute it under ODbL 1.0 or CC0 (see [License](#license)).

## The contribution manifest

Every contribution is recorded in one manifest,
`contributions/<YYYY-MM-DD>-<github-username>.json`, and each row it adds names
it in `contribution`. The manifest is the row's provenance: who contributed
it, where the list came from, and the license it was granted under. The pull
request that adds it is opened from the account named in `contributor`, and
opening it is how the manifest is signed.

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
node seeds/employers-validate.mjs                    # check employers/
node seeds/employers-validate.mjs --base <dir>       # also check the changes against another checkout
node seeds/employers-validate.mjs --write-changelog  # maintainers, on main: regenerate CHANGELOG.md, then check
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

`CHANGELOG.md` is not checked against the manifests: a contribution does not
edit it, and maintainers regenerate it on main.

In a pull request, the `Employer registry validate` workflow runs the
validator from the base branch against the pull request's files, so a pull
request cannot change the rules it is checked by.

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
