import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import {
  loadPortalsDocument,
  mergePortalFilters,
  patchPortalFiltersText,
  PortalsConfigError,
  watchedCompanies,
} from "../../src/lib/portals-config.mjs";

const TEMPLATE = fileURLToPath(new URL("../../../templates/portals.example.yml", import.meta.url));

const fixtureDirs = [];

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "career-ops-portals-"));
  fixtureDirs.push(dir);
  const file = path.join(dir, "portals.yml");
  const template = path.join(dir, "portals.example.yml");
  writeFileSync(template, "title_filter:\n  positive: [Template Role]\nsources:\n  acme: true\n", "utf8");
  return { file, template };
}

after(() => {
  for (const dir of fixtureDirs) rmSync(dir, { recursive: true, force: true });
});

test("a missing user config seeds from the shipped template", () => {
  const { file, template } = fixture();
  const result = loadPortalsDocument(file, template);

  assert.equal(result.seeded, true);
  assert.deepEqual(result.doc.title_filter, { positive: ["Template Role"] });
  assert.deepEqual(result.doc.sources, { acme: true });
});

test("malformed user YAML is rejected instead of replaced with the template", () => {
  const { file, template } = fixture();
  const malformed = "tracked_companies: [Acme\ntitle_filter: custom";
  writeFileSync(file, malformed, "utf8");

  assert.throws(
    () => loadPortalsDocument(file, template),
    (error) => error instanceof PortalsConfigError && error.kind === "invalid-user-config",
  );
  assert.equal(readFileSync(file, "utf8"), malformed);
});

test("a scalar user document is rejected as an invalid mapping", () => {
  const { file, template } = fixture();
  writeFileSync(file, "just-a-string\n", "utf8");

  assert.throws(
    () => loadPortalsDocument(file, template),
    (error) => error instanceof PortalsConfigError && error.kind === "invalid-user-config",
  );
});

test("a YAML timestamp scalar is rejected as an invalid mapping", () => {
  const { file, template } = fixture();
  writeFileSync(file, "2024-01-01\n", "utf8");

  assert.throws(
    () => loadPortalsDocument(file, template),
    (error) => error instanceof PortalsConfigError && error.kind === "invalid-user-config",
  );
});

test("valid custom blocks survive the web-owned filter update", () => {
  const original = {
    tracked_companies: [{ name: "Acme", careers_url: "https://example.com/jobs" }],
    title_filter: { positive: ["Old Role"], negative: ["Intern"] },
    location_filter: { allow: ["Old City"], remote: true },
    sources: { custom: { enabled: true } },
  };

  const merged = mergePortalFilters(original, ["ML Engineer", "AI Engineer"], ["Cairo", "Remote"]);

  assert.deepEqual(merged.title_filter, {
    positive: ["ML Engineer", "AI Engineer"],
    negative: ["Intern"],
  });
  assert.deepEqual(merged.location_filter, { allow: ["Cairo", "Remote"], remote: true });
  assert.deepEqual(merged.tracked_companies, original.tracked_companies);
  assert.deepEqual(merged.sources, original.sources);
  assert.deepEqual(original.title_filter.positive, ["Old Role"], "input must not be mutated");
});

test("an invalid seed template is an installation error, not a user conflict", () => {
  const { file, template } = fixture();
  writeFileSync(template, "title_filter: [broken\n", "utf8");

  assert.throws(
    () => loadPortalsDocument(file, template),
    (error) => error instanceof PortalsConfigError && error.kind === "invalid-template",
  );
});

test("watchedCompanies lists scanned companies first, then paused ones, with the careers host", () => {
  const doc = {
    tracked_companies: [
      { name: "Globex", careers_url: "https://jobs.example.test/globex", enabled: false },
      { name: "Acme AI", careers_url: "https://careers.acme.example/jobs" },
      { name: "Initech", api: "https://boards-api.example.test/initech" },
      { careers_url: "https://nameless.example" },
      "not a company",
    ],
  };
  assert.deepEqual(watchedCompanies(doc), [
    { name: "Acme AI", enabled: true, host: "careers.acme.example" },
    { name: "Initech", enabled: true, host: "boards-api.example.test" },
    { name: "Globex", enabled: false, host: "jobs.example.test" },
  ]);
  assert.deepEqual(watchedCompanies({ title_filter: {} }), []);
});

// /api/portals used to write yaml.dump(doc), which drops every comment and
// every commented-out "# - name:" company block a user enables by uncommenting.
const commentLines = (text) => text.split("\n").filter((l) => l.trim().startsWith("#"));
const expectPatched = (source, roles, locations) => {
  const text = patchPortalFiltersText(source, roles, locations);
  assert.ok(text, "the text edit should apply");
  assert.deepEqual(yaml.load(text), mergePortalFilters(yaml.load(source), roles, locations));
  return text;
};

test("the shipped template keeps every comment and commented-out company when roles are set", () => {
  const source = readFileSync(TEMPLATE, "utf8");
  const text = expectPatched(source, ["Data Engineer", "Analytics: Lead"], undefined);
  assert.deepEqual(commentLines(text), commentLines(source));
  assert.ok(commentLines(source).some((l) => /^\s*#\s*- name:/.test(l)), "fixture has commented-out companies");
});

test("adding a location allow-list to the template keeps its commented example block", () => {
  const source = readFileSync(TEMPLATE, "utf8");
  const text = expectPatched(source, ["Data Engineer"], ["United States", "Remote"]);
  assert.deepEqual(commentLines(text), commentLines(source));
});

test("an existing allow list is replaced and the other location tiers stay", () => {
  const source = [
    "# my notes",
    "title_filter:",
    "  positive:",
    "    - \"Old\"  # was here",
    "    # - \"Maybe later\"",
    "  negative: [Intern]",
    "location_filter:",
    "  block: [Moon]",
    "  allow:",
    "    - Berlin",
    "    - Paris",
    "  # trailing note",
    "tracked_companies:",
    "  # - name: Paused Co",
    "  - name: Acme",
    "",
  ].join("\n");
  const text = expectPatched(source, ["New"], ["Lisbon"]);
  assert.deepEqual(commentLines(text), commentLines(source));
  // A note after the last item (a commented-out suggestion) stays after the new items.
  assert.match(text, /  positive:\n    - "New"\n    # - "Maybe later"\n  negative: \[Intern\]/);
  assert.match(text, /  allow:\n    - "Lisbon"\n  # trailing note\n/);
});

test("flow-style and same-indent lists are rewritten in place", () => {
  expectPatched("title_filter:\n  positive: [A, B]  # inline\n  negative: []\n", ["C"], undefined);
  const sameIndent = expectPatched("title_filter:\n  positive:\n  - A\n  - B\n  negative:\n  - X\n", ["C"], undefined);
  assert.match(sameIndent, /  positive:\n  - "C"\n  negative:/);
});

test("missing sections and keys are added", () => {
  expectPatched("# only a note\ntracked_companies:\n  - name: Acme\n", ["A"], ["Berlin"]);
  expectPatched("title_filter:\n  negative:\n    - Junior\n", ["A"], undefined);
});

test("CRLF line endings are kept", () => {
  const text = expectPatched("title_filter:\r\n  positive:\r\n    - A\r\n# note\r\nother: 1\r\n", ["B"], undefined);
  assert.ok(!/[^\r]\n/.test(text), "every line ends with CRLF");
});

test("shapes the line edit cannot place return null so the route falls back", () => {
  assert.equal(patchPortalFiltersText("title_filter: { positive: [A] }\n", ["B"], undefined), null);
  assert.equal(patchPortalFiltersText("title_filter:\n  positive: A\n", ["B"], undefined), null);
});
