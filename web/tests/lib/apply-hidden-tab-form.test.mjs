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
const { factsOf } = await import("../../src/lib/apply/drive-action.mjs");

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
    // The Apply control must be ready for a click before the trigger runs: its
    // click gives up after 3 s and still reports the control as used, which a
    // cold browser on a slow runner can use up. A trial click runs every check
    // a real click waits for (visible, stable, enabled, receives events)
    // without clicking, so the 3 s are left for the click itself.
    await page.locator("#cta").click({ trial: true, timeout: 10_000 });
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
    evaluate: async () => undefined,
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

test("isApplicationHref refuses other pages on an ATS vendor's own site", async () => {
  const { isApplicationHref } = await import("../../src/lib/apply/apply-link.mjs");
  for (const vendorPage of [
    "https://recruitee.com/privacy",
    "https://www.greenhouse.io/careers",
    "https://www.greenhouse.com/blog",
    "https://lever.co/pricing",
    "https://www.ashbyhq.com/customers",
    "https://www.workable.com/features",
    "https://www.teamtailor.com/en/",
  ]) {
    assert.equal(isApplicationHref(vendorPage), false, vendorPage);
  }
  for (const application of [
    "https://jobs.lever.co/acme/123",
    "https://jobs.ashbyhq.com/acme/123/application",
    "https://apply.workable.com/acme/j/ABC123/",
    "https://job-boards.greenhouse.io/acme/jobs/123",
    "https://careers.acme.test/jobs/1/apply",
  ]) {
    assert.equal(isApplicationHref(application), true, application);
  }
});

test("tryApplyTrigger clicks Apply instead of following a vendor privacy page", async (t) => {
  const fx = await fixturePage(t, RECRUITEE_LIKE.replace('href="https://recruitee.com/"', 'href="https://recruitee.com/privacy"'));
  if (!fx) return;
  const { page, requested, close } = fx;
  try {
    await page.locator("#cta").waitFor({ state: "visible" });
    const acted = await tryApplyTrigger(page);
    assert.ok(acted && typeof acted === "object" && "followed" in acted, "the Apply control should have been used");
    assert.deepEqual(requested.filter(isRecruiteeHost), []);
    await page
      .locator("#panel-apply")
      .waitFor({ state: "visible", timeout: 10_000 })
      .catch(() => assert.fail("the Apply click did not open the form panel"));
  } finally {
    await close();
  }
});

const POSTING_WITH_APPLICATION_LINK = RECRUITEE_LIKE.replace(
  '<a href="https://recruitee.com/"><img alt=""></a>',
  '<a href="https://acme.recruitee.com/o/android-developer/c/new">Apply on Recruitee</a>',
);

test("tryApplyTrigger clicks Apply when the application link fails and the posting stays loaded", async (t) => {
  const fx = await fixturePage(t, POSTING_WITH_APPLICATION_LINK);
  if (!fx) return;
  const { page, close } = fx;
  try {
    // A 204 answer cancels the navigation: goto rejects and the posting stays.
    await page.route("**/c/new", (route) => route.fulfill({ status: 204, body: "" }));
    await page.locator("#cta").waitFor({ state: "visible" });
    const acted = await tryApplyTrigger(page);
    assert.ok(acted && typeof acted === "object" && "followed" in acted);
    await page
      .locator("#panel-apply")
      .waitFor({ state: "visible", timeout: 10_000 })
      .catch(() => assert.fail("the Apply button was not clicked after the link failed"));
  } finally {
    await close();
  }
});

test("tryApplyTrigger does not look for Apply when a failed link replaced the posting", async (t) => {
  const fx = await fixturePage(t, POSTING_WITH_APPLICATION_LINK);
  if (!fx) return;
  const { page, requested, close } = fx;
  try {
    // An aborted request leaves Chrome's error page, while page.url() still
    // reads as the posting's address.
    const acted = await tryApplyTrigger(page);
    assert.ok(acted && typeof acted === "object" && "followed" in acted, "the failed link counts as followed");
    assert.deepEqual(requested.filter(isRecruiteeHost), ["https://acme.recruitee.com/o/android-developer/c/new"]);
  } finally {
    await close();
  }
});

test("same-name radios and checkboxes in different forms are separate questions", async (t) => {
  const html = `<!doctype html>
    <form id="newsletter">
      <label><input type="checkbox" name="consent" value="yes">Send me the newsletter</label>
      <fieldset><legend>How often?</legend>
        <label><input type="radio" name="q" value="weekly">Weekly</label>
        <label><input type="radio" name="q" value="monthly">Monthly</label>
      </fieldset>
    </form>
    <form id="application">
      <label><input type="checkbox" name="consent" value="yes">I agree to the privacy notice</label>
      <fieldset><legend>Can you relocate?</legend>
        <label><input type="radio" name="q" value="yes">Yes</label>
        <label><input type="radio" name="q" value="no">No</label>
      </fieldset>
    </form>`;
  const fx = await fixturePage(t, html);
  if (!fx) return;
  const { page, close } = fx;
  try {
    const form = await extractForm(page);
    assert.deepEqual(
      form.fields.map((f) => [f.type, f.label, f.options ?? null]),
      [
        ["checkbox", "Send me the newsletter", null],
        ["radio", "How often?", ["Weekly", "Monthly"]],
        ["checkbox", "I agree to the privacy notice", null],
        ["radio", "Can you relocate?", ["Yes", "No"]],
      ],
    );
  } finally {
    await close();
  }
});

test("a second extraction clears the tags of controls it no longer offers", async (t) => {
  const html = `<!doctype html><form>
    <label for="a">First name</label><input id="a" name="a">
    <label for="b">Last name</label><input id="b" name="b">
    <label for="c">Email</label><input id="c" type="email" name="c">
  </form>`;
  const fx = await fixturePage(t, html);
  if (!fx) return;
  const { page, close } = fx;
  try {
    await extractForm(page);
    await page.evaluate(() => { document.getElementById("a").style.display = "none"; });
    const form = await extractForm(page);
    assert.deepEqual(form.fields.map((f) => f.label), ["Last name", "Email"]);
    const tags = await page.evaluate(() => [...document.querySelectorAll("[data-co-field]")].map((e) => [e.id, e.getAttribute("data-co-field")]));
    assert.deepEqual(tags, [["b", "co0"], ["c", "co1"]]);
  } finally {
    await close();
  }
});

test("a control in a visibility:hidden panel is skipped, a styled box with a visible label is not", async (t) => {
  const html = `<!doctype html><form>
    <div style="visibility:hidden">
      <label for="secret">Hidden question</label><input id="secret" name="secret">
      <label><input type="radio" name="hidden-choice" value="a">A</label>
    </div>
    <label for="email">Email</label><input id="email" type="email" name="email">
    <label><input type="checkbox" name="terms" style="visibility:hidden;position:absolute">I agree to the terms</label>
  </form>`;
  const fx = await fixturePage(t, html);
  if (!fx) return;
  const { page, close } = fx;
  try {
    const form = await extractForm(page);
    assert.deepEqual(form.fields.map((f) => [f.type, f.label]), [["email", "Email"], ["checkbox", "I agree to the terms"]]);
  } finally {
    await close();
  }
});

for (const button of ['<button type="submit">Apply</button>', "<button>Apply</button>"]) {
  test(`tryApplyTrigger does not click a form's submit button named Apply: ${button}`, async (t) => {
    const html = `<!doctype html><body>
      <p>About the role.</p>
      <form onsubmit="event.preventDefault(); window.__submitted = true;">
        <label for="name">Full name</label><input id="name" name="name">
        ${button}
      </form>
    </body>`;
    const fx = await fixturePage(t, html);
    if (!fx) return;
    const { page, close } = fx;
    try {
      await page.getByRole("button", { name: "Apply" }).waitFor({ state: "visible" });
      const acted = await tryApplyTrigger(page);
      assert.equal(acted, false);
      assert.equal(await page.evaluate(() => window.__submitted === true), false, "the form was submitted");
    } finally {
      await close();
    }
  });
}

test("a hidden wrapper label does not name the visible field next to it", async (t) => {
  const html = `<!doctype html><form>
    <div class="form-group">
      <label style="visibility:hidden">Website<input name="trap"></label>
      <input name="full_name" placeholder="Full name">
    </div>
  </form>`;
  const fx = await fixturePage(t, html);
  if (!fx) return;
  const { page, close } = fx;
  try {
    const form = await extractForm(page);
    assert.deepEqual(form.fields.map((f) => [f.type, f.label]), [["text", "Full name"]]);
  } finally {
    await close();
  }
});

test("the fill step names a field the same way extraction does when its group label is hidden", async (t) => {
  const html = `<!doctype html><form>
    <div class="form-group">
      <label style="visibility:hidden">Website</label>
      <input name="full_name" placeholder="Full name">
    </div>
  </form>`;
  const fx = await fixturePage(t, html);
  if (!fx) return;
  const { page, close } = fx;
  try {
    const form = await extractForm(page);
    assert.deepEqual(form.fields.map((f) => f.label), ["Full name"]);
    const facts = await page.locator('input[name="full_name"]').evaluate(factsOf, null);
    assert.equal(facts.identity, "Full name");
  } finally {
    await close();
  }
});

test("the fill step reads a radio's option within its own form, like extraction", async (t) => {
  const html = `<!doctype html>
    <form id="newsletter"><label><input type="radio" name="consent" value="yes">I agree</label></form>
    <form id="application"><label><input type="radio" name="consent" value="yes">I agree</label></form>`;
  const fx = await fixturePage(t, html);
  if (!fx) return;
  const { page, close } = fx;
  try {
    const form = await extractForm(page);
    assert.deepEqual(form.fields.map((f) => f.options), [["I agree"], ["I agree"]]);
    const facts = await page.locator('#application input[name="consent"]').evaluate(factsOf, null);
    assert.equal(facts.option, "I agree");
  } finally {
    await close();
  }
});

test("the fill step ignores a visibility:hidden control when it names a field, like extraction", async (t) => {
  const html = `<!doctype html><form>
    <div class="form-group">
      <div class="label">Full name</div>
      <div style="visibility:hidden"><input name="trap"></div>
      <input name="full_name">
    </div>
  </form>`;
  const fx = await fixturePage(t, html);
  if (!fx) return;
  const { page, close } = fx;
  try {
    const form = await extractForm(page);
    assert.deepEqual(form.fields.map((f) => f.label), ["Full name"]);
    const facts = await page.locator('input[name="full_name"]').evaluate(factsOf, null);
    assert.equal(facts.identity, "Full name");
  } finally {
    await close();
  }
});
