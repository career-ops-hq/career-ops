Set-Location "C:\Users\PC\career-ops"
$prompt = Get-Content -Raw -Path "websearch-scan-prompt.md"
$allowedTools = "Read,Glob,Grep,WebSearch,WebFetch,mcp__playwright__browser_navigate,mcp__playwright__browser_snapshot,mcp__playwright__browser_close"

# Timestamped, not a fixed filename -- a fixed name gets overwritten by the
# next run, which erased the previous run's raw output when a parsing bug
# silently dropped every result (2026-09-17 through 2026-09-19). Keeping
# per-run history means a future bug leaves recoverable data instead of
# destroying it on the very next run.
New-Item -ItemType Directory -Force -Path "C:\Users\PC\career-ops\data\websearch-runs" | Out-Null
$stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$resultsPath = "C:\Users\PC\career-ops\data\websearch-runs\$stamp.txt"

# Plain stdout redirection -- not a Claude tool call, so it isn't subject to
# the tool-permission system. This is the write path for an otherwise
# read-only headless run: it prints, the shell captures it to a file.
& "C:\Users\PC\AppData\Roaming\npm\claude.cmd" -p $prompt --allowedTools $allowedTools --permission-prompts none *> $resultsPath

# Deterministic script, no AI involved -- does the actual write/commit.
node "C:\Users\PC\career-ops\apply-websearch-results.mjs" $resultsPath
