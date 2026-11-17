// The filler used to type a sponsorship "No", a salary, a source, a years
// figure, a start date, and an essay the profile never stated.
//
// Run from web/: node --experimental-strip-types --test tests/lib/apply-blank-unknown.test.mjs

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  blankUnknownDraft,
  classifyApplyQuestion,
  listedDriveClick,
  listedDriveText,
  prepareFillAnswers,
  prepareLabeledAnswers,
  readApplyProfile,
  statedAnswer,
} from "../../src/lib/apply/blank-unknown.mjs";

const here = dirname(fileURLToPath(import.meta.url));

test("a guess is cleared and a profile fact is kept", () => {
  const fields = [
    { id: "sponsor", type: "radio", label: "Will you now or in the future require visa sponsorship?", options: ["Yes", "No"] },
    { id: "salary", type: "text", label: "Desired salary" },
    { id: "history", type: "text", label: "Salary history" },
    { id: "hear", type: "select", label: "How did you hear about us?", options: ["LinkedIn", "A friend"] },
    { id: "years", type: "number", label: "Years of experience" },
    { id: "start", type: "date", label: "Earliest start date" },
    { id: "move", type: "radio", label: "Are you willing to relocate?", options: ["Yes", "No"] },
    { id: "essay", type: "textarea", label: "Why do you want this role?" },
    { id: "auth", type: "checkbox", label: "I am authorized to work in the United States" },
    { id: "gender", type: "select", label: "Gender", options: ["Decline to self-identify", "Woman"] },
    { id: "name", type: "text", label: "First name" },
    { id: "role", type: "textarea", label: "Role description" },
  ];
  const draft = {
    sponsor: { value: "No", needs_confirmation: false },
    salary: { value: "180000", needs_confirmation: false },
    history: { value: "90000", needs_confirmation: false },
    hear: { value: "LinkedIn", needs_confirmation: false },
    years: { value: "12", needs_confirmation: false },
    start: { value: "2026-12-01", needs_confirmation: false },
    move: { value: "Yes", needs_confirmation: false },
    essay: { value: "A drafted sentence.", needs_confirmation: false },
    auth: { value: "yes", needs_confirmation: false },
    gender: { value: "Woman", needs_confirmation: false },
    name: { value: "Fixture", needs_confirmation: false },
    role: { value: "Kept the queue moving.", needs_confirmation: false },
  };

  const cleared = blankUnknownDraft(fields, draft, {});
  for (const id of ["sponsor", "salary", "history", "hear", "years", "start", "move", "essay", "auth", "gender"]) {
    assert.equal(cleared[id].value, "", `${id} kept a guess`);
    assert.equal(cleared[id].needs_confirmation, true);
  }
  assert.equal(cleared.name.value, "Fixture");
  assert.equal(cleared.role.value, "Kept the queue moving.");

  const profile = {
    location: {
      needs_sponsorship: false,
      willing_to_relocate: false,
      authorized_in: ["United States"],
    },
    compensation: { target_range: "140000" },
    years_experience: "4",
    availability: { start_date: "2026-04-01" },
    source: "A friend",
    apply: { answers: { "why do you want this role?": "The profile states this sentence." } },
  };
  const kept = blankUnknownDraft(fields, draft, profile);
  assert.equal(kept.sponsor.value, "No");
  assert.equal(kept.sponsor.needs_confirmation, false);
  assert.equal(kept.salary.value, "140000");
  assert.equal(kept.history.value, "");
  assert.equal(kept.hear.value, "A friend");
  assert.equal(kept.years.value, "4");
  assert.equal(kept.start.value, "2026-04-01");
  assert.equal(kept.move.value, "No");
  assert.equal(kept.essay.value, "The profile states this sentence.");
  assert.equal(kept.auth.value, "yes");
  assert.equal(kept.gender.value, "");

  const typed = prepareFillAnswers({
    fields,
    answers: { salary: "180000", name: "Fixture" },
    profile: {},
    edited: ["salary"],
  });
  assert.equal(typed.salary, "180000");
  assert.equal(typed.name, "Fixture");

  const labeled = prepareLabeledAnswers(
    [{ label: "Desired salary", value: "180000" }, { label: "First name", value: "Fixture" }],
    {},
    ["Desired salary"],
  );
  assert.deepEqual(labeled, [
    { label: "Desired salary", value: "180000" },
    { label: "First name", value: "Fixture" },
  ]);
  assert.equal(classifyApplyQuestion({ type: "file", label: "Cover letter" }), null);
});

test("a number salary box gets the bottom of the profile range", () => {
  const field = { type: "number", label: "Desired salary" };
  const text = { type: "text", label: "Desired salary" };
  const answer = (range) => statedAnswer("salary", field, { compensation: { target_range: range } });
  assert.equal(answer("$150K-200K"), "150000");
  assert.equal(answer("EUR 95K-130K"), "95000");
  assert.equal(answer("95-120K"), "95000");
  assert.equal(answer("$180,000"), "180000");
  assert.equal(answer("180k"), "180000");
  assert.equal(answer("140000"), "140000");
  assert.equal(answer(""), null);
  assert.equal(answer("$45/hr"), null);
  assert.equal(statedAnswer("salary", text, { compensation: { target_range: "$150K-200K" } }), "$150K-200K");
});

test("an open-ended salary floor fills a number box", () => {
  const field = { type: "number", label: "Desired salary" };
  const answer = (range) => statedAnswer("salary", field, { compensation: { target_range: range } });
  assert.equal(answer("$150K+"), "150000");
  assert.equal(answer("150000+"), "150000");
  assert.equal(answer("$45/hr"), null);
});

test("fill, prefill, and drive call the gate", () => {
  const root = join(here, "../..");
  const fill = readFileSync(join(root, "src/app/api/apply/fill/route.ts"), "utf8");
  const prefill = readFileSync(join(root, "src/app/api/apply/prefill/route.ts"), "utf8");
  const drive = readFileSync(join(root, "src/app/api/apply/drive/route.ts"), "utf8");
  assert.match(fill, /prepareFillAnswers\(/);
  assert.match(prefill, /blankUnknownDraft\(/);
  assert.match(drive, /prepareLabeledAnswers\(answers, profile, editedLabels, s\.fields\)/);
  assert.match(drive, /answers must be an array/);
  assert.match(prefill, /could not read the profile/);
});

test("authorized to work without sponsorship is Yes when the profile says so", () => {
  const profile = {
    location: {
      needs_sponsorship: false,
      authorized_in: ["United States"],
    },
  };
  const fields = [
    {
      id: "auth",
      type: "radio",
      label: "Are you legally authorized to work in the United States without the need for visa sponsorship?",
      options: ["Yes", "No"],
    },
    {
      id: "sponsor",
      type: "radio",
      label: "Will you now or in the future require visa sponsorship?",
      options: ["Yes", "No"],
    },
    {
      id: "canada",
      type: "radio",
      label: "Are you legally authorized to work in Canada without the need for visa sponsorship?",
      options: ["Yes", "No"],
    },
  ];
  const filled = prepareFillAnswers({ fields, profile });
  assert.equal(filled.auth, "Yes");
  assert.equal(filled.sponsor, "No");
  assert.equal(filled.canada, "");
});

test("sponsorship questions that also mention work authorization follow needs_sponsorship", () => {
  const labels = [
    "Will you now or in the future require sponsorship for employment visa status (e.g., H-1B) to be authorized to work in the United States?",
    "Will you now or in the future require visa sponsorship to be eligible to work in the United States?",
    "Will you require sponsorship or work authorization in the United States?",
  ];
  const profiles = {
    no: { location: { needs_sponsorship: false, authorized_in: ["United States"] } },
    yes: { location: { needs_sponsorship: true, authorized_in: ["United States"] } },
    missing: { location: { authorized_in: ["United States"] } },
  };
  for (const label of labels) {
    const field = { id: "q", type: "radio", label, options: ["Yes", "No"] };
    assert.equal(classifyApplyQuestion(field), "sponsorship", label);
    const declined = blankUnknownDraft([field], { q: { value: "Yes", needs_confirmation: false } }, profiles.no);
    assert.equal(declined.q.value, "No", label);
    assert.equal(declined.q.needs_confirmation, false, label);
    const needed = blankUnknownDraft([field], { q: { value: "No", needs_confirmation: false } }, profiles.yes);
    assert.equal(needed.q.value, "Yes", label);
    assert.equal(needed.q.needs_confirmation, false, label);
    const unstated = blankUnknownDraft([field], { q: { value: "Yes", needs_confirmation: false } }, profiles.missing);
    assert.equal(unstated.q.value, "", label);
    assert.equal(unstated.q.needs_confirmation, true, label);
    const fill = prepareFillAnswers({ fields: [field], answers: { q: "Yes" }, profile: profiles.no });
    assert.equal(fill.q, "No", label);
  }
});

test("a plain work-authorization question stays on authorized_in", () => {
  const field = {
    id: "q",
    type: "radio",
    label: "Are you legally authorized to work in the United States?",
    options: ["Yes", "No"],
  };
  assert.equal(classifyApplyQuestion(field), "work-authorization");
  for (const needs of [false, true, undefined]) {
    const location = { authorized_in: ["United States"] };
    if (needs !== undefined) location.needs_sponsorship = needs;
    const draft = blankUnknownDraft(
      [field],
      { q: { value: "No", needs_confirmation: false } },
      { location },
    );
    assert.equal(draft.q.value, "Yes", String(needs));
    assert.equal(draft.q.needs_confirmation, false, String(needs));
  }
  const elsewhere = blankUnknownDraft(
    [field],
    { q: { value: "Yes", needs_confirmation: false } },
    { location: { needs_sponsorship: false, authorized_in: ["Canada"] } },
  );
  assert.equal(elsewhere.q.value, "");
  assert.equal(elsewhere.q.needs_confirmation, true);
});

test("a label that names sponsorship and work authorization without asking either stays blank", () => {
  const field = {
    id: "q",
    type: "radio",
    label: "Work authorization or visa sponsorship in the United States",
    options: ["Yes", "No"],
  };
  const draft = blankUnknownDraft(
    [field],
    { q: { value: "Yes", needs_confirmation: false } },
    { location: { needs_sponsorship: false, authorized_in: ["United States"] } },
  );
  assert.equal(draft.q.value, "");
  assert.equal(draft.q.needs_confirmation, true);
  assert.equal(prepareFillAnswers({
    fields: [field],
    answers: { q: "Yes" },
    profile: { location: { needs_sponsorship: true, authorized_in: ["United States"] } },
  }).q, "");
});

test("a negated sponsorship clause stays on the authorization answer", () => {
  const labels = [
    "Are you authorized to work in the United States and do not require sponsorship?",
    "Are you eligible to work in the United States with no need for visa sponsorship?",
    "Can you work in the United States without requiring sponsorship?",
    "I do not require visa sponsorship to work in the United States",
  ];
  const profiles = {
    no: { location: { needs_sponsorship: false, authorized_in: ["United States"] } },
    yes: { location: { needs_sponsorship: true, authorized_in: ["United States"] } },
    missing: { location: { authorized_in: ["United States"] } },
  };
  for (const label of labels) {
    const field = { id: "q", type: "radio", label, options: ["Yes", "No"] };
    assert.equal(classifyApplyQuestion(field), "work-authorization", label);
    const declined = blankUnknownDraft([field], { q: { value: "No", needs_confirmation: false } }, profiles.no);
    assert.equal(declined.q.value, "Yes", label);
    assert.equal(declined.q.needs_confirmation, false, label);
    const needed = blankUnknownDraft([field], { q: { value: "Yes", needs_confirmation: false } }, profiles.yes);
    assert.equal(needed.q.value, "No", label);
    assert.equal(needed.q.needs_confirmation, false, label);
    const unstated = blankUnknownDraft([field], { q: { value: "Yes", needs_confirmation: false } }, profiles.missing);
    assert.equal(unstated.q.value, "", label);
    assert.equal(unstated.q.needs_confirmation, true, label);
  }
  const elsewhere = blankUnknownDraft(
    [{
      id: "q",
      type: "radio",
      label: "Are you authorized to work in the United States and do not require sponsorship?",
      options: ["Yes", "No"],
    }],
    { q: { value: "Yes", needs_confirmation: false } },
    { location: { needs_sponsorship: false, authorized_in: ["Canada"] } },
  );
  assert.equal(elsewhere.q.value, "");
  assert.equal(elsewhere.q.needs_confirmation, true);
});

test("authorized without sponsorship is No when sponsorship is needed", () => {
  const field = {
    id: "auth",
    type: "radio",
    label: "Are you legally authorized to work in the United States without the need for visa sponsorship?",
    options: ["Yes", "No"],
  };
  const needed = blankUnknownDraft(
    [field],
    { auth: { value: "Yes", needs_confirmation: false } },
    { location: { needs_sponsorship: true, authorized_in: ["United States"] } },
  );
  assert.equal(needed.auth.value, "No");
  assert.equal(needed.auth.needs_confirmation, false);
  const unstated = blankUnknownDraft(
    [field],
    { auth: { value: "Yes", needs_confirmation: false } },
    { location: { authorized_in: ["United States"] } },
  );
  assert.equal(unstated.auth.value, "");
  assert.equal(unstated.auth.needs_confirmation, true);
});

test("current or previous pay stays blank instead of using the desired range", () => {
  const profile = { compensation: { target_range: "$150K-200K" } };
  const fields = [
    { id: "current", type: "text", label: "What is your current salary?" },
    { id: "previous", type: "text", label: "Previous compensation" },
    { id: "last", type: "text", label: "Last pay" },
    { id: "desired", type: "text", label: "Desired salary" },
    { id: "history", type: "text", label: "Salary history" },
  ];
  const filled = prepareFillAnswers({ fields, profile });
  assert.equal(filled.current, "");
  assert.equal(filled.previous, "");
  assert.equal(filled.last, "");
  assert.equal(filled.history, "");
  assert.equal(filled.desired, "$150K-200K");
});

test("an hourly or monthly pay box does not get the annual range", () => {
  const profile = { compensation: { target_range: "$150K-200K" } };
  const fields = [
    { id: "hourly", type: "number", label: "Desired hourly wage" },
    { id: "monthly", type: "number", label: "Expected monthly salary" },
    { id: "annual", type: "number", label: "Desired salary" },
  ];
  const filled = prepareFillAnswers({ fields, profile });
  assert.equal(filled.hourly, "");
  assert.equal(filled.monthly, "");
  assert.equal(filled.annual, "150000");
});

test("work authorization answers follow the question, and a short country code is a whole word", () => {
  const profile = { location: { authorized_in: ["United States", "US"] } };
  const fields = [
    { id: "require", type: "radio", label: "Do you require work authorization in the United States?", options: ["Yes", "No"] },
    { id: "notbox", type: "checkbox", label: "I am not authorized to work in the United States" },
    { id: "eligible", type: "radio", label: "Are you eligible to work in the United States?", options: ["Yes", "No"] },
    { id: "yesbox", type: "checkbox", label: "I am authorized to work in the United States" },
    { id: "aus", type: "radio", label: "Are you authorized to work in Australia?", options: ["Yes", "No"] },
  ];
  const draft = {
    require: { value: "Yes", needs_confirmation: false },
    notbox: { value: "yes", needs_confirmation: false },
    eligible: { value: "No", needs_confirmation: false },
    yesbox: { value: "no", needs_confirmation: false },
    aus: { value: "Yes", needs_confirmation: false },
  };
  const gated = blankUnknownDraft(fields, draft, profile);
  assert.equal(gated.require.value, "No");
  assert.equal(gated.notbox.value, "no");
  assert.equal(gated.eligible.value, "Yes");
  assert.equal(gated.yesbox.value, "yes");
  assert.equal(gated.aus.value, "");
  assert.equal(gated.aus.needs_confirmation, true);
});

test("demographic and conviction guesses are cleared", () => {
  const fields = [
    { id: "hispanic", type: "select", label: "Are you Hispanic or Latino?", options: ["Yes", "No", "Decline to self-identify"] },
    { id: "orient", type: "select", label: "Sexual orientation" },
    { id: "felony", type: "radio", label: "Have you ever been convicted of a felony?", options: ["Yes", "No"] },
    { id: "gender", type: "select", label: "Gender", options: ["Decline to self-identify", "Woman"] },
  ];
  const draft = {
    hispanic: { value: "No", needs_confirmation: false },
    orient: { value: "Decline to self-identify", needs_confirmation: false },
    felony: { value: "No", needs_confirmation: false },
    gender: { value: "Woman", needs_confirmation: false },
  };
  const gated = blankUnknownDraft(fields, draft, {});
  for (const id of ["hispanic", "orient", "felony", "gender"]) {
    assert.equal(gated[id].value, "", id);
    assert.equal(gated[id].needs_confirmation, true, id);
  }
});

test("total years fill only a total-experience question", () => {
  const profile = { years_experience: "8" };
  const fields = [
    { id: "total", type: "number", label: "Years of experience" },
    { id: "intotal", type: "number", label: "How many years of experience in total do you have?" },
    { id: "overall", type: "number", label: "Years of experience overall" },
    { id: "python", type: "number", label: "How many years of Python?" },
    { id: "address", type: "number", label: "How many years have you lived at your current address?" },
  ];
  const draft = {
    total: { value: "", needs_confirmation: true },
    intotal: { value: "2", needs_confirmation: false },
    overall: { value: "4", needs_confirmation: false },
    python: { value: "2", needs_confirmation: false },
    address: { value: "3", needs_confirmation: false },
  };
  const gated = blankUnknownDraft(fields, draft, profile);
  assert.equal(classifyApplyQuestion(fields[1]), "years");
  assert.equal(classifyApplyQuestion(fields[2]), "years");
  assert.equal(gated.total.value, "8");
  assert.equal(gated.intotal.value, "8");
  assert.equal(gated.overall.value, "8");
  assert.equal(gated.python.value, "2");
  assert.equal(gated.address.value, "3");
  const filled = prepareFillAnswers({ fields, profile });
  assert.equal(filled.total, "8");
  assert.equal(filled.intotal, "8");
  assert.equal(filled.overall, "8");
  assert.equal("python" in filled, false);
  assert.equal("address" in filled, false);
});

test("years with a named skill stay blank, and race is a whole word", () => {
  const profile = { years_experience: "8" };
  const python = { id: "python", type: "number", label: "Years of experience with Python" };
  const forPython = { id: "forpy", type: "number", label: "Years of experience for Python" };
  const rewards = { id: "rewards", type: "number", label: "Years of experience in Total Rewards" };
  const embrace = { id: "story", type: "text", label: "Describe a time you had to embrace a new tool" };
  assert.equal(classifyApplyQuestion(python), "years-specific");
  assert.equal(classifyApplyQuestion(forPython), "years-specific");
  assert.equal(classifyApplyQuestion(rewards), "years-specific");
  assert.equal(classifyApplyQuestion({ type: "select", label: "Race/Ethnicity" }), "eeo");
  assert.equal(classifyApplyQuestion({ type: "select", label: "Racial background" }), "eeo");
  assert.equal(classifyApplyQuestion(embrace), null);
  const gated = blankUnknownDraft(
    [python, forPython, rewards, embrace],
    {
      python: { value: "5", needs_confirmation: false },
      forpy: { value: "5", needs_confirmation: false },
      rewards: { value: "8", needs_confirmation: false },
      story: { value: "I learned the CRM.", needs_confirmation: false },
    },
    profile,
  );
  assert.equal(gated.python.value, "");
  assert.equal(gated.python.needs_confirmation, true);
  assert.equal(gated.forpy.value, "");
  assert.equal(gated.forpy.needs_confirmation, true);
  assert.equal(gated.rewards.value, "");
  assert.equal(gated.story.value, "I learned the CRM.");
  const filled = prepareFillAnswers({ fields: [python, forPython], answers: { python: "5", forpy: "5" }, profile });
  assert.equal(filled.python, "");
  assert.equal(filled.forpy, "");
});

test("a full drive may type only a listed answer value", () => {
  const answers = [
    { label: "Years of experience", value: "8" },
    { label: "Name", value: "Ada Lovelace" },
  ];
  assert.equal(listedDriveText("8", answers, "Years of experience"), true);
  assert.equal(listedDriveText("  ada   lovelace ", answers, "Name"), true);
  assert.equal(listedDriveText("8", answers), false);
  assert.equal(listedDriveText("", answers), true);
  assert.equal(listedDriveText("   ", answers), true);
  assert.equal(listedDriveText("-", []), false);
  assert.equal(listedDriveText("-", answers, ""), false);
  assert.equal(listedDriveText("?", null), false);
  assert.equal(listedDriveText(" - ", []), false);
  assert.equal(listedDriveText("8.", answers, "Years of experience"), true);
  assert.equal(listedDriveText("I will need sponsorship", answers), false);
  assert.equal(listedDriveText("8", []), false);
  assert.equal(listedDriveText("8", null), false);
  assert.equal(listedDriveText("", null), true);
  const relocate = { label: "Are you willing to relocate?", value: "Yes" };
  assert.equal(listedDriveText("Yes", [relocate]), false);
  assert.equal(listedDriveText("Yes", [relocate], "Will you require sponsorship?"), false);
  assert.equal(listedDriveText("Yes", [relocate], "Are you willing to relocate?"), true);
  assert.equal(listedDriveText("Yes!", [relocate], "Are you willing to relocate?"), true);
  assert.equal(listedDriveClick("radio", "Yes", "Will you require sponsorship?", [relocate]), false);
  assert.equal(listedDriveClick("radio", "Yes", "Are you willing to relocate?", [relocate]), true);
  assert.equal(listedDriveClick("radio", "Yes", "", [relocate]), false);
  assert.equal(listedDriveClick("button", "Next", "", [relocate]), true);
});

test("labeled drive answers use the real field, not a text stand-in", () => {
  const profile = { compensation: { target_range: "$150K-200K" }, source: "LinkedIn" };
  const fields = [
    { id: "pay", type: "number", label: "Desired salary" },
    { id: "hear", type: "select", label: "How did you hear about us?", options: ["Referral", "Other"] },
  ];
  const labeled = prepareLabeledAnswers(
    [
      { id: "pay", label: "Desired salary", value: "$150K-200K" },
      { id: "hear", label: "How did you hear about us?", value: "LinkedIn" },
    ],
    profile,
    [],
    fields,
  );
  assert.deepEqual(labeled, [{ id: "pay", label: "Desired salary", value: "150000" }]);
});

test("a missing profile is empty and a broken profile is an error", () => {
  const saved = process.env.CAREER_OPS_PROFILE;
  delete process.env.CAREER_OPS_PROFILE;
  const root = mkdtempSync(join(tmpdir(), "apply-profile-"));
  try {
    assert.deepEqual(readApplyProfile(root), {});
    const config = join(root, "config");
    mkdirSync(config);
    const file = join(config, "profile.yml");
    writeFileSync(file, "compensation: [\n  - broken\n");
    assert.throws(() => readApplyProfile(root), /profile\.yml/);
  } finally {
    if (saved === undefined) delete process.env.CAREER_OPS_PROFILE;
    else process.env.CAREER_OPS_PROFILE = saved;
    rmSync(root, { recursive: true, force: true });
  }
});
