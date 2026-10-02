"""Compare Python ATS fill guidance with the retired Node utility."""

from pathlib import Path
import json
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from career_ops.applications.application_prefill import detect_ats, prepare_application


with tempfile.TemporaryDirectory(prefix="career-ops-application-prefill-") as temporary:
    root = Path(temporary)
    (root / "config").mkdir()
    (root / "output").mkdir()
    (root / "profile.yml").write_text(
        'candidate:\n  full_name: "Alice Example"\n  email: "alice@example.invalid"\n'
        '  phone: "+1 555 0100"\n  linkedin: "https://example.invalid/alice"\n'
        '  portfolio_url: "https://portfolio.invalid"\n'
    )
    (root / "output" / "resume.pdf").write_bytes(b"%PDF-1.4\n" + b"x" * 2048)
    (root / "cover.txt").write_text("I built documented workflows.\nI can explain the evidence.")
    baseline = json.loads((ROOT / "tests" / "fixtures" / "application-prefill-baseline.json").read_text())
    for case in baseline:
        url = case["url"]
        guide, warning = prepare_application(url, Path("output/resume.pdf"), Path("cover.txt"), root=root)
        assert warning is None and guide + "\n" == case["stdout"], (url, guide, case["stdout"])

    for url in ("http://boards.greenhouse.io/example/jobs/1234",
                "https://evil.invalid/example/jobs/1234",
                "https://boards.greenhouse.io/example/jobs/not-numeric"):
        try:
            detect_ats(url)
        except ValueError:
            pass
        else:
            raise AssertionError(f"Unsupported apply URL accepted: {url}")
    try:
        prepare_application("https://jobs.lever.co/example/role-1", Path("../outside.pdf"), root=root)
    except ValueError as error:
        assert "inside output" in str(error)
    else:
        raise AssertionError("PDF outside output/ was accepted")

help_result = subprocess.run([sys.executable, "-m", "career_ops", "apply", "prefill", "--help"],
                             cwd=ROOT, text=True, capture_output=True)
assert help_result.returncode == 0 and "--url" in help_result.stdout

print("workflow application prefill: three ATS baselines and rejection paths passed")
