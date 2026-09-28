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

const { GET: getOffers, POST: postOffers } = await import("../../src/app/api/offers/route.ts");

async function withTempRoot(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "career-ops-offers-test-"));
  mkdirSync(path.join(root, "data"), { recursive: true });
  mkdirSync(path.join(root, "config"), { recursive: true });
  const prev = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  try {
    await fn({ root, obsPath: path.join(root, "data", "salary-observations.tsv") });
  } finally {
    if (prev === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prev;
    rmSync(root, { recursive: true, force: true });
  }
}

test("offers GET parses empty state and target defaults", async () => {
  await withTempRoot(async () => {
    const res = await getOffers();
    const data = await res.json();
    assert.deepEqual(data.offers, []);
    assert.deepEqual(data.observations, []);
    assert.ok(data.targetComp);
  });
});

test("offers POST record appends observation to TSV", async () => {
  await withTempRoot(async ({ obsPath }) => {
    const req = new Request("http://fixture.invalid/api/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "record",
        company: "Stripe",
        role: "Staff Engineer",
        baseComp: "$210k",
        bonus: "15%",
        equity: "$60k/yr",
        signing: "$25k",
        notes: "Recruiter phone call",
      }),
    });
    const res = await postOffers(req);
    const data = await res.json();
    assert.equal(data.success, true);

    const content = readFileSync(obsPath, "utf8");
    assert.match(content, /Stripe\tStaff Engineer/);
    assert.match(content, /Base: \$210k/);
  });
});

test("offers POST delete removes observation", async () => {
  await withTempRoot(async () => {
    // Record two observations
    await postOffers(
      new Request("http://fixture.invalid/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "record",
          company: "Company A",
          role: "Role A",
          baseComp: "$150k",
        }),
      })
    );
    await postOffers(
      new Request("http://fixture.invalid/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "record",
          company: "Company B",
          role: "Role B",
          baseComp: "$180k",
        }),
      })
    );

    // Verify GET reads 2
    let res = await getOffers();
    let data = await res.json();
    assert.equal(data.observations.length, 2);

    // Delete item 1 with content
    const delRes = await postOffers(
      new Request("http://fixture.invalid/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", content: data.observations[0].content }),
      })
    );
    assert.equal((await delRes.json()).success, true);

    // Verify only 1 remains
    res = await getOffers();
    data = await res.json();
    assert.equal(data.observations.length, 1);
    assert.equal(data.observations[0].company, "Company B");
  });
});

test("offers POST record with newline and tab in note sanitizes input without corrupting row boundaries", async () => {
  await withTempRoot(async () => {
    await postOffers(
      new Request("http://fixture.invalid/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "record",
          company: "Acme Corp",
          role: "Staff Engineer",
          baseComp: "$200k",
          notes: "Line 1\nLine 2\twith tab\r\nLine 3",
        }),
      })
    );

    const res = await getOffers();
    const data = await res.json();
    assert.equal(data.observations.length, 1);
    assert.equal(data.observations[0].company, "Acme Corp");
    assert.ok(!data.observations[0].notes.includes("\n"));
    assert.ok(!data.observations[0].notes.includes("\t"));
  });
});

test("offers POST delete protects against expected content mismatch and requires expected for id-based delete", async () => {
  await withTempRoot(async () => {
    await postOffers(
      new Request("http://fixture.invalid/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "record",
          company: "Target Corp",
          role: "Engineer",
          baseComp: "$150k",
        }),
      })
    );

    let res = await getOffers();
    let data = await res.json();
    assert.equal(data.observations.length, 1);
    const rowContent = data.observations[0].content;

    // ID delete without expected value should return 400
    const noExpectedRes = await postOffers(
      new Request("http://fixture.invalid/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          id: 1,
        }),
      })
    );
    assert.equal(noExpectedRes.status, 400);

    // Partial/substring expected value should return 409 (must match entire row)
    const partialRes = await postOffers(
      new Request("http://fixture.invalid/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          id: 1,
          expected: "Target Corp",
        }),
      })
    );
    assert.equal(partialRes.status, 409);

    // Mismatched expected value should return 409 and not delete
    const mismatchRes = await postOffers(
      new Request("http://fixture.invalid/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          id: 1,
          expected: "Different Corp\tEngineer\tBase: $150k",
        }),
      })
    );
    assert.equal(mismatchRes.status, 409);

    res = await getOffers();
    data = await res.json();
    assert.equal(data.observations.length, 1);

    // Exact matching expected value should succeed
    const matchRes = await postOffers(
      new Request("http://fixture.invalid/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          id: 1,
          expected: rowContent,
        }),
      })
    );
    assert.equal(matchRes.status, 200);

    res = await getOffers();
    data = await res.json();
    assert.equal(data.observations.length, 0);
  });
});
