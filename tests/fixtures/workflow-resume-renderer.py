"""Write a readable test PDF for the apply renderer seam without using the service."""

import json
import os
from pathlib import Path
import sys


source = Path(sys.argv[1])
output = Path(sys.argv[2])
failure_marker = os.environ.get("CAREER_OPS_RESUME_FAIL_ONCE")
if failure_marker and not Path(failure_marker).exists():
    Path(failure_marker).write_text("failed before export")
    raise SystemExit(3)
task_id = next(item.split("=", 1)[1] for item in sys.argv[3:] if item.startswith("--task-id="))
metadata = Path(next(item.split("=", 1)[1] for item in sys.argv[3:] if item.startswith("--metadata=")))
version = int(next(item.split("=", 1)[1] for item in sys.argv[3:] if item.startswith("--version=")))
name = json.loads(source.read_text())["candidate"]["name"]
label = name.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
stream = f"BT /F1 18 Tf 72 700 Td ({label}) Tj ET".encode("latin-1")
if os.environ.get("CAREER_OPS_RESUME_STRAY_HYPHEN"):
    stream += b"\nBT /F1 12 Tf 72 675 Td (AI workflow, -) Tj ET"
if os.environ.get("CAREER_OPS_RESUME_SPLIT_HYPHEN"):
    stream += b"\nBT /F1 12 Tf 72 675 Td (Owns the full-) Tj ET"
    stream += b"\nBT /F1 12 Tf 72 650 Td (arc) Tj ET"
objects = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream",
    b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
]
pdf = b"%PDF-1.4\n"
offsets = [0]
for index, body in enumerate(objects, 1):
    offsets.append(len(pdf))
    pdf += f"{index} 0 obj\n".encode() + body + b"\nendobj\n"
startxref = len(pdf)
pdf += f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode()
pdf += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
pdf += f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{startxref}\n%%EOF\n".encode()
output.parent.mkdir(parents=True, exist_ok=True)
output.write_bytes(pdf)
metadata.write_text(json.dumps({
    "resume_id": f"fixture-{task_id}", "slug": "wrong-task" if os.environ.get("CAREER_OPS_RESUME_WRONG_METADATA") else f"career-ops-workflow-{task_id}",
    "last_artifact_version": version,
}))
print(json.dumps({"resumeId": f"fixture-{task_id}", "outputPath": str(output.resolve()),
                  "metadataPath": str(metadata.resolve())}))
