// Every routable page has a loading state beside it.
//
// #4338 added one per route. Next guarantees what a loading.tsx DOES; what
// nothing guarantees is that the next route added gets one — and the failure is
// silent, because a route without a loading state simply goes back to leaving
// the previous page on screen with no feedback.
//
// Deliberately asserts only EXISTENCE and that the file renders something.
// It does not require a particular component, class or prop: #4338 composes
// page-loading-skeletons.tsx and a `Skeleton` primitive, and a future route may
// reasonably do something else. A test that mandates one spelling fails on a
// correct implementation, which teaches the next person to edit the assertion
// rather than read it.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
// The core's predicate, not a copy: tests/mjs-files.test.mjs requires every
// recursive walker over this checkout to consult it (#3499, #3762).
import { isNestedCheckout } from "../../../lib/mjs-files.mjs";

const WEB = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const APP = join(WEB, "src", "app");

/** Every directory under src/app that holds a page.tsx. */
function routeDirs(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "api") continue; // route handlers, not pages
    const child = join(dir, entry.name);
    // A second checkout parked under src/app is not this app's routes. Without
    // this the walk would demand a loading.tsx for someone else's pages and fail
    // naming files that are correct on the branch under test.
    if (isNestedCheckout(child)) continue;
    routeDirs(child, acc);
  }
  try {
    statSync(join(dir, "page.tsx"));
    acc.push(dir);
  } catch {
    /* not a route */
  }
  return acc;
}

const routes = routeDirs(APP);

test("the app still has the routes this check is meant to cover", () => {
  // A guard on the guard: if routeDirs() ever stops finding pages — a rename, a
  // move into a route group — every assertion below would pass over an empty
  // list and report as coverage.
  assert.ok(routes.length >= 10, `expected at least 10 routes, found ${routes.length}`);
});

test("every page has a loading state beside it", () => {
  const missing = routes
    .filter((d) => {
      try {
        statSync(join(d, "loading.tsx"));
        return false;
      } catch {
        return true;
      }
    })
    .map((d) => relative(APP, d).split(sep).join("/") || "/");

  assert.deepEqual(
    missing,
    [],
    "these routes have a page.tsx but no loading.tsx, so navigating to them leaves " +
      `the previous page on screen with no feedback:\n    ${missing.join("\n    ")}`,
  );
});

test("every loading state exports a component", () => {
  // Existence alone is not enough — an empty file is indistinguishable from
  // having none — but this checks ONLY for a default export.
  //
  // The first version of this also required JSX in the file, and that was wrong:
  // several of these are one-line re-exports
  //
  //     import { AnalyticsPageSkeleton } from "@/components/page-loading-skeletons";
  //     export default AnalyticsPageSkeleton;
  //
  // which is a perfectly good loading state and has no `<` in it. A check that
  // fails on a correct implementation teaches the next person to edit the
  // assertion instead of reading it.
  const empty = [];
  for (const d of routes) {
    const file = join(d, "loading.tsx");
    let src;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue; // absence is the previous test's job to report
    }
    const rel = relative(APP, d).split(sep).join("/") || "/";
    if (!/export\s+default/.test(src)) empty.push(`${rel}: no default export`);
  }
  assert.deepEqual(empty, [], `loading states with nothing to render:\n    ${empty.join("\n    ")}`);
});

test("a detail route does not inherit its parent's list skeleton", () => {
  // A loading.tsx covers its segment AND everything nested under it, so without
  // its own, /pipeline/[id] flashes a table skeleton before rendering one report
  // — a skeleton that lies about the shape of what is coming is worse than a
  // plain spinner. Named explicitly so deleting one fails with the reason.
  for (const rel of [join("pipeline", "[id]"), join("jobs", "[id]")]) {
    assert.doesNotThrow(
      () => statSync(join(APP, rel, "loading.tsx")),
      `${rel} must have its own loading.tsx — without it the route inherits the ` +
        "list skeleton from its parent segment",
    );
  }
});
