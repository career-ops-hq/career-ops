"""Check reverse ATS dataset validation, cache fallback and resume fingerprint."""

from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from career_ops.discovery.reverse_sources import (CACHE_SECONDS, dataset_fingerprint, load_company_list,
                                      sample_companies, to_entry)


assert dataset_fingerprint(["acme", "beta"]) == "9d131c15e6830863"
assert dataset_fingerprint(["acme", "beta"]) != dataset_fingerprint(["beta", "acme"])
assert to_entry("greenhouse", "acme")["careers_url"] == "https://job-boards.greenhouse.io/acme"
assert to_entry("workday", "tenant|wd5|External")["careers_url"] == "https://tenant.wd5.myworkdayjobs.com/External"
assert to_entry("icims", "acme") == {"name": "acme", "careers_url":
                                          "https://careers-acme.icims.com/jobs/search?ss=1&in_iframe=1",
                                          "provider": "icims"}
assert to_entry("icims", "evil/..%2f") is None
assert to_entry("lever", "../unsafe") is None
assert to_entry("workday", "tenant|bad/host|External") is None
assert sample_companies(["a", "b", "c"], 2) == ["a", "b"]

with tempfile.TemporaryDirectory() as directory:
    cache = Path(directory)
    calls = []

    def fetch(url):
        calls.append(url)
        return ["acme", "beta"]

    fresh, status = load_company_list("greenhouse", cache, fetch=fetch)
    assert fresh == ["acme", "beta"] and status == "ok" and len(calls) == 1
    cached, status = load_company_list("greenhouse", cache, fetch=lambda _: (_ for _ in ()).throw(AssertionError("refetch")))
    assert cached == fresh and status == "ok"
    stale, status = load_company_list("greenhouse", cache, fetch=lambda _: (_ for _ in ()).throw(OSError("offline")),
                                      now=(cache / "greenhouse.json").stat().st_mtime + CACHE_SECONDS + 1)
    assert stale == fresh and status == "stale"
    empty, status = load_company_list("lever", cache, fetch=lambda _: (_ for _ in ()).throw(OSError("offline")))
    assert empty == [] and status == "empty"
print("reverse sources: host guards, ordering fingerprint and cache fallback passed")
