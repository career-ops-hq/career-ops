# Review Before Write (Optional)

An opt-in pattern for people who want every direct agent edit to their candidate files shown and approved first. It is not part of core and nothing in career-ops turns it on. Background: [#4081](https://github.com/career-ops-hq/career-ops/issues/4081).

**This is not a security boundary.** It guards one path, Claude Code's own edit tools, and relies on the agent following an instruction everywhere else. Read [What it does not intercept](#what-it-does-not-intercept) before relying on it.

## The contract

Before the agent changes a protected file, it:

1. Reads the current file, or confirms it does not exist.
2. Shows the exact current-versus-proposed diff in a ```` ```diff ```` block, naming the file.
3. Stops and waits for your next message to approve that diff.
4. Applies only the approved change.
5. Shows a new diff and asks again if the change or the files involved change.

A broad request ("improve my CV", "fix my profile") is not approval for a diff you have not seen.

## Claude Code: an opt-in hook

Everything goes in your own `.claude/` folder, which career-ops treats as user-owned.

Add this to `.claude/settings.json` (merge it if you already have hooks):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit|NotebookEdit",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/review-before-write.sh\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Save this as `.claude/hooks/review-before-write.sh` and run `chmod +x` on it. It needs `jq`.

```sh
#!/bin/sh
# Opt-in review-before-write guard for career-ops candidate files.
# See docs/REVIEW_BEFORE_WRITE.md. Requires jq.
#
# Denies a direct Claude Code edit to a protected file unless, in this session:
#   1. a recent assistant message named the file and showed a diff, and
#   2. the latest user message approves it.
# Otherwise it stays silent and Claude Code's normal permission flow applies.
# It reads the transcript but never writes or logs it.
set -eu

# Paths relative to the project root. A trailing / protects everything under it.
# Edit this list to suit your setup.
PROTECTED="writing-samples/
cv.md
config/profile.yml
config/cv-facts.json
modes/_profile.md
modes/_custom.md
modes/_brief.md
portals.yml
article-digest.md
voice-dna.md
interview-prep/story-bank.md
data/career-profile.yml"

pass() { printf '{}\n'; exit 0; }
deny() {
  jq -n --arg r "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

input="$(cat)"
target="$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // ""')"
[ -n "$target" ] || pass

root="${CLAUDE_PROJECT_DIR:-$(printf '%s' "$input" | jq -r '.cwd // ""')}"
case "$target" in
  /*) rel="${target#"${root%/}"/}" ;;
  *) rel="${target#./}" ;;
esac

protected=no
for p in $PROTECTED; do
  case "$p" in
    */) case "$rel" in "$p"*) protected=yes ;; esac ;;
    *) [ "$rel" = "$p" ] && protected=yes ;;
  esac
done
[ "$protected" = yes ] || pass

reason="$rel is protected. Show the exact current-versus-proposed diff for $rel in a \`\`\`diff block, then wait for the user to approve it in their next message."

transcript="$(printf '%s' "$input" | jq -r '.transcript_path // ""')"
[ -r "$transcript" ] || deny "$reason"

last_user="$(jq -sr '[.[] | select(.type == "user") | .message.content
  | if type == "string" then . else ([.[]? | select(.type == "text") | .text] | join("\n")) end
  | select(. != "")] | last // ""' "$transcript" | tr '[:upper:]' '[:lower:]')"
recent="$(jq -sr '[.[] | select(.type == "assistant") | .message.content[]?
  | select(.type == "text") | .text] | .[-20:] | join("\n")' "$transcript")"

printf '%s' "$last_user" | grep -Eq '(^|[^a-z])(approved?|go ahead|apply it)([^a-z]|$)' || deny "$reason"
# Any negation fails closed: a wrong "no" costs one more prompt, a wrong "yes" costs your CV.
printf '%s' "$last_user" | grep -Eq "(^|[^a-z])(not|no|don'?t|never|wait|hold)([^a-z]|$)" && deny "$reason"
printf '%s' "$recent" | grep -Fq "$rel" || deny "$reason"
# A diff is a ```diff block or unified-diff headers.
printf '%s' "$recent" | grep -Eq '^(```diff|diff --git|--- |\+\+\+ |@@ )' || deny "$reason"

pass
```

When an edit is blocked, Claude Code passes the reason back to the agent, which should then show the diff and ask. When the checks pass, the hook returns nothing, so your normal permission prompts still apply. It never approves an edit on its own.

The hook reads the session transcript to look for the diff and your approval. It does not write, copy or log anything, so your CV text stays where it was.

## What it intercepts

Direct `Write`, `Edit`, `MultiEdit` and `NotebookEdit` calls from Claude Code to a path on the protected list.

## What it does not intercept

- **Shell commands.** `sed -i`, `>`, `cp`, `mv`, `rm` or `git checkout` through the Bash tool all bypass it. The instruction below is the only guard there.
- **Scripts and generators** that write these files themselves.
- **Other agent CLIs** (Codex, OpenCode, Gemini CLI and the rest), and edits from your editor or any other program.
- **What the approval means.** The hook checks that a diff naming the file was shown and that your latest message contains an approval word without a negation. It cannot check that the edit matches the diff you approved.

Subagents were not tested.

## Codex and other agents

Without hooks, the contract can only be an instruction. Put it in `modes/_custom.md`, which `AGENTS.md` already tells agents to read in every mode and which updates leave alone:

```markdown
## Review before write

Before creating, editing, deleting, moving, renaming, formatting or overwriting cv.md,
config/profile.yml, config/cv-facts.json, modes/_profile.md, modes/_custom.md,
modes/_brief.md, portals.yml, article-digest.md, voice-dna.md,
interview-prep/story-bank.md, data/career-profile.yml or anything in writing-samples/:

1. Read the current file, or confirm it does not exist.
2. Show the exact current-versus-proposed diff, including every target path.
3. Stop and wait for a later message from me that explicitly approves that diff.
4. Apply only the approved diff.
5. If the content or the paths change, show a new diff and ask again.

A broad request to improve or fix something is not approval for a diff I have not
seen. Shell commands, scripts and other tools are bound by the same rule.
```

This is an agent contract, not a technical control: an agent that ignores the instruction is not stopped.
