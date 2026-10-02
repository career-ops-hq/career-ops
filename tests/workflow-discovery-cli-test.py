"""Keep migrated discovery CLI defaults aligned with the Node scanner."""

import contextlib
import io
import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from career_ops.cli import main


def invoke(*args: str):
    with patch.object(sys, "argv", ["career_ops", *args]), contextlib.redirect_stdout(io.StringIO()), \
            contextlib.redirect_stderr(io.StringIO()):
        main()


with patch("career_ops.cli.discover") as discover:
    try:
        invoke("discover", "--company=")
    except SystemExit as error:
        assert error.code == 1
    else:
        raise AssertionError("An empty company filter must not start a full scan")
    discover.assert_not_called()

with patch("career_ops.cli.discover", return_value={"status": "completed"}) as discover:
    invoke("discover", "--company", "AIA", "--verify", "--headed-fallback", "--throttle=8000",
           "--rediscover-404", "--posted-after=2026-01-01", "--posted-before=2026-09-01",
           "--since=7", "--include-blacklisted", "--dry-run")
    options = discover.call_args.kwargs
    assert options["company_filter"] == "AIA"
    assert (options["verify"], options["headed_fallback"], options["rediscover_404"]) == (True, True, True)
    assert options["throttle_ms"] == 8000
    assert (options["posted_after"], options["posted_before"], options["since_days"]) == (
        "2026-01-01", "2026-09-01", 7)
    assert (options["include_blacklisted"], options["dry_run"], options["resume"]) == (True, True, False)
    invoke("discover", "--resume")
    assert discover.call_args.kwargs["resume"] is True

with patch("career_ops.cli.discover_global", return_value={"status": "completed"}) as global_run:
    invoke("global", "--ats=", "--md-out=")
    assert global_run.call_args.kwargs["ats"] is None
    assert global_run.call_args.kwargs["md_out"] is None
    invoke("global", "--seeds=yc", "--ats=", "--md-out", ".")
    assert global_run.call_args.kwargs["ats"] is None
    assert global_run.call_args.kwargs["seeds"] == ["yc"]
    assert global_run.call_args.kwargs["md_out"] == Path(".")
    invoke("global", "--limit=0")
    assert global_run.call_args.kwargs["limit"] is None
