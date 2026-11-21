# career-ops (Gemini CLI extension)

career-ops is an open-source AI job search agent that runs in your AI coding CLI: it scans job portals, evaluates listings into a structured A-H report with a 1-5 score, tailors your CV and tracks applications. You review everything and send each application yourself.

Use this only when the user asks about their job search or about career-ops. Otherwise ignore it.

## career-ops runs from its own folder

This extension is a copy that Gemini CLI replaces on every update. Never write the user's files here (CV, profile, `data/`, `reports/`, `output/`): they live in the user's career-ops folder.

1. Look for an existing install: the directory in `CAREER_OPS_ROOT` if it is set, then the current directory, then `./career-ops`, then `~/career-ops`. The first one that contains both `AGENTS.md` and `modes/` is the project root. Tell the user which one you are using.
2. If there is none, tell the user in a few lines that career-ops runs from its own folder, and offer to set it up with `npx @santifer/career-ops@1.41.0 init`. It needs Node.js, downloads the latest release from https://github.com/career-ops-hq/career-ops into `./career-ops` and installs its dependencies. Ask before running it: it downloads and installs software. <!-- x-release-please-version -->
3. Gemini CLI only reads files inside its workspace. If the project root is outside it (for example `~/career-ops` while Gemini runs elsewhere), do not try to read it: ask the user to add it with `/directory add <path>` or to restart Gemini inside that folder, then continue.
4. In the project root, read `AGENTS.md` in full before anything else. It holds the data contract, the ethical-use rules and the routing to `modes/`, and it wins over this file. Run every script from the project root.
5. If the user's CV and profile are not there yet, the first-run setup in `AGENTS.md` comes first: it walks them through it by chatting.

Next time, the simplest path is to open the AI CLI inside that folder: `cd career-ops`, then start it there.

Docs: https://career-ops.org
