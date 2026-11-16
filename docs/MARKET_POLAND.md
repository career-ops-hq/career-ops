# Poland market setup (opt-in)

This is a user-selected setup guide, not a change to the shipped search
defaults. It uses existing providers and adds no scraper or candidate data.

## Poland-relevant job boards

These entries are already in `templates/portals.example.yml` and are disabled
by default. Enable only the boards you want in your user-owned `portals.yml`;
do not edit the shipped template.

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
built-in board providers in this checkout. Do not treat them as scanner-enabled;
adding a provider would be separate implementation work.

## Poland-first location

For Warsaw/Poland office roles and remote roles explicitly eligible for EU
applicants, use the [Poland-first, EU-remote location policy](WORKPLACE_GEOGRAPHY.md#poland-first-eu-remote-example).
It is opt-in. Add other countries to `allow` and `onsite_countries` only when
you are willing to consider office or hybrid work there. A remote-region label
is not proof of work authorization.

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
