# Community asks and the Hired Wall

AGENTS.md → "Community asks" and "Celebrating a hire (the Hired Wall)" send you here. Read this file when `node community-asks.mjs next` prints an ask, and when the user records a `hired` or `accepted` outcome.

## Community asks (one at a time, once each)

This project practices CareerOps (see `MANIFESTO.md`), and career-ops never phones home: the only signals the maintainers get are the ones people choose to give. So it asks for them in words, rarely, and at the right moment. There are three asks, each shown at most once and never two in one run: a GitHub star after the first evaluation report, the manifesto later (after five reports, at least a week after the star), and the Hired Wall at a hire (see "Celebrating a hire (the Hired Wall)").

- **When:** at the very end of an interactive run that saved at least one evaluation report (`oferta`, `auto-pipeline`, `pipeline`, and their translations), run `node community-asks.mjs next`. If it prints nothing, say nothing about it. If it prints an ask, end your reply with it, after everything else:
  - copy a fenced block (the star's drawing) exactly as printed, fence included: never translate, redraw or re-indent it;
  - translate the sentence faithfully into the language the user is writing to you in this conversation (when that is unclear, `language.output` in `config/profile.yml`). Keep the URL and the word Star (the name of GitHub's button, the same in every language) exactly as printed, and add, remove or soften nothing.
- **If the user says yes** in their next reply (yes, sure, go ahead…), run `node community-asks.mjs open star`, or `open manifesto` for that ask: it opens the page in their browser, and starring or signing stays their own click. Anything else in that reply: drop the ask and carry on.
- **The script decides.** Never ask for a star, a signature or a share on your own, never turn an ask into a bigger one, and never repeat an ask, not even when the user ignored it.
- **Never** in a headless run or a batch worker (see "Headless / Batch Mode"). Never star through `gh`, `curl` or any API, and never offer to: the GitHub Acceptable Use Policies forbid automated starring.
- On a `hired` outcome the Hired Wall is the only ask.
- The user can turn the asks off with `node community-asks.mjs off` or `CAREER_OPS_NO_ASKS=1`.

## Celebrating a hire (the Hired Wall)

When the user records a `hired` or `accepted` outcome, celebrate FIRST — a landed job is the whole point of this tool — and then offer, once:

> That's the whole point of everything we did here. Congratulations! 🎉
>
> One optional thing: career-ops keeps a public wall of people who landed jobs with it. If you want yours there, I'll draft it from what we already know (role, weeks, what helped). You'll see the exact text, and nothing leaves this machine unless you submit it yourself on GitHub. Want the draft? If not, I won't bring this one up again.

If they say yes: run `node hired-share.mjs --report N --anonymity <their choice> --story "<their words>" --open` — it prints the exact payload, opens a prefilled GitHub issue, and the user reviews and submits it themselves. Ask their anonymity level explicitly and pass it as `handle`, `role` or `count` (the only values the script accepts: handle and avatar, role and location without a handle, or a count only); never default to the most exposed. Offer a 2-sentence draft story built only from tracker data, and let them rewrite it. If they say "not now": `node hired-share.mjs --report N --mark later`. If they say no: `--mark never`, and honor it — that hire is never brought up again.

**Cadence rules (hard):** one ask per hire, at outcome time. After an update, `node hired-share.mjs --status` may list hires never asked or marked "later" more than 30 days ago — at most ONE gentle mention, then respect the answer. Never remind on a schedule. Never mention the wall at `offer_received`: an offer can still fall through, and the ask belongs to the signed outcome only.

**Privacy (hard):** salary is never part of a story. Company name only if the user writes it themselves. The share flow reads tracker data locally and writes only `data/.hired-share-state.json`; the only thing that ever leaves the machine is the issue the user submits from their own GitHub account.
