// Tests for chats.mjs — conversation persistence shape + model-context logic.
// Imports directly from the module (single source of truth) so test and
// production code can never drift.
//
// Run:  node --test tests/lib/chats.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_ID_RE, MAX_MESSAGES, newChatId, sanitizeChat, deriveTitle, chatSummary,
  buildConversationContext, stripSessionMarkers,
} from "../../src/lib/chats.mjs";

test("newChatId is filesystem-safe, unique and time-sortable", () => {
  const a = newChatId(1_700_000_000_000);
  const b = newChatId(1_700_000_000_001);
  assert.match(a, CHAT_ID_RE);
  assert.match(b, CHAT_ID_RE);
  assert.notEqual(a, b);
  assert.ok(a < b, "later timestamp sorts later");
  const ids = new Set(Array.from({ length: 200 }, () => newChatId(1_700_000_000_000)));
  assert.equal(ids.size, 200, "same-millisecond ids must not collide");
});

test("sanitizeChat migrates the legacy {role, content} shape and drops pending confirms", () => {
  const chat = sanitizeChat({
    id: "c123456abc",
    messages: [
      { role: "assistant", content: "Hi there" },
      { role: "user", parts: [{ type: "text", text: "Help me set up" }, { type: "confirm", cid: "x", summary: "Save?", state: "pending" }] },
      { role: "assistant", parts: [{ type: "confirm", cid: "y", summary: "Saved profile", state: "done" }, { type: "card", jobId: "j1" }] },
      { role: "user", parts: [] }, // nothing usable → dropped
      "junk",
    ],
  });
  assert.ok(chat);
  assert.equal(chat.messages.length, 3);
  assert.deepEqual(chat.messages[0], { role: "assistant", parts: [{ type: "text", text: "Hi there" }] });
  assert.deepEqual(chat.messages[1].parts, [{ type: "text", text: "Help me set up" }], "pending confirm is transient UI");
  assert.equal(chat.messages[2].parts[0].state, "done");
  assert.equal(chat.title, "Help me set up", "title derives from the first user line");
  assert.equal(chat.claudeSessionId, null);
});

test("sanitizeChat rejects a bad id and caps runaway conversations", () => {
  assert.equal(sanitizeChat({ id: "../etc/passwd", messages: [] }), null);
  assert.equal(sanitizeChat({ id: "UPPER", messages: [] }), null);
  assert.equal(sanitizeChat(null), null);
  const many = Array.from({ length: MAX_MESSAGES + 50 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
  const chat = sanitizeChat({ id: "c123456abc", messages: many });
  assert.equal(chat.messages.length, MAX_MESSAGES);
  assert.equal(chat.messages.at(-1).parts[0].text, `m${MAX_MESSAGES + 49}`, "keeps the NEWEST messages");
});

test("sanitizeChat keeps a well-formed Claude session id and drops a malformed one", () => {
  assert.equal(sanitizeChat({ id: "c123456abc", messages: [], claudeSessionId: "5c1c0d5e-9a8b-4c1d-8e2f-123456789abc" }).claudeSessionId, "5c1c0d5e-9a8b-4c1d-8e2f-123456789abc");
  assert.equal(sanitizeChat({ id: "c123456abc", messages: [], claudeSessionId: "bad id with spaces" }).claudeSessionId, null);
});

test("deriveTitle shortens a long first question and has a fallback", () => {
  assert.equal(deriveTitle([]), "New conversation");
  assert.equal(deriveTitle([{ role: "assistant", parts: [{ type: "text", text: "Hi" }] }]), "New conversation");
  const long = "Can you walk me through what my exit narrative should be for a move from consulting into product?";
  const t = deriveTitle([{ role: "user", parts: [{ type: "text", text: long }] }]);
  assert.ok(t.length <= 48 && t.endsWith("…"), t);
});

test("chatSummary counts user turns only and carries no messages", () => {
  const s = chatSummary({ id: "c123456abc", title: "T", createdAt: 1, updatedAt: 2, cliId: "claude", messages: [
    { role: "assistant", parts: [] }, { role: "user", parts: [] }, { role: "assistant", parts: [] }, { role: "user", parts: [] },
  ] });
  assert.deepEqual(s, { id: "c123456abc", title: "T", createdAt: 1, updatedAt: 2, cliId: "claude", count: 2 });
  assert.equal("messages" in s, false);
});

test("buildConversationContext keeps the last N verbatim and digests older USER turns", () => {
  const h = [];
  for (let i = 1; i <= 20; i++) {
    h.push({ role: "user", content: `question ${i} about something long enough to be abbreviated `.padEnd(220, "x") });
    h.push({ role: "assistant", content: `answer ${i}` });
  }
  const { digest, convo, droppedTurns } = buildConversationContext(h, { verbatim: 6, digestMax: 20, digestChars: 40 });
  // last 6 messages verbatim: q18 a18 q19 a19 q20 a20
  assert.ok(convo.includes("question 18") && convo.includes("answer 20"));
  assert.ok(!convo.includes("question 17"));
  // older user turns digested, abbreviated, oldest first
  assert.ok(digest.startsWith("Earlier in this conversation"));
  const lines = digest.trim().split("\n").slice(1);
  assert.equal(lines.length, 17, "17 older user turns (q1..q17)");
  assert.ok(lines[0].startsWith("- question 1 "));
  for (const l of lines) assert.ok(l.length <= 2 + 40, `abbreviated: ${l.length}`);
  assert.ok(!digest.includes("answer 1 "), "assistant turns are not digested");
  assert.equal(droppedTurns, 34);
});

test("buildConversationContext with a short history has no digest", () => {
  const { digest, convo } = buildConversationContext([{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }]);
  assert.equal(digest, "");
  assert.equal(convo, "User: hi\nAssistant: hello");
});

test("stripSessionMarkers removes the marker and returns the id", () => {
  const { text, sessionId } = stripSessionMarkers("Sure —<<session:5c1c0d5e-9a8b-4c1d-8e2f-123456789abc>> here you go.");
  assert.equal(text, "Sure — here you go.");
  assert.equal(sessionId, "5c1c0d5e-9a8b-4c1d-8e2f-123456789abc");
  assert.deepEqual(stripSessionMarkers("plain"), { text: "plain", sessionId: null });
});
