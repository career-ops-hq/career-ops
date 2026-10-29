# LinkedIn job alerts

LinkedIn sends job alerts to your inbox. CareerOps can add those jobs to `data/pipeline.md` on the schedule you already use for scans. You save the email as a file. CareerOps does not open LinkedIn.

Each job is stored as `https://www.linkedin.com/jobs/view/{id}`. A job already in the pipeline or the tracker is skipped.

## Save the email in a folder

This path has no password and no API key.

1. Create `data/linkedin-alerts` in your CareerOps data root.
2. In your mail app, add a rule that saves messages from LinkedIn job alerts into that folder as `.eml` files. A `.txt` or `.mbox` export works too.
3. Run `node linkedin-watch.mjs` once to confirm a job lands in the pipeline.
4. Install the 15-minute worker if you have not already (`sh web/scripts/install-scan-schedule.sh` on macOS or Linux). Each check reads the folder.

`node linkedin-watch.mjs --dry-run` prints the count and writes nothing.

## What this does not do

CareerOps does not log into LinkedIn, does not open LinkedIn search, and does not send messages.
