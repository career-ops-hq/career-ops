"""Check canonical URL selection and the API-first liveness path."""

import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow.liveness_check import current_urls, check


with TemporaryDirectory() as directory:
    data = Path(directory)
    database = data / "opportunities.db"
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE opportunities (id INTEGER PRIMARY KEY, url TEXT, "
                           "state TEXT, application_state TEXT)")
        connection.executemany("INSERT INTO opportunities VALUES (?,?,?,?)", [
            (1, "https://boards.greenhouse.io/acme/jobs/1", "discovered", "none"),
            (2, "https://boards.greenhouse.io/acme/jobs/2", "evaluated", "none"),
            (3, "https://example.com/closed", "rejected", "none"),
            (4, "https://example.com/applied", "evaluated", "applied"),
            (5, "https://boards.greenhouse.io/acme/jobs/1", "discovered", "none"),
            (6, "https://boards.greenhouse.io/acme/jobs/2", "evaluated", "preparing"),
        ])
    selected = current_urls(database)
    assert selected == ["https://boards.greenhouse.io/acme/jobs/1",
                        "https://boards.greenhouse.io/acme/jobs/2"]
    observed = []

    def reader(urls):
        observed.extend(urls)
        return [{"url": url, "result": result, "via_api": True}
                for url, result in zip(urls, ("active", "expired"))]

    state = check(select_urls=lambda: selected, reader=reader)
    assert observed == selected
    assert state["summary"] == {"active": 1, "expired": 1, "uncertain": 0, "via_api": 2}

    mock = data / "fetch.mjs"
    mock.write_text("""globalThis.fetch = async url => {
  if (!['1', '2'].some(id => url === 'https://boards-api.greenhouse.io/v1/boards/acme/jobs/' + id))
    throw new Error('Unexpected request: ' + url);
  return new Response('', { status: url.endsWith('/2') ? 404 : 200 });
};
""")
    env = {**os.environ, "NODE_OPTIONS": f"--import={mock}"}
    command = [sys.executable, "-B", "-m", "workflow.liveness_check"]
    run = subprocess.run([*command, "--directory", str(data)], cwd=ROOT, env=env,
                         capture_output=True, text=True, timeout=20)
    assert run.returncode == 1, run.stderr
    assert "Checking 2 URL(s)" in run.stdout
    assert "1 active  1 expired  0 uncertain  (2 via API" in run.stdout

    listing = data / "urls.txt"
    listing.write_text("# comment\nhttps://boards.greenhouse.io/acme/jobs/1\n")
    for args in (["--file", str(listing)], ["https://boards.greenhouse.io/acme/jobs/1"],
                 ["--throttle", "https://boards.greenhouse.io/acme/jobs/1"]):
        run = subprocess.run([*command, *args], cwd=ROOT, env=env,
                             capture_output=True, text=True, timeout=20)
        assert run.returncode == 0 and "1 active  0 expired" in run.stdout, (args, run.stderr)


print("workflow liveness: canonical selection, graph, and API-first CLI passed")
