# Ontario GO Jobs offline recipe

Ontario GO Jobs places its search and posting pages behind an interactive
Radware challenge. This recipe does not fetch the site, solve the challenge, or
reuse browser credentials. It only parses rendered result pages that you save
after using the site normally in your own browser.

This is a cookbook recipe, not a bundled career-ops integration. Copy the
parser into the gitignored `local/` directory before using it so you can adjust
site-specific HTML handling without changing core.

## Set up

From the career-ops checkout:

```bash
mkdir -p local data/gojobs
cp docs/recipes/gojobs/parse-gojobs-html.mjs local/gojobs.mjs
```

On PowerShell:

```powershell
New-Item -ItemType Directory -Force local, data/gojobs
Copy-Item docs/recipes/gojobs/parse-gojobs-html.mjs local/gojobs.mjs
```

In your normal browser, open the GO Jobs search page, complete any challenge
yourself, run the search, and save each rendered results page as HTML under
`data/gojobs/`. Save every page you want scanned. Duplicate canonical job URLs
are collapsed across captures.

Test the copied parser directly:

```bash
node local/gojobs.mjs data/gojobs
```

A CAPTCHA page or bare search form fails loudly instead of returning a false
empty result.

## portals.yml

Add this private entry to `portals.yml`:

```yaml
tracked_companies:
  - name: Ontario Public Service
    careers_url: https://www.gojobs.gov.on.ca/Search.aspx
    scan_method: local_parser
    parser:
      command: node
      script: local/gojobs.mjs
      args: [data/gojobs]
      format: jobs-json-v1
    enabled: true
```

Run `node scan.mjs` as usual. The local-parser provider starts the copied script
from the career-ops checkout, and the parser resolves capture paths through
`CAREER_OPS_ROOT`, `CAREER_OPS_DATA_DIR`, or `.career-ops-data` using the same
precedence as the rest of career-ops. Normal scan filters, deduplication, and
pipeline writes still apply. Refreshing coverage requires another manual save;
this is not real-time or unattended scanning.

## Manual recipe test

Recipe tests live beside the recipe and are intentionally not discovered by
`test-all.mjs`, which only runs suites under `tests/`. Run this focused test by
hand after modifying the parser:

```bash
node --test docs/recipes/gojobs/parse-gojobs-html.manual-test.mjs
```

Every `.mjs` file in the repository still participates in the standard
`node --check` syntax pass.
