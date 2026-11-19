import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeTextKey } from "../../src/lib/core/normalize-text-key.mjs";
import { matchEvaluatedPosting } from "../../src/lib/evaluated-posting.mjs";

const norm = (value) => normalizeTextKey(value, " ");
const scored = [{
  n: "4",
  company: "Acme",
  role: "Operations analyst",
  url: "https://jobs.example/acme/posting-a",
}];

test("a different posting at an already scored company is not already evaluated", () => {
  const offer = {
    company: "Acme",
    title: "Operations analyst",
    url: "https://jobs.example/acme/posting-b",
  };
  assert.equal(matchEvaluatedPosting(scored, offer, norm), null);
});

test("the same posting is still already evaluated", () => {
  const offer = {
    company: "Acme",
    title: "Operations analyst",
    url: "https://jobs.example/acme/posting-a",
  };
  assert.equal(matchEvaluatedPosting(scored, offer, norm)?.n, "4");
});

test("a missing url still matches the same company and title", () => {
  const offer = { company: "Acme", title: "Operations analyst", url: "" };
  const rows = [{ n: "4", company: "Acme", role: "Operations analyst", url: "" }];
  assert.equal(matchEvaluatedPosting(rows, offer, norm)?.n, "4");
});

test("a nearby title is not evaluated when the offer has its own URL", () => {
  const rows = [{
    n: "1",
    company: "Acme",
    role: "Senior Software Engineer Backend",
    url: "",
  }];
  const offer = {
    company: "Acme",
    title: "Senior Software Engineer Frontend",
    url: "https://jobs.example/acme/frontend",
  };
  assert.equal(matchEvaluatedPosting(rows, offer, norm), null);
});

test("a tracker row with no URL matches an offer with a URL by exact company and title", () => {
  const rows = [{ n: "5", company: "Acme", role: "Operations analyst", url: "" }];
  const offer = {
    company: "Acme",
    title: "Operations analyst",
    url: "https://jobs.example/acme/posting-c",
  };
  assert.equal(matchEvaluatedPosting(rows, offer, norm)?.n, "5");
});

test("a scored URL does not match an offer that has no URL", () => {
  const offer = { company: "Acme", title: "Operations analyst", url: "" };
  assert.equal(matchEvaluatedPosting(scored, offer, norm), null);
});

test("a short role does not match a different title when both URLs are missing", () => {
  const rows = [{ n: "2", company: "Northwind", role: "Engineer", url: "" }];
  const offer = { company: "Northwind", title: "Engineering Manager", url: "" };
  assert.equal(matchEvaluatedPosting(rows, offer, norm), null);
});

test("an exact URL wins over an earlier row that has no URL", () => {
  const rows = [
    { n: "1", company: "Acme", role: "Senior Software Engineer Backend", url: "" },
    {
      n: "9",
      company: "Acme",
      role: "Operations analyst",
      url: "https://jobs.example/acme/posting-a",
    },
  ];
  const offer = {
    company: "Acme",
    title: "Senior Software Engineer Frontend",
    url: "https://jobs.example/acme/posting-a?utm_source=board",
  };
  assert.equal(matchEvaluatedPosting(rows, offer, norm)?.n, "9");
});

test("a greenhouse apply embed is the scored board posting", () => {
  const rows = [{
    n: "4",
    company: "Acme",
    role: "Engineer",
    url: "https://boards.greenhouse.io/acme/jobs/8028783",
  }];
  const offer = {
    company: "Acme",
    title: "Engineer",
    url: "https://boards.greenhouse.io/embed/job_app?for=acme&token=8028783",
  };
  assert.equal(matchEvaluatedPosting(rows, offer, norm)?.n, "4");
});

test("a lever apply link is the scored posting", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const rows = [{
    n: "7",
    company: "Acme",
    role: "Engineer",
    url: `https://jobs.lever.co/acme/${id}`,
  }];
  const offer = {
    company: "Acme",
    title: "Engineer",
    url: `https://jobs.lever.co/acme/${id}/apply`,
  };
  assert.equal(matchEvaluatedPosting(rows, offer, norm)?.n, "7");
});

test("an ashby application link is the scored posting", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const rows = [{
    n: "6",
    company: "Acme",
    role: "Engineer",
    url: `https://jobs.ashbyhq.com/acme/${id}`,
  }];
  const offer = {
    company: "Acme",
    title: "Engineer",
    url: `https://jobs.ashbyhq.com/acme/${id}/application`,
  };
  assert.equal(matchEvaluatedPosting(rows, offer, norm)?.n, "6");
});

test("an english posting and its german twin stay two evaluations", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const rows = [{
    n: "8",
    company: "Acme",
    role: "Engineer",
    url: `https://jobs.lever.co/acme/${id}?lang=en`,
  }];
  const offer = {
    company: "Acme",
    title: "Engineer",
    url: `https://jobs.lever.co/acme/${id}/apply?lang=de`,
  };
  assert.equal(matchEvaluatedPosting(rows, offer, norm), null);
});

test("a different greenhouse id is a different posting", () => {
  const rows = [{
    n: "3",
    company: "Northwind",
    role: "Operations analyst",
    url: "https://boards.example/northwind/jobs?gh_jid=100",
  }];
  const offer = {
    company: "Northwind",
    title: "Operations analyst",
    url: "https://boards.example/northwind/jobs?gh_jid=200",
  };
  assert.equal(matchEvaluatedPosting(rows, offer, norm), null);
});
