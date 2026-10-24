# Backing up your career-ops data

Your CV, tracker, reports, generated PDFs and `portals.yml` live only on the machine
you run career-ops on. They are git-ignored on purpose, so pushing the project does not
save them, and `node update-system.mjs` does not either. If the laptop dies, or a
[web session's VM expires](SETUP.md#browser-only--claude-code-on-the-web), they are gone.

There is no single right backup tool, so this page covers three patterns. All three
start from the same step: put your data in its own folder.

> Never back up personal data to a public place. A GitHub fork of this repository is
> always public, and so is everything you commit and push to it.

---

## Step 0: move your data into its own folder (data root)

By default your files sit inside the checkout, mixed in with code. career-ops can read
and write all of them from a separate folder instead (see
[External Data Directory](../README.md#external-data-directory-optional) and
[`DATA_CONTRACT.md`](../DATA_CONTRACT.md#custom-data-directory)). Code, `modes/` and
`node_modules/` stay in the checkout; everything in the User Layer moves.

Once your data is in one folder, backing it up is one path, and none of the patterns
below have to know which files under the checkout are yours.

Use a folder **outside** the checkout, for example `~/career-data`:

```bash
cd ~/career-ops
mkdir -p ~/career-data

# Move the User Layer files and folders you actually have. Skip any that don't exist.
for p in cv.md article-digest.md voice-dna.md portals.yml \
         data reports output jds interview-prep documents writing-samples; do
  [ -e "$p" ] && mkdir -p ~/career-data/"$(dirname "$p")" && mv "$p" ~/career-data/"$p"
done
mkdir -p ~/career-data/config ~/career-data/modes ~/career-data/batch
for p in config/profile.yml config/cv-facts.json config/benchmarks.yml config/plugins.yml \
         modes/_profile.md modes/_custom.md modes/_brief.md batch/tracker-additions; do
  [ -e "$p" ] && mv "$p" ~/career-data/"$p"
done

# Moving whole folders also took their tracked scaffolds (.gitkeep, README.md).
# Those are system files; put them back in the checkout.
git ls-files --deleted -z | xargs -0 git checkout --

# Point career-ops at it (the marker file is git-ignored).
echo "$HOME/career-data" > .career-ops-data
node doctor.mjs
git status
```

`doctor.mjs` should report nothing missing; if it lists a file, it is still in the
checkout or was never created. `git status` should be clean: your files are no longer
in the checkout, and the scaffolds are back where they were.

You can use `export CAREER_OPS_ROOT=~/career-data` instead of the marker file. The marker
works without editing your shell profile, and every script and agent mode picks it up.

---

## Pattern 1: a private Git repository (recommended)

Versioned history, works across machines, and you already have Git.

```bash
cd ~/career-data
git init -b main
git add -A
git commit -m "career-ops data"
gh repo create career-data --private --source . --push
gh repo view career-data --json visibility -q .visibility   # must print PRIVATE
```

The data folder is its own repository, so career-ops's `.gitignore` does not apply to it
and `git add -A` picks up everything. That is the reason for Step 0: if you instead make a
second repository over the checkout, the project's `.gitignore` silently skips `cv.md`,
`data/` and `reports/`, and the backup looks fine but holds none of your data.

To back up later:

```bash
cd ~/career-data && git add -A && git commit -m "backup $(date +%F)" && git push
```

To schedule that, use the same tools as [scheduled scans](AUTOMATION.md) (cron, launchd,
Task Scheduler) with the command above.

**On a new machine** (or at the start of a cloud session):

```bash
git clone https://github.com/career-ops-hq/career-ops.git ~/career-ops
gh repo clone career-data ~/career-data
cd ~/career-ops && npm install && npx playwright install chromium
echo "$HOME/career-data" > .career-ops-data
node doctor.mjs
```

The code is a fresh clone, so `node update-system.mjs` keeps working normally. Your data
never passes through it.

In a [web session](SETUP.md#browser-only--claude-code-on-the-web), the VM starts fresh
every time, so clone the data repository at the start and push before you finish. The
session's GitHub access must include the data repository.

Keep secrets out of it: API keys belong in `.env` / `.career-ops.env` in the checkout,
not in the data folder. Before the first push, a cheap check is
`git grep -nE 'sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|PRIVATE KEY-----'`.

---

## Pattern 2: sync to a cloud drive with rclone

For Google Drive, Dropbox, OneDrive, S3 and many others, without Git.
[rclone](https://rclone.org) copies a folder to any of them, and its `crypt` remote
encrypts file names and contents before they leave your machine.

```bash
rclone config                         # create a remote, e.g. "gdrive"; optionally a crypt remote on top
rclone sync ~/career-data gdrive:career-data --progress
```

`rclone sync` makes the destination match the source, deletions included. Run it in the
same direction every time, and use `rclone copy` if you would rather never delete on the
remote. To restore, swap the arguments: `rclone copy gdrive:career-data ~/career-data`.

There is no history: a file you damage today is synced over tomorrow's copy. Turn on your
provider's version history, or combine this with Pattern 3.

---

## Pattern 3: encrypted snapshots with restic

For an external drive or any storage you don't fully trust.
[restic](https://restic.net) keeps encrypted, deduplicated snapshots, so you can go back to
any earlier day.

```bash
restic -r /Volumes/Backup/career-data init         # choose a password and store it safely
restic -r /Volumes/Backup/career-data backup ~/career-data
restic -r /Volumes/Backup/career-data snapshots
restic -r /Volumes/Backup/career-data restore latest --target ~/restore
```

`restore` recreates the folder's full original path inside the target directory, so
find `career-data` under `~/restore` and move it into place afterwards.

restic also writes to S3, Backblaze B2, SFTP and rclone remotes. If you lose the password,
the backup cannot be read.

---

## What to check, whichever pattern you use

- **Restore once before you rely on it.** Restore into a scratch folder, point
  `CAREER_OPS_ROOT` at it, and run `node doctor.mjs`.
- **Nothing personal in the checkout.** After Step 0, `git status` in `~/career-ops`
  should show no personal files, and nothing you push from the checkout contains them.
- **Updates are unaffected.** `node update-system.mjs` only touches the System Layer in the
  checkout. Your data root is outside it.
