# Running career-ops on Windows

career-ops runs on Windows without a VM or WSL. Most of it is plain Node and never notices the platform. The sharp edges are all in the same place: the parts that shell out to `bash` — `batch/batch-runner.sh` and the test-suite fixtures that drive it.

If something is failing and the error mentions `node: command not found`, an empty argument list, or `syntax error near unexpected token`, one of the first three sections below is why.

## Checklist

- [ ] Node.js LTS installed and on `PATH`
- [ ] Git for Windows installed (it provides Git Bash, which `batch/` needs)
- [ ] Cloned on v1.26.0 or later, or renormalized once (see §3)
- [ ] `npx playwright install chromium` if you want PDF generation
- [ ] `node doctor.mjs --json` reports `"onboardingNeeded": false`

## 1. `bash` on your PATH is probably not Git Bash

This is the single most expensive Windows gotcha, because it fails in a way that looks like a bug in career-ops.

On a default Windows install, `bash` on `PATH` resolves to `C:\WINDOWS\System32\bash.exe` — that is the **WSL launcher**, not Git Bash. It exists even if you have never knowingly used WSL.

Check which one you have:

```powershell
Get-Command bash | Format-List Source
```

If that prints `C:\WINDOWS\System32\bash.exe`, anything that shells out through bare `bash` runs inside a Linux distribution instead of Windows. WSL has its own `PATH`, so the Windows `node` is invisible there. `batch/batch-runner.sh` then dies partway through with:

```
node: command not found
```

and exit code `127`. Because the runner's output is captured, that can surface as an empty result rather than an error — a batch that "ran" and produced nothing, or a test asserting on an empty string.

**Fix:** install Git for Windows and make sure the tooling finds *its* bash. The test suite does this for you (see §2); if you are driving `batch/batch-runner.sh` yourself, invoke Git Bash by its full path rather than relying on `bash` resolving correctly.

You do not need to uninstall or disable WSL. You only need the shell career-ops uses to be Git Bash.

## 2. Where Git Bash lives depends on how you installed Git

Two common layouts:

| Install method | Git Bash path |
|---|---|
| Git for Windows installer | `C:\Program Files\Git\bin\bash.exe` |
| Scoop | `%USERPROFILE%\scoop\apps\git\current\bin\bash.exe` |

The test suite searches both — `tests/helpers.mjs` checks the Program Files layout and the Scoop layout under `%SCOOP%` and `%USERPROFILE%\scoop`, and names the shell it fell back to when a shell command fails, so a failure tells you which bash actually ran.

The same split applies to `cygpath.exe` (`...\Git\usr\bin\cygpath.exe`), which converts Windows paths to the `/c/...` form Git Bash expects.

Two things worth knowing if you are writing your own tooling around the repo:

- **`cygpath` and `bash` must come from the same install.** Git Bash mounts drives at `/c/...`; WSL mounts them at `/mnt/c/...`. Mixing a `cygpath` from one with a `bash` from the other produces a path the receiving shell cannot resolve, silently.
- **Scoop does not put `cygpath` on `PATH`.** Checking `C:\Program Files\...` is not a reliable way to decide whether Git is installed — on a Scoop machine that check fails while Git Bash is present the whole time.

## 3. Shell scripts must keep LF line endings

Since **v1.26.0** the repository ships a `.gitattributes` that forces LF in the working tree on every platform, so a fresh clone gets this right regardless of your `core.autocrlf`.

If you cloned **before v1.26.0**, your working tree can still hold the CRLF versions. Git Bash cannot parse those:

```
batch/batch-runner.sh: line 2: syntax error near unexpected token `$'{\r''
```

Renormalize once:

```powershell
git rm --cached -r .
git reset --hard
```

To confirm afterwards, ask Git what it thinks the file is:

```powershell
git ls-files --eol batch/batch-runner.sh
```

`w/lf` in the output is what you want. `w/crlf` means the renormalization did not take — check that `.gitattributes` is actually present at the repo root.

## 4. Running the tests

```powershell
node test-all.mjs
```

To run one suite on its own — useful when you are adding tests, and the fastest way to see a specific failure:

```powershell
node --test tests/cli-flags.test.mjs
```

Windows-specific failures in the suite are almost always one of the three problems above rather than a logic bug. If a group of tests fails while their own captured output shows the correct behaviour, suspect the shell before the code.

## 5. PDF generation needs a browser

`generate-pdf.mjs` drives Playwright. Install the browser once:

```powershell
npx playwright install chromium
```

Without it, PDF generation fails while every other part of the pipeline works — so a report can be produced with no PDF beside it. Assert the file exists rather than trusting the log line.

## 6. Skill entrypoints appear as plain text files

Windows does not create symlinks by default, so the CLI skill entrypoints (`.claude/skills/`, `.opencode/skills/`, ...) check out as pointer files. This is handled automatically by the installer and updater — see [FAQ #1](FAQ.md). No `mklink` and no Developer Mode needed.

## 7. Scheduling on Windows

[AUTOMATION.md](AUTOMATION.md) covers Task Scheduler setup. Three things that are easy to get wrong and hard to diagnose afterwards:

- **Task Scheduler has no console, so stdout and stderr are discarded.** A scheduled run that fails leaves no trace of *why* unless the command redirects to a file or the script logs its own errors. A run that failed and a run that hung look identical on disk.
- **Use `-NonInteractive`** in the PowerShell action. Anything that prompts will hang the task until its execution time limit.
- **A task registered with "Run with highest privileges" can only be edited from an elevated shell.** `Set-ScheduledTask` returns `Access is denied` otherwise, including from an agent CLI.

## 8. Path conventions

Node scripts take Windows absolute paths (`D:\jobs\posting.md`) and forward-slash paths (`D:/jobs/posting.md`) interchangeably. `/tmp/...` and `/d/...` are not Windows paths — the first is a Unix location that does not exist, the second is a Git Bash mount form that only resolves inside that shell.

---

Something wrong or missing here? Open an issue — Windows setups vary more than the other platforms, and this page is built from real failures rather than a clean-room test matrix.
