# Career Ops macOS app implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install a local `Career Ops.app` that starts the existing production web build, displays it in a native window and stops only its own server process.

**Architecture:** A small AppKit and WebKit executable launches `web/server.mjs start -p 0` through an explicit Node path. Pure Swift helpers validate configuration and parse the Next startup URL; the existing Node launcher forwards termination to its child so quitting the app cannot orphan Next.

**Tech Stack:** Swift 6, AppKit, WebKit, Foundation, Node.js, Next.js, shell build script, `node:test` and assertion-based Swift tests.

**Spec:** `docs/superpowers/specs/2026-10-06-career-ops-desktop-markets-design.md`

## Global constraints

- Use only macOS frameworks and tools already installed; do not add Electron, Tauri, Xcode project generators or package dependencies.
- Bind the service to `127.0.0.1` and use a system-selected port.
- Launch processes without a shell and preserve paths containing spaces.
- Store checkout, Node and data paths in local preferences under `CareerOpsCheckoutPath`, `CareerOpsNodePath` and `CareerOpsDataRootPath`; never store credentials.
- Terminate only the child process started by this app.
- Keep the app outside App Sandbox because it must launch Node and read the chosen local directories.
- Install locally in `~/Applications`; signing is ad hoc and notarization is out of scope.
- User-facing copy is Portuguese from Portugal.
- The existing server at port 3427 remains running during development and is not adopted or terminated by the app.

## Review focus

- Quitting the wrapper while Next is running must not leave an orphan; Task 1 tests signal forwarding.
- Finder does not inherit the terminal PATH; Task 2 validates and persists an explicit Node executable.
- Startup output may contain ANSI colour and arrive in chunks; Task 2 tests incremental URL parsing.
- External destinations must leave the WebView while only the server's exact origin stays inside; Task 2 tests the decision helper and `target=_blank` handling.
- A moved checkout, missing build or invalid data path must show a recoverable error instead of an empty window; Task 2 tests validation and the manual flow.
- Finder does not provide a controlled environment: Task 2 removes inherited Career Ops root and network variables, then sets the canonical root values explicitly.

---

### Task 1: Owned server lifecycle

**Files:**
- Modify: `web/server.mjs`
- Modify: `web/tests/lib/server-launcher.test.mjs`

**Interfaces:**
- Produces: asynchronous child lifecycle in `server.mjs`, preserving existing argv, bind warnings and exit status.
- Produces: SIGINT and SIGTERM forwarding from the wrapper to the exact Next child, followed by a bounded SIGKILL escalation when that child ignores graceful termination.

- [ ] **Step 1: Write a failing lifecycle test**

Run stub Next processes that record SIGTERM in a temporary file. Start `server.mjs` asynchronously, terminate the wrapper and assert the child records the signal and exits. Add a second stub that ignores SIGTERM and prove the wrapper escalates only its child after the bounded timeout. Keep the existing bind and exit-code tests unchanged.

- [ ] **Step 2: Run the launcher suite and confirm the intended failure**

Run: `cd web && node --test tests/lib/server-launcher.test.mjs`

Expected: the child does not receive the wrapper's termination signal.

- [ ] **Step 3: Replace the blocking spawn with owned asynchronous lifecycle**

Use `spawn` with inherited streams, register signal handlers once, forward a received termination signal to the child and exit after the child closes. If it does not close within the bounded timeout, send SIGKILL to that same child. Remove timers and listeners on close. Preserve platform-native non-zero signal status and startup failures.

- [ ] **Step 4: Verify launcher and web suites**

Run: `cd web && node --test tests/lib/server-launcher.test.mjs`

Run: `cd web && npm test`

Expected: both exit 0.

- [ ] **Step 5: Commit**

Commit message: `fix(web): stop owned Next child with launcher`

### Task 2: Native launcher, tests and local build

**Files:**
- Create: `macos/CareerOpsCore.swift`
- Create: `macos/CareerOpsCoreTests.swift`
- Create: `macos/CareerOpsApp.swift`
- Create: `macos/Info.plist`
- Create: `macos/build-app.sh`

**Interfaces:**
- Produces: `LaunchConfiguration` with checkout, Node and optional data-root URLs.
- Produces: `validateConfiguration`, incremental `ServerURLParser` and `navigationDisposition` pure helpers.
- Produces: `macos/build-app.sh [--checkout PATH] [--node PATH] [--data-root PATH] [--destination PATH]`.
- Produces: `Career Ops.app` with bundle identifier `io.career-ops.local`, a single-instance activation policy and `applicationShouldTerminateAfterLastWindowClosed`.

- [ ] **Step 1: Write failing Swift helper tests**

Cover spaces in paths, Node versions below `22.6.0`, missing `.next/BUILD_ID`, ANSI and chunked `Local:` output, valid port range, loopback URLs, same-origin navigation, other loopback ports, external HTTPS URLs and malformed URLs. Compile the test executable against the missing helper API and confirm compilation fails for those symbols.

- [ ] **Step 2: Implement the pure helper layer**

Use Foundation only. Parse the port from Next's announced `http` URL only when the host is `127.0.0.1` or `localhost` and the port is in `1...65535`; retain an incomplete trailing line between chunks, stop at the first valid URL and return concrete PT-PT validation messages.

- [ ] **Step 3: Run the Swift helper tests**

Run: `macos/build-app.sh --test-only`

Expected: every assertion passes and the command exits 0.

- [ ] **Step 4: Implement the AppKit and WebKit lifecycle**

Create one native window. Load saved preferences, validate paths, launch the Node wrapper with `Process`, wait for the parsed URL plus an HTTP response, then load it. Apply a startup timeout and fail immediately if the process exits. Before launch, remove `CAREER_OPS_WEB_ALLOWED_HOSTS`, `CAREER_OPS_ROOT`, `CAREER_OPS_DATA_DIR` and `CAREER_OPS_CODE_ROOT`, then set `CAREER_OPS_ROOT` and `CAREER_OPS_CODE_ROOT` explicitly. Save process output to `~/Library/Logs/Career Ops/server.log`. On failure, show the cause with `Escolher pasta`, `Tentar novamente`, `Abrir registo` and `Fechar` where applicable.

- [ ] **Step 5: Implement navigation and downloads**

Keep only links with the exact scheme, host and port of the started server in the WebView. Open every other destination with `NSWorkspace`, including `target=_blank` through `WKUIDelegate`. Handle `WKDownload` through `NSSavePanel`; never choose a destination or overwrite a file without the user's action.

- [ ] **Step 6: Build the app bundle**

Compile with `swiftc` and the AppKit/WebKit frameworks, copy `Info.plist`, generate the app icon from the existing Career Ops icon, sign ad hoc and install to the requested destination. Write the build-time default paths into the bundle without committing machine-specific paths.

- [ ] **Step 7: Verify tests and inspect the bundle**

Run: `macos/build-app.sh --test-only`

Resolve the installation inputs without committing machine-specific paths:

```bash
career_ops_checkout="$(pwd -P)"
career_ops_node="$(command -v node)"
career_ops_data_root="$(cat "$(dirname "$(git rev-parse --git-common-dir)")/.career-ops-data")"
macos/build-app.sh --checkout "$career_ops_checkout" --node "$career_ops_node" --data-root "$career_ops_data_root" --destination "$HOME/Applications/Career Ops.app"
```

Run: `codesign --verify --deep --strict "$HOME/Applications/Career Ops.app"`

Run: `plutil -lint "$HOME/Applications/Career Ops.app/Contents/Info.plist"`

Expected: all commands exit 0.

- [ ] **Step 8: Commit source only**

Do not add the built `.app`, logs or compiled test executables.

Commit message: `feat(macos): add local Career Ops application`

### Task 3: Installed-app end-to-end verification and project record

**Files:**
- Modify: `docs/contexto/task.md`
- Modify: `docs/contexto/memory.md`

**Interfaces:**
- Consumes: installed app and the production Next build.
- Produces: evidence for startup, reuse, navigation, error and shutdown flows.

- [ ] **Step 1: Verify the production web build**

Run: `cd web && npm run typecheck && npm run build`

Expected: both exit 0 before the app is opened.

- [ ] **Step 2: Verify cold launch and second activation**

Open the installed app with no app-owned server running. Confirm the Today page loads in PT-PT, the process binds loopback on a non-fixed port and a second `open` activates the same app instance.

- [ ] **Step 3: Verify browser boundaries**

Exercise internal navigation, the existing external documentation link in Configuração and a deterministic synthetic download served from the disposable data-root fixture. Confirm the external link leaves the WebView and the download asks for a destination. Cancel before writing if no disposable destination was prepared.

- [ ] **Step 4: Verify recovery and ownership**

Temporarily point `CareerOpsCheckoutPath` at a synthetic missing checkout and confirm the actionable error, then restore the three named preferences. Quit the app and prove its wrapper and Next child ended while the independent server on port 3427 still answers HTTP 200.

- [ ] **Step 5: Run the complete automated gate**

Run: `node test-all.mjs`

Run: `cd web && npm test && npm run typecheck && npm run build`

Run: `macos/build-app.sh --test-only`

Expected: every command exits 0.

- [ ] **Step 6: Update context and commit**

Record the installed app path, exact commands, observed PIDs and ports, test counts and the local-only runtime limitation in `task.md` and `memory.md`.

Commit message: `docs(project): record macOS app verification`
