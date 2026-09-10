// The logo resolver's domain guesser: a company name -> the domains we probe.
//
// This decides whether a company can EVER get a logo, because the cache never
// expires and stores misses as an empty sentinel (see logo-cache-key.mjs). A
// domain that was never going to resolve is therefore written down as "this
// company has no logo", permanently — so a stem that is merely *plausible* is
// not good enough, it has to be the one the real domain uses.
//
// The stems used to be built by DELETING every character outside [a-z0-9],
// which is the defect lib/ascii-fold.mjs exists to end. Its docstring names
// verify-portals.mjs (#2930) and providers/_trust-validator.mjs (#2924) as the
// two prior instances; this was a third, in the one place where the result is
// cached forever.
//
// Run:  node --test tests/lib/company-domains.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { companyDomains } from "../../src/lib/core/company-domains.mjs";
import { COMPANY_KEY_VERSION } from "../../src/lib/core/logo-cache-key.mjs";

const first = (name) => companyDomains(name)[0] ?? null;

// EXACT membership, deliberately not `list.includes(domain)`. CodeQL reads an
// `includes` whose argument looks like a host as js/incomplete-url-substring-
// sanitization and flags every one of these (7 alerts on the first push of this
// PR). It is a false positive here — these are whole domain strings in an
// array, not a substring test against a URL — but Set.has says what is actually
// meant, so the query has nothing to misread and the assertion gets stricter
// rather than merely quieter.
const offers = (list, domain) => new Set(list).has(domain);

test("an accented name resolves the domain it actually has", () => {
  for (const [name, domain] of [
    ["Telefónica", "telefonica.com"],
    ["Škoda", "skoda.com"],
    ["Ørsted", "orsted.com"],
    ["Nestlé", "nestle.com"],
    ["Bâloise", "baloise.com"],
    ["Sparkasse Köln", "sparkassekoln.com"],
    ["Peugeot Citroën", "peugeotcitroen.com"],
  ]) {
    assert.equal(first(name), domain, `${name} probed the wrong domain first`);
  }
});

test("Société Générale gets both its full stem and its first word", () => {
  const out = companyDomains("Société Générale");
  assert.ok(offers(out, "societegenerale.com"), `missing societegenerale.com: ${out}`);
  assert.ok(offers(out, "societe.com"), `missing the firstWord stem: ${out}`);
  // The pre-fold resolver produced neither.
  assert.ok(![...out].some((d) => d.startsWith("socitgnrale")), `a deleted-letter stem survives: ${out}`);
});

test("plain ASCII names are completely unchanged", () => {
  // The fold must be invisible to every name that was already resolving. These
  // are the exact outputs the pre-fold implementation produced.
  assert.deepEqual(companyDomains("AT&T"), ["atandt.com", "att.com", "atandt.ai", "att.ai", "atandt.io"]);
  assert.deepEqual(companyDomains("Amazon.com Services LLC").slice(0, 2), ["amazoncomservicesllc.com", "amazoncom.com"]);
  assert.deepEqual(companyDomains("Acme").slice(0, 2), ["acme.com", "acme.ai"]);
  assert.deepEqual(companyDomains("O'Reilly Media").slice(0, 2), ["oreillymedia.com", "oreilly.com"]);
});

test("& becomes 'and' before folding, and firstWord is folded separately", () => {
  // Two easy ways to get this wrong: fold first (the fold DELETES &, so AT&T
  // would become "att" and lose the atandt stem), or derive firstWord from the
  // &-expanded string (AT&T's first word would become "atandt", not "att").
  const out = companyDomains("AT&T");
  assert.ok(offers(out, "atandt.com"), `& must expand to "and": ${out}`);
  assert.ok(offers(out, "att.com"), `firstWord must fold the raw token: ${out}`);
});

test("a name with no Latin content yields no stems rather than a bad guess", () => {
  // Deliberate, and the same answer the core fold documents: no ASCII domain
  // can contain it, so probing one would only cache a miss. The route turns an
  // empty list into a 404 and the client falls back to its monogram.
  for (const name of ["日本電産", "Яндекс", "Ελλάδα"]) {
    assert.deepEqual(companyDomains(name), [], `${name} produced a guess`);
  }
});

test("a curated brand domain still wins, and comes first", () => {
  const curated = (n) => (n === "Notion" ? "notion.so" : null);
  const out = companyDomains("Notion", curated);
  assert.equal(out[0], "notion.so", "the curated map must outrank the slug guesses");
  assert.ok(offers(out, "notion.com"), "the slug guesses are still offered as fallbacks");
});

test("a parenthesised acronym is still a stem, and parens are stripped from the base", () => {
  const out = companyDomains("Acme Holdings (5WPR)");
  assert.ok(offers(out, "5wpr.com"), `acronym stem missing: ${out}`);
  assert.ok(offers(out, "acmeholdings.com"), `base stem missing: ${out}`);
});

test("at most five candidates, deduplicated", () => {
  const out = companyDomains("Acme");
  assert.ok(out.length <= 5, `${out.length} candidates`);
  assert.equal(new Set(out).size, out.length, "duplicates leaked through");
});

test("the cache key version was bumped for this resolver change", () => {
  // logo-cache-key.mjs's own docstring makes this mandatory: the cache never
  // expires and misses are stored as an empty sentinel, so without a bump every
  // warm install keeps serving the permanent "no logo" this change exists to
  // fix — to exactly the companies it fixes it for.
  assert.notEqual(COMPANY_KEY_VERSION, "v3", "companyDomains() changed while COMPANY_KEY_VERSION stayed at v3");
});
