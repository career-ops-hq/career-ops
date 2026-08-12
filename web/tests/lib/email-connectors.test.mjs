import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONNECTOR_KINDS,
  CONNECTOR_CAPABILITIES,
  createConnectorRegistry,
  defineConnector,
  mockOAuthUrl,
  mockExchangeCode,
  isMockCredential,
  saveConnectorCredentials,
  readConnectorCredentials,
  deleteConnectorCredentials,
  gmailConnector,
  outlookConnector,
  imapConnectorShape,
  defaultEmailRegistry,
} from "../../src/lib/email-connectors.mjs";

function tmpRoot() {
  return mkdtempSync(join(tmpdir(), "career-ops-connectors-"));
}

test("CONNECTOR_KINDS stödjer oauth2 + imap (framtida IMAP-arkitektur)", () => {
  assert.deepEqual(CONNECTOR_KINDS, ["oauth2", "imap"]);
  assert.ok(CONNECTOR_CAPABILITIES.includes("list-email"));
  assert.ok(CONNECTOR_CAPABILITIES.includes("save-draft"));
  assert.ok(CONNECTOR_CAPABILITIES.includes("send-email"));
});

test("defineConnector validerar kind och okända fält", () => {
  assert.throws(() => defineConnector({ id: "x", kind: "pop3" }), /kind/);
  assert.throws(() => defineConnector({ id: "x", kind: "oauth2", okänd: true }), /okänd/);
  const c = defineConnector({ id: "x", name: "X", kind: "oauth2", capabilities: ["list-email"] });
  assert.equal(c.id, "x");
  assert.deepEqual(c.capabilities, ["list-email"]);
});

test("registry: register/get/list + dubbelregistrering kastar", () => {
  const reg = createConnectorRegistry();
  reg.register(defineConnector({ id: "a", name: "A", kind: "oauth2", capabilities: ["list-email"] }));
  reg.register(defineConnector({ id: "b", name: "B", kind: "imap", capabilities: ["list-email"] }));
  assert.equal(reg.list().length, 2);
  assert.equal(reg.get("a").name, "A");
  assert.throws(() => reg.register(defineConnector({ id: "a", name: "A2", kind: "oauth2" })), /redan registrerad/);
  assert.throws(() => reg.get("finns-inte"), /okänd connector/);
});

test("defaultEmailRegistry innehåller Gmail + Outlook", () => {
  const reg = defaultEmailRegistry();
  const ids = reg.list().map((c) => c.id).sort();
  assert.deepEqual(ids, ["gmail", "outlook"]);
  assert.equal(reg.get("gmail").kind, "oauth2");
  assert.equal(reg.get("outlook").kind, "oauth2");
});

test("gmail/outlook-connect: OAuth-mock-URL, aldrig lösenord", () => {
  const g = gmailConnector();
  const connect = g.connect();
  assert.equal(connect.status, "mock");
  assert.ok(connect.url.includes("oauth"), "mock OAuth-URL saknas");
  assert.ok(mockOAuthUrl("outlook").includes("outlook"));
});

test("mockExchangeCode → tydligt mock-markerade tokens, inga lösenord", () => {
  const cred = mockExchangeCode("gmail", "auth-code-123");
  assert.equal(cred.connectorId, "gmail");
  assert.ok(cred.accessToken.startsWith("mock_"));
  assert.ok(cred.refreshToken.startsWith("mock_"));
  assert.equal(cred.mock, true);
  assert.equal(isMockCredential(cred), true);
  assert.ok(!("password" in cred), "lösenord får aldrig lagras");
  assert.ok(!("clientSecret" in cred));
  assert.throws(() => mockExchangeCode("gmail", ""));
});

test("säker credential storage: 0600-fil, round-trip, mock-only, delete", async () => {
  const root = tmpRoot();
  try {
    const cred = mockExchangeCode("gmail", "code-1");
    const file = await saveConnectorCredentials(root, cred);
    assert.ok(existsSync(file), "credential-fil saknas");
    const mode = statSync(file).mode & 0o777;
    assert.equal(mode, 0o600, `förväntad 0600, fick ${mode.toString(8)}`);

    const read = await readConnectorCredentials(root, "gmail");
    assert.equal(read.connectorId, "gmail");
    assert.ok(isMockCredential(read));
    assert.equal(read.accessToken, cred.accessToken);

    // Icke-mock-kredentialer vägras i FAS 5.
    await assert.rejects(
      saveConnectorCredentials(root, { connectorId: "gmail", accessToken: "RIKTIG_TOKEN", mock: false }),
      /refusing to store non-mock/,
    );

    const del = await deleteConnectorCredentials(root, "gmail");
    assert.equal(del.connectorId, "gmail");
    assert.equal(await readConnectorCredentials(root, "gmail"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sendEmail är BLOCKERAD i FAS 5 för alla connectors", async () => {
  const g = gmailConnector();
  await assert.rejects(g.sendEmail({ to: "x@y.se", subject: "Hej" }), /BLOCKED/);
  const o = outlookConnector();
  await assert.rejects(o.sendEmail({ to: "x@y.se", subject: "Hej" }), /BLOCKED/);
});

test("saveDraft (mock) fungerar men skickar ingenting", async () => {
  const g = gmailConnector();
  const draft = await g.saveDraft({ id: "msg-1", subject: "Utkast" });
  assert.equal(draft.mock, true);
  assert.equal(draft.savedAs, "draft");
});

test("imapConnectorShape förbereder IMAP-stöd", () => {
  const shape = imapConnectorShape();
  assert.equal(shape.kind, "imap");
  assert.equal(shape.connect().status, "imap-not-configured");
  assert.ok(shape.capabilities.includes("list-email"));
});
