import assert from "node:assert/strict";
import { test } from "node:test";
import { setupPanelLabel, setupPanelMode } from "../../src/lib/home/setup-panel.mjs";

const OPTIONAL = Array.from({ length: 8 }, (_, index) => ({
  heading: `## Your section ${index + 1}`,
  state: "missing",
}));

test("a finished required setup with optional sections left collapses to a link, not 4/12", () => {
  const panel = setupPanelMode({ missing: [], sections: OPTIONAL });
  assert.equal(panel.mode, "link");
  assert.equal(panel.remaining, 8);
  assert.equal(setupPanelLabel(panel), "Optional profile details (8 left)");
  assert.equal(/\d+\/\d+/.test(setupPanelLabel(panel)), false);
});

test("a few filled optional sections stay collapsed, and the count is what is left", () => {
  const sections = OPTIONAL.map((section, index) => (
    index < 5 ? { ...section, state: "filled" } : section
  ));
  const panel = setupPanelMode({ missing: [], sections });
  assert.equal(panel.mode, "link");
  assert.equal(panel.remaining, 3);
  assert.equal(setupPanelLabel(panel), "Optional profile details (3 left)");
});

test("missing required setup still shows the checklist", () => {
  const panel = setupPanelMode({ missing: ["cv.md"], sections: OPTIONAL });
  assert.equal(panel.mode, "checklist");
  assert.ok(panel.remaining > 0);
});

test("nothing left hides the panel", () => {
  const sections = OPTIONAL.map((section) => ({ ...section, state: "filled" }));
  const panel = setupPanelMode({ missing: [], sections });
  assert.equal(panel.mode, "hidden");
  assert.equal(panel.remaining, 0);
  assert.equal(setupPanelLabel(panel), "");
});

test("first-run compact mode still shows the checklist while a required file is missing", () => {
  const panel = setupPanelMode({ missing: ["portals.yml"], sections: OPTIONAL, compact: true });
  assert.equal(panel.mode, "checklist");
  assert.equal(panel.showSections, false);
});


test("mixed filled, missing, and template optional sections collapse with the unfilled count", () => {
  const sections = [
    { heading: "## Your North Star", state: "filled" },
    { heading: "## Your must-haves", state: "missing" },
    { heading: "## Your deal-breakers", state: "template" },
    { heading: "## Your story", state: "filled" },
  ];
  const panel = setupPanelMode({ missing: [], sections });
  assert.equal(panel.mode, "link");
  assert.equal(panel.remaining, 2);
  assert.equal(setupPanelLabel(panel), "Optional profile details (2 left)");
});

test("one remaining template section still collapses to a singular link", () => {
  const sections = [
    { heading: "## Your North Star", state: "filled" },
    { heading: "## Your must-haves", state: "filled" },
    { heading: "## Your deal-breakers", state: "template" },
  ];
  const panel = setupPanelMode({ missing: [], sections });
  assert.equal(panel.mode, "link");
  assert.equal(panel.remaining, 1);
  assert.equal(setupPanelLabel(panel), "Optional profile details (1 left)");
});
