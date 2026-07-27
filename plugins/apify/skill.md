---
name: career-ops-plugin-apify
description: How to scan a job source through an Apify actor as a keyed provider.
license: MIT
---

# apify plugin

A keyed provider: runs an Apify actor and maps its dataset items into the
scanner. It fires ONLY on a `portals.yml` entry that sets `provider: apify` —
never via auto-detection. Put `APIFY_TOKEN` in `.env`.

## portals.yml entry

```yaml
tracked_companies:
  - name: "Indeed — VP Engineering (Chicago)"
    provider: apify
    actor: misceres/indeed-scraper
    input: { position: "VP of Engineering", location: "Chicago, IL", maxItems: 25 }
    field_map:
      title:    [positionName, title]    # array = first non-empty wins
      url:      url
      company:  [company, companyName]
      location: [location, formattedLocation]
```

## Then

`node scan.mjs` runs the provider for that entry and writes the results to the
pipeline like any other source. An optional `field_map.description` caches the
JD locally under `jds/`.
