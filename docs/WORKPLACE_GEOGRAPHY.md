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

The policy is an additional gate before the normal location tiers. It never
rescues a posting the existing `block_hard`, `block` or `allow` rules reject.
Without `workplace_policy`, location matching is unchanged.

- Office and hybrid roles must name an allowed onsite location. An explicit
  foreign country prevents a same-named city from matching.
- Remote roles must show an allowed country or a configured covering region.
  A bare `Remote` label or a timezone requirement is not sufficient evidence.
- Structured applicant-country restrictions and explicit English eligibility
  clauses can narrow a broad label such as `Europe` or `Worldwide`; an explicit
  excluded home country or `UK only` restriction wins.

Normal scans, full ATS scans and shared admission gates use the same check.
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
