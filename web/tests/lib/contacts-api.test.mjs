import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
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

const { GET: getContacts, POST: postContacts } = await import("../../src/app/api/contacts/route.ts");

async function withTempRoot(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "career-ops-contacts-test-"));
  mkdirSync(path.join(root, "data"), { recursive: true });
  const prev = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  try {
    await fn({ root, contactsPath: path.join(root, "data", "contacts.tsv") });
  } finally {
    if (prev === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prev;
    rmSync(root, { recursive: true, force: true });
  }
}

test("contacts POST defaults omitted status to identified", async () => {
  await withTempRoot(async ({ contactsPath }) => {
    const req = new Request("http://fixture.invalid/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Jane Doe",
        company: "Acme Corp",
      }),
    });
    const res = await postContacts(req);
    assert.equal(res.status, 200);

    const content = readFileSync(contactsPath, "utf8");
    assert.match(content, /Jane Doe\tAcme Corp\t\tdirect\t\t\t\tidentified/);

    const getRes = await getContacts();
    const data = await getRes.json();
    assert.equal(data.contacts.length, 1);
    assert.equal(data.contacts[0].status, "identified");
  });
});

test("contacts POST accepts valid statuses and rejects invalid status with 400", async () => {
  await withTempRoot(async () => {
    for (const validStatus of ["identified", "contacted", "replied", "referral"]) {
      const req = new Request("http://fixture.invalid/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `User ${validStatus}`,
          company: "Acme Corp",
          status: validStatus,
        }),
      });
      const res = await postContacts(req);
      assert.equal(res.status, 200);
    }

    const invalidReq = new Request("http://fixture.invalid/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Invalid User",
        company: "Acme Corp",
        status: "pending",
      }),
    });
    const invalidRes = await postContacts(invalidReq);
    assert.equal(invalidRes.status, 400);
    const data = await invalidRes.json();
    assert.match(data.error, /Invalid status/);
  });
});
