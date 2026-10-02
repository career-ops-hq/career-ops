"""Exercise Python board decisions, preview writes and the Node probe boundary."""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from career_ops.discovery.board_resolution import (ProviderProbeSession, VENDOR_ORDER, candidate_urls, dedupe_matches, derive_slug,
                                       insert_tracked_companies, parse_company_input, parse_workday_hint, portal_entry,
                                       resolve_boards, resolve_company)


companies, warnings = parse_company_input("companies:\n  - name: Stripe\n  - name: Stripe\n  - name: DeepL\n    slug: DeepL\n", ["stripe", "Ramp"])
assert [company["name"] for company in companies] == ["Stripe", "DeepL", "Ramp"]
assert not warnings
assert derive_slug("  N8N!  ") == "n8n"
assert parse_company_input(": : invalid yaml : :\n[", [])[1]
assert parse_company_input("companies:\n  - name: ''\n  - slug: x\n", [])[0] == []
assert VENDOR_ORDER[:3] == ("gh", "ashby", "lever")
default_candidates, _, _ = candidate_urls({"name": "Adyen"}, VENDOR_ORDER)
assert len(default_candidates) == len(VENDOR_ORDER)
assert {item["vendor"]: item["careers_url"] for item in default_candidates} == {
    "gh": "https://job-boards.greenhouse.io/adyen", "ashby": "https://jobs.ashbyhq.com/adyen",
    "lever": "https://jobs.lever.co/adyen", "workable": "https://apply.workable.com/adyen",
    "smartrecruiters": "https://careers.smartrecruiters.com/adyen", "recruitee": "https://adyen.recruitee.com",
    "bamboohr": "https://adyen.bamboohr.com", "breezy": "https://adyen.breezy.hr",
    "pinpoint": "https://adyen.pinpointhq.com", "rippling": "https://ats.rippling.com/adyen/jobs",
    "join": "https://join.com/companies/adyen"}
mixed, _, _ = candidate_urls({"name": "DeepL", "slug": "DeepL"}, VENDOR_ORDER)
assert next(item["careers_url"] for item in mixed if item["vendor"] == "ashby").endswith("/DeepL")
assert next(item["careers_url"] for item in mixed if item["vendor"] == "recruitee") == "https://deepl.recruitee.com"
for unsafe_slug in ("foo.bar", "evil.com", "a.b.c.d", "..evil.com", "x.bamboohr.com", "169.254.169.254"):
    candidates, _, _ = candidate_urls({"name": "X", "slug": unsafe_slug},
                                      ("recruitee", "breezy", "bamboohr", "pinpoint"))
    assert all(urlsplit(item["careers_url"]).hostname.endswith({
        "recruitee": ".recruitee.com", "breezy": ".breezy.hr",
        "bamboohr": ".bamboohr.com", "pinpoint": ".pinpointhq.com"}[item["vendor"]]) for item in candidates)

for slug, expected in (("foo.bar", {"workable", "recruitee", "bamboohr", "breezy", "pinpoint", "rippling"}),
                       ("_bad", {"workable", "recruitee", "bamboohr", "breezy", "pinpoint", "rippling"}),
                       ("a-", {"pinpoint", "rippling"})):
    candidates, skipped, unsupported = candidate_urls({"name": "X", "slug": slug}, VENDOR_ORDER)
    assert not skipped and set(unsupported) == expected, (slug, candidates, unsupported)
assert parse_workday_hint({"name": "Nvidia", "workday": {"tenant": "nvidia", "site": "External", "instance": "wd5"}}) == {
    "tenant": "nvidia", "site": "External", "instance": "wd5"}
assert parse_workday_hint({"name": "Nvidia", "workday": "https://nvidia.wd5.myworkdayjobs.com/External"}) == {
    "tenant": "nvidia", "site": "External", "instance": "wd5"}
assert parse_workday_hint({"name": "Adyen"}) is None
assert parse_workday_hint({"name": "Bad", "workday": {"tenant": "../bad", "site": "External"}}) is None
assert parse_workday_hint({"name": "X", "careers_url": "https://acme.wd3.myworkdayjobs.com/en-US/Careers/job/foo"}) == {
    "tenant": "acme", "site": "Careers", "instance": "wd3"}
assert portal_entry({"name": "Foo: Bar", "careers_url": "https://jobs.ashbyhq.com/foo"}).startswith('\n  - name: "Foo: Bar"')
assert "    api: https://boards-api.greenhouse.io/v1/boards/adyen/jobs" in portal_entry({
    "name": "Adyen", "careers_url": "https://job-boards.greenhouse.io/adyen",
    "api": "https://boards-api.greenhouse.io/v1/boards/adyen/jobs"})
assert "api:" not in portal_entry({"name": "Until", "careers_url": "https://jobs.lever.co/until"})
assert "    provider: workday" in portal_entry({"name": "X", "careers_url": "https://x.wd5.myworkdayjobs.com/External", "provider": "workday"})
inserted = insert_tracked_companies("tracked_companies:\njob_boards: []\n", [portal_entry({"name": "X", "careers_url": "https://jobs.lever.co/x"})])
assert inserted.index("tracked_companies:") < inserted.index("name: X") < inserted.index("job_boards:")
doc = "title_filter:\n  positive: [a]\n\ntracked_companies:\n  - name: Existing\n    careers_url: https://jobs.lever.co/existing\n\njob_boards:\n  - name: Foo\n"
inserted = insert_tracked_companies(doc, [portal_entry({"name": "New", "careers_url": "https://jobs.lever.co/new"})])
assert inserted.startswith("title_filter:\n  positive: [a]\n") and inserted.endswith("job_boards:\n  - name: Foo\n")
assert inserted.index("tracked_companies:") < inserted.index("name: New") < inserted.index("job_boards:")
assert "tracked_companies:" in insert_tracked_companies("title_filter: []\n", [portal_entry({"name": "New", "careers_url": "https://jobs.lever.co/new"})])
existing = [{"name": "Adyen", "careers_url": "https://job-boards.greenhouse.io/adyen/"}]
assert len(dedupe_matches([{"name": "adyen", "careers_url": "https://elsewhere.example"}], existing)[1]) == 1
assert len(dedupe_matches([{"name": "Other", "careers_url": "https://job-boards.greenhouse.io/adyen"}], existing)[1]) == 1
assert len(dedupe_matches([{"name": "A", "careers_url": "u1"}, {"name": "A", "careers_url": "u2"}], [])[0]) == 1


def probe(name, provider, url):
    if provider == "greenhouse" and name == "Stripe":
        return {"status": "match", "jobCount": 12}
    if provider == "workday" and ".wd2." in url:
        return {"status": "match", "jobCount": 50}
    return {"status": "error", "httpStatus": 404, "error": "Not Found"}


stripe = resolve_company({"name": "Stripe"}, probe=probe)["resolved"]
assert stripe["vendor"] == "greenhouse" and stripe["jobCount"] == 12 and stripe["api"].endswith("/stripe/jobs")
workday = resolve_company({"name": "Nvidia", "workday": {"tenant": "nvidia", "site": "External"}},
                          vendors=(), probe=probe)["resolved"]
assert ".wd2." in workday["careers_url"] and workday["provider"] == "workday"
absent = resolve_company({"name": "Unknown"}, vendors=("gh",), include_workday=False, probe=probe)["unresolved"]
assert "no supported ATS board" in absent["reason"] and absent["errors"][0]["definitive"]
unavailable = resolve_company({"name": "Unknown"}, vendors=("gh",), include_workday=False,
                              probe=lambda *_: {"status": "error", "error": "timeout"})["unresolved"]
assert "status unknown" in unavailable["reason"]
mixed_failure = resolve_company({"name": "Unknown"}, vendors=("gh", "ashby"), include_workday=False,
                                probe=lambda _name, provider, _url: {"status": "error", "error": "timeout"} if provider == "ashby"
                                else {"status": "error", "httpStatus": 404, "error": "Not Found"})["unresolved"]
assert "status unknown" in mixed_failure["reason"]
empty_board = resolve_company({"name": "Unknown"}, vendors=("gh", "ashby"), include_workday=False,
                              probe=lambda _name, provider, _url: {"status": "empty", "jobCount": 0} if provider == "ashby"
                              else {"status": "error", "error": "timeout"})["unresolved"]
assert "currently list 0 jobs" in empty_board["reason"]
later_match = resolve_company({"name": "Unknown"}, vendors=("gh", "ashby"), include_workday=False,
                              probe=lambda _name, provider, _url: {"status": "match", "jobCount": 5} if provider == "ashby"
                              else {"status": "error", "httpStatus": 404, "error": "Not Found"})["resolved"]
assert later_match["vendor"] == "ashby" and later_match["jobCount"] == 5
assert resolve_company({"name": "Unsafe", "slug": "a/b"}, vendors=("gh",), probe=probe)["unresolved"]["skippedUnsafeSlug"] == ["gh"]

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    portals = root / "portals.yml"
    original = "# keep this comment\ntracked_companies:\n  - name: Existing\n    careers_url: https://jobs.lever.co/existing\n\njob_boards: []\n"
    portals.write_text(original)
    input_file = root / "companies.yml"
    input_file.write_text("companies:\n  - Stripe\n  - Existing\n")
    preview = resolve_boards(portals, input_path=input_file, vendors=("gh",), include_workday=False, probe=probe)
    assert preview["metadata"]["fresh"] == 1 and not preview["metadata"]["written"]
    assert "Stripe" in preview["pendingEntries"] and portals.read_text() == original
    first = resolve_boards(portals, input_path=input_file, vendors=("gh",), include_workday=False, write=True, probe=probe)
    assert first["metadata"]["freshWritten"] == 1 and "# keep this comment" in portals.read_text()
    again = resolve_boards(portals, input_path=input_file, vendors=("gh",), include_workday=False, write=True, probe=probe)
    assert again["metadata"]["freshWritten"] == 0 and portals.read_text().count("name: Stripe") == 1
    assert dedupe_matches([stripe], [{"name": "Else", "api": stripe["api"]}])[1] == [stripe]

script = '''import { probe } from "./adapters/node/providers/_probe.mjs";
const p = new Map([["test", { detect: e => e.careers_url.includes("allowed") ? {} : null,
  fetch: async (_e, ctx) => { if (ctx.maxPages) throw Error("wrong cap"); return [{}, {}]; } }]]);
const good = await probe({ name: "X", provider: "test", careers_url: "https://allowed.example/jobs" }, p, {});
const bad = await probe({ name: "X", provider: "test", careers_url: "https://blocked.example/jobs" }, p, {});
console.log(JSON.stringify({ good, bad }));'''
result = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=True)
boundary = json.loads(result.stdout)
assert boundary["good"] == {"status": "match", "jobCount": 2}
assert boundary["bad"]["status"] == "error" and boundary["bad"]["error"] == "no API URL derivable"
cli = subprocess.run([sys.executable, "-m", "career_ops", "resolve-company", "--help"],
                     cwd=ROOT, capture_output=True, text=True, check=True)
assert "--vendors" in cli.stdout and "--write" in cli.stdout
with ProviderProbeSession() as session:
    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(lambda number: session.probe("X", f"unknown-{number}", "https://example.com"), range(8)))
    assert all(result["status"] == "error" and result["error"] == f"unknown provider: unknown-{number}"
               for number, result in enumerate(results))
print("board resolution: Python decisions, preview, idempotent write and Node probe boundary passed")
