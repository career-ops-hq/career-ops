"""Run CLI recovery fixtures with a controlled capture boundary and crash injection."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from career_ops import tasks
from career_ops.cli import main

tasks.capture_jd = lambda *args, **kwargs: None
if "--crash-at" in sys.argv:
    index = sys.argv.index("--crash-at")
    crash = sys.argv[index + 1]
    del sys.argv[index:index + 2]
    initialize = tasks.Runtime.__init__

    def initialize_with_crash(self, store, directory, crash_at=None):
        initialize(self, store, directory, crash)

    tasks.Runtime.__init__ = initialize_with_crash
main()
