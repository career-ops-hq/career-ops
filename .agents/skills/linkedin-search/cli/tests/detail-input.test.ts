import { afterEach, describe, expect, test } from "bun:test";
import { runDetail } from "../src/commands/detail";
import { DETAIL_URL } from "../src/helpers";
import { runCLI } from "./helpers";

// The real command path, not the parser in isolation: `detail` must never
// send a request for a URL that is not a LinkedIn job view. Before the host
// check, a Greenhouse apply link pasted from a posting was reduced to its
// 7-digit path segment and the handler fetched LinkedIn posting 4567890 -
// an unrelated job, printed with exit 0. fetch is stubbed throughout; no
// test here touches the network.

const originalFetch = globalThis.fetch;
const originalStderrWrite = process.stderr.write;

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stderr.write = originalStderrWrite;
});

function recordingFetch(): string[] {
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    requested.push(String(input));
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  return requested;
}

function captureStderr(): string[] {
  const out: string[] = [];
  process.stderr.write = ((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  return out;
}

describe("detail input on the real handler path", () => {
  test("a foreign job-board URL is rejected with BAD_ID before any request", async () => {
    const requested = recordingFetch();
    const stderr = captureStderr();

    const rc = await runDetail({ id: "https://boards.greenhouse.io/acme/jobs/4567890", format: "json" });

    expect(rc).toBe(1);
    expect(requested).toEqual([]);
    expect(JSON.parse(stderr.join("").trim())).toMatchObject({ code: "BAD_ID" });
  });

  test("a LinkedIn job URL builds the fetch URL from the extracted id", async () => {
    const requested = recordingFetch();
    captureStderr();

    const rc = await runDetail({
      id: "https://dk.linkedin.com/jobs/view/data-scientist-9876543210/?trackingId=x",
      format: "json",
    });

    expect(rc).toBe(1); // the stub answers 404 -> NOT_FOUND, after the request was made
    expect(requested).toEqual([`${DETAIL_URL}/9876543210`]);
  });
});

describe("detail input through the CLI", () => {
  test("exits 1 with the stderr-JSON BAD_ID contract for a foreign URL", async () => {
    const result = await runCLI(["detail", "https://jobs.lever.co/acme/1234567"]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ code: "BAD_ID" });
  });
});
