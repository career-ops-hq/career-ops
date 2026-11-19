# Conditional workplace geography

An `allow: [Remote]` location filter matches the work arrangement, not the
countries a remote employee may work from. Likewise, allowing a whole country
admits office roles in every city there. To combine a specific office/hybrid
location with remote work from a country, opt into `location_filter.workplace_policy`:

```yaml
location_filter:
  allow: [Barcelona, Spain, Remote, Europe, Worldwide]
  workplace_policy:
    onsite_locations: [Barcelona]
    onsite_countries: [Spain] # defaults to remote_countries
    remote_countries: [Spain] # country names or ISO codes
    remote_regions: [Europe, European Union, EU, EMEA, Worldwide, Anywhere, Global]
```

### Poland-first, EU-remote example

For a Poland-based search that accepts office roles in selected Polish cities
and remote roles the candidate can work from Poland, use a narrower policy:

```yaml
location_filter:
  allow: [Warsaw, Warszawa, Kraków, Krakow, Wrocław, Wroclaw, Gdańsk, Gdansk, Poznań, Poznan, Łódź, Lodz, Poland, Remote, Worldwide, EU, European Union]
  workplace_policy:
    onsite_locations: [Warsaw, Warszawa, Kraków, Wrocław, Wroclaw, Gdańsk, Poznań, Łódź, Lodz]
    onsite_countries: [Poland]
    remote_countries: [Poland]
    remote_regions: [European Union, EU]
```

This keeps office/hybrid roles in the listed Polish cities and permits remote
roles whose location or structured eligibility identifies Poland or a
configured region such as the EU. A description must identify Poland; naming
only a generic EU region does not establish eligibility. `Worldwide` is
included in `allow` so Poland-eligible remote postings labeled worldwide can
reach the workplace-policy check. `remote_countries: [Poland]` still rejects
a remote role restricted to another country, such as Germany.

For relocation to another EU office, add each destination city to both `allow`
and `onsite_locations`, and its country to `onsite_countries`. If you want all
of Europe rather than the EU, add the appropriate countries or region
explicitly; the scopes are not interchangeable.

Europe, the EU and the EEA are different scopes. Add EU/EEA region labels only
when they cover your allowed remote country; these labels do not establish work
authorization. See the [EU Council's EEA overview](https://www.consilium.europa.eu/en/policies/eu-eea-relations/)
and [EFTA's membership FAQ](https://www.efta.int/about-efta/faqs).

The policy is an additional gate before the normal location tiers. It never
rescues a posting the existing `block_hard`, `block` or `allow` rules reject.
Without `workplace_policy`, location matching is unchanged.

Each policy field is a YAML list; bare strings are rejected. Optional fields may
be omitted or null. An empty `onsite_countries` list also uses `remote_countries`
as its default; a supplied nonempty country list must name a recognized country.

- Office and hybrid roles must name an allowed onsite location. An explicit
  foreign country prevents a same-named city from matching.
- Remote roles must show an allowed country or a configured covering region.
  A bare `Remote` label or a timezone requirement is not sufficient evidence.
- Structured applicant-country restrictions and explicit English eligibility
  clauses can narrow a broad label such as `Europe` or `Worldwide`; an explicit
  excluded home country or `UK only` restriction wins.
- Location and structured country fields accept ISO country codes. Description
  prose uses country names, aliases or an ISO token after explicit geography
  such as `must be based in PT` or `work remotely from PT`. Ordinary words such
  as `us` or `by` cannot establish remote-country eligibility.
- Timezone abbreviations in hours/overlap wording do not count as countries.
  A region qualified by "where we have a hiring presence" needs separate
  evidence that the allowed remote country is eligible.

Normal scans, full ATS scans and shared admission gates use the same check.
Dayforce rechecks the policy against its detail description without repeating
legacy location matching on a changed detail location.
Discover retains the saved policy in its temporary filters and carries provider
geography evidence through its results. Add to Inbox checks the current policy
again before either canonical writer runs. A mixed incompatible selection adds
nothing and explains the rejection, so retry compatible roles separately.
Today rechecks saved history using its stored title and location; old history
rows do not retain full descriptions or applicant-country metadata.

This is a conservative deterministic filter, not universal interpretation of
job-description prose or proof of visa/work authorization. Unsupported or
ambiguous location wording may withhold an eligible role; review the original
posting before changing your policy. The policy belongs in user-owned
`portals.yml`; updates preserve it, and no existing Inbox/history rows are
rewritten automatically.
