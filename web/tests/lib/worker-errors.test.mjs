import test from "node:test";
import assert from "node:assert/strict";
import { isWorkerAuthError } from "../../src/lib/worker-errors.mjs";

const job = (text, label = "Error") => ({ status: "error", text, steps: [{ label }] });

test("missing CV envelope is not classified as an authentication failure", () => {
  assert.equal(isWorkerAuthError(job("The agent emitted no <<cv-html>> envelope.")), false);
});
test("generic authentication and credential words in content do not trigger sign-in", () => {
  assert.equal(isWorkerAuthError(job("Resume covers authentication, credential handling, and API key rotation.")), false);
  assert.equal(isWorkerAuthError(job("Is the CLI installed and authenticated?")), false);
});
test("genuine Codex authentication failures trigger sign-in", () => {
  assert.equal(isWorkerAuthError(job("Authentication required. Please run codex login.")), true);
  assert.equal(isWorkerAuthError(job("Unauthorized: invalid API key")), true);
});
test("genuine Claude authentication failures still trigger sign-in", () => {
  assert.equal(isWorkerAuthError(job("Invalid API key. Please run /login.")), true);
});
