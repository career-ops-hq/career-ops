# Poland market setup (opt-in)

This is a user-selected setup guide, not a change to the shipped search
defaults. It uses existing providers and adds no scraper or candidate data.
For a copyable, opt-in portal fragment, see
[the Poland/EU example](../examples/poland-market/portals.fragment.yml). Merge
it into your user-owned `portals.yml`; do not replace your personal filters.

## Poland-relevant job boards

These providers already exist in `templates/portals.example.yml`. The template
currently enables SolidJobs IT and leaves JustJoin.it, No Fluff Jobs, and
Bulldogjob disabled. The example opts into these existing providers without
changing the shipped template.

| Board | Provider | Support |
|---|---|---|
| JustJoin.it | `justjoin` | Public API |
| No Fluff Jobs | `nofluffjobs` | Public API |
| Bulldogjob | `bulldogjob` | Listing-page parser |
| SolidJobs | `solidjobs` | Public API; the template has division-specific entries |

See [Supported Job Boards](SUPPORTED_JOB_BOARDS.md) for each provider's
pagination, fields, and limitations.

Other Polish sources such as [Pracuj.pl](https://www.pracuj.pl/),
[RocketJobs.pl](https://rocketjobs.pl/), and
[theprotocol.it](https://theprotocol.it/) do not currently have dedicated
built-in board providers in this checkout, so the example does not scan them.
The repository's provider guide requires a source proposal before implementing
a board provider when source eligibility is uncertain. Do not work around a
board's bot challenge to create an integration.

## Poland-first location

For office roles in selected Polish cities and remote roles the candidate can
work from Poland, use the
[Poland-first location policy](WORKPLACE_GEOGRAPHY.md#poland-first-eu-remote-example).
The copyable example lists Polish cities in both `allow` and `onsite_locations`,
with Poland in `onsite_countries` and `remote_countries`. EU region labels in
the posting's location or structured eligibility can match a generic EU-eligible
remote posting when Poland is not named. A description naming only an EU region
does not establish eligibility; a description must identify Poland. A role
restricted to another country is not allowed. To add an EU office for
relocation, add each destination city to `allow` and `onsite_locations`, and
its country to `onsite_countries`. A remote-region label is not proof of work
authorization.

## Compensation details

The evaluator recognizes `PLN` as a currency token. When recording a target or
reading a posting, keep the amount's basis explicit:

- currency (`PLN`);
- period (monthly or annual);
- gross or net, when stated;
- contract type, such as employment contract (`umowa o pracę`, often `UoP`),
  B2B, or `umowa zlecenie`.

Do not compare amounts with different periods or bases as if they were
equivalent. Preserve what the posting says and mark missing details unknown;
this guide makes no net-pay estimate or contract conversion. It is not tax or
legal advice.

In `config/profile.yml`, enter only a candidate-chosen target. For example:

```yaml
compensation:
  target_range: "PLN <candidate-chosen range> gross/month — UoP"
  currency: "PLN"
  minimum: "" # leave blank until the candidate sets a minimum
```

The placeholders above are not market estimates. Do not copy them as a salary
claim.
