# Repository Guidelines

## Project Structure & Module Organization

Core automation lives in root-level `.mjs` files; shared helpers belong in `lib/` or `utils/`. Job-board adapters live in `providers/`, reusable prompts in `modes/`, and document layouts in `templates/`. The Go terminal dashboard is isolated in `dashboard/`; the experimental Next.js UI is in `web/`. Node tests are split between `test/` and `tests/`, with provider coverage under `tests/providers/`.

Respect the data contract in `DATA_CONTRACT.md`. Personal content belongs in user-layer paths such as `config/profile.yml`, `modes/_profile.md`, `data/`, `reports/`, and `output/`. Do not place user facts in system-layer scripts, shared modes, or templates.

## Build, Test, and Development Commands

- `npm install --ignore-scripts` installs root dependencies without downloading Playwright browsers.
- `node test-all.mjs --quick` runs the core Node test suite used by CI.
- `npm run doctor` checks required local profile and configuration files.
- `npm run verify` validates the pipeline; `npm run validate:portals` checks portal configuration.
- `cd dashboard && go test ./...` runs Go dashboard tests; `go run . --path ..` starts it locally.
- `cd web && npm ci && npm test && npm run typecheck && npm run build` validates the web UI. Use `npm run dev` for local development.

## Coding Style & Naming Conventions

Follow `.editorconfig`: UTF-8, LF endings, final newline, trimmed trailing whitespace, and two-space indentation; Go uses tabs and `gofmt`. Use kebab-case script names (`check-liveness.mjs`), descriptive camelCase identifiers, and `.test.mjs` for Node tests. Keep CLI output stable, structured JSON machine-readable, and platform behavior compatible with macOS, Linux, and Windows.

## Testing Guidelines

Use Node's built-in `node:test` framework and Go's standard testing package. Add the smallest regression test near the affected module. Provider changes require a focused test in `tests/providers/`; dashboard changes require `*_test.go`. No numeric coverage threshold is enforced, but changed behavior must have direct assertions. Run focused tests first, then the quick suite.

## Commit & Pull Request Guidelines

History follows Conventional Commits: `feat(scan): ...`, `fix(pdf): ...`, `docs: ...`, and `chore: ...`. Keep commits scoped and imperative. Pull requests should explain behavior and motivation, link related issues, list validation performed, and include screenshots for dashboard or web UI changes. Never commit secrets, generated reports, personal application data, or local temporary output.
