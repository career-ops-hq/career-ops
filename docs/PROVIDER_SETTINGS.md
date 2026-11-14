# Provider settings

Some providers read optional settings from their entry in `portals.yml`, next to `name`, `careers_url` and `provider`. For what each provider reads in general, see [Supported job boards](SUPPORTED_JOB_BOARDS.md).

All settings below are **off by default**: an entry that sets none of them keeps every offer the board returns.

## SolidJobs (`provider: solidjobs`)

```yaml
- name: SolidJobs
  careers_url: https://solid.jobs/public-api/offers/it?campaign=career-ops
  provider: solidjobs
  workplace: [remote, hybrid]
  enabled: true
```

| Setting | Accepted values | What it does |
|---|---|---|
| `workplace` | A list (or a single value) of `remote`, `hybrid`, `office`. Case-insensitive. | Keeps only offers matching one of the listed work modes. |

The API gives two booleans per offer, `isRemote` and `isHybrid`. An offer with both set matches `remote` and `hybrid`; one with neither is `office`. A value outside `remote`, `hybrid`, `office` matches no offer, so a list holding only such values drops every offer.
