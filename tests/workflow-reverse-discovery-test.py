"""Exercise the reverse sweep's fresh-date, filter, dedup and blacklist contracts."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from workflow.reverse_discovery import (blacklist_offers, date_class, output_offer, pre_enrich, rejection,
                                        retain_jobs, title_config)


CUTOFF = 1_000_000_000_000
config = {"title_filter": {"positive": ["Engineer"]},
          "title_filter_full": {"positive": ["AI Engineer"], "negative": ["Sales"]},
          "location_filter": {"allow": ["Shanghai", "Hong Kong"]},
          "content_filter": {"negative": ["no engineering"]}}
base = {"url": "https://jobs.example.com/1", "company": "Acme", "title": "AI Engineer",
        "location": "Shanghai", "description": "Build AI systems", "postedAt": CUTOFF + 1}

assert title_config(config) == config["title_filter_full"]
assert title_config({"title_filter": config["title_filter"]}) == config["title_filter"]
assert title_config({}) is None
assert title_config(None) is None
assert title_config({"title_filter": config["title_filter"], "title_filter_full": {"positive": []}}) == {"positive": []}
assert date_class({"postedAt": CUTOFF - 1}, CUTOFF) == "stale"
assert date_class({}, CUTOFF) == "undated"
assert rejection(base, config, CUTOFF) is None
assert rejection({**base, "postedAt": CUTOFF - 1}, config, CUTOFF) == "stale"
assert rejection({**base, "postedAt": None}, config, CUTOFF) == "undated"
assert rejection({**base, "title": "Backend Engineer"}, config, CUTOFF) == "title"
assert rejection({**base, "location": "Seattle"}, config, CUTOFF) == "location"
assert rejection({**base, "description": "No engineering"}, config, CUTOFF) == "content"
assert pre_enrich({**base, "postedAt": None}, config, CUTOFF)
assert not pre_enrich({**base, "title": "Sales", "postedAt": None}, config, CUTOFF)
assert not pre_enrich({**base, "location": "Seattle", "postedAt": None}, config, CUTOFF)

jobs = [base, {**base, "url": "https://jobs.example.com/2"},
        {**base, "url": "https://jobs.example.com/3", "title": "AI Engineer II"},
        {**base, "url": "https://jobs.example.com/4", "postedAt": None}]
seen_urls, seen_roles = set(), set()
offers, dropped = retain_jobs(jobs, "greenhouse-full", config, CUTOFF, seen_urls, seen_roles)
assert len(offers) == 2 and dropped["duplicate"] == 1 and dropped["undated"] == 1
assert {offer["url"] for offer in offers} == {jobs[0]["url"], jobs[2]["url"]}
assert len(seen_urls) == len(seen_roles) == 2

kept, filtered, annotated = blacklist_offers(offers, {"acme": {"reason": "user choice"}})
assert not kept and filtered == 2 and annotated == 0
kept, filtered, annotated = blacklist_offers(offers, {"acme": {"reason": "user choice"}}, include_blacklisted=True)
assert len(kept) == 2 and filtered == 0 and annotated == 2
assert kept[0]["note"] == "blacklisted: user choice"
assert output_offer(kept[0])["source"] == "greenhouse-full"
print("reverse discovery: date, filters, dedup and blacklist passed")
