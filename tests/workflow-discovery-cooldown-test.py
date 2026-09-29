"""Check company matching and role-scoped reapplication windows."""

from datetime import date
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow.discovery_cooldown import company_match, cooldown, load_windows

assert company_match("Nestlé Deutschland", "Nestlé")
assert company_match("株式会社アカネ", "株式会社アカネ")
assert not company_match("株式会社アカネ", "合同会社ゾロ")
assert not company_match("Acmetric", "Acme")
assert not company_match("", "")

windows = load_windows({"re_apply_windows": {
    "Acme": {"last_apply_date": "2026-09-20", "same_role_days": 14,
             "applied_to": ["Engineer"], "cross_role_bucket": "em_roles"},
    "Invalid": {"last_apply_date": "2026-02-30", "same_role_days": 7},
    "Malformed": {"last_apply_date": "2026-09-20", "same_role_days": None},
}})
assert set(windows) == {"Acme"}
today = date(2026, 9, 28)
assert cooldown({"company": "Acme Corp", "title": "Engineer"}, windows, today=today)["reason"] == "cooldown:Acme:2026-10-04"
assert cooldown({"company": "Acme", "title": "Engineering Manager"}, windows, today=today)["skip"]
assert not cooldown({"company": "Acme", "title": "Designer"}, windows, today=today)["skip"]
assert not cooldown({"company": "Acme", "title": "Engineer"}, windows, today=date(2026, 10, 4))["skip"]
