# documents/ — profile intake sources

Drop the documents you already have here, then ask your agent to run the
`intake` mode (see `modes/intake.md`). It extracts text locally, proposes
source-annotated additions to `config/profile.yml` / `cv.md` /
`modes/_profile.md`, and writes nothing without your explicit confirmation.

| Folder | What goes here |
|---|---|
| `cv/` | Master CV (PDF, `.md`, `.tex`, or `.txt`) |
| `linkedin/` | LinkedIn "Save to PDF" export |
| `diplomas/` | Transcripts, degree certificates |
| `references/` | Reference letters |

Everything in this folder is **user layer**: gitignored (except this README
and `.gitkeep`), never touched by the updater, never leaves your machine.
Extraction is fully local — `.md`/`.txt`/`.tex` are read directly; PDFs with
a text layer use `pdftotext` if installed (`brew install poppler` /
`apt install poppler-utils`). Scanned/image-only PDFs, images, and `.docx`
are out of scope — convert them first.

Re-runs are idempotent: already-merged sources are fingerprinted in
`data/intake-state.json` and only genuinely new material is proposed again.
