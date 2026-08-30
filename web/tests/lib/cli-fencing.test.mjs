// Tests for translating worker capabilities into a CLI's permission flags (#2507).
//
// Asserts on the argv that actually ships, never on a caller's source text —
// claude-invocation.mjs's header lists the five ways source-text guards for this
// were defeated. The values below encode a fact verified against codex-cli
// 0.146.0 rather than a preference, so read the comments before "tightening" one:
// under `read-only` the Codex sandbox blocks DNS outright, and the network escape
// hatch only exists for `workspace-write`.
//
// Run:  node --test tests/lib/cli-fencing.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { fenceArgs, fencingReport, isFencingNotice } from "../../src/lib/cli-fencing.mjs";
import { CAPS, KNOWN_KINDS, capabilitiesFor } from "../../src/lib/worker-capabilities.mjs";
import { scopeFrom } from "../../src/lib/claude-invocation.mjs";

/** The argv shape /api/run ships for codex (codexStreamArgs), prompt last. */
const codexArgv = (prompt = "PROMPT") => ["exec", "--json", "--color", "never", prompt];

/** A Claude argv built the way the routes build theirs: deny list DERIVED from
 *  the allow list, so nothing forbidden is left merely unmentioned. */
const claudeArgv = (allowed = "Read,Glob,Grep") => {
  const scope = scopeFrom(allowed);
  // --strict-mcp-config included: verification requires it for a non-writing record,
  // because a deny list describes only native tools and an MCP server could supply
  // a write tool beside them.
  return ["-p", "PROMPT", "--strict-mcp-config", "--allowedTools", scope.allowed, "--disallowedTools", scope.disallowed];
};

/** Read a `-c key=value` override back out of a built argv. */
function configValue(args, key) {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === "-c" && args[i + 1].startsWith(`${key}=`)) return args[i + 1].slice(key.length + 1);
  }
  return null;
}

test("the fixture these guards read still looks like itself", () => {
  // Given a suite that leans on KNOWN_KINDS to enumerate work
  // When it is empty, every loop below passes vacuously
  assert.ok(KNOWN_KINDS.length > 0, "KNOWN_KINDS must not be empty");
  for (const id of ["codex", "claude"]) {
    assert.equal(fencingReport({ cliId: id, cliName: id, capabilities: CAPS.workspaceWrite }).level, "full",
      `${id} must still be fenceable`);
  }
});

test("a local read-only worker gets a true read-only sandbox", () => {
  // Given a worker that reads local files and never fetches (pdf, cv/ingest,
  // apply/prefill, the drive planner)
  // When its codex argv is fenced
  const { args } = fenceArgs({ cliId: "codex", args: codexArgv(), capabilities: CAPS.localReadOnly });

  // Then the sandbox is read-only, and no network hatch is opened.
  assert.equal(configValue(args, "sandbox_mode"), "read-only");
  assert.equal(configValue(args, "sandbox_workspace_write.network_access"), null);
});

test("a searching worker keeps the read-only sandbox and gets the model's own web tool", () => {
  // Given AI search: it hunts the web but is never handed a url to open (#2361)
  // When its codex argv is fenced
  const { args } = fenceArgs({ cliId: "codex", args: codexArgv(), capabilities: CAPS.webSearchOnly });

  // Then its web access is --search, which the model runs server-side, so
  // nothing has to cross the sandbox and read-only survives. This is the exact
  // configuration #2361 shipped inline; the point of moving it here was to keep
  // it, not to trade it for a writable workspace.
  assert.ok(args.includes("--search"), "a web-using worker must get the native search tool");
  assert.equal(configValue(args, "sandbox_mode"), "read-only");
  assert.equal(configValue(args, "sandbox_workspace_write.network_access"), null);
});

test("a fetching worker gets workspace-write plus the network hatch", () => {
  // Given a worker that must fetch but is not asked to write (research, the
  // assistant and explore advisors)
  // When its codex argv is fenced
  const { args } = fenceArgs({ cliId: "codex", args: codexArgv(), capabilities: CAPS.networkReadOnly });

  // Then it lands on workspace-write WITH network — deliberately, not by
  // oversight. Verified on codex-cli 0.146.0: `read-only` blocks DNS and its
  // escape hatch (sandbox_workspace_write.network_access) applies only to
  // workspace-write, so there is no read-only-plus-network policy to ask for.
  // "Tightening" this to read-only silently breaks every fetch these workers make.
  assert.equal(configValue(args, "sandbox_mode"), "workspace-write");
  assert.equal(configValue(args, "sandbox_workspace_write.network_access"), "true");
});

test("a persisting worker gets workspace-write plus the network hatch", () => {
  // Given evaluate/fix-portal, which fetch a posting and then write artifacts
  const { args } = fenceArgs({ cliId: "codex", args: codexArgv(), capabilities: CAPS.workspaceWrite });

  // Then writes are confined to the workspace and the fetch still works.
  assert.equal(configValue(args, "sandbox_mode"), "workspace-write");
  assert.equal(configValue(args, "sandbox_workspace_write.network_access"), "true");
});

test("no capability ever yields an unsandboxed run", () => {
  // Given every capability record that exists
  for (const [name, caps] of Object.entries(CAPS)) {
    const { args } = fenceArgs({ cliId: "codex", args: codexArgv(), capabilities: caps });

    // Then the policy is one of the two constrained modes. danger-full-access
    // disables the sandbox entirely; no worker has a reason to ask for it, and a
    // run that quietly received it would look fenced while being anything but.
    const mode = configValue(args, "sandbox_mode");
    assert.ok(["read-only", "workspace-write"].includes(mode), `${name} produced sandbox_mode=${mode}`);
  }
});

test("the sandbox policy is spelled with -c, which beats the user's config.toml", () => {
  // Given career-ops does not pass --ignore-user-config, so a user's
  // ~/.codex/config.toml still applies to these runs
  const { args } = fenceArgs({ cliId: "codex", args: codexArgv(), capabilities: CAPS.localReadOnly });

  // Then the mode is a `-c` override, whose precedence over config.toml was
  // verified (a config setting danger-full-access is overridden by
  // `-c sandbox_mode=read-only`). `-s` was NOT used: its precedence could not be
  // verified the same way, and an unproven override leaves the fence defeatable
  // by any user who had set that key for other work.
  assert.ok(args.includes("-c"), "sandbox policy must be passed as a -c override");
  assert.ok(!args.includes("-s") && !args.includes("--sandbox"), "must not rely on -s (precedence unverified)");
});

test("every codex run refuses escalation by approval", () => {
  // Given a sandbox a model can ask to be let out of, and a headless run with
  // nobody to ask
  for (const [name, caps] of Object.entries(CAPS)) {
    const { args } = fenceArgs({ cliId: "codex", args: codexArgv(), capabilities: caps });

    // Then approval is refused outright, so a blocked command stays blocked
    // instead of hanging on a prompt or being waved through.
    const approval = args.indexOf("--ask-for-approval");
    assert.notEqual(approval, -1, `${name} must set an approval policy`);
    assert.equal(args[approval + 1], "never", `${name} must refuse approvals`);
  }
});

test("fencing never disturbs the prompt or the subcommand", () => {
  // Given codex reads the prompt as the last positional argument, and
  // parseCodexEvent only understands output produced by this exact argv
  const original = codexArgv("the prompt");
  const { args } = fenceArgs({ cliId: "codex", args: original, capabilities: CAPS.workspaceWrite });

  // Then the prompt stays last, the transport flags survive, and everything
  // fencing added sits ahead of them: global options before the subcommand,
  // sandbox overrides after it, nothing past the prompt.
  const exec = args.indexOf("exec");
  assert.ok(exec !== -1, "the subcommand must survive fencing");
  assert.ok(args.slice(0, exec).includes("--ask-for-approval"), "global flags belong before the subcommand");
  assert.equal(args.at(-1), "the prompt");
  for (const flag of ["--json", "--color"]) {
    assert.ok(args.indexOf(flag) > exec, `${flag} must survive fencing, after the subcommand`);
  }
  assert.equal(args[args.indexOf("--color") + 1], "never", "--color keeps its own value");
  // And the caller's array is not mutated underneath it.
  assert.deepEqual(original, codexArgv("the prompt"));
});

test("a caller's own global flags keep their place ahead of the subcommand", () => {
  // Given AI search's argv shape after #2361: isolation and output flags the
  // route owns, with the prompt last
  const original = ["exec", "--ephemeral", "--output-last-message", "/tmp/out.txt", "the prompt"];
  const { args } = fenceArgs({ cliId: "codex", args: original, capabilities: CAPS.webSearchOnly });

  // Then fencing splices around them rather than replacing them: the route's
  // flags still follow the subcommand, in order, and the prompt is still last.
  const exec = args.indexOf("exec");
  assert.ok(args.indexOf("--ephemeral") > exec);
  assert.equal(args[args.indexOf("--output-last-message") + 1], "/tmp/out.txt");
  assert.equal(args.at(-1), "the prompt");
});

test("an argv that already spells its own permissions is refused", () => {
  // Given #2361 landed an inline Codex sandbox in one route while this module
  // was being written, and for two days the repo had two sandboxing paths
  for (const spelled of [
    ["exec", "--sandbox", "read-only", "PROMPT"],
    ["exec", "-s", "workspace-write", "PROMPT"],
    ["--ask-for-approval", "never", "exec", "PROMPT"],
    ["--search", "exec", "PROMPT"],
    ["exec", "-c", "sandbox_mode=danger-full-access", "PROMPT"],
    // The equals form is not a hypothetical spelling: verified on codex-cli
    // 0.146.0 that `--sandbox=read-only` and `--ask-for-approval=never` are
    // accepted exactly as their space-separated forms are. A whole-token scan
    // waves these through and then fences an argv that already had a policy.
    ["exec", "--sandbox=read-only", "PROMPT"],
    ["exec", "-s=workspace-write", "PROMPT"],
    ["--ask-for-approval=never", "exec", "PROMPT"],
    // And the attached config forms, which put the key where a payload check
    // looking at the whole token would never find it. Both exit 0 on 0.146.0.
    ["exec", "--config=sandbox_mode=read-only", "PROMPT"],
    ["exec", "-csandbox_mode=read-only", "PROMPT"],
    ["exec", "-sdanger-full-access", "PROMPT"],
    ["exec", "--yolo", "PROMPT"],
    ["exec", "--approve-for-me", "PROMPT"],
    ["exec", "--not-so-yolo", "PROMPT"],
  ]) {
    // When such an argv reaches fencing
    // Then it is refused, so "there is exactly one Codex permission path" is a
    // failure the caller hits rather than a claim in a comment.
    assert.throws(
      () => fenceArgs({ cliId: "codex", args: spelled, capabilities: CAPS.localReadOnly }),
      /already spells/,
      `${spelled.join(" ")} must be refused`,
    );
  }
});

test("a policy key is caught through the spacing codex tolerates", () => {
  // Given codex TRIMS a config key before applying it, so the spaced spelling is
  // not a typo that fails safely — it is the same override. Confirmed on 0.146.0
  // by running an otherwise-fenced exec carrying `-c "sandbox_mode =
  // danger-full-access"` and watching the model's `echo hi > ./probe.txt`
  // succeed: the sandbox was off, and a startsWith("sandbox_mode=") guard had
  // waved the argv through.
  for (const spelled of [
    ["exec", "-c", "sandbox_mode = danger-full-access", "PROMPT"],
    ["exec", "-c", "  sandbox_mode=danger-full-access", "PROMPT"],
    ["exec", "-c", "sandbox_mode\t=\tdanger-full-access", "PROMPT"],
    ["exec", "-csandbox_mode = danger-full-access", "PROMPT"],
    ["exec", "--config=sandbox_mode = danger-full-access", "PROMPT"],
    // The dotted key is a prefix, and must survive the same treatment.
    ["exec", "-c", "sandbox_workspace_write.network_access = true", "PROMPT"],
    // And the other two policy axes, which are just as much permission.
    ["exec", "-c", "approval_policy = never", "PROMPT"],
    ["exec", "-c", "web_search = live", "PROMPT"],
  ]) {
    // When such an argv reaches fencing
    // Then it is refused: whitespace is not a second spelling the guard gets to
    // miss, because it is not a second meaning to codex.
    assert.throws(
      () => fenceArgs({ cliId: "codex", args: spelled, capabilities: CAPS.localReadOnly }),
      /already spells/,
      `${spelled.join(" ")} must be refused`,
    );
  }
});

test("a key that merely STARTS with a policy key is not mistaken for one", () => {
  // Given the comparison is now on the trimmed key, exact for scalar keys — a
  // prefix test would read a future `sandbox_mode_hint` as sandbox policy and
  // refuse an argv that sets nothing of the kind
  const { args } = fenceArgs({
    cliId: "codex",
    args: ["exec", "-c", "web_search_results = 5", "PROMPT"],
    capabilities: CAPS.localReadOnly,
  });

  // Then it passes through, and the run is still fenced by us.
  assert.ok(args.includes("web_search_results = 5"), "an unrelated key must survive");
  assert.equal(configValue(args, "sandbox_mode"), "read-only");
});

test("a config override that is not about permission passes through", () => {
  // Given `-c` carries every kind of codex setting, not only sandbox policy
  const { args } = fenceArgs({
    cliId: "codex",
    args: ["exec", "-cmodel=o3", "-c", "shell_environment_policy.inherit=all", "PROMPT"],
    capabilities: CAPS.localReadOnly,
  });

  // Then the guard discriminates on the KEY rather than refusing every `-c`: a
  // rule that banned config overrides outright would be enforced by callers
  // routing around it, which is how the second sandboxing path appeared.
  assert.ok(args.includes("-cmodel=o3"), "an unrelated config override must survive");
  assert.equal(configValue(args, "sandbox_mode"), "read-only");
});

test("every Codex permission config override spelling is refused", () => {
  for (const payload of [
    "sandbox_mode=danger-full-access",
    "sandbox_workspace_write.network_access=true",
    "approval_policy=never",
    "web_search=live",
    "features.web_search_request=true",
  ]) {
    for (const configArgs of [
      ["-c", payload],
      ["--config", payload],
      [`-c${payload}`],
      [`--config=${payload}`],
    ]) {
      const args = ["exec", ...configArgs, "PROMPT"];
      assert.throws(
        () => fenceArgs({ cliId: "codex", args, capabilities: CAPS.localReadOnly }),
        /already spells/,
        `${args.join(" ")} must be refused`,
      );
    }
  }
});

test("a prompt that merely mentions a permission flag is still fenceable", () => {
  // Given modes/discover.md and user queries are free text that may name a flag
  const { args } = fenceArgs({
    cliId: "codex",
    args: ["exec", "run with --sandbox read-only and --search"],
    capabilities: CAPS.localReadOnly,
  });

  // Then only the argv BEFORE the prompt is scanned — the prompt is data, and
  // refusing it would make an ordinary query un-runnable.
  assert.equal(args.at(-1), "run with --sandbox read-only and --search");
  assert.equal(configValue(args, "sandbox_mode"), "read-only");
});

test("an unrecognized codex argv shape throws instead of guessing", () => {
  // Given argvs this module cannot anchor to: no `exec` subcommand at all, and
  // one with nothing after it that could be the prompt
  for (const args of [["-p", "PROMPT"], ["--ephemeral", "exec"]]) {
    // When fencing is attempted
    // Then it fails loudly. Splicing flags into an unknown command line could
    // produce a run graded "full" while being unsandboxed — the exact dishonesty
    // fencingReport exists to prevent.
    assert.throws(
      () => fenceArgs({ cliId: "codex", args, capabilities: CAPS.localReadOnly }),
      /must contain an "exec" subcommand/,
      `${args.join(" ")} must be refused`,
    );
  }
});

test("claude is fenced by its own tool flags, so its argv passes through", () => {
  // Given claudeCliArgs already spelled --allowedTools/--disallowedTools
  const original = claudeArgv();
  const { args } = fenceArgs({ cliId: "claude", args: original, capabilities: CAPS.localReadOnly });

  // Then nothing is added — "unchanged" here means "already fenced", not
  // "unfenced" — and §55.6's assertions on that argv stay valid untouched.
  assert.deepEqual(args, original);
});

test("a CLI with no verified mechanism is passed through and reported honestly", () => {
  // Given the runtimes nobody has been able to verify a fencing mechanism for
  for (const cliId of ["gemini", "opencode", "copilot", "qwen", "antigravity", "grok"]) {
    const original = ["-p", "PROMPT"];
    const { args } = fenceArgs({ cliId, args: original, capabilities: CAPS.workspaceWrite });

    // Then their invocation is byte-identical to before this change — adding
    // this layer must not alter a runtime it cannot actually restrict...
    assert.deepEqual(args, original, `${cliId} argv must be untouched`);
    // ...and the run says so rather than looking fenced (#2507).
    const { level, notice } = fencingReport({ cliId, cliName: cliId, capabilities: CAPS.workspaceWrite });
    assert.equal(level, "none", `${cliId} has no verified mechanism and must not claim one`);
    assert.ok(isFencingNotice(notice), `${cliId} must produce a detectable notice`);
  }
});

test("every runtime and capability pair grades to a defined level", () => {
  // Given fencingReport replaced a boolean that nothing read. A boolean could not
  // describe the middle case at all: Codex has no read-only-plus-network policy,
  // so a worker that must fetch but is not asked to write receives a writable
  // workspace — fenced on one axis, not the other.
  const grades = [];
  for (const cliId of ["claude", "codex", "gemini", "made-up-cli"]) {
    for (const [name, caps] of Object.entries(CAPS)) {
      const { level, notice } = fencingReport({ cliId, cliName: cliId, capabilities: caps });

      // Then the level is one of the three, and a notice exists exactly when the
      // run is less fenced than the record declares.
      assert.ok(["full", "partial", "none"].includes(level), `${cliId}/${name} → ${level}`);
      assert.equal(notice === null, level === "full", `${cliId}/${name}: notice must accompany a non-full level`);
      if (notice) assert.ok(isFencingNotice(notice), `${cliId}/${name}: notice must be detectable by the UI`);
      grades.push(`${cliId}/${name}=${level}`);
    }
  }
  // And the middle case is genuinely reachable — a suite where nothing is ever
  // "partial" would pass while the level meant nothing.
  assert.ok(grades.includes("codex/networkReadOnly=partial"), `no partial case reached: ${grades.join(" ")}`);
  // While a searching worker is fully fenced: it reaches the web without the
  // sandbox being opened, so grading it "partial" would be the same dishonesty
  // pointed the other way — and would put a warning on AI search, which #2361
  // sandboxed properly.
  assert.ok(grades.includes("codex/webSearchOnly=full"), `search must grade full: ${grades.join(" ")}`);
});

test("a kind needing neither writes nor network gets a true read-only sandbox", () => {
  // Given the stronger claim the test below cannot make: for a worker that both
  // axes say needs nothing, read-only is the only correct answer, and any other
  // mode is a fence that does not fence.
  for (const kind of KNOWN_KINDS) {
    const caps = capabilitiesFor(kind);
    if (caps.writes || caps.network) continue;

    const { args } = fenceArgs({ cliId: "codex", args: codexArgv(), capabilities: caps });
    assert.equal(configValue(args, "sandbox_mode"), "read-only", `${kind} needs nothing yet is not read-only`);
  }
});

test("a non-writing kind gets a writable sandbox only when it needs the network", () => {
  // Given the whole point of the shared policy: one classification, honoured by
  // every CLI. This is the invariant that would have caught a duplicated,
  // drifted copy of the writing-kinds list.
  for (const kind of [...KNOWN_KINDS, "unknown-kind"]) {
    const caps = capabilitiesFor(kind);
    if (caps.writes) continue;

    const { args } = fenceArgs({ cliId: "codex", args: codexArgv(), capabilities: caps });
    const mode = configValue(args, "sandbox_mode");

    // Named for what it asserts. A non-writing worker may still land on
    // workspace-write, but ONLY as the price of network access — never because
    // the policy said it writes. (Its previous name claimed no read-only kind
    // ever gets a writable sandbox, which the `|| caps.network` arm contradicts;
    // the case above makes that stronger claim where it actually holds.)
    assert.ok(
      mode === "read-only" || caps.network,
      `${kind} does not write and does not fetch, yet received sandbox_mode=${mode}`,
    );
  }
});

test("a forbidden tool that is merely unmentioned is refused, not certified", () => {
  // Given --permission-mode acceptEdits auto-approves whatever nobody named, so a
  // deny list that omits a forbidden tool GRANTS it. Two real argvs used to pass:
  // one denying only Task (Write/Edit/Bash auto-approved), and all six advisor
  // routes, every one of which omitted MultiEdit.
  // When such an argv is presented
  // Then it is refused — this is the #2185 rule, applied to the fencing gate.
  assert.throws(
    () =>
      fenceArgs({
        cliId: "claude",
        args: ["-p", "PROMPT", "--strict-mcp-config", "--permission-mode", "acceptEdits", "--disallowedTools", "Task"],
        capabilities: CAPS.localReadOnly,
      }),
    /does not deny/,
  );
  assert.throws(
    () =>
      fenceArgs({
        cliId: "claude",
        // The pre-fix advisor deny list, verbatim: MultiEdit missing.
        args: ["-p", "PROMPT", "--strict-mcp-config", "--allowedTools", "Read", "--disallowedTools", "Bash,Write,Edit,NotebookEdit,Task,WebFetch,WebSearch"],
        capabilities: CAPS.localReadOnly,
      }),
    /does not deny MultiEdit/,
  );
  assert.throws(
    // No deny list at all — the flag is present so this exercises the tool rule
    // rather than the MCP one, which the case below covers on its own.
    () => fenceArgs({ cliId: "claude", args: ["-p", "PROMPT", "--strict-mcp-config"], capabilities: CAPS.localReadOnly }),
    /does not deny/,
  );
});

test("a claude argv that contradicts its declared capabilities is refused", () => {
  // Given six of the seven call sites hand-write their Claude argv next to a
  // hand-picked capability record, with nothing checking the two agree — so a
  // route could deny Bash to Claude while handing Codex a writable sandbox and
  // both halves would look right in isolation.
  // When the argv grants what the record forbids
  // Then fencing refuses, naming the offending tool.
  assert.throws(
    () =>
      fenceArgs({
        cliId: "claude",
        args: claudeArgv("Read,Write,Glob"), // grants Write, so the derived list cannot deny it
        capabilities: CAPS.localReadOnly, // writes: false
      }),
    /does not deny Write/,
  );

  assert.throws(
    () =>
      fenceArgs({
        cliId: "claude",
        args: claudeArgv("Read,WebFetch,Glob"), // grants WebFetch
        capabilities: CAPS.localReadOnly, // network: false
      }),
    /does not deny WebFetch/,
  );
});

test("a claude argv consistent with its capabilities passes verification", () => {
  // Given the two records that permit more than the strictest one
  // When each is paired with an argv that matches
  // Then verification is silent — it refuses contradictions, it does not demand
  // that every permitted tool be present — and it hands BACK the argv it was
  // given. Asserting only the report level would leave this passing if
  // verifyClaudeArgs began rewriting or dropping the caller's flags, which is
  // the one thing Claude's entry in FENCERS promises not to do.
  const netArgv = claudeArgv("Read,WebFetch,WebSearch,Glob,Grep");
  const net = fenceArgs({ cliId: "claude", args: netArgv, capabilities: CAPS.networkReadOnly });
  assert.deepEqual(net.args, netArgv, "a verified claude argv must pass through unchanged");
  assert.equal(fencingReport({ cliId: "claude", cliName: "Claude Code", capabilities: CAPS.networkReadOnly }).level, "full");

  const writeArgv = claudeArgv("Read,WebFetch,Write,Edit,Bash");
  const write = fenceArgs({ cliId: "claude", args: writeArgv, capabilities: CAPS.workspaceWrite });
  assert.deepEqual(write.args, writeArgv, "a verified claude argv must pass through unchanged");
  assert.equal(fencingReport({ cliId: "claude", cliName: "Claude Code", capabilities: CAPS.workspaceWrite }).level, "full");
});

test("each notice is detectable by the UI and names the runtime", () => {
  // Given the notice is emitted by API routes and detected by a client component,
  // a copied string literal would drift the first time the wording is edited — and
  // the failure would be silent: the warning simply stops rendering.
  const unfenced = fencingReport({ cliId: "gemini", cliName: "Gemini CLI", capabilities: CAPS.localReadOnly });
  const partial = fencingReport({ cliId: "codex", cliName: "Codex", capabilities: CAPS.networkReadOnly });

  // Then BOTH shapes are detectable — a predicate that knew only the first would
  // go stale the day the second was added, which is why it is not a bare marker.
  for (const [name, report] of [["unfenced", unfenced], ["partial", partial]]) {
    assert.ok(isFencingNotice(report.notice), `${name} notice must be detectable`);
  }
  assert.ok(unfenced.notice.includes("Gemini CLI"), "notice must name the runtime");
  assert.ok(partial.notice.includes("Codex"), "notice must name the runtime");
  // And a plain step label is not mistaken for one.
  assert.equal(isFencingNotice("Reading your CV & profile"), false);
  assert.equal(isFencingNotice(undefined), false);
});

test("fencingReport answers for the runtimes the routes actually ask about", () => {
  // Given the routes call it for every entry in clis.ts
  for (const cliId of ["gemini", "opencode", "copilot", "qwen", "antigravity", "grok"]) {
    // Then each unverified runtime reports honestly rather than defaulting to a
    // reassuring answer.
    assert.equal(fencingReport({ cliId, cliName: cliId, capabilities: CAPS.localReadOnly }).level, "none");
  }
  for (const cliId of ["claude", "codex"]) {
    assert.equal(fencingReport({ cliId, cliName: cliId, capabilities: CAPS.localReadOnly }).level, "full");
  }
});

test("a non-writing claude argv without --strict-mcp-config is refused", () => {
  // Given a deny list describes only NATIVE tools. Without --strict-mcp-config the
  // run also loads the user's own MCP servers, any of which may expose a write
  // tool — so a worker declared writes:false could still write while this module
  // certified the run as fenced. The native flags alone are not a complete
  // description of what the agent can reach.
  const scope = scopeFrom("Read,Glob,Grep");
  const args = ["-p", "PROMPT", "--allowedTools", scope.allowed, "--disallowedTools", scope.disallowed];

  // When such an argv is presented for a non-writing worker
  // Then it is refused, however complete its native deny list is.
  assert.throws(
    () => fenceArgs({ cliId: "claude", args, capabilities: CAPS.localReadOnly }),
    /--strict-mcp-config/,
  );

  // And a writing worker is unaffected: MCP grants it nothing its capability
  // record does not already allow, and locking it would silently break a user's
  // configured server on an evaluation.
  const writeScope = scopeFrom("Read,WebFetch,WebSearch,Write,Edit,Bash,Glob,Grep");
  const writeArgs = ["-p", "PROMPT", "--allowedTools", writeScope.allowed, "--disallowedTools", writeScope.disallowed];
  assert.doesNotThrow(() => fenceArgs({ cliId: "claude", args: writeArgs, capabilities: CAPS.workspaceWrite }));
});

test("a prototype-inherited cliId is not mistaken for a fencer", () => {
  // Given `FENCERS[cliId]` also resolves inherited Object.prototype members, so
  // "toString" or "constructor" yields a truthy function that would then be CALLED
  // as a fencer — returning a string or the argv untouched, either way silently
  // unfenced while reporting otherwise.
  for (const cliId of ["toString", "constructor", "valueOf", "__proto__"]) {
    const args = ["-p", "PROMPT"];
    const { args: out } = fenceArgs({ cliId, args, capabilities: CAPS.localReadOnly });

    // Then it is treated as an unknown runtime: argv untouched, and graded "none"
    // so both entry points agree on what membership in FENCERS means.
    assert.deepEqual(out, args, `${cliId} must not resolve to a fencer`);
    assert.equal(fencingReport({ cliId, cliName: cliId, capabilities: CAPS.localReadOnly }).level, "none");
  }
});
