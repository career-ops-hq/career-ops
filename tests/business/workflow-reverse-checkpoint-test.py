"""Check reverse sweep resume policy against drift, invalid state and failed writes."""

from pathlib import Path
import json
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from career_ops.discovery.reverse_checkpoint import compatible, load_checkpoint, resume_at, write_checkpoint
from career_ops.discovery.reverse_sources import dataset_fingerprint


values = ["acme", "beta", "gamma"]
fingerprint = dataset_fingerprint(values)
base = {"run_id": "run-1", "cutoff_ms": 1_000_000_000_000, "ats": ["greenhouse"], "seeds": [], "limit": 2,
        "include_undated": False, "completed_sources": [], "offers": [],
        "source_health": [],
        "current": {"name": "greenhouse", "resume_at": 1, "dataset_len": len(values), "dataset_hash": fingerprint},
        "counters": {"companies_scanned": 1}}
with tempfile.TemporaryDirectory() as directory:
    path = Path(directory) / "checkpoint.json"
    assert write_checkpoint(path, base)
    loaded = load_checkpoint(path)
    assert loaded and loaded["cutoff_ms"] == base["cutoff_ms"]
    assert compatible(loaded, ats=["greenhouse"], seeds=[], limit=2, include_undated=False, shuffle=False)
    assert not compatible(loaded, ats=["greenhouse"], seeds=[], limit=2, include_undated=False, shuffle=True)
    assert not compatible(loaded, ats=["greenhouse"], seeds=["yc"], limit=2, include_undated=False, shuffle=False)
    assert resume_at(loaded, "greenhouse", values, fingerprint) == 1
    try:
        resume_at(loaded, "greenhouse", ["beta", "acme", "gamma"], dataset_fingerprint(["beta", "acme", "gamma"]))
    except ValueError as error:
        assert "changed" in str(error)
    else:
        raise AssertionError("reordered dataset must invalidate checkpoint")
    path.write_text('{"version":3,"current":{"name":"greenhouse"}}')
    assert load_checkpoint(path) is None
    for current in ({"name": "greenhouse", "dataset_len": 3, "dataset_hash": fingerprint},
                    {"name": "greenhouse", "resume_at": "x", "dataset_len": 3, "dataset_hash": fingerprint},
                    {"name": "greenhouse", "resume_at": -1, "dataset_len": 3, "dataset_hash": fingerprint},
                    {"resume_at": 1, "dataset_len": 3, "dataset_hash": fingerprint}):
        path.write_text(json.dumps({"version": 3, **base, "current": current}))
        assert load_checkpoint(path) is None
    path.write_text(json.dumps({"version": 3, **base, "current": None}))
    assert load_checkpoint(path)["current"] is None
    assert not write_checkpoint(path / "child", base)
print("reverse checkpoint: compatible resume, dataset drift and write failure passed")
