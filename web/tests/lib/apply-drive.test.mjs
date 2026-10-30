// Tests for the drive loop's action executor: what is actually done to the page
// when the planner picks an action, and what is refused.
//
// submit-guard.test.mjs pins the rule ("would clicking this submit the
// application?"). This pins where the rule is applied. "Nothing is ever
// submitted automatically" is enforced at runtime in executeAction
// (src/lib/apply/drive-action.mjs), and every way of losing it leaves the rule
// itself intact: an action branch that skips the check, a selector resolved
// again after it, a fallback that acts on an element the main path refused, a
// decision taken on the snapshot instead of on the element as it is now.
//
// The executor runs here against a fake Playwright page whose form has a real
// submit control: clicking it counts a submission, and `fill()` rejects on it the
// way Playwright's does on a button. The planner is a script of actions in place
// of the LLM. Element facts are read by the real `factsOf`, off fake elements
// that answer the DOM calls it makes, so skipping the re-read is observable too.
//
// driveSession itself (drive.ts) is TypeScript behind the `@/` alias and spawns
// the CLI, so it cannot be imported here. The last tests read its source
// instead, in the style of drive-stream-close.test.mjs: the loop must hand every
// action to this executor and do nothing to an element on its own.
//
// Run (from web/):  node --test tests/lib/apply-drive.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { executeAction, factsOf } from "../../src/lib/apply/drive-action.mjs";
import { isSubmitControl } from "../../src/lib/apply/submit-guard.mjs";

// ── The fake page ──

const FILLABLE = new Set(["", "text", "email", "tel", "url", "search", "number", "password"]);

/** As much of a DOM element as `factsOf` reads. */
class FakeElement {
  constructor(id, { tag, attrs = {}, text = "", value = "", form = null, options = [], submits = false, clickFails = false }) {
    Object.assign(this, { id, tag, attrs: { ...attrs }, textContent: text, value, form, options, submits, clickFails });
    this.attached = true;
  }
  get tagName() {
    return this.tag.toUpperCase();
  }
  get placeholder() {
    return this.attrs.placeholder ?? "";
  }
  get name() {
    return this.attrs.name ?? "";
  }
  getAttribute(name) {
    return this.attrs[name] ?? null;
  }
  closest(selector) {
    return selector === "form" ? this.form : null;
  }
}

/** A Playwright ElementHandle bound to one element, for good: what it was
 *  resolved to is what every later call acts on. */
class FakeHandle {
  constructor(page, el) {
    Object.assign(this, { page, el, disposed: false });
  }
  async evaluate(fn, arg) {
    if (!this.el.attached) throw new Error("Element is not attached to the DOM");
    const facts = fn(this.el, arg);
    // The page is free to change the moment the read returns.
    this.page.afterRead?.();
    return facts;
  }
  async scrollIntoViewIfNeeded() {}
  async click() {
    if (this.el.clickFails) throw new Error("Timeout 6000ms exceeded while waiting for the element to be visible and enabled");
    this.page.log.push(`click:${this.el.id}`);
    if (this.el.submits) this.el.form.submits++;
  }
  async fill(text) {
    const { tag, attrs } = this.el;
    const fillable = tag === "textarea" || (tag === "input" && FILLABLE.has(attrs.type ?? ""));
    if (!fillable) throw new Error("Element is not an <input>, <textarea> or [contenteditable] element");
    this.el.value = text;
    this.page.log.push(`fill:${this.el.id}=${text}`);
  }
  async selectOption(wanted) {
    if (this.el.tag !== "select") throw new Error("Element is not a <select> element");
    const by = typeof wanted === "string" ? "value" : "label";
    const want = typeof wanted === "string" ? wanted : wanted.label;
    const option = this.el.options.find((o) => o[by] === want);
    if (!option) throw new Error("did not find some options");
    this.el.value = option.value;
    this.page.log.push(`select:${this.el.id}=${option.value} (by ${by})`);
  }
  async dispose() {
    this.disposed = true;
  }
}

/** The Page and its main Frame in one object: `log` is everything that was done
 *  to the page, `selectors` every selector that was resolved against it. */
class FakePage {
  constructor() {
    this.form = { submits: 0 };
    this.elements = [];
    this.log = [];
    this.selectors = [];
    this.handles = [];
    // keyboard.type presses a key per character, so a line break is an Enter on the focused
    // control: implicit submission. insertText dispatches no key events.
    this.keyboard = {
      type: async (text) => { this.log.push(`keyboard-type:${text}`); if (/[\r\n]/.test(text)) this.form.submits++; },
      insertText: async (text) => void this.log.push(`keyboard:${text}`),
    };
  }
  /** Add a control inside the form (pass `form: null` for one outside it) and
   *  tag it the way a snapshot would. */
  add(id, spec) {
    const el = new FakeElement(id, { form: this.form, ...spec });
    el.attrs["data-co-ref"] = `etest-${this.elements.length}`;
    this.elements.push(el);
    return el;
  }
  el(id) {
    return this.elements.find((e) => e.id === id);
  }
  ref(id) {
    return this.el(id).attrs["data-co-ref"];
  }
  /** The refs a snapshot would offer: every control the guard does not refuse. */
  snapshot() {
    return new Set(this.elements.filter((e) => !isSubmitControl(factsOf(e, null))).map((e) => e.attrs["data-co-ref"]));
  }
  /** Every ref on the page, the submit control's included: a snapshot that
   *  failed to hold one back. */
  everyRef() {
    return new Set(this.elements.map((e) => e.attrs["data-co-ref"]));
  }
  async $(selector) {
    this.selectors.push(selector);
    const ref = /^\[data-co-ref="(.*)"\]$/.exec(selector)?.[1];
    const el = this.elements.find((e) => e.attached && e.attrs["data-co-ref"] === ref);
    if (!el) return null;
    const handle = new FakeHandle(this, el);
    this.handles.push(handle);
    return handle;
  }
  async waitForLoadState() {}
  async evaluate() {
    this.log.push("scroll");
  }
}

const SUBMIT = { tag: "button", attrs: { type: "submit" }, text: "Submit application", submits: true };

/** A one-page application: three fields, a pager, and the button that files it. */
function applicationForm(submit = SUBMIT) {
  const page = new FakePage();
  page.add("name", { tag: "input", attrs: { type: "text", name: "name", "aria-label": "Full name" } });
  page.add("country", { tag: "select", attrs: { name: "country", "aria-label": "Country" }, options: [{ label: "Germany", value: "DE" }, { label: "France", value: "FR" }] });
  // A scripted widget: Playwright's fill() rejects on it, which is the way into
  // the type branch's click-then-keyboard fallback.
  page.add("pronouns", { tag: "div", attrs: { role: "combobox", "aria-label": "Pronouns" } });
  page.add("next", { tag: "button", attrs: { type: "button" }, text: "Next step" });
  page.add("submit", submit);
  return page;
}

/** One turn: the page is its own main frame here. */
const act = (page, action, actionable = page.snapshot()) => executeAction(page, page, action, actionable);

/** Nothing was done to the page, and whatever was resolved was released. */
function assertUntouched(page) {
  assert.deepEqual(page.log, [], "nothing may be done to the page");
  assert.equal(page.form.submits, 0, "the form must not be submitted");
  assert.ok(page.handles.every((h) => h.disposed), "every resolved handle is released");
}

// The three verbs that name a ref, each with the payload the planner would send.
const REF_ACTIONS = [
  { action: "click" },
  { action: "type", text: "Jane Doe" },
  { action: "select", value: "DE" },
];

// The shapes a final button takes. Each one is refused by a different reading in
// submit-guard.mjs, and none of them takes fill() or selectOption().
const SUBMIT_SHAPES = [
  ["<button type=submit>", SUBMIT],
  ["<input type=submit>", { tag: "input", attrs: { type: "submit" }, value: "Submit", submits: true }],
  ["a typeless <button> inside the form", { tag: "button", text: "Weiter", submits: true }],
  ["a scripted type=button reading «Bewerbung absenden»", { tag: "button", attrs: { type: "button" }, text: "Bewerbung absenden", submits: true }],
  ['<div role="button">Send</div>', { tag: "div", attrs: { role: "button" }, text: "Send", submits: true }],
  ["an icon-only button named by aria-label", { tag: "button", attrs: { type: "button", "aria-label": "Submit application" }, submits: true }],
];

// ── The fixture is not inert ──

test("fixture: the fake submit control submits when clicked, and rejects fill() and selectOption()", async () => {
  // Given the form's submit control, reached without the executor
  const page = applicationForm();
  const handle = await page.$(`[data-co-ref="${page.ref("submit")}"]`);

  // When it is acted on directly
  // Then fill() and selectOption() reject, which is what sends an unguarded
  // `type` into its click fallback, and a click files the form. Every refusal
  // below is measured against this: the page can be submitted, and was not.
  await assert.rejects(handle.fill("x"));
  await assert.rejects(handle.selectOption({ label: "x" }));
  await handle.click();
  assert.equal(page.form.submits, 1);
});

// ── The guard, per action branch ──

for (const [shape, submit] of SUBMIT_SHAPES) {
  for (const action of REF_ACTIONS) {
    test(`${action.action} aimed at ${shape} is refused as a submit control`, async () => {
      // Given a snapshot that offered the submit control's ref, so nothing but
      // the check at action time stands between the planner and the button
      const page = applicationForm(submit);

      // When the planner aims this action at it
      const outcome = await act(page, { ...action, ref: page.ref("submit") }, page.everyRef());

      // Then it is refused by name, and neither the action nor the fallback
      // inside its branch reached the element
      assert.equal(outcome.refusal, "submit-control");
      assert.equal(outcome.note, "refused to click a submit control (the human submits)");
      assert.match(outcome.detail, /^blocked submit "/);
      assertUntouched(page);
    });
  }
}

test("any action that names a ref is cleared, not only the three that use one", async () => {
  // Given actions whose branch never touches an element: scroll, and a verb
  // the executor does not know
  for (const action of ["scroll", "press", "submit"]) {
    const page = applicationForm();

    // When they name the submit control anyway
    const outcome = await act(page, { action, ref: page.ref("submit") }, page.everyRef());

    // Then the ref is what gets them refused, before the verb is looked at
    assert.equal(outcome.refusal, "submit-control", action);
    assertUntouched(page);
  }
});

// ── The re-read at action time ──

const TURNS_INTO_SUBMIT = [
  ["is relabelled «Submit application» on the last step", (el) => { el.textContent = "Submit application"; }],
  ["loses its type attribute", (el) => { delete el.attrs.type; }],
  ["gets an aria-label naming the submit action", (el) => { el.attrs["aria-label"] = "Bewerbung absenden"; }],
];

for (const [how, mutate] of TURNS_INTO_SUBMIT) {
  for (const action of REF_ACTIONS) {
    test(`${action.action} is refused when the control ${how} after the snapshot`, async () => {
      // Given a pager the snapshot rightly offered
      const page = applicationForm();
      const offered = page.snapshot();
      assert.ok(offered.has(page.ref("next")), "the snapshot offers the pager");

      // And a page that turns it into the final button before the action lands
      const next = page.el("next");
      mutate(next);
      next.submits = true;

      // When the planner acts on what it was shown
      const outcome = await act(page, { ...action, ref: page.ref("next") }, offered);

      // Then the decision is taken on the element as it is now
      assert.equal(outcome.refusal, "submit-control");
      assertUntouched(page);
    });
  }
}

test("the action lands on the element that was cleared, even when its ref moves to the submit control", async () => {
  // Given a page that re-renders right after the check reads the pager, leaving
  // the pager's ref on the submit button: a second lookup of the same selector
  // would now find the wrong node
  const page = applicationForm();
  const offered = page.snapshot();
  const ref = page.ref("next");
  page.afterRead = () => {
    delete page.el("next").attrs["data-co-ref"];
    page.el("submit").attrs["data-co-ref"] = ref;
  };

  // When the planner clicks the pager
  const outcome = await act(page, { action: "click", ref }, offered);

  // Then the click went to the handle the check was run on, resolved once
  assert.equal(outcome.refusal, undefined);
  assert.deepEqual(page.log, ["click:next"]);
  assert.equal(page.selectors.length, 1, "the selector is resolved once, before the check");
  assert.equal(page.form.submits, 0);
});

// ── The other two refusals ──

for (const action of REF_ACTIONS) {
  test(`${action.action} with the submit control's ref is refused as not offered, without consulting the page`, async () => {
    // Given a real snapshot, which lists the submit control with no ref
    const page = applicationForm();
    const offered = page.snapshot();
    assert.equal(offered.has(page.ref("submit")), false, "the snapshot holds the submit control back");

    // When the planner names the ref it was never given
    const outcome = await act(page, { ...action, ref: page.ref("submit") }, offered);

    // Then it is refused on the ref alone: no selector is resolved at all
    assert.equal(outcome.refusal, "not-offered");
    assert.equal(outcome.note, "not offered this turn");
    assert.deepEqual(page.selectors, []);
    assertUntouched(page);
  });
}

test("a ref from another turn, or one the planner made up, is refused as not offered", async () => {
  // Given refs no snapshot of this page produced, one of them hostile and long
  const page = applicationForm();
  const invented = `x"],[type="submit"],[data-co-ref="${"y".repeat(40)}`;

  for (const ref of ["eold-3", invented, 7]) {
    // When the planner clicks them
    const outcome = await act(page, { action: "click", ref });

    // Then each is refused, never reaches a selector, and is quoted capped
    assert.equal(outcome.refusal, "not-offered", String(ref));
    assert.equal(outcome.detail, `blocked ref ${String(ref).slice(0, 24)} (not offered this turn)`);
    assert.deepEqual(page.selectors, []);
    assertUntouched(page);
  }
});

for (const action of REF_ACTIONS) {
  test(`${action.action} on an element that left the page after the snapshot is refused as gone`, async () => {
    // Given a control the snapshot offered, removed before the action
    const page = applicationForm();
    const offered = page.snapshot();
    page.el("next").attached = false;

    // When the planner acts on it
    const outcome = await act(page, { ...action, ref: page.ref("next") }, offered);

    // Then it is reported as gone, not as a submit control
    assert.equal(outcome.refusal, "gone");
    assert.equal(outcome.note, "element gone");
    assert.equal(outcome.detail, `blocked ref ${page.ref("next")} (gone)`);
    assertUntouched(page);
  });
}

test("an element that cannot be read is refused as gone, and its handle is released", async () => {
  // Given a control that resolves, then detaches before its facts are read
  const page = applicationForm();
  const offered = page.snapshot();
  const resolve = page.$.bind(page);
  page.$ = async (selector) => {
    const handle = await resolve(selector);
    handle.el.attached = false;
    return handle;
  };

  // When the planner clicks it
  const outcome = await act(page, { action: "click", ref: page.ref("next") }, offered);

  // Then unreadable counts as refused: what cannot be described cannot be cleared
  assert.equal(outcome.refusal, "gone");
  assert.equal(page.handles.length, 1);
  assertUntouched(page);
});

test("a frame that cannot resolve the selector refuses as gone instead of throwing", async () => {
  // Given a frame that navigated away under the loop
  const page = applicationForm();
  const offered = page.snapshot();
  page.$ = async () => {
    throw new Error("Execution context was destroyed");
  };

  // When the planner clicks
  const outcome = await act(page, { action: "click", ref: page.ref("next") }, offered);

  // Then the turn is a refusal the loop can report
  assert.equal(outcome.refusal, "gone");
  assertUntouched(page);
});

// ── Ordinary actions still go through ──

test("click on an ordinary control clicks it", async () => {
  const page = applicationForm();

  const outcome = await act(page, { action: "click", ref: page.ref("next") });

  assert.deepEqual(outcome, { detail: 'click "Next step"', note: "", refusal: undefined });
  assert.deepEqual(page.log, ["click:next"]);
  assert.equal(page.form.submits, 0);
  assert.ok(page.handles.every((h) => h.disposed));
});

test("type fills a field", async () => {
  const page = applicationForm();

  const outcome = await act(page, { action: "type", ref: page.ref("name"), text: "Jane Doe" });

  assert.deepEqual(outcome, { detail: "type into Full name", note: "", refusal: undefined });
  assert.deepEqual(page.log, ["fill:name=Jane Doe"]);
});

test("type falls back to click-then-keyboard on a control fill() rejects", async () => {
  // Given a scripted combobox, which is not something fill() accepts
  const page = applicationForm();

  // When the planner types into it
  const outcome = await act(page, { action: "type", ref: page.ref("pronouns"), text: "they/them" });

  // Then the fallback runs, on the same cleared element
  assert.equal(outcome.refusal, undefined);
  assert.deepEqual(page.log, ["click:pronouns", "keyboard:they/them"]);
  assert.equal(page.form.submits, 0);
});

test("a line break in typed text never submits the form (GHSA-rm8h-2825-ww26)", async () => {
  // Given a control fill() rejects, and a planner text that ends in a line break
  const page = applicationForm();

  // When the planner types "she/her\n", "a\r\nb" and "x\r" into it
  for (const text of ["she/her\n", "a\r\nb", "x\r"]) await act(page, { action: "type", ref: page.ref("pronouns"), text });

  // Then the fallback inserts the text with the breaks flattened, presses no key, and nothing is submitted
  assert.deepEqual(page.log.filter((l) => l.startsWith("keyboard")), ["keyboard:she/her ", "keyboard:a b", "keyboard:x "]);
  assert.equal(page.form.submits, 0);
});

test("select picks an option by label, and falls back to its value", async () => {
  const page = applicationForm();

  const byLabel = await act(page, { action: "select", ref: page.ref("country"), value: "Germany" });
  const byValue = await act(page, { action: "select", ref: page.ref("country"), value: "FR" });

  assert.equal(byLabel.detail, 'select "Germany"');
  assert.equal(byValue.refusal, undefined);
  assert.deepEqual(page.log, ["select:country=DE (by label)", "select:country=FR (by value)"]);
});

test("scroll scrolls the page and resolves no element", async () => {
  const page = applicationForm();

  const outcome = await act(page, { action: "scroll" });

  assert.deepEqual(outcome, { detail: "scroll", note: "", refusal: undefined });
  assert.deepEqual(page.log, ["scroll"]);
  assert.deepEqual(page.selectors, []);
});

test("there is no submit verb, and a ref-less click does nothing", async () => {
  // Given actions outside the vocabulary: a verb that does not exist, on its
  // own and aimed at an ordinary control, and a click that names nothing
  const page = applicationForm();

  const outcomes = [
    await act(page, { action: "submit" }),
    await act(page, { action: "submit", ref: page.ref("next") }),
    await act(page, { action: "click" }),
  ];

  // Then each is reported as unknown and nothing is done
  assert.deepEqual(outcomes.map((o) => o.detail), ["unknown action submit", "unknown action submit", "unknown action click"]);
  assertUntouched(page);
});

test("an action that fails is reported, not thrown, and its handle is released", async () => {
  // Given a control Playwright times out on
  const page = applicationForm();
  page.el("next").clickFails = true;

  // When the planner clicks it
  const outcome = await act(page, { action: "click", ref: page.ref("next") });

  // Then the loop gets a step to show, its message capped at 50 chars, and no refusal
  assert.equal(outcome.detail, "click failed: Timeout 6000ms exceeded while waiting for the elem");
  assert.equal(outcome.refusal, undefined);
  assertUntouched(page);
});

// ── A scripted run ──

test("a scripted planner fills the form and never submits it, however it tries", async () => {
  // Given a planner that does its job and then goes for the button: by the ref
  // it was never offered, by typing into it, and finally through a pager that
  // became the final button after the snapshot it was read from
  const page = applicationForm();
  const script = [
    (p) => ({ action: "type", ref: p.ref("name"), text: "Jane Doe" }),
    (p) => ({ action: "select", ref: p.ref("country"), value: "Germany" }),
    (p) => ({ action: "type", ref: p.ref("pronouns"), text: "she/her" }),
    (p) => ({ action: "click", ref: p.ref("submit") }),
    (p) => ({ action: "type", ref: p.ref("submit"), text: "\n" }),
    (p) => ({ action: "select", ref: p.ref("submit"), value: "Submit application" }),
    (p) => {
      const stale = { action: "click", ref: p.ref("next") };
      Object.assign(p.el("next"), { textContent: "Submit application", submits: true });
      return stale;
    },
  ];

  // When the loop runs it, one snapshot and one action per turn
  const refusals = [];
  for (const plan of script) {
    const offered = page.snapshot();
    refusals.push((await act(page, plan(page), offered)).refusal);
  }

  // Then the fields are filled, every attempt on the button is refused for the
  // right reason, and the form was never submitted
  assert.deepEqual(refusals, [undefined, undefined, undefined, "not-offered", "not-offered", "not-offered", "submit-control"]);
  assert.deepEqual(page.log, ["fill:name=Jane Doe", "select:country=DE (by label)", "click:pronouns", "keyboard:she/her"]);
  assert.equal(page.form.submits, 0);
  assert.ok(page.handles.every((h) => h.disposed));
});

// ── The loop uses this executor, and only this executor ──

const DRIVE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/lib/apply/drive.ts"), "utf8");
// Comments describe actions; only code performs them.
const DRIVE_CODE = DRIVE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("driveSession hands every action to executeAction, with this turn's actionable refs", () => {
  assert.match(DRIVE, /import\s*\{[^}]*\bexecuteAction\b[^}]*\}\s*from\s*"\.\/drive-action\.mjs"/);
  const calls = DRIVE_CODE.match(/\bexecuteAction\(/g) ?? [];
  assert.equal(calls.length, 1, "drive.ts must execute planner actions in exactly one place");
  assert.match(DRIVE_CODE, /await executeAction\(page, frame, act, snap\.actionable\)/);
});

test("drive.ts does nothing to an element itself", () => {
  // The snapshot's own `evaluate` and `$$` read the page; these act on it. One
  // of them appearing in drive.ts is an action path the guard above never sees.
  const acting = /\.(click|dblclick|tap|fill|type|press|pressSequentially|check|uncheck|setChecked|selectOption|setInputFiles|dispatchEvent|focus|hover|dragTo)\(/g;
  assert.deepEqual(DRIVE_CODE.match(acting) ?? [], [], "element actions belong in drive-action.mjs, behind the submit guard");
  // Anchor: the pattern must be able to see an action when there is one.
  assert.ok("await target.click({ timeout: 6000 })".match(acting));
});

test("the snapshot and the executor read element facts through the same extractor", () => {
  // Two extractors would eventually disagree about one element, and the planner
  // would be offered a control the executor classifies differently.
  assert.match(DRIVE, /import\s*\{[^}]*\bfactsOf\b[^}]*\}\s*from\s*"\.\/drive-action\.mjs"/);
  assert.match(DRIVE_CODE, /\.evaluate\(factsOf, null\)/);
  assert.doesNotMatch(DRIVE_CODE, /\bconst factsOf\b|\bfunction factsOf\b/);
});
