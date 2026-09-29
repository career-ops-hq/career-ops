"""Check that the PDF adapter accepts a readable candidate PDF and rejects misbinding."""

import json
import os
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow.resume_renderer import render_resume


with tempfile.TemporaryDirectory(prefix="career-ops-resume-renderer-") as temporary:
    root = Path(temporary)
    (root / "config").mkdir()
    (root / "cv.md").write_text("Managed 20 staff")
    source = root / "resume.json"
    source.write_text(json.dumps({"candidate": {"name": "Jiaming Zhang"}, "summary": "Owns the full arc"}))
    pdf = root / "resume.pdf"
    fake = f"{ROOT / 'workflow' / '.venv' / 'bin' / 'python'} {ROOT / 'tests' / 'fixtures' / 'workflow-resume-renderer.py'}"
    with patch.dict(os.environ, {"CAREER_OPS_RESUME_RENDERER": fake}):
        receipt = render_resume("123e4567-e89b-12d3-a456-426614174000", 1, root, source, pdf,
                                root / "config" / "profile.yml", "Jiaming Zhang", "Example", "Engineer")
        assert receipt["pages"] == 1 and receipt["text_sha256"]
        try:
            render_resume("123e4567-e89b-12d3-a456-426614174000", 1, root, source, pdf,
                          root / "config" / "profile.yml", "Wrong Candidate", "Example", "Engineer")
        except ValueError as error:
            assert "candidate identity" in str(error)
        else:
            raise AssertionError("PDF with the wrong candidate identity was accepted")
    with patch.dict(os.environ, {"CAREER_OPS_RESUME_RENDERER": fake, "CAREER_OPS_RESUME_WRONG_METADATA": "1"}):
        try:
            render_resume("123e4567-e89b-12d3-a456-426614174000", 1, root, source, pdf,
                          root / "config" / "profile.yml", "Jiaming Zhang", "Example", "Engineer")
        except ValueError as error:
            assert "not bound" in str(error)
        else:
            raise AssertionError("Metadata for another task was accepted")
    with patch.dict(os.environ, {"CAREER_OPS_RESUME_RENDERER": fake, "CAREER_OPS_RESUME_STRAY_HYPHEN": "1"}):
        try:
            render_resume("123e4567-e89b-12d3-a456-426614174000", 1, root, source, pdf,
                          root / "config" / "profile.yml", "Jiaming Zhang", "Example", "Engineer")
        except ValueError as error:
            assert "line-end hyphens" in str(error)
        else:
            raise AssertionError("PDF with renderer-inserted hyphens was accepted")
    with patch.dict(os.environ, {"CAREER_OPS_RESUME_RENDERER": fake, "CAREER_OPS_RESUME_SPLIT_HYPHEN": "1"}):
        try:
            render_resume("123e4567-e89b-12d3-a456-426614174000", 1, root, source, pdf,
                          root / "config" / "profile.yml", "Jiaming Zhang", "Example", "Engineer")
        except ValueError as error:
            assert "line-end hyphens" in str(error)
        else:
            raise AssertionError("PDF with a fabricated split-word hyphen was accepted")
        source.write_text(json.dumps({"candidate": {"name": "Jiaming Zhang"}, "summary": "Owns the full-arc"}))
        assert render_resume("123e4567-e89b-12d3-a456-426614174000", 1, root, source, pdf,
                             root / "config" / "profile.yml", "Jiaming Zhang", "Example", "Engineer")["pages"] == 1

    with patch.dict(os.environ, {"CAREER_OPS_RESUME_RENDERER": fake, "CAREER_OPS_RESUME_UNSUPPORTED_METRIC": "1"}):
        try:
            render_resume("123e4567-e89b-12d3-a456-426614174000", 1, root, source, pdf,
                          root / "config" / "profile.yml", "Jiaming Zhang", "Example", "Engineer")
        except ValueError as error:
            assert "CV fact gate" in str(error)
        else:
            raise AssertionError("PDF with unsupported staffing claim was accepted")

print("workflow resume renderer: PDF identity, readability and artifact rejection passed")
