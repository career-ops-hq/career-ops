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

For Warsaw office roles and remote roles explicitly eligible for EU applicants,
use the [Poland-first, EU-remote location policy](WORKPLACE_GEOGRAPHY.md#poland-first-eu-remote-example).
The copyable example is city-specific: add each desired city to both `allow`
and `onsite_locations`, and add its country to `onsite_countries` for office or
hybrid work. This also lets EU-based users add their own local office locations.
A remote-region label is not proof of work authorization.

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
