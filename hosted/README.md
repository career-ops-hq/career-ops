# Hosted engine adapter — first integration slice

Start with [PROJECT_HANDOFF.md](../PROJECT_HANDOFF.md) and the [architecture](../docs/hosted/backend-design.md).

This package currently implements a trusted worker adapter for **pasted-text evaluation plus canonical tracker merge**. It runs the real upstream evaluator and merger without changing their source. It is not an HTTP service, container sandbox, production queue, authentication system or complete hosted product.

Install the root dependencies and run:

```sh
npm ci --ignore-scripts
npm --prefix hosted test
```

Tests use synthetic candidate facts and a loopback server returning fixed OpenAI-compatible streaming responses. They execute the real evaluator and tracker merger, including simultaneous workspaces. They make no paid provider requests and do not prove model quality, research parity, PDF correctness or container isolation.

## Trusted worker integration

```js
import { createEngine } from './engine.mjs';

const engine = createEngine({
  engineRevision: serverConfig.engineCommit, // exact immutable image source revision
  provider: {
    baseUrl: serverConfig.modelBaseUrl,
    model: serverConfig.model,
    apiKey: serverSecrets.modelApiKey,
  },
});
const result = await engine.evaluate({
  workspace: supervisor.privateWorkspace,
  jobId: supervisor.jobId, // UUID
  postingText: job.postingText,
  postingUrl: job.postingUrl, // attribution only; this adapter does not fetch it
  signal: supervisor.abortSignal,
});
```

Provider configuration, engine commit and workspace selection are server-owned. Use only in a disposable private workspace outside the code checkout; provision confirmed `cv.md`, `config/profile.yml`, `modes/_profile.md` and an initialized canonical `data/applications.md` tracker. No `.env` or symlink entries are allowed. Do not mount unrelated tenant files or platform secrets into the execution container. Restrict outgoing networking at the container/gateway level; this module is not an SSRF firewall.

The adapter uses fixed script names and argument arrays, fresh allowlisted child environments, an isolated home/temp directory, bounded output, timeout and cancellation. It preserves the upstream summary parser, tracker parser and writer. A local mutation lock prevents overlapping adapter runs in one workspace; it is deliberately fail-closed after a crash and has no lease expiry. Production requires supervisor fencing, snapshots and recovery.

Successful jobs store a private receipt beneath `.hosted/<job-id>/`. Reusing the same ID and input returns the receipt without another model call; changed input/profile/model raises `idempotency_conflict`. A partial job raises `job_needs_recovery`; never delete its state and blindly retry because a provider request or tracker mutation may already have occurred. These receipts are local execution aids, not the durable job database. Never commit runtime workspaces.

Model output and provider diagnostics remain private subprocess data and are not included in thrown errors. Do not expose raw process stdout/stderr through a public API. Any failed run may have changed its disposable workspace; only a future supervisor may validate and publish a complete snapshot.

## Next work

Add tailoring, strict CV validation and PDF rendering; then durable queue/lease/snapshot publication. The supervisor must supply the actual immutable engine image's source commit; the adapter records it but does not attest that a mutable checkout matches it. Add authenticated APIs only after tenant container isolation is verified. Preserve human submission.
