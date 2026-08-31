// H-1B Sponsor Check plugin entry point.
// This plugin does not source jobs; the real API surface is the CLI
// (check.mjs) plus the companion skill. The ingest hook is declared only so
// the manifest satisfies the engine's non-empty hooks[] requirement.
export default {
  async ingest(_ctx) {
    return [];
  }
};
