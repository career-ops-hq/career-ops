import { afterEach, describe, expect, test } from "bun:test";
import { htmlFetch } from "../src/helpers";

// A stalled upstream connection (accepted socket, no response) would otherwise
// hang the CLI forever - fetch has no default timeout. Assert the request
// wrapper carries an AbortSignal timeout. Fails on the pre-fix code (no signal).
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("htmlFetch request timeout", () => {
  test("passes an AbortSignal timeout to fetch", async () => {
    let init: RequestInit | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, i?: RequestInit) => {
      init = i;
      return new Response("<html></html>", { status: 200 });
    }) as unknown as typeof fetch;

    await htmlFetch("https://www.linkedin.com/jobs-guest/jobs/api/x");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
