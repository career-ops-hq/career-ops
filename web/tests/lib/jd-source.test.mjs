// Tests for jd-source.mjs + jd-archive.mjs — the identity a pasted or uploaded
// job description gets, and the file it becomes.
//
// isJdRef is the load-bearing one. Its result decides two things with real
// consequences: whether a string is joined onto a filesystem path on the server
// (/api/run's prepareEvaluate, /api/jd), and whether it bypasses normalizeJobUrl
// (cleanPipelineOffers, startEvaluate). A permissive isJdRef is therefore both a
// path-traversal primitive and a hole in the URL validation the rest of the app
// leans on, so the refusals below are the point of this file.
//
// Run:  node --test tests/lib/jd-source.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { JD_REF_PREFIX, MIN_JD_CHARS, MAX_JD_CHARS, isJdRef, jdRefPath, slug, validateJdText } from "../../src/lib/jd-source.mjs";
import { jdFilename, jdMarkdown } from "../../src/lib/jd-archive.mjs";

const REAL = "local:jds/acme-ai-engineer-1a2b3c4d5e.md";

test("isJdRef: accepts a reference of the shape jdFilename actually produces", () => {
  // Given the reference /api/jd hands back for a JD saved with a company + role
  const ref = `${JD_REF_PREFIX}${jdFilename({ company: "Acme Corp", role: "Senior AI Engineer", text: "x".repeat(500) })}`;

  // Then the validator that gates every consumer accepts it, and resolves it to
  // a path under jds/ — the two halves have to agree or a JD saves and then
  // cannot be read back
  assert.equal(isJdRef(ref), true);
  assert.match(jdRefPath(ref), /^jds\/acme-corp-senior-ai-engineer-[0-9a-f]{10}\.md$/);
});

test("isJdRef: refuses every shape that could escape the jds/ directory", () => {
  // Given references crafted to walk out of jds/, reach a sibling directory, or
  // smuggle a separator past the prefix check
  const escapes = [
    "local:jds/../cv.md",
    "local:jds/../../etc/passwd",
    "local:jds/..%2Fcv.md",
    "local:jds/sub/dir.md",
    "local:jds//etc/passwd.md",
    "local:jds/.env.md",
    "local:jds/",
    "local:jds/no-extension",
    "local:jds/wrong.txt",
    "local:jds/UPPER.md",
    "local:jds/has space.md",
    "local:jds/semi;colon.md",
  ];

  // Then none of them is a reference, so each falls through to the URL path and
  // is refused there with an ordinary error instead of being joined onto a path
  for (const s of escapes) assert.equal(isJdRef(s), false, s);
});

test("isJdRef: refuses anything that is not a local:jds/ string at all", () => {
  // Given the other values that reach this function in the wild
  for (const s of ["https://boards.greenhouse.io/acme/jobs/1", "jds/x.md", "local:reports/1.md", "", null, undefined, 42, {}]) {
    // Then it says no without throwing — callers use the result as a plain
    // branch condition and none of them null-check first
    assert.equal(isJdRef(s), false, String(s));
  }
});

test("jdRefPath: returns '' for a non-reference rather than a half-built path", () => {
  // Given a string that is not a reference
  // Then the path is empty, so a caller that skipped isJdRef builds
  // path.join(root, "") — the root itself, an existsSync miss — rather than
  // path.join(root, "jds/../../etc/passwd")
  assert.equal(jdRefPath("https://example.com/jobs/1"), "");
  assert.equal(jdRefPath("local:jds/../cv.md"), "");
  assert.equal(jdRefPath(REAL), "jds/acme-ai-engineer-1a2b3c4d5e.md");
});

test("slug: strips to a filename-safe stem and never ends in a hyphen", () => {
  assert.equal(slug("Acme Corp."), "acme-corp");
  assert.equal(slug("  Señor Engineer!  "), "se-or-engineer");
  assert.equal(slug(""), "");
  assert.equal(slug("日本語"), ""); // nothing sluggable → caller substitutes
  // Truncation must not leave a trailing hyphen, which would produce
  // "company--hash" and fail nothing but read as a bug.
  assert.equal(slug("aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii", 20).endsWith("-"), false);
});

test("jdFilename: same JD text always resolves to the same file", () => {
  // Given the same posting pasted twice, the second time with the company typo
  // fixed and a role added
  const text = "We are hiring a Staff Engineer. ".repeat(30);
  const first = jdFilename({ company: "Acme Crop", role: "", text });
  const second = jdFilename({ company: "Acme Corp", role: "Staff Engineer", text });

  // Then the HASH is identical, because the label the user typed is not part of
  // the posting's identity — this is what keeps a corrected typo from producing
  // a second archived file and a second pipeline row for one posting
  assert.equal(first.slice(-13), second.slice(-13));
  // and a genuinely different posting does not collide with either
  assert.notEqual(jdFilename({ company: "Acme Corp", text: `${text}x` }).slice(-13), first.slice(-13));
});

test("jdFilename: a JD with no company or role still gets a usable name", () => {
  // Given a bare paste with nothing typed alongside it
  const name = jdFilename({ text: "y".repeat(400) });

  // Then the name is still a valid reference rather than a bare hash or a
  // leading-hyphen filename
  assert.match(name, /^pasted-[0-9a-f]{10}\.md$/);
  assert.equal(isJdRef(`${JD_REF_PREFIX}${name}`), true);
});

test("jdMarkdown: keeps the JD verbatim under the heading the prompt looks for", () => {
  // Given a JD with its own markdown-ish structure and surrounding whitespace
  const text = "\n\n## Requirements\n\n- 5 years of Python\n- Kubernetes\n\n";
  const md = jdMarkdown({ company: "Acme", role: "SRE", source: "upload: jd.pdf", savedAt: "2026-09-03", text });

  // Then the provenance header is above the posting and the posting itself is
  // unmodified below the heading the evaluate prompt tells the agent to look for
  const [header, body] = md.split("## Job description\n\n");
  assert.match(header, /^# SRE at Acme\n/);
  assert.match(header, /\*\*Source:\*\* upload: jd\.pdf/);
  assert.match(header, /\*\*Saved:\*\* 2026-09-03/);
  assert.equal(body, "## Requirements\n\n- 5 years of Python\n- Kubernetes\n");
});

test("jdMarkdown: records missing company and role explicitly, never blank", () => {
  // Given a JD saved with no label at all
  const md = jdMarkdown({ savedAt: "2026-09-03", text: "z".repeat(300) });

  // Then the header says so in words. A blank value after "**Company:**" reads
  // as a broken write; "(not given)" reads as a fact about the archive.
  assert.match(md, /\*\*Company:\*\* \(not given\)/);
  assert.match(md, /\*\*Role:\*\* \(not given\)/);
  assert.match(md, /^# Job description\n/);
});

test("validateJdText: refuses a paste too short to be a posting", () => {
  // Given a mis-paste: the job TITLE rather than the description
  const r = validateJdText("Senior AI Engineer");

  // Then it is refused with the character count, because the failure mode it
  // prevents is silent — a two-line JD still produces a confident A-F report
  assert.equal(r.ok, false);
  assert.match(r.error, /18 characters/);
  assert.doesNotMatch(r.error, /—/); // AGENTS.md house rule: no em dashes
});

test("validateJdText: accepts a real posting and hands back the trimmed text", () => {
  const text = `  ${"We are hiring. ".repeat(30)}  `;
  const r = validateJdText(text);
  assert.equal(r.ok, true);
  assert.equal(r.text, text.trim());
  assert.ok(r.text.length >= MIN_JD_CHARS);
});

test("validateJdText: refuses an empty paste and an oversized one", () => {
  assert.equal(validateJdText("").ok, false);
  assert.equal(validateJdText("   ").ok, false);
  assert.equal(validateJdText(null).ok, false);
  assert.equal(validateJdText("x".repeat(MAX_JD_CHARS + 1)).ok, false);
});

test("jdMarkdown: the heading adapts to which of company/role the user actually typed", () => {
  const base = { savedAt: "2026-09-03", text: "x".repeat(300) };

  // Both: the natural phrasing
  assert.match(jdMarkdown({ ...base, company: "Initech", role: "SRE" }), /^# SRE at Initech\n/);
  // Role only
  assert.match(jdMarkdown({ ...base, role: "SRE" }), /^# SRE\n/);
  // Company only. "Job description at Initech" reads as a location, so the
  // company is labelled rather than glued on with "at".
  assert.match(jdMarkdown({ ...base, company: "Initech" }), /^# Job description: Initech\n/);
  // Neither
  assert.match(jdMarkdown(base), /^# Job description\n/);
});

test("slug: a long run of separators is handled in linear time", () => {
  // Given a company field that is nothing but separators, which is the input
  // shape an anchored `-+` trim backtracks on (CodeQL js/polynomial-redos).
  // The company and role are typed straight into the Add job dialog, so this
  // string is caller-controlled.
  const pathological = `${"-".repeat(60_000)}x`;

  const started = Date.now();
  const out = slug(pathological, 40);
  const elapsed = Date.now() - started;

  // Then it is fast and correct. The bound is deliberately loose: it is here to
  // catch a return to quadratic trimming, not to measure this machine.
  assert.ok(elapsed < 1000, `slug took ${elapsed}ms on a 60k separator run`);
  assert.equal(out, "x");
});

test("slug: trimming is exact at both ends and after truncation", () => {
  assert.equal(slug("---acme---"), "acme");
  assert.equal(slug("!!!"), "");
  assert.equal(slug("-"), "");
  // Truncation must not leave the stem ending on a separator
  assert.equal(slug("abcdefghij klmnopqrst uvwxyz", 11), "abcdefghij");
});
