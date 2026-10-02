"""Run the retained offline Python business and Node adapter contracts."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
patterns = sys.argv[1:] or ['tests/*-test.py', 'tests/**/*.test.mjs', 'tests/*.test.mjs']
files = sorted({path for pattern in patterns for path in ROOT.glob(pattern) if path.is_file()})
if not files:
    raise SystemExit('No checks matched')
failed = []
for path in files:
    command = [sys.executable, '-B'] if path.suffix == '.py' else ['node']
    result = subprocess.run([*command, str(path)], cwd=ROOT, text=True, capture_output=True)
    print(f'{"PASS" if result.returncode == 0 else "FAIL"} {path.relative_to(ROOT)}', flush=True)
    if result.returncode:
        failed.append(path)
        print(result.stdout + result.stderr, flush=True)
raise SystemExit(bool(failed))
