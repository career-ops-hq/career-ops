// Tests for the Apply session SSRF guard. POST /api/apply/session used to
// Playwright-open whatever http(s) URL the client sent; this pins the shared
// liveness-browser.mjs guard (rejectPrivateOrInvalid + validateUrlSecurity)
// in front of that, including redirect hops. No real browser, no network.
//
// Run:  node --test tests/lib/apply-url-guard.test.mjs

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  blockedApplyUrlResponse,
  assertSafeApplyUrl,
  installApplyEgressGuard,
  UnsafeApplyUrlError,
  APPLY_URL_BLOCKED_MESSAGE,
  APPLY_URL_REQUIRED_MESSAGE,
} from "../../src/lib/apply/url-guard.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const { setHostResolver } = await import(pathToFileURL(join(ROOT, "liveness-browser.mjs")).href);

const PUBLIC_JOB = "https://boards.greenhouse.io/example/jobs/123";

function assertNoLeak(payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  assert.doesNotMatch(text, /127\.0\.0\.1|10\.0\.0\.5|169\.254|blocked host|Egress guard|\/etc\/passwd/i);
}

test("blockedApplyUrlResponse: rejects localhost with a generic 4xx", async () => {
  // Given a loopback apply URL (literal host, no DNS)
  const url = "http://127.0.0.1/admin";

  // When the session route classifies it
  const blocked = await blockedApplyUrlResponse(url);

  // Then Playwright is never reached: 400, no internal details
  assert.equal(blocked?.status, 400);
  assert.equal(blocked?.error, APPLY_URL_BLOCKED_MESSAGE);
  assertNoLeak(blocked);
});

test("blockedApplyUrlResponse: rejects RFC1918", async () => {
  const blocked = await blockedApplyUrlResponse("http://10.0.0.5/internal");
  assert.equal(blocked?.status, 400);
  assert.equal(blocked?.error, APPLY_URL_BLOCKED_MESSAGE);
  assertNoLeak(blocked);
});

test("blockedApplyUrlResponse: rejects IPv6 ULA fd00::/8", async () => {
  const blocked = await blockedApplyUrlResponse("http://[fd00::1]/");
  assert.equal(blocked?.status, 400);
  assert.equal(blocked?.error, APPLY_URL_BLOCKED_MESSAGE);
  assertNoLeak(blocked);
});

test("blockedApplyUrlResponse: rejects IPv6 link-local outside fe80:", async () => {
  const blocked = await blockedApplyUrlResponse("http://[fe90::1]/");
  assert.equal(blocked?.status, 400);
  assert.equal(blocked?.error, APPLY_URL_BLOCKED_MESSAGE);
  assertNoLeak(blocked);
});

test("blockedApplyUrlResponse: rejects cloud metadata host", async () => {
  const blocked = await blockedApplyUrlResponse("http://169.254.169.254/latest/meta-data/");
  assert.equal(blocked?.status, 400);
  assert.equal(blocked?.error, APPLY_URL_BLOCKED_MESSAGE);
  assertNoLeak(blocked);
});

test("blockedApplyUrlResponse: rejects file: protocol", async () => {
  const blocked = await blockedApplyUrlResponse("file:///etc/passwd");
  assert.equal(blocked?.status, 400);
  assert.equal(blocked?.error, APPLY_URL_REQUIRED_MESSAGE);
  assertNoLeak(blocked);
});

test("blockedApplyUrlResponse: allows a normal https job URL", async () => {
  // Given a public ATS posting (literal host is not private)
  const blocked = await blockedApplyUrlResponse(PUBLIC_JOB);

  // Then the session opener is allowed to proceed
  assert.equal(blocked, null);
});

test("assertSafeApplyUrl: throws UnsafeApplyUrlError on loopback without launching Playwright", async () => {
  await assert.rejects(() => assertSafeApplyUrl("http://localhost/"), UnsafeApplyUrlError);
});

async function runGuard(requestUrl, { resolver } = {}) {
  const restore = resolver ? setHostResolver(resolver) : null;
  try {
    let pattern = null;
    let handler = null;
    const context = {
      async route(p, cb) {
        pattern = p;
        handler = cb;
      },
    };
    await installApplyEgressGuard(context);
    let verdict = null;
    await handler({
      request: () => ({ url: () => requestUrl }),
      abort: async (code) => { verdict = { action: "abort", code }; },
      continue: async () => { verdict = { action: "continue" }; },
    });
    return { pattern, verdict };
  } finally {
    restore?.();
  }
}

describe("DNS + redirect layer (serial: shared hostResolver seam)", { concurrency: 1 }, () => {
  test("assertSafeApplyUrl: allows a public host when DNS is public (mocked)", async () => {
    const restore = setHostResolver(async () => ["93.184.216.34"]);
    try {
      await assertSafeApplyUrl(PUBLIC_JOB);
    } finally {
      restore();
    }
  });

  test("assertSafeApplyUrl: a public hostname that resolves to loopback is refused", async () => {
    const restore = setHostResolver(async (hostname) => (
      hostname === "ssrf-blocked-host.local" ? ["127.0.0.1"] : ["93.184.216.34"]
    ));
    try {
      await assert.rejects(
        () => assertSafeApplyUrl("http://ssrf-blocked-host.local/sensitive-internal"),
        (err) => {
          assert.equal(err instanceof UnsafeApplyUrlError, true);
          assert.equal(err.message, APPLY_URL_BLOCKED_MESSAGE);
          assertNoLeak(err.message);
          return true;
        },
      );
    } finally {
      restore();
    }
  });

  test("installApplyEgressGuard: registers a context-wide route", async () => {
    const { pattern } = await runGuard(PUBLIC_JOB, { resolver: async () => ["93.184.216.34"] });
    assert.equal(pattern, "**/*");
  });

  test("installApplyEgressGuard: allows a legitimate public request (mocked DNS)", async () => {
    const { verdict } = await runGuard(PUBLIC_JOB, { resolver: async () => ["93.184.216.34"] });
    assert.deepEqual(verdict, { action: "continue" });
  });

  test("installApplyEgressGuard: blocks a redirect hop to a literal private IP", async () => {
    const { verdict } = await runGuard("http://10.0.0.5/internal", { resolver: async () => ["93.184.216.34"] });
    assert.deepEqual(verdict, { action: "abort", code: "blockedbyclient" });
  });

  test("installApplyEgressGuard: blocks a hostname that resolves to loopback", async () => {
    const { verdict } = await runGuard("http://ssrf-blocked-host.local/sensitive-internal", {
      resolver: async (hostname) => (hostname === "ssrf-blocked-host.local" ? ["127.0.0.1"] : ["93.184.216.34"]),
    });
    assert.deepEqual(verdict, { action: "abort", code: "blockedbyclient" });
  });

  test("assertSafeApplyUrl: a public hostname that resolves to fd00::1 is refused", async () => {
    const restore = setHostResolver(async (hostname) => (
      hostname === "ssrf-blocked-host.local" ? ["fd00::1"] : ["93.184.216.34"]
    ));
    try {
      await assert.rejects(
        () => assertSafeApplyUrl("http://ssrf-blocked-host.local/apply"),
        UnsafeApplyUrlError,
      );
    } finally {
      restore();
    }
  });

  test("assertSafeApplyUrl: a public hostname that resolves to fe90::1 is refused", async () => {
    const restore = setHostResolver(async (hostname) => (
      hostname === "ssrf-blocked-host.local" ? ["fe90::1"] : ["93.184.216.34"]
    ));
    try {
      await assert.rejects(
        () => assertSafeApplyUrl("http://ssrf-blocked-host.local/apply"),
        UnsafeApplyUrlError,
      );
    } finally {
      restore();
    }
  });

  test("installApplyEgressGuard: blocks a hostname that resolves to fd00::1", async () => {
    const { verdict } = await runGuard("http://ssrf-blocked-host.local/apply", {
      resolver: async (hostname) => (hostname === "ssrf-blocked-host.local" ? ["fd00::1"] : ["93.184.216.34"]),
    });
    assert.deepEqual(verdict, { action: "abort", code: "blockedbyclient" });
  });

  test("installApplyEgressGuard: blocks a hostname that resolves to fe90::1", async () => {
    const { verdict } = await runGuard("http://ssrf-blocked-host.local/apply", {
      resolver: async (hostname) => (hostname === "ssrf-blocked-host.local" ? ["fe90::1"] : ["93.184.216.34"]),
    });
    assert.deepEqual(verdict, { action: "abort", code: "blockedbyclient" });
  });

  test("installApplyEgressGuard: blocks file: on a redirect hop", async () => {
    const { verdict } = await runGuard("file:///etc/passwd", { resolver: async () => ["93.184.216.34"] });
    assert.deepEqual(verdict, { action: "abort", code: "blockedbyclient" });
  });
});
