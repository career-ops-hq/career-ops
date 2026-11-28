# Provider settings

Some providers read optional settings from their entry in `portals.yml`, next to `name`, `careers_url` and `provider`. This page covers the settings of the Polish boards JustJoin.it and NoFluffJobs. For what each provider reads in general, see [Supported job boards](SUPPORTED_JOB_BOARDS.md).

All settings below are **off by default**: an entry that sets none of them keeps every offer the board returns. These filters run inside the provider, before the global `title_filter`, `location_filter` and the rest. Offers they drop never reach those filters.

## JustJoin.it (`provider: justjoin`)

```yaml
- name: JustJoin.it
  careers_url: https://justjoin.it/job-offers/all-locations
  provider: justjoin
  workplace: [remote, hybrid]
  open_to_ukrainians: true
  max_polish_level: B1
  enabled: true
```

| Setting | Accepted values | What it does |
|---|---|---|
| `workplace` | A list (or a single value) of `remote`, `hybrid`, `office`. Case-insensitive. | Keeps only offers whose `workplaceType` is in the list. |
| `open_to_ukrainians` | `true` | Keeps only offers whose employer set `isOpenToHireUkrainians` to true. Only the boolean `true` turns it on; any other value, including the string `"true"`, leaves it off. |
| `max_polish_level` | A CEFR level, `A1` to `C2`. Case-insensitive. | Drops offers that ask for Polish above that level. |

Behaviour worth knowing:

- **`max_polish_level` keeps offers with no language listed.** An offer that lists no languages at all, or lists languages but not Polish, is kept, because the field is often empty. The setting can only drop an offer that names a Polish level above your limit.
- A Polish entry with a level the provider does not recognise counts as `C2`, so it is dropped under a strict limit rather than slipping through.
- An unrecognised `max_polish_level` value (for example `B3`) turns the filter off without a warning.
- `workplace` is matched against the board's value as is. A value outside `remote`, `hybrid`, `office` (a typo, say) matches no offer, so a list holding only such values drops every offer.

## NoFluffJobs (`provider: nofluffjobs`)

```yaml
- name: NoFluffJobs
  careers_url: https://nofluffjobs.com/pl
  provider: nofluffjobs
  workplace: [remote]
  enabled: true
```

| Setting | Accepted values | What it does |
|---|---|---|
| `workplace` | A list (or a single value) of `remote`, `hybrid`, `office`. Case-insensitive. | `remote` keeps fully remote postings. `hybrid` or `office` keeps every posting that is not fully remote. |

**NoFluffJobs cannot tell hybrid from office.** The list API only marks whether a posting is fully remote. So `[hybrid]` and `[office]` do the same thing: they keep all postings that are not fully remote, hybrid and on-site alike. `[remote, hybrid]` (or any list that has `remote` and one of the other two) keeps everything, so it filters nothing. A list holding only values this provider does not know drops every posting.

NoFluffJobs has no `open_to_ukrainians` or `max_polish_level` setting.
