import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

const webSrc = fileURLToPath(new URL("../../src/", import.meta.url));
const loader = `
  import { existsSync } from "node:fs";
  import path from "node:path";
  import { pathToFileURL } from "node:url";
  export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(${JSON.stringify(webSrc)}, specifier.slice(2));
      for (const ext of [".ts", ".tsx", ".mjs", ".js", ""]) {
        if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, pathToFileURL(webSrc));

const { GET: getInbox, POST: postInbox } = await import("../../src/app/api/inbox/route.ts");

async function withTempRoot(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "career-ops-inbox-test-"));
  mkdirSync(path.join(root, "data"), { recursive: true });
  const inboxPath = path.join(root, "data", "agent-inbox.md");
  const prevRoot = process.env.CAREER_OPS_ROOT;
  const prevInbox = process.env.CAREER_OPS_INBOX;
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_INBOX = inboxPath;
  try {
    await fn({ root, inboxPath });
  } finally {
    if (prevRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prevRoot;
    if (prevInbox === undefined) delete process.env.CAREER_OPS_INBOX;
    else process.env.CAREER_OPS_INBOX = prevInbox;
    rmSync(root, { recursive: true, force: true });
  }
}

test("inbox GET returns empty list when file is missing", async () => {
  await withTempRoot(async () => {
    const res = await getInbox();
    const data = await res.json();
    assert.equal(data.exists, false);
    assert.deepEqual(data.items, []);
    assert.equal(data.pendingCount, 0);
    assert.equal(data.resolvedCount, 0);
  });
});

test("inbox POST add queues a new task with timestamp", async () => {
  await withTempRoot(async ({ inboxPath }) => {
    const req = new Request("http://fixture.invalid/api/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", request: "evaluate https://example.com/jobs/123" }),
    });
    const res = await postInbox(req);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].done, false);
    assert.match(data.items[0].request, /evaluate https:\/\/example.com\/jobs\/123/);

    const fileContent = readFileSync(inboxPath, "utf8");
    assert.match(fileContent, /- \[ \] \d{4}-\d{2}-\d{2}/);
  });
});

test("inbox POST toggle and resolve annotates item correctly", async () => {
  await withTempRoot(async () => {
    // Add item
    await postInbox(
      new Request("http://fixture.invalid/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", request: "draft follow-up for Acme" }),
      })
    );

    // Resolve with result
    const resolveReq = new Request("http://fixture.invalid/api/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resolve", id: 1, result: "Email sent to Sarah" }),
    });
    const res = await postInbox(resolveReq);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.items[0].done, true);
    assert.equal(data.items[0].result, "Email sent to Sarah");
  });
});

test("inbox POST delete removes specific item", async () => {
  await withTempRoot(async () => {
    await postInbox(
      new Request("http://fixture.invalid/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", request: "task 1" }),
      })
    );
    await postInbox(
      new Request("http://fixture.invalid/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", request: "task 2" }),
      })
    );

    const delRes = await postInbox(
      new Request("http://fixture.invalid/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: 1 }),
      })
    );
    const data = await delRes.json();
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].request, "task 2");
  });
});
