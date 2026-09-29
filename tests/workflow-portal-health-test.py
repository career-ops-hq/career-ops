"""Compare portal identity decisions and reject cross-company slug repairs."""

from pathlib import Path
import json
import subprocess
import sys
from urllib.error import HTTPError


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow.portal_health import (board_title_owner, identity_matches, parse_ats_slug,
                                    slug_candidates, verify_ats_company)


names = ["Telefónica", "Société Générale", "Hims & Hers", "AT&T", "Mercury Systems",
         "Nimbus Data", "Işık", "Møller", "Großmann", "Đại"]
comparisons = [("Mercury", "Mercury Systems"), ("The Hims & Hers Inc", "Hims & Hers"),
               ("AT&T", "AT&T"), ("Scale", "Scale AI"), ("L'Oréal", "Loreal")]
node = subprocess.run(
    ["node", "--input-type=module", "-e",
     "import {deriveSlugCandidates,boardIdentityMatches,parseAtsSlug} from './verify-portals.mjs'; "
     "let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);"
     "console.log(JSON.stringify({slugs:x.names.map(n=>deriveSlugCandidates(n,{firstWordSuffixes:false})),"
     "matches:x.comparisons.map(([a,b])=>boardIdentityMatches(a,b)),"
     "urls:x.urls.map(parseAtsSlug)}));"],
    cwd=ROOT, input=json.dumps({"names": names, "comparisons": comparisons,
                                "urls": ["https://jobs.eu.lever.co/alpha", "https://jobs.ashbyhq.com/beta",
                                         "https://evil.com/jobs.lever.co/alpha"]}),
    text=True, capture_output=True, check=True,
)
baseline = json.loads(node.stdout)
assert [slug_candidates(name) for name in names] == baseline["slugs"]
assert [identity_matches(*pair) for pair in comparisons] == baseline["matches"]
assert [parse_ats_slug(url) for url in ("https://jobs.eu.lever.co/alpha", "https://jobs.ashbyhq.com/beta",
                                       "https://evil.com/jobs.lever.co/alpha")] == baseline["urls"]
assert board_title_owner("<title>Hims &amp; Hers Jobs</title>") == "Hims & Hers"


def missing(url):
    raise HTTPError(url, 404, "Not Found", {}, None)


def board_json(url):
    if url.endswith("/old/jobs"):
        return missing(url)
    if url.endswith("/alphalabs/jobs"):
        return {"jobs": [{"id": 1}]}
    if url.endswith("/alphalabs"):
        return {"name": "Alpha Labs"}
    return missing(url)


row = verify_ats_company({"name": "Alpha Labs", "careers_url": "https://boards.greenhouse.io/old"},
                         get_json=board_json, get_text=lambda _: "")
assert row["suggested"]["ats"] == "greenhouse" and row["suggested"]["slug"] == "alphalabs"


def wrong_owner(url):
    result = board_json(url)
    if url.endswith("/alphalabs"):
        return {"name": "Alpha Labs AI"}
    return result


row = verify_ats_company({"name": "Alpha Labs", "careers_url": "https://boards.greenhouse.io/old"},
                         get_json=wrong_owner, get_text=lambda _: "")
assert "suggested" not in row

print("workflow portal health: Node decisions and ownership rejection passed")
