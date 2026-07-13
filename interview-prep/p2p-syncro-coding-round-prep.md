# P2P.org Syncro - Coding Round Prep (HUB)

**Interview:** Thu Jul 9, 11:00 Romania time (EEST) | Google Meet | 1h | 1 tech interviewer | screen-shared, your own Rust setup
**Format:** Part 1 = Coding WITH AI · Part 2 = Coding WITHOUT AI
**Focus (recruiter's words):** Rust, algorithmic efficiency, time & space complexity, performance-aware low-latency code
**Role context:** `p2p-syncro-staff-engineer.md` (company/product/competitive intel + your calibrated fit)

## Your three goals (this frames every choice)
1. **Behave as a senior software engineer** - communication, process, judgment, self-verification. This is what a coding round scores; it's your strongest lever.
2. **Get insight into the interview process** - reconnaissance for the loop (a Solana/networking screen likely comes next).
3. **Practice live thinking + coding in Rust** - reps under time pressure, borrow-checker fluency, thinking aloud.

You've self-assessed the role as a stretch on job-specific depth. The plan does NOT fake that. It maximizes senior signal on the ~80% general-Rust surface and gives honest, intelligent talking points for the ~20% you'll only discuss.

## The prep docs (read in this order)
1. **`p2p-syncro-env-setup.md`** - VS Code + rust-analyzer, shortcuts, debug, cold-start ritual, screen-share hygiene. (Day 1 AM)
2. **`p2p-syncro-rust-cheatsheet.md`** - collections/complexity/iterators/patterns/perf idioms. (Skim daily, drill Day 1-2)
3. **`p2p-syncro-ai-usage-playbook.md`** - the AI-allowed half. (Day 2)
4. **`p2p-syncro-gap-topics.md`** - low-latency + QUIC/TPU/SWQoS talking points. (Day 3 AM)
5. Code scaffold: **`~/rust-interview-prep/`** (outside this repo) - `cargo test` / `cargo clippy` verified working, criterion cached.

---

## Communication protocol - how to think aloud like a senior (the #1 scored skill)

Run every problem through this arc, out loud:

1. **Clarify before coding.** Restate the problem. Ask about constraints: input size, ranges, duplicates, sorted?, memory limits, streaming vs batch, is it a hot path? (Asking "how big is n?" is itself a senior signal - it drives the algorithm.)
2. **State approach + Big-O before typing.** "Brute force is O(n^2); I can get O(n) with a HashMap. Space goes to O(n). I'll do the O(n) one." Offer the tradeoff, then pick.
3. **Narrate while coding.** Say what each block does. Don't go silent. Silence + typing reads as "hoping it works".
4. **Test your own code unprompted.** Empty / single / duplicate / max. Write the test, run it. Don't wait to be asked "does it work?".
5. **Self-review + state confidence.** "Tests pass for the edge cases; I've read it through; I'm confident. If this were hot, I'd pre-allocate the buffer."
6. **Take hints gracefully.** If nudged, engage - "Good point, that breaks on negatives; let me handle that." Never get defensive. Interviewers hint on purpose; adapting well scores higher than needing no hint.

Senior tells: asks about constraints first · states complexity unprompted · tests without being asked · names tradeoffs · admits uncertainty honestly · stays calm and talks through a stuck moment instead of freezing.

---

## 3-day schedule (heavy track, ~12h)

### Day 1 - Sun Jul 6: Environment + Rust fluency foundation
**AM (~3h)**
- [ ] Read `p2p-syncro-env-setup.md`. Install extensions, create the "Interview" VS Code profile.
- [ ] Open `~/rust-interview-prep`. Drill shortcuts (10 min mouse-free). Rehearse cold-start ritual x5 (<30s each).
- [ ] Confirm debugger fires (`F5` + breakpoint), `cargo test`/`clippy` clean, `cargo install cargo-nextest bacon`.
**PM (~3h)**
- [ ] Skim `p2p-syncro-rust-cheatsheet.md` sections 1-3. Drill collections + iterators + borrow-checker fixes by hand.
- [ ] **Live Mock #1** with Claude (easy-medium, AI-FREE) - baseline live coding + think-aloud.

### Day 2 - Mon Jul 7: Patterns + perf-aware Rust + AI usage
**AM (~3h)**
- [ ] Cheatsheet section 4: drill two pointers, sliding window, hashing, heap top-k, BFS/DFS, DP-lite. Narrate Big-O each.
- [ ] **Live Mock #2** (medium, AI-FREE).
**PM (~3h)**
- [ ] Read `p2p-syncro-ai-usage-playbook.md`. Set up your AI tool(s) in the fresh browser profile.
- [ ] **Live Mock #3** (medium, AI-ALLOWED) - practice the delegate/verify loop and the "overrule the AI" move.
- [ ] Cheatsheet section 5 (perf idioms). Practice the "O(n) answer, then the constant-factor win" framing.

### Day 3 - Tue Jul 8: Gap topics + full dress rehearsal
**AM (~3h)**
- [ ] Read `p2p-syncro-gap-topics.md`. Rehearse the 60-second QUIC/TPU/SWQoS and low-latency explanations + the honest-gap line.
**PM (~3h)**
- [ ] **FULL DRESS REHEARSAL**: two-part mock mirroring the real thing - 30 min AI-allowed problem + 30 min AI-free problem, with camera-style narration throughout.
- [ ] Feedback -> fix the 2-3 weakest spots.

### Jul 9 AM (pre-11:00): light touch
- [ ] Re-skim cheatsheet section 8 (self-check) + gap-topics one-liners.
- [ ] 5-min day-of smoke test (env-setup doc section 8). Then stop, hydrate, stay calm.

---

## Live-mock protocol (how we run drills in-session)

1. I pose a problem (with the constraints a good interviewer gives).
2. You code in `~/rust-interview-prep/` (new `src/bin/problemX.rs` or edit `lib.rs`).
3. You narrate: clarify -> approach + Big-O -> code -> test.
4. You tell me "done" or paste the code.
5. I review as a senior interviewer: probe complexity, edge cases, Rust idioms, and throw one follow-up ("now make it O(n)", "what if it's a stream", "what breaks at scale").
6. I score **communication + process**, not just correctness, and log gaps below.

Say **"start mock 1"** (or 2/3/dress) when you're ready and I'll run it.

---

## Drill log (updated as we go)

| Mock | Type | Problem | Correct? | Big-O stated? | Comm/process notes | Gaps to fix |
|---|---|---|---|---|---|---|
| 1 | AI-free | _tbd_ | | | | |
| 2 | AI-free | _tbd_ | | | | |
| 3 | AI-allowed | _tbd_ | | | | |
| Dress | 2-part | _tbd_ | | | | |

## Running gap list (things to shore up)
- _(populated after each mock)_
