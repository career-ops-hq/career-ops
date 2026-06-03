# Career Command Center Dashboard Implementation Plan

> **For Hermes:** Use direct TDD in the Go dashboard. Keep user data out of committed files.

**Goal:** Turn the existing terminal dashboard from a tracker viewer into a full job-search command center for students, undergrads, and active job seekers.

**Architecture:** Add a default Command Center screen in the existing Bubble Tea app, backed by small data-model helpers that inspect setup readiness, application metrics, pending URL backlog, reports, and interview-prep artifacts. Keep the existing Pipeline, Report Viewer, and Progress screens intact, then make navigation explicit: Home, Pipeline, Progress.

**Tech Stack:** Go 1.24, Bubble Tea, Lipgloss, markdown/yaml/text files already used by career-ops.

```
Career Command Center
        |
        +-- Readiness checklist: CV, profile, portals, tracker, proof points
        +-- Journey rails: setup -> discover -> evaluate -> apply -> interview
        +-- Next best action: concrete command or file to fix
        +-- Momentum cockpit: active apps, top fits, pending URLs, reports, response rates
        +-- Existing screens: pipeline table, progress analytics, report viewer
```

---

## Acceptance Criteria

1. `go test ./...` passes from `dashboard/`.
2. Dashboard starts even when `data/applications.md` is missing; it should show onboarding/readiness instead of exiting.
3. The default screen is the Command Center, not the raw pipeline table.
4. Command Center shows setup readiness with missing/ready states for `cv.md`, `config/profile.yml`, `modes/_profile.md`, `portals.yml`, `data/applications.md`, plus optional proof-point/interview-prep artifacts.
5. Command Center shows student/job-seeker journey guidance: setup, discovery, shortlist, apply, interview, follow-up.
6. Command Center computes a next best action from real repo state, not fake numbers.
7. Navigation is visible and works: `p` pipeline, `a` analytics/progress, `h`/`esc` home, `q` quit.
8. Existing pipeline interactions still work.
9. README dashboard section documents the expanded Command Center.

---

## Task 1: Add data/model contract for dashboard readiness

**Files:**
- Modify: `dashboard/internal/model/career.go`
- Modify: `dashboard/internal/data/career.go`
- Test: `dashboard/internal/data/career_test.go`

**TDD:**
1. Write failing tests for `LoadDashboardContext`/equivalent helper:
   - missing files produce incomplete readiness and a next action to add CV/profile.
   - sample tracker/pipeline/report files produce counted applications, pending URLs, and report count.
2. Run focused data tests and confirm RED.
3. Implement small file-existence/count helpers.
4. Run focused tests and full dashboard tests.

## Task 2: Add Command Center screen

**Files:**
- Create: `dashboard/internal/ui/screens/command.go`
- Create/modify tests: `dashboard/internal/ui/screens/command_test.go`

**TDD:**
1. Write rendering tests that assert readiness, journey rails, next action, and navigation hints appear.
2. Run focused screen tests and confirm RED.
3. Implement `CommandModel` with responsive text panels using existing theme.
4. Run focused tests and full dashboard tests.

## Task 3: Wire app navigation and empty tracker behavior

**Files:**
- Modify: `dashboard/main.go`
- Modify: `dashboard/internal/ui/screens/pipeline.go`
- Test: `dashboard/internal/ui/screens/pipeline_test.go` if needed

**TDD:**
1. Add tests for no-app empty rendering if not already covered.
2. Run tests and confirm RED where applicable.
3. Make dashboard default to command view and let `ParseApplications` returning nil degrade to empty slice.
4. Wire `p`, `a`, `h`, `esc`, and `q` semantics cleanly.
5. Run full Go test suite.

## Task 4: Document and verify

**Files:**
- Modify: `README.md`

**Steps:**
1. Update Dashboard TUI section with command-center features and navigation.
2. Build binary with `go build -o career-dashboard .` from `dashboard/`.
3. Run a smoke check against the current repo path. If interactive TUI cannot be captured cleanly in non-TTY mode, at least verify the binary builds and tests pass.
4. Commit all system-layer changes. Do not commit user-layer files (`cv.md`, `config/profile.yml`, `portals.yml`, `modes/_profile.md`, `data/applications.md`).
