"""Serve the dashboard page and its JSON API on a local address."""

from __future__ import annotations

from contextlib import closing
import errno
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import re
import sys
from urllib.parse import parse_qs, urlparse

from career_ops.dashboard.data import connect, job_detail, list_jobs, material_files


PAGE = Path(__file__).with_name("index.html")
DETAIL = re.compile(r"^/api/jobs/(\d+)$")
FILE = re.compile(r"^/api/jobs/(\d+)/file$")


def handler_for(database: Path) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args) -> None:
            sys.stderr.write("dashboard: " + format % args + "\n")

        def send_body(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def send_json(self, payload, status: int = HTTPStatus.OK) -> None:
            self.send_body(status, json.dumps(payload, ensure_ascii=False).encode(), "application/json; charset=utf-8")

        def do_GET(self) -> None:
            url = urlparse(self.path)
            try:
                if url.path in {"/", "/index.html"}:
                    self.send_body(HTTPStatus.OK, PAGE.read_bytes(), "text/html; charset=utf-8")
                elif url.path == "/api/jobs":
                    with closing(connect(database)) as db:
                        self.send_json(list_jobs(db))
                elif match := DETAIL.match(url.path):
                    with closing(connect(database)) as db:
                        detail = job_detail(db, int(match[1]))
                    self.send_json(detail) if detail else self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
                elif match := FILE.match(url.path):
                    self.send_file(match[1], parse_qs(url.query).get("id", [""])[0])
                else:
                    self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
            except Exception as error:  # surface store errors to the page instead of dropping the connection
                self.log_message("error on %s: %r", url.path, error)
                self.send_json({"error": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)

        def send_file(self, opportunity_id: str, file_id: str) -> None:
            """Only files referenced by this opportunity's stored rows are readable."""
            with closing(connect(database)) as db:
                item = next((entry for entry in material_files(db, opportunity_id) if entry["id"] == file_id), None)
            path = Path(item["path"]) if item else None
            if path is None or not path.is_file():
                self.send_json({"error": "file not found"}, HTTPStatus.NOT_FOUND)
                return
            content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            if content_type.startswith("text/") or content_type == "application/json":
                content_type += "; charset=utf-8"
            self.send_body(HTTPStatus.OK, path.read_bytes(), content_type)

    return Handler


def serve(directory: Path, host: str, port: int) -> None:
    database = directory / "opportunities.db"
    if not database.is_file():
        raise FileNotFoundError(f"Business store not found: {database}")
    try:
        server = ThreadingHTTPServer((host, port), handler_for(database))
    except OSError as error:
        if error.errno == errno.EADDRINUSE:
            raise SystemExit(f"Port {port} is already in use; stop the other dashboard or pass --port.") from None
        raise
    print(json.dumps({"status": "serving", "url": f"http://{host}:{server.server_port}/"}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
