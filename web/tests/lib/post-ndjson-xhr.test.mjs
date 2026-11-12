import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { postNdjsonXhr } from "../../src/lib/post-ndjson-xhr.mjs";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/lib/post-ndjson-xhr.mjs"), "utf8");

test("postNdjsonXhr is a function", () => {
  assert.equal(typeof postNdjsonXhr, "function");
});

test("Discover stream uses XMLHttpRequest, not fetch", () => {
  assert.match(src, /XMLHttpRequest/);
  assert.doesNotMatch(src, /\bfetch\s*\(/);
});

// A stand-in for the browser object: the test drives the same callbacks the
// browser would (progress, load, abort) and checks what the caller receives.
function withFakeXhr(run) {
  const real = globalThis.XMLHttpRequest;
  let last = null;
  globalThis.XMLHttpRequest = class {
    constructor() {
      last = this;
      this.responseText = "";
      this.status = 0;
      this.headers = {};
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(k, v) {
      this.headers[k] = v;
    }
    send(body) {
      this.body = body;
    }
  };
  return Promise.resolve(run(() => last)).finally(() => {
    globalThis.XMLHttpRequest = real;
  });
}

test("an aborted request rejects as AbortError, which Explore reads as interrupted", () =>
  withFakeXhr(async (xhr) => {
    const { isAbortError } = await import("../../src/lib/explore-error.mjs");
    const pending = postNdjsonXhr("/api/explore", { ats: ["greenhouse"] }, () => {});
    xhr().onabort();
    const err = await pending.then(
      () => null,
      (e) => e,
    );
    assert.ok(err, "an abort must not resolve as a finished scan");
    assert.equal(isAbortError(err), true);
  }));

test("a network failure is an error, not an interruption", () =>
  withFakeXhr(async (xhr) => {
    const { isAbortError } = await import("../../src/lib/explore-error.mjs");
    const pending = postNdjsonXhr("/api/explore", {}, () => {});
    xhr().onerror();
    const err = await pending.then(
      () => null,
      (e) => e,
    );
    assert.ok(err instanceof Error);
    assert.equal(isAbortError(err), false);
  }));

test("events arrive as the stream grows, including a line split across chunks", () =>
  withFakeXhr(async (xhr) => {
    const seen = [];
    const pending = postNdjsonXhr("/api/explore", { ats: ["lever"] }, (ev) => seen.push(ev));
    const x = xhr();
    assert.equal(x.method, "POST");
    assert.equal(x.body, JSON.stringify({ ats: ["lever"] }));

    x.responseText = '{"kind":"start"}\n{"kind":"off';
    x.onprogress();
    assert.deepEqual(seen, [{ kind: "start" }], "the half line waits for the rest");

    x.responseText += 'er","offer":{"url":"https://jobs.example/1"}}\n';
    x.onprogress();
    assert.equal(seen.length, 2);
    assert.equal(seen[1].offer.url, "https://jobs.example/1");

    x.responseText += '{"kind":"done","count":1,"offers":[]}';
    x.status = 200;
    x.onload();
    assert.deepEqual(await pending, { status: 200, errorBody: null });
    assert.equal(seen.at(-1).kind, "done", "a last line with no trailing newline is still delivered");
    assert.equal(seen.length, 3);
  }));

test("a failed response hands back its JSON body instead of scan events", () =>
  withFakeXhr(async (xhr) => {
    const seen = [];
    const pending = postNdjsonXhr("/api/explore", {}, (ev) => seen.push(ev));
    const x = xhr();
    x.responseText = '{"error":"The scanner isn\'t available.","code":"SCANNER_MISSING"}';
    x.status = 400;
    x.onprogress();
    x.onload();
    const { status, errorBody } = await pending;
    assert.equal(status, 400);
    assert.equal(errorBody.code, "SCANNER_MISSING");
    assert.deepEqual(seen, []);
  }));
