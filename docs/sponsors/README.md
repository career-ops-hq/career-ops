# Sponsor logos

One file per sponsor, referenced from `.github/sponsors.json`. SVG preferred, under 20 KB, no external references, rendered at 48 px height in every README. Each logo is the trademark of its owner and is displayed with their permission for the duration of the sponsorship; it is not covered by the repository's MIT license.

Add a sponsor: drop the file here, add the entry to `.github/sponsors.json` with an explicit `order` (1 = most visible; placement is part of the agreement, so it is never derived from a date or a name), run `node .github/scripts/sponsors.mjs --write`. The sponsor link carries no tracking parameters. `test-all.mjs` checks that README.md and the 16 translations match the JSON.
