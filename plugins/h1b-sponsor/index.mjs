// H-1B Sponsor Check plugin entry point.
// This plugin does not source jobs; the real API surface is the CLI
// (check.mjs) plus the companion skill. The ingest hook is declared only so
// the manifest satisfies the engine's non-empty hooks[] requirement, so a run
// says where the lookups are instead of leaving a bare "0 found".
import { hasIndex } from './lib/index.mjs';

export default {
  async ingest(ctx) {
    ctx.log('h1b-sponsor finds no jobs. Look up an employer with: node plugins/h1b-sponsor/check.mjs "<company>"');
    if (ctx.env.H1B_API_BASE === undefined && !hasIndex()) {
      ctx.log('No local H-1B index is installed, so lookups have no data. Install it with: node plugins/h1b-sponsor/install-h1b-index.mjs');
    }
    return [];
  }
};
