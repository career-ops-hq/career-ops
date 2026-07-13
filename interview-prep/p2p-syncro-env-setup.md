# P2P Syncro Coding Round - Environment Setup (VS Code + rust-analyzer)

Target: zero friction on camera. You should never fumble a shortcut, a run button, or a notification popup mid-interview. Set this up once on Day 1 and rehearse it.

---

## 1. Extensions (install + verify)

| Extension | Why |
|---|---|
| `rust-analyzer` (rust-lang.rust-analyzer) | LSP: completions, inline errors, Run/Debug CodeLens, quick-fixes. The whole show. |
| `CodeLLDB` (vadimcn.vscode-lldb) | Native debugger for Rust on macOS. Breakpoints, watch, step. |
| `Even Better TOML` (tamasfe.even-better-toml) | `Cargo.toml` editing without pain. |
| `crates` (optional) | Inline latest-version hints in Cargo.toml. Low value in an interview, fine to skip. |

Do NOT install the deprecated `rust` (rls) extension. If it's there, disable it - it fights rust-analyzer.

Verify: open `~/rust-interview-prep/src/lib.rs`. You should see a greyed `Run | Debug` CodeLens above each `#[test]` and above any `fn main`. If not, rust-analyzer isn't active - reload window.

## 2. Key settings (already in the scaffold's `.vscode/settings.json`)

```jsonc
"editor.formatOnSave": true,              // rustfmt on every save - never hand-format live
"rust-analyzer.check.command": "clippy",  // clippy lints inline, not just rustc
"rust-analyzer.check.allTargets": true,
"editor.fontSize": 16,                     // readable when screen-shared/compressed
"editor.minimap.enabled": false,          // less clutter on camera
```

Bump font to 18 if you'll share a small window. Interviewers squinting at your code is a silent negative.

## 3. Shortcut cheat-sheet (drill these to muscle memory - macOS)

**The one that matters most:**
- `Cmd .` - **Quick Fix**. Auto-import a symbol, fill match arms, add missing trait members, wrap in Ok/Some, generate. When you type `HashMap` and it's not imported, `Cmd .` -> Enter. This is your fastest path out of "where does this come from".

**Navigation:**
- `F12` go to definition · `Alt F12` peek definition (inline, no context switch) · `Shift F12` find all references
- `Cmd Shift O` symbol in file (jump to a fn) · `Cmd T` symbol in workspace
- `Cmd P` quick-open file · `Ctrl -` / `Ctrl Shift -` navigate back/forward
- `Cmd Shift \` jump to matching bracket

**Editing:**
- `F2` rename symbol (project-wide, safe) · `Ctrl Space` trigger completion
- `Alt Up/Down` move line · `Shift Alt Down/Up` duplicate line · `Cmd /` toggle comment
- `Cmd D` add next occurrence to multi-cursor · `Cmd Shift L` select all occurrences
- `Cmd Shift K` delete line · `Cmd Enter` insert line below

**Run / test / debug:**
- Click the `Run` CodeLens above a test, OR `Cmd Shift P` -> "rust-analyzer: Run" (`rust-analyzer.run`) and bind it to a key if you like.
- `F5` start debugging (uses launch.json) · `F9` toggle breakpoint · `F10` step over · `F11` step into · `Shift F11` step out
- `Ctrl` `` ` `` toggle integrated terminal · `Cmd K Cmd S` open keybindings if you need to check one

**Problems / diagnostics:**
- `F8` / `Shift F8` next / previous problem in file · `Cmd Shift M` open Problems panel

**rust-analyzer power commands** (`Cmd Shift P`, type "rust-analyzer:"):
- "Expand macro recursively" - see what a `#[derive]` or `println!` expands to
- "Open Cargo.toml" · "Reload workspace" (fixes stale analysis)

> Drill: spend 10 minutes doing ONLY keyboard navigation - no mouse. Rename a symbol, import a type via `Cmd .`, jump to a def and back, run a test. Repeat until it's automatic.

## 4. Debugging: two modes, know when to use each

**Fast loop (use this 90% of the time in a coding round):**
- `dbg!(x)` - prints `file:line x = value` and returns the value (so you can wrap expressions: `let y = dbg!(compute());`).
- `eprintln!("{x:?}")` for debug-format, `{x:#?}` for pretty.
- `assert_eq!(got, want)` in a test - lets rust-analyzer's Run button be your whole debug cycle.
- `cargo test testname` runs one test; rust-analyzer runs the exact test under the cursor.

**Real debugger (know it works, use if a bug is genuinely non-obvious):**
- `.vscode/launch.json` in the scaffold has two configs: "Debug bin day1" and "Debug unit tests (lib)".
- Set a breakpoint (`F9`), hit `F5`, inspect variables in the left panel, step with `F10`/`F11`.
- Honest calibration: reaching for a full debugger on a 20-minute algorithm problem can read as slow. Prefer the test + `dbg!` loop; keep the debugger as the escape hatch.

## 5. Cold-start ritual (rehearse to under 30 seconds)

When the interviewer says "share your screen and let's start", you should be coding in seconds:

1. `~/rust-interview-prep` already open in VS Code (open it before the call).
2. New drill -> either edit `src/lib.rs`, or `src/bin/day1.rs`, or make `src/bin/problemX.rs`.
3. Write the function signature + a `#[test]` with one example from the prompt.
4. Click `Run` on the test (red) -> implement -> `Run` (green).
5. Narrate as you go (see communication protocol in the hub doc).

> Practice this 5 times cold. From "blank editor" to "first green test" in <30s means the setup never costs you thinking time.

## 6. Fast feedback tooling (install Day 1)

```bash
cargo install cargo-nextest   # faster, cleaner test output than `cargo test`
cargo install bacon           # background checker: shows errors as you type
# alt: cargo install cargo-watch  ->  cargo watch -x check -x test
```

Run `bacon` in a side terminal during drills: it recompiles + reruns checks on save, so borrow-checker errors surface instantly without you switching windows. (Optional on camera - some prefer the clean CodeLens loop. Rehearse both, pick one.)

## 7. Screen-share hygiene (do NOT use a full VM - here's why + what to do instead)

A full VM adds latency, a second Rust toolchain to maintain, and one more thing to break the morning of. Skip it. You get the same "clean, private, professional" result with:

**Dedicated VS Code profile** (`Cmd Shift P` -> "Profiles: Create Profile", name it "Interview"):
- Only the 4 extensions above. Clean theme, font 16-18. No personal repos in "Recent". No leaking side panels.
- Switch to it before the call; switch back after.

**macOS hygiene:**
- Turn on a **Focus / Do Not Disturb** mode - kills notification banners mid-share.
- Quit Slack, Mail, Telegram, WhatsApp, Discord, Signal. (No preview popups, no message content leaks.)
- Close every personal browser tab. Open a **fresh browser profile** (or Guest window) with ONLY the allowed-AI tab and the meeting.
- Clean desktop / hide desktop icons. Single display, or know exactly which window you'll share.
- Silence the dock badge counts.

**If you genuinely want isolation** (personal files never at risk of a mis-share): create a **separate macOS user account** ("interview"), install VS Code + rustup there. Native performance, ~5 min setup, far lighter than a VM. Documented as the fallback; the profile approach is the default and enough.

## 8. Day-of smoke test (Jul 9, ~10:45, 5 minutes)

- [ ] Open `~/rust-interview-prep` in the Interview profile.
- [ ] Cold-start ritual once: blank -> green test in <30s.
- [ ] `cargo test` and `cargo clippy` both run clean.
- [ ] One breakpoint fires under `F5` (proves the debugger path if you need it).
- [ ] Focus mode ON, chat apps quit, fresh browser profile with the AI tab open.
- [ ] Screen-share a test window to yourself (start a solo Meet) - confirm font is readable and nothing private is visible.
- [ ] Mic + camera check. Water within reach. Then stop touching things.
