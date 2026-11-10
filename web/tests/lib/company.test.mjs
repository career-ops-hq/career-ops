// lib/company.ts: the curated brand-domain lookup and the monogram helpers.
//
// company.ts has no `@/` alias imports and no Node-only deps ("PURE,
// client-safe" per its own header), so it can be imported directly under
// --experimental-strip-types without the alias loader.
//
// The curated lookup's answer goes FIRST in the logo route's candidate list
// (companyDomains() in lib/core/company-domains.mjs). It used to fall back to
// an un-folded slug+".com" for every name the map lacked, so that guess went
// first for every company: "Telefónica" probed telefónica.com ahead of
// telefonica.com. company-domains.test.mjs never caught it because it calls
// companyDomains() with no lookup at all; the composed tests below call it with
// the one the route actually passes.
//
// Run:  node --experimental-strip-types --test tests/lib/company.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { curatedCompanyDomain, companyInitials, monogramHue } from "../../src/lib/company.ts";
import { companyDomains } from "../../src/lib/core/company-domains.mjs";

// What app/api/logo/route.ts computes for `?company=`.
const routeCandidates = (name) => companyDomains(name, curatedCompanyDomain);

test("a curated brand resolves to its domain", () => {
  assert.equal(curatedCompanyDomain("Notion"), "notion.so");
  assert.equal(curatedCompanyDomain("  ZOOM "), "zoom.us");
  assert.equal(curatedCompanyDomain("AT&T"), "att.com");
});

test("a curated brand still resolves behind a legal suffix", () => {
  assert.equal(curatedCompanyDomain("Stripe, Inc."), "stripe.com");
  assert.equal(curatedCompanyDomain("Red Hat, Inc."), "redhat.com");
  assert.equal(curatedCompanyDomain("Datadog Inc"), "datadoghq.com");
});

test("a name outside the map gets null, never a guess", () => {
  for (const name of [
    "Telefónica",
    "Société Générale",
    "Co-op Group",
    "Amazon.com Services LLC",
    "Acme",
    "日本電産",
    "",
    "   ",
    null,
    undefined,
  ]) {
    assert.equal(curatedCompanyDomain(name), null, `${JSON.stringify(name)} returned a guess`);
  }
});

test("the route's candidates put the folded stem first for a name outside the map", () => {
  // The exact lists, so a reordering is caught as well as a stray candidate.
  // "before" in each message is what the route probed when the lookup fell back
  // to an un-folded slug guess.
  const cases = [
    ["Telefónica", ["telefonica.com", "telefonica.ai", "telefonica.io", "telefonica.co"], "telefónica.com"],
    ["Škoda", ["skoda.com", "skoda.ai", "skoda.io", "skoda.co"], "škoda.com"],
    ["Société Générale", ["societegenerale.com", "societe.com", "societegenerale.ai", "societe.ai", "societegenerale.io"], "sociétégénérale.com"],
    ["Co-op Group", ["coopgroup.com", "coop.com", "coopgroup.ai", "coop.ai", "coopgroup.io"], "-op.com"],
    ["Amazon.com Services LLC", ["amazoncomservicesllc.com", "amazoncom.com", "amazoncomservicesllc.ai", "amazoncom.ai", "amazoncomservicesllc.io"], "amazoncomservices.com"],
  ];
  for (const [name, expected, before] of cases) {
    assert.deepEqual(routeCandidates(name), expected, `${name} (used to probe ${before} first)`);
  }
});

test("a name with no Latin content gets no candidates through the route either", () => {
  // company-domains.mjs documents this (no ASCII domain can contain it, so a
  // probe could only cache a miss), but the slug fallback used to hand the
  // route 日本電産.com anyway.
  for (const name of ["日本電産", "Яндекс", "Ελλάδα"]) {
    assert.deepEqual(routeCandidates(name), [], `${name} produced a guess`);
  }
});

test("curated brands keep their place at the head of the route's list", () => {
  assert.deepEqual(routeCandidates("Notion"), ["notion.so", "notion.com", "notion.ai", "notion.io", "notion.co"]);
  assert.equal(routeCandidates("Stripe, Inc.")[0], "stripe.com");
  assert.equal(routeCandidates("Red Hat, Inc.")[0], "redhat.com");
  // The slug fallback happened to put att.com first; without the map entry the
  // folded stem atandt.com would lead.
  assert.deepEqual(routeCandidates("AT&T").slice(0, 2), ["att.com", "atandt.com"]);
});

test("a hyphen joins a legal-suffix word to its neighbour instead of exposing it", () => {
  // \b treated the "co" of "Co-op" as a standalone suffix and stripped it.
  assert.equal(companyInitials("Co-op Group"), "CO");
  assert.equal(companyInitials("Coca-Cola Co"), "CC");
  // A suffix after a non-ASCII letter is part of that word, not a suffix.
  assert.equal(companyInitials("Bâco"), "BÂ");
});

test("monogram initials", () => {
  assert.equal(companyInitials("Acme Inc."), "AC");
  assert.equal(companyInitials("Société Générale"), "SG");
  assert.equal(companyInitials("日本電産"), "日本");
  assert.equal(companyInitials(""), "?");
  assert.equal(companyInitials(null), "?");
});

test("the monogram hue is deterministic and in range", () => {
  assert.equal(monogramHue("Acme"), monogramHue("  acme "));
  for (const name of ["Acme", "Telefónica", "日本電産", "", null]) {
    const hue = monogramHue(name);
    assert.ok(Number.isInteger(hue) && hue >= 0 && hue < 360, `${name}: ${hue}`);
  }
});
