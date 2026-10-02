"""Compare portal identity decisions and reject cross-company slug repairs."""

from pathlib import Path
from contextlib import redirect_stdout
import json
from io import BytesIO, StringIO
import os
import subprocess
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.error import HTTPError


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from career_ops.discovery import portal_health
from career_ops.http_identity import DEFAULT_USER_AGENT
from career_ops.discovery.portal_health import (board_title_owner, identity_matches, parse_ats_slug,
                                    probe_provider, ProviderHealthSession, slug_candidates, verify_ats_company,
                                    verify_companies)


names = ["Telefónica", "Société Générale", "Hims & Hers", "AT&T", "Mercury Systems",
         "Nimbus Data", "Işık", "Møller", "Großmann", "Đại"]
comparisons = [("Mercury", "Mercury Systems"), ("The Hims & Hers Inc", "Hims & Hers"),
               ("AT&T", "AT&T"), ("Scale", "Scale AI"), ("L'Oréal", "Loreal")]
baseline = json.loads((ROOT / "tests/fixtures/portal-health-node-output.json").read_text())
assert [slug_candidates(name) for name in names] == baseline["slugs"]
assert [identity_matches(*pair) for pair in comparisons] == baseline["matches"]
assert [parse_ats_slug(url) for url in ("https://jobs.eu.lever.co/alpha", "https://jobs.ashbyhq.com/beta",
                                       "https://evil.com/jobs.lever.co/alpha")] == baseline["urls"]
assert board_title_owner("<title>Hims &amp; Hers Jobs</title>") == "Hims & Hers"
assert board_title_owner("<title>Soci&eacute;t&eacute; G&eacute;n&eacute;rale Jobs</title>") == "Société Générale"
assert board_title_owner("<title>A &amp;lt; B Jobs</title>") == "A &lt; B"
assert board_title_owner("<body>no title</body>") is None
assert not identity_matches("Mercury Systems", board_title_owner("<title>Mercury &amp; Co Jobs</title>"))

node_ua = subprocess.run(["node", "--input-type=module", "-e",
                          "import {DEFAULT_USER_AGENT} from './adapters/node/shared/user-agent.mjs'; console.log(DEFAULT_USER_AGENT)"],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
assert DEFAULT_USER_AGENT == node_ua
with patch.object(portal_health, "urlopen", return_value=BytesIO(b"x" * 9000)) as open_url:
    assert len(portal_health.fetch_text("https://example.com")) == 8192
    assert open_url.call_args.args[0].get_header("User-agent") == DEFAULT_USER_AGENT
    assert open_url.call_args.kwargs["timeout"] == 10


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

assert probe_provider({"name": "Example"}, collect=lambda _: {
    "matched": True, "provider": "workday", "jobCount": 0, "budgetReached": True,
}) == {"name": "Example", "provider": "workday", "status": "live", "partial": True}
assert probe_provider({"name": "Example"}, collect=lambda _: {
    "matched": True, "provider": "workday", "error": "HTTP 404", "httpStatus": 404,
})["errorKind"] == "slug_gone"
assert probe_provider({"name": "Example"}, collect=lambda _: {
    "matched": True, "provider": "workday", "error": "HTTP 503", "httpStatus": 503,
    "budgetReached": True,
})["status"] == "missing"
assert probe_provider({"name": "Example"}, collect=lambda _: {"matched": False})["status"] == "skipped"
assert len(verify_companies([{"name": "disabled", "enabled": False}, {"name": "unknown"}],
                            ats_probe=lambda _: None,
                            provider_probe=lambda _: {"status": "skipped"})) == 1
with ProviderHealthSession() as session:
    for name in ("Unknown One", "Unknown Two"):
        assert session.probe({"name": name, "careers_url": "not-a-url"})["matched"] is False
with TemporaryDirectory() as directory:
    portal = Path(directory) / "portals.yml"
    portal.write_text("tracked_companies:\n  - name: Disabled\n    enabled: false\n")
    command = subprocess.run([sys.executable, "-B", "-m", "career_ops", "portal", "health", "--ats-only",
                              "--json", "--strict", "--file", str(portal)],
                             cwd=ROOT, capture_output=True, text=True, check=True)
    assert json.loads(command.stdout) == {"found": True, "results": []}
    (Path(directory) / ".env").write_text("CAREER_OPS_ALLOW_FAKE_IP_RANGE=1\n")
    with patch.object(portal_health, "ROOT", Path(directory)), \
            patch.dict(os.environ, {}, clear=True), redirect_stdout(StringIO()):
        assert portal_health.main(["--file", str(Path(directory) / "missing.yml"), "--json"]) == 0
        assert os.environ["CAREER_OPS_ALLOW_FAKE_IP_RANGE"] == "1"

print("workflow portal health: Node decisions and ownership rejection passed")
