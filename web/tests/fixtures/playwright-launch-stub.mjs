// session.ts imports playwright-core for real. This stands in for that module
// in one test file so a missing refusal fails the assertion instead of opening Chrome.
globalThis.__applyLaunchAttempts = globalThis.__applyLaunchAttempts || 0;

export const chromium = {
  launch: Object.assign(
    async function launch() {
      globalThis.__applyLaunchAttempts += 1;
      if (typeof globalThis.__applyCareerPage === "function") return globalThis.__applyCareerPage();
      throw new Error("stub: chrome was not launched");
    },
    { refusedByTest: true },
  ),
};
