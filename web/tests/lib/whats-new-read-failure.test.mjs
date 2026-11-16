// A broken scan history must not read as "no new matches".
//
// /api/whats-new used one bare catch for every read failure:
//
//   try { rows = fs.readFileSync(...scan-history.tsv...) }
//   catch { return Response.json({ offers: [], count: 0 }) }
//
// ENOENT is the only failure that legitimately means an empty result — a user
// who has never scanned has no history. Every other failure means the file is
// BROKEN, and answering 200 with an empty payload made that indistinguishable
// from a quiet week. The home hero then settles both loops and can say "You're
// all caught up" off a file it could not open, which is the exact overclaim
// lib/home/hero-state.mjs exists to prevent, arriving one layer lower.
//
// Driven for real rather than asserted from the source: the handler is
// importable under the @/ loader, so the two cases can be distinguished by
// their actual status codes. Each runs in its own child because the loader
// registers process-wide and CAREER_OPS_ROOT is read at module load.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WEB = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
// A file:// URL, not a bare path. `--import` takes a module SPECIFIER, and on
// Windows an absolute path begins with a drive letter — Node reads `D:` as a
// URL scheme and throws ERR_UNSUPPORTED_ESM_URL_SCHEME. POSIX happens to
// tolerate the path form, so the bug is invisible until CI runs on Windows.
// web-ts-alias-loader.test.mjs already does this; I did not copy it.
const LOADER = pathToFileURL(join(WEB, "tests", "helpers", "web-ts-alias-loader.mjs")).href;

const DRIVER = `
const { GET } = await import("@/app/api/whats-new/route.ts");
const res = await GET(new Request("http://localhost/api/whats-new"));
console.log(JSON.stringify({ status: res.status, body: await res.json() }));
`;

const roots = [];
function makeRoot(prepare) {
  const dir = mkdtempSync(join(tmpdir(), "co-whatsnew-"));
  roots.push(dir);
  mkdirSync(join(dir, "data"), { recursive: true });
  prepare?.(dir);
  return dir;
}

/** The handler's answer, from a child with the alias loader registered.
 *  `env` is laid over the sandbox's blanked overrides. */
function callRoute(root, env = {}) {
  const driver = join(root, "driver.mjs");
  writeFileSync(driver, DRIVER);
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--import", LOADER, driver],
    {
      cwd: WEB,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
      env: {
        ...process.env,
        CAREER_OPS_ROOT: root,
        // Would each pull a read back out of the sandbox and make the result
        // depend on the developer's own files.
        CAREER_OPS_DATA_DIR: "",
        CAREER_OPS_TRACKER: "",
        ...env,
      },
    },
  );
  // The loader prints deprecation notices to stderr; the payload is the last
  // stdout line, so a future warning cannot break the parse.
  const line = out.trim().split("\n").filter(Boolean).at(-1);
  return JSON.parse(line);
}

test("no history at all is an empty week, not an error", () => {
  // The legitimate empty: nothing has ever been scanned. This is the case the
  // original bare catch was written for, and it must keep working — turning it
  // into an error would put a red panel in front of every new user.
  const res = callRoute(makeRoot());
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { offers: [], count: 0 });
});

test("a scan history that cannot be read is reported, not emptied", () => {
  // A directory where the file should be: readFileSync throws EISDIR, which is
  // the file being broken rather than absent. Chosen over chmod 000 because it
  // reproduces as a non-root user and on every platform the suite runs on.
  const res = callRoute(makeRoot((dir) => mkdirSync(join(dir, "data", "scan-history.tsv"))));

  assert.notEqual(res.status, 200, "a failed read must not answer 200 — that is what made it look like an empty week");
  assert.equal(res.status, 500);
  // The message has to name the cause: "something went wrong" would leave the
  // user with a broken file and no way to find out which or why.
  assert.match(res.body.error ?? "", /scan history could not be read/i);
  assert.match(res.body.error ?? "", /EISDIR/);
  // The shape stays intact so a client that renders the payload regardless
  // cannot crash on a missing array.
  assert.deepEqual(res.body.offers, []);
  assert.equal(res.body.count, 0);
});

test("the dashboard rejects the failure response", () => {
  // The fix is only worth anything if the caller acts on it. today-dashboard's
  // refetch() throws on !r.ok, so a 500 sets freshError, and hero-state then
  // refuses all-clear. Asserted here because the status code is the contract
  // between the two halves: a route that reported the failure as 200 with an
  // `error` key would satisfy the test above and change nothing upstream.
  const res = callRoute(makeRoot((dir) => mkdirSync(join(dir, "data", "scan-history.tsv"))));
  const ok = res.status >= 200 && res.status < 300;
  assert.equal(ok, false, "r.ok must be false, or refetch() treats a broken file as fresh data");
});

// collectWhatsNew skips line 1 as the header, so a history without one is
// never walked and every case below would pass on an empty week.
const HISTORY_HEADER = "url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n";

test("a linked report that cannot be read is reported, not read as URL-unknown", () => {
  // The report's `**URL:**` decides whether a second posting with the same
  // company and title is shown (#5684). A report that exists but cannot be
  // read is broken, not absent: treating it as "URL unknown" falls back to
  // company + role and hides that posting with no signal. Same EISDIR setup
  // as the history test above.
  const today = new Date().toISOString().slice(0, 10);
  const res = callRoute(makeRoot((dir) => {
    mkdirSync(join(dir, "reports", "001-acme-2026-10-01.md"), { recursive: true });
    writeFileSync(join(dir, "data", "applications.md"), [
      "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
      "|---|---|---|---|---|---|---|---|---|",
      "| 1 | 2026-10-01 | Acme | Staff Engineer | 4.1/5 | Evaluated | | [1](../reports/001-acme-2026-10-01.md) | |",
    ].join("\n"));
    writeFileSync(
      join(dir, "data", "scan-history.tsv"),
      `${HISTORY_HEADER}https://boards.greenhouse.io/acme/jobs/2002\t${today}\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote\n`,
    );
  }));

  assert.equal(res.status, 500);
  assert.match(res.body.error ?? "", /001-acme-2026-10-01\.md could not be read/);
  assert.match(res.body.error ?? "", /EISDIR/);
  assert.deepEqual(res.body.offers, []);
  assert.equal(res.body.count, 0);
});

test("a linked report whose path cannot be resolved is reported, not read as URL-unknown", (t) => {
  // The containment check resolves the link first, and that step must not
  // swallow a failure the read itself would report: a symlink loop (ELOOP)
  // there is as broken as EISDIR above. ELOOP rather than EACCES on the
  // reports dir, because it reproduces as root too.
  const today = new Date().toISOString().slice(0, 10);
  let linked = true;
  const root = makeRoot((dir) => {
    mkdirSync(join(dir, "reports"), { recursive: true });
    try {
      symlinkSync("001-acme-2026-10-01.md", join(dir, "reports", "001-acme-2026-10-01.md"));
    } catch {
      linked = false;
    }
    writeFileSync(join(dir, "data", "applications.md"), [
      "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
      "|---|---|---|---|---|---|---|---|---|",
      "| 1 | 2026-10-01 | Acme | Staff Engineer | 4.1/5 | Evaluated | | [1](../reports/001-acme-2026-10-01.md) | |",
    ].join("\n"));
    writeFileSync(
      join(dir, "data", "scan-history.tsv"),
      `${HISTORY_HEADER}https://boards.greenhouse.io/acme/jobs/2002\t${today}\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote\n`,
    );
  });
  // Windows without symlink privilege cannot build the fixture.
  if (!linked) return t.skip("symlinks unavailable");
  const res = callRoute(root);

  assert.equal(res.status, 500);
  assert.match(res.body.error ?? "", /001-acme-2026-10-01\.md could not be read/);
  assert.match(res.body.error ?? "", /ELOOP/);
  assert.deepEqual(res.body.offers, []);
  assert.equal(res.body.count, 0);
});

test("a linked report that does not exist still reads as URL-unknown", () => {
  // A missing report is "no URL to go on", not a broken one: the link does not
  // resolve, the row falls back to company + role, the scan row is hidden, and
  // the answer is an empty 200.
  const today = new Date().toISOString().slice(0, 10);
  const res = callRoute(makeRoot((dir) => {
    mkdirSync(join(dir, "reports"), { recursive: true });
    writeFileSync(join(dir, "data", "applications.md"), [
      "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
      "|---|---|---|---|---|---|---|---|---|",
      "| 1 | 2026-10-01 | Acme | Staff Engineer | 4.1/5 | Evaluated | | [1](../reports/001-acme-2026-10-01.md) | |",
    ].join("\n"));
    writeFileSync(
      join(dir, "data", "scan-history.tsv"),
      `${HISTORY_HEADER}https://boards.greenhouse.io/acme/jobs/2002\t${today}\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote\n`,
    );
  }));

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { offers: [], count: 0 });
});

test("a Report cell with two links names no posting, so company + role decides", () => {
  // Which link is the evaluated report is ambiguous, and the core's repair
  // (fix-report-links.mjs) leaves such a cell for manual review. Reading the
  // first link would take 001's URL, call the scan row (002's posting) a
  // second opening, and show a role that was already evaluated.
  const today = new Date().toISOString().slice(0, 10);
  const res = callRoute(makeRoot((dir) => {
    mkdirSync(join(dir, "reports"), { recursive: true });
    writeFileSync(join(dir, "reports", "001-a.md"), "# Acme\n\n**URL:** https://boards.greenhouse.io/acme/jobs/1001\n");
    writeFileSync(join(dir, "reports", "002-b.md"), "# Acme\n\n**URL:** https://boards.greenhouse.io/acme/jobs/2002\n");
    writeFileSync(join(dir, "data", "applications.md"), [
      "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
      "|---|---|---|---|---|---|---|---|---|",
      "| 1 | 2026-10-01 | Acme | Staff Engineer | 4.1/5 | Evaluated | | [1](../reports/001-a.md), [2](../reports/002-b.md) | |",
    ].join("\n"));
    writeFileSync(
      join(dir, "data", "scan-history.tsv"),
      `${HISTORY_HEADER}https://boards.greenhouse.io/acme/jobs/2002\t${today}\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote\n`,
    );
  }));

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { offers: [], count: 0 });
});

// The report links below are relative to the tracker's own folder, as the
// core reads them (tracker-utils.mjs findDeadReportLink, #760). Each report
// names a different posting than the scan row with the same title, so the row
// is shown only when the report is found; a report the web missed reads as
// "URL unknown", and company + role then hides the row.
const ACME_REPORT = "# Acme\n\n**URL:** https://boards.greenhouse.io/acme/jobs/1001\n";

function acmeTracker(link) {
  return [
    "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
    "|---|---|---|---|---|---|---|---|---|",
    `| 1 | 2026-10-01 | Acme | Staff Engineer | 4.1/5 | Evaluated | | [1](${link}) | |`,
  ].join("\n");
}

function writeAcmeHistory(dir) {
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(
    join(dir, "data", "scan-history.tsv"),
    `${HISTORY_HEADER}https://boards.greenhouse.io/acme/jobs/2002\t${today}\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote\n`,
  );
}

test("a CAREER_OPS_TRACKER tracker's report links resolve from its own folder", () => {
  const root = makeRoot((dir) => {
    mkdirSync(join(dir, "custom", "reports"), { recursive: true });
    writeFileSync(join(dir, "custom", "reports", "001-acme.md"), ACME_REPORT);
    writeFileSync(join(dir, "custom", "applications.md"), acmeTracker("reports/001-acme.md"));
    writeAcmeHistory(dir);
  });
  const res = callRoute(root, { CAREER_OPS_TRACKER: join(root, "custom", "applications.md") });

  assert.equal(res.status, 200);
  assert.equal(res.body.count, 1);
  assert.equal(res.body.offers[0].url, "https://boards.greenhouse.io/acme/jobs/2002");
});

test("a root-level tracker's report links resolve from the root", () => {
  const res = callRoute(makeRoot((dir) => {
    mkdirSync(join(dir, "reports"), { recursive: true });
    writeFileSync(join(dir, "reports", "001-acme.md"), ACME_REPORT);
    writeFileSync(join(dir, "applications.md"), acmeTracker("reports/001-acme.md"));
    writeAcmeHistory(dir);
  }));

  assert.equal(res.status, 200);
  assert.equal(res.body.count, 1);
});

test("a symlinked tracker's report links still resolve from the link's folder", (t) => {
  // data/applications.md linked into a private repo while reports/ stays in
  // the checkout (#5374): `../reports/` exists only beside the link, not
  // beside its target, so the target's folder alone would miss it.
  let linked = true;
  const root = makeRoot((dir) => {
    mkdirSync(join(dir, "reports"), { recursive: true });
    mkdirSync(join(dir, "private", "t"), { recursive: true });
    writeFileSync(join(dir, "reports", "001-acme.md"), ACME_REPORT);
    writeFileSync(join(dir, "private", "t", "applications.md"), acmeTracker("../reports/001-acme.md"));
    try {
      symlinkSync(join(dir, "private", "t", "applications.md"), join(dir, "data", "applications.md"));
    } catch (e) {
      if (e?.code !== "EPERM" || e?.syscall !== "symlink") throw e;
      linked = false;
    }
    writeAcmeHistory(dir);
  });
  if (!linked) {
    t.skip("no symlink privilege (EPERM)");
    return;
  }
  const res = callRoute(root);

  assert.equal(res.status, 200);
  assert.equal(res.body.count, 1);
});

test("an aggregator posting is told apart by its posting id, from the core", () => {
  // The route loads the aggregator rule from the core checkout (lib/core/
  // aggregator-id). uk. and www. are one Indeed board, so two different `jk`
  // ids there are two postings; by host alone the row would stay hidden.
  const today = new Date().toISOString().slice(0, 10);
  const res = callRoute(makeRoot((dir) => {
    mkdirSync(join(dir, "reports"), { recursive: true });
    writeFileSync(join(dir, "reports", "001-acme.md"), "# Acme\n\n**URL:** https://uk.indeed.com/viewjob?jk=a\n");
    writeFileSync(join(dir, "data", "applications.md"), acmeTracker("../reports/001-acme.md"));
    writeFileSync(
      join(dir, "data", "scan-history.tsv"),
      `${HISTORY_HEADER}https://www.indeed.com/viewjob?jk=b\t${today}\tindeed\tStaff Engineer\tAcme\tadded\tRemote\n`,
    );
  }));

  assert.equal(res.status, 200);
  assert.equal(res.body.count, 1);
  assert.equal(res.body.offers[0].url, "https://www.indeed.com/viewjob?jk=b");
});

process.on("exit", () => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});
