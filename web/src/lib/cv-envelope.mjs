// cv-envelope.mjs — the pdf agent's file-write contract (#2185).
//
// The web's "pdf" agent tailors content and nothing else: it must never hold
// Write/Edit, because a prompt injection in a posting or report (both enter
// that agent's context) could otherwise redirect it at cv.md. File bytes go
// through Bash (heredoc → /tmp payload, then generate-pdf.mjs). The
// <<cv-html>> envelope is the machine-readable marker the stream / backend
// watches for when present — run-prompts pulls this string into the pdf
// prompt so the instruction lives in one place.

export const CV_ENVELOPE_INSTRUCTION = `Write-scope contract (#2185): you have NO Write, Edit, MultiEdit, or NotebookEdit tools. Never try to open cv.md or any repo file for writing. Produce files ONLY via Bash:
  1. Write the JSON payload with a heredoc, e.g. cat > /tmp/cv-{candidate}-{company}.json << 'EOF' … EOF
  2. Render with node generate-pdf.mjs /tmp/cv-{candidate}-{company}.json output/….pdf --format=… --report=…
If you emit a final CV HTML/JSON blob for the backend, wrap it EXACTLY once as:
<<cv-html>>
{payload}
<</cv-html>>
Do not submit anything anywhere.`;
