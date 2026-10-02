"""Verify scan graph gates and resume after durable evidence extraction."""

from pathlib import Path
import sys
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from career_ops.evaluation import scan_graph


def inputs(name: str) -> dict:
    return {
        "source": {
            "opportunity_id": name, "url": f"https://example.com/{name}",
            "jd": "Build reviewed agent workflows.", "captured_at": "2026-09-28T00:00:00Z",
        },
        "cv": "Verified candidate facts", "profile": "Current profile",
        "targeting": "Current targeting", "rules": "Current rules",
    }


def extracted(*, liveness: str = "active", complete: bool = True, location: str = "pass") -> dict:
    gate = lambda status: {"status": status, "reason": status, "evidence": "Official posting"}
    return {
        "company": "Example", "role": "Engineer", "complete_jd": complete,
        "liveness": liveness, "liveness_reason": "Official posting capture",
        "assessment_complete": True,
        "location": gate(location), "employment": gate("pass"),
        "compensation": gate("pass"), "company_size": gate("pass"),
        "years": {"required": 3, "verified": 3, "evidence": "CV"},
        "core_capabilities": [], "credentials": [],
    }


with tempfile.TemporaryDirectory(prefix="career-ops-scan-graph-") as temporary:
    root = Path(temporary)
    borderline = extracted()
    borderline["years"] = {"required": 4, "verified": 3.3, "evidence": "CV supports 3.3 years"}
    borderline["credentials"] = [
        {"name": "Software Engineering bachelor's degree", "mandatory": True,
         "status": "present", "evidence": "CV degree"},
        {"name": "4+年技术编码工程经验(Bachelor路径)", "mandatory": True,
         "status": "absent", "evidence": "CV supports 3.3 years"},
    ]
    combined = extracted()
    combined["years"] = borderline["years"]
    combined["credentials"] = [{"name": "Bachelor's degree and 4+ years coding experience",
                                "mandatory": True, "status": "absent", "evidence": "CV supports 3.3 years"}]
    invalid_capabilities = extracted()
    invalid_capabilities["core_capabilities"] = [
        {"core": True, "mandatory": True, "match": "gap", "evidence": "No named capability"},
        {"core": True, "mandatory": True, "match": "gap", "evidence": "No named capability"},
    ]
    invalid_credentials = extracted()
    invalid_credentials["credentials"] = [{"mandatory": True, "status": "absent", "evidence": "Unnamed requirement"}]
    invalid_years = extracted()
    invalid_years["years"] = None
    absent_license = extracted()
    absent_license["credentials"] = [{"name": "Required professional license", "mandatory": True,
                                      "status": "absent", "evidence": "No license in CV"}]
    for name, response, expected in (
        ("active", extracted(), "jd_report"),
        ("unknown", extracted(liveness="uncertain"), "source_access_unknown"),
        ("invalid-liveness", extracted(liveness="stale"), "source_access_unknown"),
        ("incomplete", extracted(complete=False), "core_evidence_missing"),
        ("expired", extracted(liveness="expired"), "expired"),
        ("expired-incomplete", extracted(liveness="expired", complete=False), "expired"),
        ("failed", extracted(location="fail"), "prescreen_failed"),
        ("borderline", borderline, "jd_report"),
        ("combined", combined, "jd_report"),
        ("invalid-capabilities", invalid_capabilities, "core_evidence_missing"),
        ("invalid-credentials", invalid_credentials, "core_evidence_missing"),
        ("invalid-years", invalid_years, "core_evidence_missing"),
        ("absent-license", absent_license, "prescreen_failed"),
    ):
        with patch.object(scan_graph.model_adapter, "call_agent", return_value=(response, "fixture")):
            result = scan_graph.run_scan(inputs(name), root)
        if name in {"unknown", "invalid-liveness", "incomplete", "invalid-capabilities", "invalid-credentials", "invalid-years"}:
            assert result["waiting_reason"] == expected
        elif name in {"expired", "expired-incomplete", "failed", "absent-license"}:
            assert result["outcome"] == "exclude"
            assert result["artifact"]["reason_code"] == expected
        else:
            assert result["outcome"] == expected
            assert result["artifact"]["jd"] == inputs(name)["source"]["jd"]
            if name in {"borderline", "combined"}:
                assert result["artifact"]["prescreen"]["status"] == "uncertain"
        assert result["tool_calls"] == 1
        with patch.object(scan_graph.model_adapter, "call_agent", side_effect=AssertionError("Completed scan repeated")):
            assert scan_graph.run_scan(inputs(name), root) == result

    saved = inputs("resume")
    with patch.object(scan_graph.model_adapter, "call_agent", return_value=(extracted(), "fixture")), \
            patch.object(scan_graph, "evaluate_prescreen", side_effect=RuntimeError("prescreen interrupted")):
        try:
            scan_graph.run_scan(saved, root)
        except RuntimeError as error:
            assert str(error) == "prescreen interrupted"
        else:
            raise AssertionError("Prescreen interruption was not surfaced")
    with patch.object(scan_graph.model_adapter, "call_agent", side_effect=AssertionError("Evidence was repeated")):
        resumed = scan_graph.run_scan(saved, root)
    assert resumed["outcome"] == "jd_report" and resumed["tool_calls"] == 1
