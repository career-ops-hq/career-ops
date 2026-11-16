import assert from "node:assert/strict";
import { test } from "node:test";
import { cvOutputReader } from "../../src/lib/cv/ingest-output.mjs";
import { parseCvStream, cvStreamErrorMessage } from "../../src/lib/cv/quality.ts";

const proposal = 'Reading your CV…\n<<cv:start>>\n# CV -- Alex Example\n\n## Skills\n- Python\n<<cv:end>>\n';

test("Codex's echoed prompt on stderr cannot trigger the example unreadable marker", () => {
  let text = "";
  const output = cvOutputReader({ cliId: "codex", onText: chunk => { text += chunk; } });
  output.stderr(Buffer.from('Codex\nuser\nIf unreadable, emit <<cv:error>>{"reason":"unreadable"}.\nSOURCE: private contact details\n'));
  assert.equal(text, "");
  assert.equal(parseCvStream(text).error, null);
  output.stdout(Buffer.from(proposal));
  assert.equal(output.finish(0), null);
  assert.equal(text, proposal);
  assert.equal(parseCvStream(text).error, null);
  assert.match(parseCvStream(text).markdown, /Alex Example/);
  assert.ok(!text.includes("private contact details"));
});

test("split UTF-8 stdout is preserved for Codex and Claude", () => {
  for (const cliId of ["codex", "claude"]) {
    let text = "";
    const output = cvOutputReader({ cliId, onText: chunk => { text += chunk; } });
    const content = proposal.replace("Python", "Français · Deutsch");
    const bytes = Buffer.from(cliId === "claude" ? JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { text: content } } }) : content);
    for (const byte of bytes) output.stdout(Buffer.from([byte]));
    assert.equal(output.finish(0), null);
    assert.equal(text, content);
  }
});

test("real CLI failures and empty output are distinguished from unreadable PDFs", () => {
  const output = cvOutputReader({ cliId: "codex", onText: () => {} });
  output.stderr(Buffer.from("Error: authentication required"));
  assert.equal(output.finish(1), "cli-failed");
  assert.equal(cvOutputReader({ cliId: "codex", onText: () => {} }).finish(0), "no-output");
  assert.match(cvStreamErrorMessage("cli-failed"), /CLI.*Config/);
  assert.doesNotMatch(cvStreamErrorMessage("cli-failed"), /scanned|unreadable/);
  assert.match(cvStreamErrorMessage("unreadable"), /scanned/);
});
