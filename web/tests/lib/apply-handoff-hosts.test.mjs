// Apply must not open a browser on a host the user listed in
// config/profile.yml → apply.handoff_hosts (sites behind their own login): it
// refuses the way it refuses Workday/iCIMS/UKG, so the existing panel offers the
// posting link and the CV path and answers instead.
//
// Run (from web/): node --experimental-strip-types --test tests/lib/apply-handoff-hosts.test.mjs

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { handoffHostsFrom, matchHandoffHost, readHandoffHosts } from "../../src/lib/apply/handoff-hosts.mjs";
import { unsupportedAtsMessage, unsupportedInAppAts, unsupportedSessionJson } from "../../src/lib/apply/unsupported-ats.mjs";

test("handoffHostsFrom reads apply.handoff_hosts and normalizes entries", () => {
  const text = 'apply:\n  handoff_hosts: [" Gupy.io ", ".linkedin.com", "https://apply.workable.com/x", 42, "", "localhost", "a b.com"]\n';
  assert.deepEqual(handoffHostsFrom(text), ["gupy.io", "linkedin.com", "apply.workable.com"]);
});

test("handoffHostsFrom is empty for an absent or malformed setting", () => {
  assert.deepEqual(handoffHostsFrom(null), []);
  assert.deepEqual(handoffHostsFrom("candidate:\n  full_name: A\n"), []);
  assert.deepEqual(handoffHostsFrom("apply:\n  handoff_hosts: gupy.io\n"), []);
  assert.deepEqual(handoffHostsFrom("apply: true\n"), []);
});

test("a profile that is not valid YAML throws instead of switching handoff off", () => {
  assert.throws(() => handoffHostsFrom('apply:\n  handoff_hosts: ["gupy.io"\n'));
});

test("a configured host written with a trailing dot still matches", () => {
  const hosts = handoffHostsFrom('apply:\n  handoff_hosts: ["gupy.io.", "LinkedIn.com..", "https://apply.workable.com./x"]\n');
  assert.deepEqual(hosts, ["gupy.io", "linkedin.com", "apply.workable.com"]);
  assert.equal(matchHandoffHost("https://gupy.io/jobs/1", hosts), "gupy.io");
  assert.equal(matchHandoffHost("https://acme.gupy.io/jobs/1", hosts), "gupy.io");
  assert.equal(matchHandoffHost("https://acme.gupy.io./jobs/1", hosts), "gupy.io");
  assert.equal(matchHandoffHost("https://www.linkedin.com/jobs/view/1", hosts), "linkedin.com");
});

test("a host matches itself and its subdomains, nothing else", () => {
  const hosts = ["gupy.io", "linkedin.com"];
  assert.equal(matchHandoffHost("https://gupy.io/x", hosts), "gupy.io");
  assert.equal(matchHandoffHost("https://acme.gupy.io/jobs/1?x=1", hosts), "gupy.io");
  assert.equal(matchHandoffHost("https://www.LinkedIn.com/jobs/view/1", hosts), "linkedin.com");
  assert.equal(matchHandoffHost("https://notgupy.io/x", hosts), null);
  assert.equal(matchHandoffHost("https://gupy.io.evil.example/x", hosts), null);
  assert.equal(matchHandoffHost("not a url", hosts), null);
  assert.equal(matchHandoffHost("https://acme.gupy.io/", []), null);
});

test("readHandoffHosts reads the profile from the data root", () => {
  const root = mkdtempSync(join(tmpdir(), "handoff-hosts-"));
  try {
    mkdirSync(join(root, "config"));
    writeFileSync(join(root, "config", "profile.yml"), 'apply:\n  handoff_hosts: ["gupy.io"]\n');
    assert.deepEqual(readHandoffHosts({ CAREER_OPS_ROOT: root }), ["gupy.io"]);
    assert.deepEqual(readHandoffHosts({ CAREER_OPS_ROOT: join(root, "missing") }), [], "a missing profile states no hosts");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an empty or comment-only profile states no hosts (js-yaml 5 throws on it)", () => {
  assert.deepEqual(handoffHostsFrom("# only comments\n# here\n"), []);
  assert.deepEqual(handoffHostsFrom("\n   \n\t\n"), []);
  assert.deepEqual(handoffHostsFrom("  # indented comment\r\n"), []);
  assert.deepEqual(handoffHostsFrom(""), []);
  const root = mkdtempSync(join(tmpdir(), "handoff-hosts-"));
  try {
    mkdirSync(join(root, "config"));
    writeFileSync(join(root, "config", "profile.yml"), "# apply:\n#   handoff_hosts: [\"gupy.io\"]\n");
    assert.deepEqual(readHandoffHosts({ CAREER_OPS_ROOT: root }), [], "Apply reads no list instead of failing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readHandoffHosts surfaces a broken or unreadable profile with its path", () => {
  const root = mkdtempSync(join(tmpdir(), "handoff-hosts-"));
  try {
    mkdirSync(join(root, "config"));
    const file = join(root, "config", "profile.yml");
    writeFileSync(file, 'apply:\n  handoff_hosts: ["gupy.io"\n');
    assert.throws(() => readHandoffHosts({ CAREER_OPS_ROOT: root }), (err) => err instanceof Error && err.message.startsWith(`${file}: `));
    rmSync(file);
    mkdirSync(file); // reading a directory fails with EISDIR, not ENOENT
    assert.throws(() => readHandoffHosts({ CAREER_OPS_ROOT: root }), (err) => err instanceof Error && err.message.startsWith(`${file}: `));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Apply refuses a handoff host before any browser opens", async () => {
  const hit = await unsupportedInAppAts("https://acme.gupy.io/jobs/123", { handoffHosts: ["gupy.io"] });
  assert.deepEqual(hit, { vendor: "handoff", label: "gupy.io", postingUrl: "https://acme.gupy.io/jobs/123" });
  const body = unsupportedSessionJson(hit, "42");
  assert.equal(body.unsupported, true);
  assert.equal(body.postingUrl, "https://acme.gupy.io/jobs/123");
  assert.match(body.message, /apply\.handoff_hosts/);
  assert.match(body.message, /no browser was opened/);
  assert.ok(body.checklistHref, "the CV path and answers stay one click away");
  assert.match(unsupportedAtsMessage(hit, true), /The window was closed\./);
});

test("unlisted hosts and the built-in refusals are unchanged", async () => {
  assert.equal(await unsupportedInAppAts("https://jobs.lever.co/acme/1", { handoffHosts: ["gupy.io"] }), null);
  assert.equal(await unsupportedInAppAts("https://acme.gupy.io/jobs/1", { handoffHosts: [] }), null);
  const workday = await unsupportedInAppAts("https://acme.wd5.myworkdayjobs.com/en-US/careers/job/X_R1", { handoffHosts: ["myworkdayjobs.com"] });
  assert.equal(workday?.vendor, "workday", "a built-in vendor keeps its own refusal");
  assert.equal(unsupportedAtsMessage("Workday"), unsupportedAtsMessage(workday));
});
