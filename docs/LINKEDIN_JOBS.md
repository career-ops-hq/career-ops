# Add LinkedIn jobs

Paste a LinkedIn job alert into CareerOps. The jobs land in your pipeline. You do not create a Google Cloud project, and you do not connect Gmail.

## Paste on the dashboard

1. Open CareerOps in the browser.
2. Open a LinkedIn job alert email.
3. Select all, then copy.
4. On the home page or the pipeline, paste into **LinkedIn job alerts**.
5. Click **Add these jobs**.

You should see a line such as `12 LinkedIn jobs added. Open Pipeline to review them.` Each row uses the job title from the line above the link. When the paste has no title, the row uses the words in the job link. Open Pipeline to read the posting.

A job that is already in the pipeline or the tracker is not added again.

To use a saved email instead of a paste, choose the file next to the paste box. `.eml` and `.txt` both work.

## Paste from the terminal

Save the alert as a file, then run:

```bash
node linkedin-import.mjs --file alert.eml
```

Or pipe it:

```bash
node linkedin-import.mjs < alert.eml
```

`--dry-run` prints the count and writes nothing. `--json` prints one object with `added`, `already`, `found`, and `message`.

With no file and no pipe, the command prints this help and waits for nothing.

## What gets saved

Each job is saved as `https://www.linkedin.com/jobs/view/{id}`. A tracking link from the email, including `/comm/jobs/view/`, becomes that address.

CareerOps does not log in to LinkedIn, does not search LinkedIn, and does not message anyone.

The Gmail plugin remains available when you already have OAuth keys. You do not need it for LinkedIn alerts. See [Plugins](PLUGINS.md).
