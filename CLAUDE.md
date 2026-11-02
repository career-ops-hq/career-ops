# This checkout is a simplified fork of career-ops

Three commands cover the whole flow; offer them first, before the full career-ops menu:

| Command | Skill | What it does |
|---------|-------|--------------|
| `/cv` | `.claude/skills/cv/` | Builds `cv.md` + `config/profile.yml` from the user's CV/LinkedIn/answers, renders `output/General/CV.pdf` |
| `/fill-profile <site>` | `.claude/skills/fill-profile/` | Fills LinkedIn / Djinni / Work.ua / Robota.ua / DOU / Upwork profiles in the user's Chrome, every save confirmed |
| `/scan-all` | `.claude/skills/scan-all/` | Searches every enabled site through Claude in Chrome, evaluates, updates the tracker, opens `output/dashboard.html` |

- **First-run setup is yours, not the user's.** Before any of the three commands, if `node_modules/` is missing run `npm install`, then `npx playwright install chromium` (needed for PDFs). If `node` itself is missing, tell the user to install the LTS from https://nodejs.org and restart Claude Code. Say in one line what you're installing; don't ask them to run commands.
- New user (no `cv.md`) → start with `/cv`, whatever they asked.
- Dashboard: `node dashboard-html.mjs --open` (also `npm run dashboard`).
- **Personal files live in the data root, not in this repo.** When `.career-ops-data` (or `CAREER_OPS_ROOT`) is set, every user-layer path the skills name (`cv.md`, `config/profile.yml`, `config/scan-all.yml`, `modes/_profile.md`, `modes/_custom.md`, `portals.yml`, `data/`, `jds/`, `reports/`, `output/`, `batch/tracker-additions/`) is read and written there (AGENTS.md → Path Resolution). Never commit those files to this public fork.
- **Updates:** this fork changes system-layer files (`CLAUDE.md`, `.claude/skills/`, `templates/`), which `update-system.mjs` would overwrite with upstream copies. So in this fork, skip AGENTS.md → "Update Check" at session start and never run `update-system.mjs apply`. Updates come by merging a career-ops release from `upstream` into this fork with git.
- Reply in the user's language (Ukrainian when they write Ukrainian).

@AGENTS.md
