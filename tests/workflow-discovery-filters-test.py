"""Pin configured posting filters against important Node scanner cases."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from workflow.discovery_filters import (classify_tier, content_match, country_match, filter_reason,
                                        location_hint, location_match, posted_date_match, posting_age_match,
                                        salary_match, title_match, visa_match)


title_filter = {"positive": ["vp", "word:intern", "director + engineering", "C++"],
                "negative": ["word:internship", "coo"]}
assert title_match("VP, Engineering", title_filter) == (True, ["vp"])
assert title_match("Director of Engineering", title_filter) == (True, ["director + engineering"])
assert title_match("International Partnerships Manager", title_filter)[0] is False
assert title_match("C++ Developer", title_filter)[0]
assert not title_match("Internship Engineer", title_filter)[0]
assert not title_match("cafe\u0301intern", {"positive": ["word:intern"]})[0]
assert title_match("anything", {"positive": [None], "negative": []})[0]
corpus = json.loads((ROOT / "tests" / "fixtures" / "title-recall-corpus.json").read_text())
assert all(title_match(row["title"], corpus["title_filter"])[0] == row["matches"] for row in corpus["titles"])
for title, tier in (("Software Engineer Intern", "intern"), ("Junior Software Engineer", "entry"),
                    ("Software Engineer I", "entry"), ("Software Engineer II", "mid"),
                    ("Senior Intern Coordinator", "senior"), ("Summer Intern, Director of Product", "intern"),
                    ("Intern Program Director", "senior"), ("Associate Professor", "senior"),
                    ("Associate Attorney", "entry"), ("Graduate Engineer", "mid"),
                    ("Graduate Engineer Program", "intern")):
    assert classify_tier(title) == tier, (title, classify_tier(title))

location_filter = {"always_allow": ["China"], "allow": ["China"], "block": ["India"],
                   "block_hard": ["Brazil"]}
assert location_match("China or India", "", "Engineer", location_filter)
assert not location_match("China or Brazil", "", "Engineer", location_filter)
assert not location_match("Indiana", "", "Engineer", {"block": ["India"], "allow": ["US"]})
assert location_match("Indiana", "", "Engineer", {"block": ["India"]})
workday = "https://acme.wd1.myworkdayjobs.com/site/job/Hyderabad-Telangana-India/Engineer_1"
assert location_hint(workday) == "hyderabad telangana india"
assert not location_match("5 Locations", workday, "Engineer", {"block": ["India"]})
assert location_match("Las Vegas", "", "Program Manager - Remote", {"allow": ["remote"]})
assert not location_match("Las Vegas", "", "Remote Sensing Engineer", {"allow": ["remote"]})
assert not location_match("Las Vegas", "", "Non–Remote Engineer", {"allow": ["remote"]})
assert not location_match("Multiple Cities, United States", "", "Software Engineer (Remote)",
                          {"allow": ["China"], "block": ["United States"]})
assert posting_age_match(None, 30)
assert posting_age_match(1000, 30, now_ms=1000 + 30 * 86_400_000)
assert not posting_age_match(999, 30, now_ms=1000 + 30 * 86_400_000)
assert posted_date_match(None, "2026-01-01", "2026-01-31")

content_filter = {"negative": ["PHP"], "positive": ["Python"], "by_title_keyword": {
    "director + engineering": {"positive": ["Kubernetes"], "negative": ["outsourcing"]}}}
assert content_match("Python", content_filter, [])
assert not content_match("Python PHP", content_filter, [])
assert content_match("Kubernetes", content_filter, ["director + engineering"])
assert not content_match("Python", content_filter, ["director + engineering"])
assert content_match("", content_filter, ["director + engineering"])
country = {"exclusionary": ["us-based candidates only"], "inclusive": ["north america"]}
assert not country_match("US-based candidates only", country, "Canada")
assert country_match("US-based candidates only; North America eligible", country, "Canada")
assert country_match("US-based candidates only", country, "United States")
assert visa_match("", {"require_mention": False})
assert not visa_match("", {"require_mention": True})
assert not visa_match("No visa sponsorship", {"enabled": True})
assert visa_match("H-1B sponsorship available", {"require_mention": True})
salary = {"min": 100000, "max": 200000, "currency": "USD"}
assert salary_match(None, salary)
assert salary_match({"min": 150000, "currency": "USD"}, salary)
assert not salary_match({"max": 90000, "currency": "USD"}, salary)
assert not salary_match({"min": 150000, "currency": "EUR"}, salary)
assert not salary_match({"max": "90000", "currency": "USD"}, salary)
job = {"title": "Junior Python Engineer", "location": "India", "description": "PHP",
       "url": "https://example.com/job", "postedAt": 1000}
config = {"title_filter": {"positive": ["Python"]}, "skip_tiers": ["entry"],
          "location_filter": {"block": ["India"]}, "content_filter": {"negative": ["PHP"]}}
assert filter_reason(job, config, "China") == "tier"
assert filter_reason({**job, "title": "Python Engineer"}, config, "China") == "location"
assert filter_reason({**job, "title": "Python Engineer", "location": "China"}, config, "China") == "content"
