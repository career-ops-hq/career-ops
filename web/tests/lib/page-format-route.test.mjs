import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as yaml from "js-yaml";

import "../helpers/web-ts-alias-loader.mjs";

// The Page format control on /config. The real route handlers and the real core
// (lib/page-format.mjs) run; only CAREER_OPS_ROOT is redirected to a scratch
// directory. What the route accepts is compared against the core's own
// normalizePageFormat, never against a list restated here, so the web and the
// PDF scripts cannot drift apart on which values count.
const CODE_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const webPageFormats = fileURLToPath(new URL("../../src/lib/page-formats.mjs", import.meta.url));

// lib/page-format.mjs imports js-yaml through lib/yaml-document.mjs. Probe
// importability, as page-format-core.test.mjs does, so a web-only install skips
// these cases instead of failing on a dependency it does not have.
let core = null;
try {
  core = await import(pathToFileURL(path.join(CODE_ROOT, "lib", "page-format.mjs")).href);
} catch {
  core = null;
}
const needsCore = { skip: core ? false : "the core's lib/page-format.mjs cannot be loaded here" };

const { GET, POST } = await import("../../src/app/api/page-format/route.ts");

const example = readFileSync(path.join(CODE_ROOT, "config", "profile.example.yml"), "utf8");
const commentLines = (text) => text.split(/\r?\n/).filter((line) => /^\s*#/.test(line));

async function withFixture(source, fn, env = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "career-ops-page-format-route-"));
  const config = path.join(root, "config");
  const file = path.join(config, "profile.yml");
  mkdirSync(config);
  if (source !== undefined) writeFileSync(file, source);
  const names = ["CAREER_OPS_ROOT", "CAREER_OPS_CODE_ROOT", "CAREER_OPS_PROFILE", ...Object.keys(env)];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  // An ambient override would send a case's writes to a real profile.
  delete process.env.CAREER_OPS_PROFILE;
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_CODE_ROOT = CODE_ROOT;
  for (const [name, value] of Object.entries(env)) process.env[name] = typeof value === "function" ? value(root) : value;
  try {
    await fn({ root, config, file });
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    rmSync(root, { recursive: true, force: true });
  }
}

const send = (body) =>
  POST(new Request("http://fixture.invalid/api/page-format", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
const read = async () => (await GET()).json();

test("GET reports the accepted formats, the default and the profile's own choice", needsCore, async () => {
  await withFixture("candidate:\n  full_name: Fixture\npage_format: a4\n", async () => {
    const body = await read();
    assert.deepEqual([...body.formats].sort(), ["a4", "letter"]);
    assert.equal(body.default, "letter");
    assert.equal(body.override, "a4");
  });
  await withFixture("page_format: ' Letter '\n", async () => {
    assert.equal((await read()).override, "letter");
  });
});

test("GET states no preference when the profile states none, an unknown size, is malformed or is absent", needsCore, async () => {
  for (const source of ["candidate:\n  full_name: Fixture\n", "page_format: foolscap\n", "candidate: [broken\n", "- a\n", undefined]) {
    await withFixture(source, async () => {
      assert.equal((await read()).override, null, JSON.stringify(source));
    });
  }
});

test("GET reports a profile that says auto as auto, not as a size and not as nothing", needsCore, async () => {
  await withFixture("page_format: auto\n", async () => {
    assert.equal((await read()).override, "auto");
  });
  await withFixture("page_format: ' AUTO '\n", async () => {
    assert.equal((await read()).override, "auto");
  });
});

test("POST accepts exactly the values the core's normalizePageFormat accepts", needsCore, async () => {
  const candidates = ["a4", "A4", " letter ", "LETTER", "Letter", "legal", "a5", "auto", "", " ", "4", 4, true, ["a4"], { a4: 1 }, undefined];
  for (const candidate of candidates) {
    await withFixture("candidate:\n  full_name: Fixture\n", async ({ file }) => {
      const expected = core.normalizePageFormat(candidate);
      const response = await send({ page_format: candidate });
      const label = JSON.stringify(candidate) ?? "undefined";
      if (expected === null) {
        assert.equal(response.status, 400, label);
        assert.equal(readFileSync(file, "utf8"), "candidate:\n  full_name: Fixture\n", `${label} wrote nothing`);
      } else {
        assert.equal(response.status, 200, label);
        assert.deepEqual(await response.json(), { ok: true, override: expected });
        assert.equal(yaml.load(readFileSync(file, "utf8")).page_format, expected);
      }
    });
  }
});

test("POST sets then removes the key, and the core reads back what was written", needsCore, async () => {
  await withFixture("candidate:\n  full_name: Fixture\n", async ({ file }) => {
    for (const size of ["a4", "letter"]) {
      assert.equal((await send({ page_format: size })).status, 200);
      assert.equal(core.readProfilePageFormat(file), size);
      assert.equal((await read()).override, size);
    }
    const removed = await send({ page_format: null });
    assert.equal(removed.status, 200);
    assert.deepEqual(await removed.json(), { ok: true, override: null });
    assert.equal(core.readProfilePageFormat(file), null);
    assert.equal((await read()).override, null);
    assert.equal(Object.hasOwn(yaml.load(readFileSync(file, "utf8")), "page_format"), false);
  });
});

test("POST changes only the page_format line: every other line, comment included, survives", needsCore, async () => {
  const source = [
    "# my profile",
    "candidate:",
    "  full_name: Fixture   # not my real name",
    "",
    "# Paper size for every PDF",
    "page_format: letter   # US recipients",
    "",
    "compensation:",
    "  target_range: 100-120",
    "",
  ].join("\n");
  await withFixture(source, async ({ config, file }) => {
    assert.equal((await send({ page_format: "a4" })).status, 200);
    assert.equal(readFileSync(file, "utf8"), source.replace("page_format: letter", 'page_format: "a4"'));
    const backups = readdirSync(config).filter((name) => name.startsWith("profile.yml.bak-"));
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(path.join(config, backups[0]), "utf8"), source);

    assert.equal((await send({ page_format: null })).status, 200);
    assert.equal(readFileSync(file, "utf8"), source.replace("page_format: letter   # US recipients\n", ""));
  });
});

test("POST adds the key to the shipped template without losing a comment", needsCore, async () => {
  await withFixture(example, async ({ file }) => {
    assert.equal((await send({ page_format: "a4" })).status, 200);
    const out = readFileSync(file, "utf8");
    assert.deepEqual(commentLines(out), commentLines(example));
    assert.deepEqual(yaml.load(out), { ...yaml.load(example), page_format: "a4" });
  });
});

test("POST of no preference on a profile without the key writes nothing", needsCore, async () => {
  const source = "candidate:\n  full_name: Fixture\n";
  await withFixture(source, async ({ config, file }) => {
    const response = await send({ page_format: null });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, override: null });
    assert.equal(readFileSync(file, "utf8"), source);
    assert.deepEqual(readdirSync(config), ["profile.yml"]);
  });
});

test("a profile that says auto is left alone until the user chooses, then replaced or cleared", needsCore, async () => {
  const source = "# sheet follows the employer\ncandidate:\n  full_name: Fixture\npage_format: auto   # per country\n";
  await withFixture(source, async ({ file }) => {
    assert.equal((await read()).override, "auto");
    assert.equal(readFileSync(file, "utf8"), source, "reading never rewrites it");

    assert.equal((await send({ page_format: "auto" })).status, 400, "auto is not a value the renderers' --format accepts");
    assert.equal(readFileSync(file, "utf8"), source, "a refused choice never rewrites it");

    assert.equal((await send({ page_format: "letter" })).status, 200);
    assert.equal(readFileSync(file, "utf8"), source.replace("page_format: auto", 'page_format: "letter"'));
    assert.equal(core.readProfilePageSetting(file), "letter");
  });
  await withFixture(source, async ({ file }) => {
    assert.equal((await send({ page_format: null })).status, 200);
    assert.equal(core.readProfilePageSetting(file), null);
    assert.deepEqual(yaml.load(readFileSync(file, "utf8")), { candidate: { full_name: "Fixture" } });
  });
});

test("POST creates a missing profile from the template, carrying nothing of its example person", needsCore, async () => {
  await withFixture(undefined, async ({ config, file }) => {
    assert.equal(existsSync(file), false);
    const response = await send({ page_format: "letter" });
    assert.equal(response.status, 200);
    const written = yaml.load(readFileSync(file, "utf8"));
    assert.equal(written.page_format, "letter");
    assert.equal(written.candidate.full_name, "", "the example person's name is not seeded");
    assert.deepEqual(readdirSync(config), ["profile.yml"]);
  });
});

// A code root that re-exports the real core and holds the given example profile,
// or none. A re-export needs no link into the checkout, so cleanup cannot follow one.
const codeRootWithTemplate = (template) => (root) => {
  const dir = path.join(root, "code");
  mkdirSync(path.join(dir, "config"), { recursive: true });
  mkdirSync(path.join(dir, "lib"));
  const real = pathToFileURL(path.join(CODE_ROOT, "lib", "page-format.mjs")).href;
  writeFileSync(path.join(dir, "lib", "page-format.mjs"), `export * from ${JSON.stringify(real)};\n`);
  if (template !== undefined) writeFileSync(path.join(dir, "config", "profile.example.yml"), template);
  return dir;
};

test("POST creates no profile when the template cannot be used", needsCore, async () => {
  const templates = {
    missing: undefined,
    malformed: "candidate: [broken\n",
    list: "- candidate\n",
    "comments only": "# nothing but comments\n",
  };
  for (const [label, template] of Object.entries(templates)) {
    await withFixture(undefined, async ({ config, file }) => {
      const response = await send({ page_format: "a4" });
      assert.equal(response.status, 500, label);
      assert.match((await response.json()).error, /profile\.example\.yml/, label);
      assert.equal(existsSync(file), false, `${label}: no one-key profile`);
      assert.deepEqual(readdirSync(config), [], `${label}: no backup or temp files`);
    }, { CAREER_OPS_CODE_ROOT: codeRootWithTemplate(template) });
  }
});

test("POST of no preference with no profile needs no template", needsCore, async () => {
  await withFixture(undefined, async ({ config, file }) => {
    const response = await send({ page_format: null });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, override: null });
    assert.equal(existsSync(file), false);
    assert.deepEqual(readdirSync(config), []);
  }, { CAREER_OPS_CODE_ROOT: codeRootWithTemplate(undefined) });
});

test("POST of no preference with no profile does not create one", needsCore, async () => {
  await withFixture(undefined, async ({ file }) => {
    assert.equal((await send({ page_format: null })).status, 200);
    assert.equal(existsSync(file), false);
  });
});

test("POST follows CAREER_OPS_PROFILE like every other reader of the profile", needsCore, async () => {
  const env = { CAREER_OPS_PROFILE: (root) => path.join(root, "elsewhere", "me.yml") };
  await withFixture("candidate:\n  full_name: Fixture\n", async ({ root, file }) => {
    const target = path.join(root, "elsewhere", "me.yml");
    mkdirSync(path.dirname(target));
    writeFileSync(target, "candidate:\n  full_name: Elsewhere\n");
    assert.equal((await send({ page_format: "a4" })).status, 200);
    assert.equal(yaml.load(readFileSync(target, "utf8")).page_format, "a4");
    assert.equal(Object.hasOwn(yaml.load(readFileSync(file, "utf8")), "page_format"), false);
    assert.equal((await read()).override, "a4");
  }, env);
});

test("a fixture ignores a CAREER_OPS_PROFILE it did not set, and puts it back", needsCore, async () => {
  const outside = mkdtempSync(path.join(tmpdir(), "career-ops-page-format-ambient-"));
  const ambient = path.join(outside, "me.yml");
  const source = "candidate:\n  full_name: Ambient\n";
  writeFileSync(ambient, source);
  const previous = process.env.CAREER_OPS_PROFILE;
  process.env.CAREER_OPS_PROFILE = ambient;
  try {
    await withFixture("candidate:\n  full_name: Fixture\n", async ({ file }) => {
      assert.equal((await send({ page_format: "a4" })).status, 200);
      assert.equal(readFileSync(ambient, "utf8"), source, "the ambient profile is not written");
      assert.equal(yaml.load(readFileSync(file, "utf8")).page_format, "a4");
    });
    assert.equal(process.env.CAREER_OPS_PROFILE, ambient);
  } finally {
    if (previous === undefined) delete process.env.CAREER_OPS_PROFILE;
    else process.env.CAREER_OPS_PROFILE = previous;
    rmSync(outside, { recursive: true, force: true });
  }
});

test("POST rejects a body that is not a JSON object, or has no page_format key", needsCore, async () => {
  await withFixture("candidate:\n  full_name: Fixture\n", async ({ file }) => {
    for (const body of ["{", "null", "[]", "42", '"a4"', {}, { format: "a4" }]) {
      assert.equal((await send(body)).status, 400, JSON.stringify(body));
    }
    assert.equal(readFileSync(file, "utf8"), "candidate:\n  full_name: Fixture\n");
  });
});

test("POST names the accepted formats when it rejects one", needsCore, async () => {
  await withFixture("candidate:\n  full_name: Fixture\n", async () => {
    const response = await send({ page_format: "legal" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /a4, letter/);
  });
});

test("POST refuses an existing profile that is not a YAML mapping, without touching it", needsCore, async () => {
  for (const source of ["- candidate:\n    full_name: Fixture\n", "42\n", "null\n", "# Existing profile to repair\n", "candidate: [broken\n"]) {
    await withFixture(source, async ({ config, file }) => {
      const before = readdirSync(config).sort();
      const response = await send({ page_format: "a4" });
      assert.equal(response.status, 409, JSON.stringify(source));
      assert.match((await response.json()).error, /refusing to overwrite/i);
      assert.equal(readFileSync(file, "utf8"), source);
      assert.deepEqual(readdirSync(config).sort(), before, "no backup or temp files on rejection");
    });
  }
});

test("the web owns no second copy of the core's page format rules", async () => {
  const web = await import(pathToFileURL(webPageFormats).href);
  assert.equal("normalizePageFormat" in web, false, "validation lives in the core: lib/page-format.mjs");
  assert.equal("PROFILE_PAGE_FORMAT_KEY" in web, false);
  const route = readFileSync(new URL("../../src/app/api/page-format/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /normalizePageFormat\s*[,}]/, "the route does not import a local normalizePageFormat");
  assert.match(route, /@\/lib\/core\/page-format\.mjs/);
});

test("the Config page renders the Page format control", () => {
  const form = readFileSync(new URL("../../src/components/config-form.tsx", import.meta.url), "utf8");
  assert.match(form, /import\s*{\s*PageFormatSettings\s*}\s*from\s*"@\/components\/page-format-settings"/);
  assert.match(form, /<PageFormatSettings\s*\/>/);
});

test("the control names its option group, announces save errors and clears a stale one", () => {
  const src = readFileSync(new URL("../../src/components/page-format-settings.tsx", import.meta.url), "utf8");
  assert.match(src, /<span id="page-format-label"/);
  assert.match(src, /role="group"\s+aria-labelledby="page-format-label"/);
  assert.match(src, /role="alert"[^>]*>\{error\}/);
  assert.match(src, /onClick=\{\(\) => \{\s*setChoice\(o\.value\);\s*setError\(null\);\s*\}\}/);
});

test("the control shows a profile that says auto and does not offer to rewrite it unchanged", () => {
  const src = readFileSync(new URL("../../src/components/page-format-settings.tsx", import.meta.url), "utf8");
  assert.match(src, /override === "auto"/);
  assert.match(src, /disabled=\{saving \|\| unchanged\}/);
});
