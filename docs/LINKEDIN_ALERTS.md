# LinkedIn job alerts

LinkedIn sends job alerts to your inbox. CareerOps can add those jobs to `data/pipeline.md`. You save the email as a file. CareerOps does not open LinkedIn.

The 15-minute worker from option B in [docs/AUTOMATION.md](AUTOMATION.md) reads the folder. A plain `scan.mjs` schedule does not. Running one saved job by hand does not either.

Each job is stored as `https://www.linkedin.com/jobs/view/{id}`. A job already in the pipeline or the tracker is skipped.

## Save the email in a folder

This path has no password and no API key.

1. Create `data/linkedin-alerts` in your CareerOps data root.
2. In your mail app, write each message to a temporary name in that folder. When the write finishes, rename it to a final `.eml`, `.txt`, or `.mbox` name. The importer reads only those final names.
3. Run `node linkedin-watch.mjs` once to confirm a job lands in the pipeline. `--dir` points at another folder. `--json` prints the result as JSON. `--dry-run` prints the count and writes nothing.
4. Install the 15-minute worker if you have not already. macOS and Linux use `sh web/scripts/install-scan-schedule.sh`. Windows uses `powershell.exe -NoProfile -ExecutionPolicy Bypass -File web/scripts/install-scan-schedule.ps1`. The steps are in [docs/AUTOMATION.md](AUTOMATION.md).

An imported file moves to `data/linkedin-alerts/imported/`. A file over 2,000,000 characters stays where it is, and so does a file that cannot be read. The command names that file.

## What this does not do

CareerOps does not log into LinkedIn, does not open LinkedIn search, and does not send messages.
