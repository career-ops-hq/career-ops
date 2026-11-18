// Recruitee posting pages ship the whole application form inside a hidden
// "Apply" tab panel. extractForm used to keep the hidden radio and checkbox
// inputs (it exempts them from the visibility check because styled controls
// hide their real input) and drop every hidden text field. Three hidden fields
// then passed as "the form", the Apply tab was never opened, and the fill
// could not reach them. When the field list is empty instead, tryApplyTrigger
// must not leave for the "Powered by Recruitee" logo link (a vendor homepage).
//
// Uses real headless Google Chrome with every network request aborted; skips
// where Chrome cannot start, unless the run requires a browser.
// Run (from web/): node --experimental-strip-types --test tests/lib/apply-hidden-tab-form.test.mjs

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";
import { toolRequired } from "../../../tests/required-tools.mjs";
import "../helpers/web-ts-alias-loader.mjs";

const { extractForm } = await import("../../src/lib/apply/extract.ts");
const { tryApplyTrigger } = await import("../../src/lib/apply/diagnose.ts");

// Fictional employer; the markup mirrors Recruitee's tabs: a tab panel with
// the `hidden` attribute holds the form until the Apply control is clicked.
const RECRUITEE_LIKE = `<!doctype html><html><head><title>Acme - Android Developer</title></head><body>
  <div role="tablist">
    <button role="tab" aria-selected="true">Job description</button>
    <button role="tab" aria-selected="false" aria-controls="panel-apply">Apply</button>
  </div>
  <div role="tabpanel"><p>About the role.</p><button type="button" id="cta">Apply</button></div>
  <div role="tabpanel" id="panel-apply" hidden>
    <form>
      <label for="name">Full name *</label><input id="name" name="candidate.name" required>
      <label for="email">Email address *</label><input id="email" type="email" name="candidate.email" required>
      <label for="cv">CV or resume *</label><input id="cv" type="file" name="candidate.cv" required>
      <fieldset><legend>Are you based in the Netherlands?</legend>
        <label><input type="radio" name="q1" value="yes" required>Yes</label>
        <label><input type="radio" name="q1" value="no">No</label>
      </fieldset>
      <label for="why">Why this role?</label><textarea id="why" name="q2" required></textarea>
      <label><input type="checkbox" name="consent" required>I consent to the processing of my data</label>
    </form>
  </div>
  <footer><a href="https://recruitee.com/"><img alt=""></a></footer>
  <script>
    document.getElementById("cta").addEventListener("click", () => {
      document.getElementById("panel-apply").hidden = false;
    });
  </script>
</body></html>`;

// A launch failure skips these tests, except in a run that requires the
// browser (tests/required-tools.mjs), where it fails.
let browser;
let launchError;
before(async () => {
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
  } catch (e) {
    launchError = e;
  }
});
after(async () => {
  await browser?.close();
});

async function fixturePage(t, html) {
  if (!browser) {
    if (toolRequired("browser")) throw launchError;
    t.skip(`system Chrome did not launch (${launchError instanceof Error ? launchError.message : String(launchError)})`);
    return null;
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  const requested = [];
  await page.route("**/*", (route) => {
    requested.push(route.request().url());
    return route.abort();
  });
  await page.setContent(html);
  return { page, requested, close: () => context.close() };
}

test("a form inside a hidden tab panel yields no fields, not just its radios and checkboxes", async (t) => {
  const fx = await fixturePage(t, RECRUITEE_LIKE);
  if (!fx) return;
  const { page, close } = fx;
  try {
    const form = await extractForm(page);
    assert.deepEqual(form.fields, []);
  } finally {
    await close();
  }
});

test("a styled checkbox whose own input is display:none is still extracted", async (t) => {
  const html = `<!doctype html><form>
    <label for="email">Email</label><input id="email" type="email">
    <label class="box"><input type="checkbox" name="agree" style="display:none"><span>Keep me informed</span></label>
  </form>`;
  const fx = await fixturePage(t, html);
  if (!fx) return;
  const { page, close } = fx;
  try {
    const form = await extractForm(page);
    assert.deepEqual(form.fields.map((f) => f.type), ["email", "checkbox"]);
  } finally {
    await close();
  }
});

test("tryApplyTrigger clicks Apply instead of following a vendor homepage link", async (t) => {
  const fx = await fixturePage(t, RECRUITEE_LIKE);
  if (!fx) return;
  const { page, requested, close } = fx;
  try {
    // The page must be painted before the trigger runs: its click gives up
    // after 3 s, which a cold browser on a slow runner can use up.
    await page.locator("#cta").waitFor({ state: "visible" });
    const acted = await tryApplyTrigger(page);
    assert.ok(acted && typeof acted === "object" && "followed" in acted, "the Apply control should have been used");
    assert.deepEqual(requested.filter(isRecruiteeHost), []);
    await page
      .locator("#panel-apply")
      .waitFor({ state: "visible", timeout: 10_000 })
      .catch(() => assert.fail("the Apply click did not open the form panel"));
    const form = await extractForm(page);
    assert.deepEqual(form.fields.map((f) => f.type), ["text", "email", "file", "radio", "textarea", "checkbox"]);
  } finally {
    await close();
  }
});

function isRecruiteeHost(u) {
  const host = new URL(u).hostname;
  return host === "recruitee.com" || host.endsWith(".recruitee.com");
}

test("tryApplyTrigger follows a later application link when the first ATS link is a vendor homepage", async (t) => {
  const html = `<!doctype html><body>
    <a href="https://recruitee.com/">Powered by Recruitee</a>
    <a href="https://acme.recruitee.com/o/android-developer/c/new">Continue</a>
  </body>`;
  const fx = await fixturePage(t, html);
  if (!fx) return;
  const { page, requested, close } = fx;
  try {
    const acted = await tryApplyTrigger(page);
    assert.ok(acted && typeof acted === "object" && "followed" in acted, "the application link should have been followed");
    assert.deepEqual(requested.filter(isRecruiteeHost), ["https://acme.recruitee.com/o/android-developer/c/new"]);
  } finally {
    await close();
  }
});

test("a styled checkbox in a hidden wrapper counts when its label[for] is visible", async (t) => {
  const html = `<!doctype html><form>
    <label for="email">Email</label><input id="email" type="email">
    <div style="display:none"><input type="checkbox" id="news" name="news"></div>
    <label for="news">Keep me informed</label>
  </form>`;
  const fx = await fixturePage(t, html);
  if (!fx) return;
  const { page, close } = fx;
  try {
    const form = await extractForm(page);
    assert.deepEqual(form.fields.map((f) => f.type), ["email", "checkbox"]);
  } finally {
    await close();
  }
});

test("a label in a visibility:hidden panel does not keep its styled checkbox", async (t) => {
  const html = `<!doctype html>
    <div style="visibility:hidden"><form>
      <label><input type="checkbox" name="consent" style="display:none"><span>I consent</span></label>
    </form></div>`;
  const fx = await fixturePage(t, html);
  if (!fx) return;
  const { page, close } = fx;
  try {
    const form = await extractForm(page);
    assert.deepEqual(form.fields, []);
  } finally {
    await close();
  }
});

test("a radio or checkbox option in a hidden panel is not offered with the visible ones", async (t) => {
  const html = `<!doctype html><form>
    <fieldset><legend>Based in the Netherlands?</legend>
      <label><input type="radio" name="nl" value="yes">Yes</label>
      <div hidden><label><input type="radio" name="nl" value="no">No</label></div>
    </fieldset>
    <fieldset><legend>Which benefits?</legend>
      <label><input type="checkbox" name="perks" value="health">Health</label>
      <label><input type="checkbox" name="perks" value="dental">Dental</label>
      <div hidden><label><input type="checkbox" name="perks" value="gym">Gym</label></div>
    </fieldset>
  </form>`;
  const fx = await fixturePage(t, html);
  if (!fx) return;
  const { page, close } = fx;
  try {
    const form = await extractForm(page);
    assert.deepEqual(form.fields.map((f) => [f.type, f.options]), [["radio", ["Yes"]], ["checkbox", ["Health", "Dental"]]]);
    const tagged = await page.evaluate(() => [...document.querySelectorAll("[data-co-field]")].map((e) => e.getAttribute("value")));
    assert.deepEqual(tagged, ["yes", "health", "dental"]);
  } finally {
    await close();
  }
});

test("isApplicationHref accepts an application URL and refuses a vendor homepage", async () => {
  const { isApplicationHref } = await import("../../src/lib/apply/apply-link.mjs");
  assert.equal(isApplicationHref("https://recruitee.com/"), false);
  assert.equal(isApplicationHref("https://www.greenhouse.io"), false);
  assert.equal(isApplicationHref("https://boards.greenhouse.io/acme/jobs/123"), true);
  assert.equal(isApplicationHref("https://acme.recruitee.com/o/android-developer/c/new"), true);
  assert.equal(isApplicationHref("https://jobs.ashbyhq.com/acme/123/application/submit"), false);
  assert.equal(isApplicationHref("/apply"), false);
  assert.equal(isApplicationHref(null), false);
});

test("a checkbox group with a hidden option keeps its question and offers only the visible option", async (t) => {
  const html = `<!doctype html><form>
    <fieldset><legend>Which shifts suit you?</legend>
      <label><input type="checkbox" name="shift" value="morning">Morning</label>
      <div hidden><label><input type="checkbox" name="shift" value="night">Night</label></div>
    </fieldset>
  </form>`;
  const fx = await fixturePage(t, html);
  if (!fx) return;
  const { page, close } = fx;
  try {
    const form = await extractForm(page);
    assert.deepEqual(form.fields.map((f) => [f.type, f.label, f.options]), [["checkbox", "Which shifts suit you?", ["Morning"]]]);
  } finally {
    await close();
  }
});

test("radios that share one label keep using their values when one is hidden", async (t) => {
  const html = `<!doctype html><form>
    <fieldset><legend>Based in the Netherlands?</legend>
      <input type="radio" name="nl" value="Yes" aria-label="Based in the Netherlands?">
      <div hidden><input type="radio" name="nl" value="No" aria-label="Based in the Netherlands?"></div>
    </fieldset>
  </form>`;
  const fx = await fixturePage(t, html);
  if (!fx) return;
  const { page, close } = fx;
  try {
    const form = await extractForm(page);
    assert.deepEqual(form.fields.map((f) => [f.type, f.options]), [["radio", ["Yes"]]]);
  } finally {
    await close();
  }
});

test("tryApplyTrigger reads the candidate links in one pass", async () => {
  const application = "https://acme.recruitee.com/o/android-developer/c/new";
  const gotos = [];
  const links = {
    evaluateAll: async (fn) => fn([{ getAttribute: () => "https://recruitee.com/" }, { getAttribute: () => application }]),
    // A list that changed between reads: per-index reads would miss the application link.
    count: async () => 2,
    nth: () => ({ getAttribute: async () => { throw new Error("element moved"); } }),
    first: () => links,
  };
  const page = {
    url: () => "https://careers.acme.test/jobs/1",
    context: () => ({ pages: () => [] }),
    goto: async (href) => { gotos.push(href); },
    locator: () => links,
    getByRole: () => ({ or: () => ({ first: () => ({ count: async () => 0 }) }) }),
  };
  const acted = await tryApplyTrigger(page);
  assert.ok(acted && typeof acted === "object" && "followed" in acted);
  assert.deepEqual(gotos, [application]);
});

test("a hidden option with its own text does not stop visible options that share one label from using their values", async (t) => {
  const html = `<!doctype html><form>
    <fieldset><legend>Which benefits?</legend>
      <input type="checkbox" name="perks" value="Health" aria-label="Which benefits?">
      <input type="checkbox" name="perks" value="Dental" aria-label="Which benefits?">
      <div hidden><label><input type="checkbox" name="perks" value="other">Other</label></div>
    </fieldset>
    <fieldset><legend>Based in the Netherlands?</legend>
      <input type="radio" name="nl" value="Yes" aria-label="Based in the Netherlands?">
      <input type="radio" name="nl" value="No" aria-label="Based in the Netherlands?">
      <div hidden><label><input type="radio" name="nl" value="unsure">Not sure</label></div>
    </fieldset>
  </form>`;
  const fx = await fixturePage(t, html);
  if (!fx) return;
  const { page, close } = fx;
  try {
    const form = await extractForm(page);
    assert.deepEqual(form.fields.map((f) => [f.type, f.options]), [["checkbox", ["Health", "Dental"]], ["radio", ["Yes", "No"]]]);
    const tagged = await page.evaluate(() => [...document.querySelectorAll("[data-co-field]")].map((e) => e.getAttribute("data-co-option")));
    assert.deepEqual(tagged, ["Health", "Dental", "Yes", "No"]);
  } finally {
    await close();
  }
});
