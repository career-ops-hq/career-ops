# Hosted engine integration

Start with [PROJECT_HANDOFF.md](../PROJECT_HANDOFF.md) and the [architecture](../docs/hosted/backend-design.md).

Implemented: pasted-text evaluation, canonical tracker merge, CV tailoring, strict validation, real Chromium PDF rendering, PDF indexing and canonical ready marking. This remains an internal worker integration, not a public API or complete hosted application.

## Verification

```sh
npm ci --ignore-scripts
npx playwright install --with-deps chromium
npm --prefix hosted test
```

Tests use synthetic candidate facts and a loopback server returning fixed OpenAI-compatible responses. They execute the actual upstream evaluator, merger, tailoring script, validators, Chromium renderer and ready-marker, including two concurrent independent workspaces. No paid provider is called. This proves process integration and rejection behavior; it does not measure real model quality or establish production tenant isolation.

For a workspace-local browser cache, set `PLAYWRIGHT_BROWSERS_PATH` during both installation and tests. Tests also accept a server-selected `HOSTED_TEST_CHROMIUM` executable for diagnostics; the pinned browser is recommended for reproducibility.

## Trusted worker API

```js
import { chromium } from 'playwright';
import { createEngine } from './engine.mjs';

const engine = createEngine({
  engineRevision: serverConfig.engineCommit,
  browserExecutable: chromium.executablePath(),
  provider: {
    baseUrl: serverConfig.modelBaseUrl,
    model: serverConfig.model,
    apiKey: serverSecrets.modelApiKey,
  },
});
const evaluation = await engine.evaluate({
  workspace: supervisor.privateWorkspace,
  jobId: supervisor.evaluationJobId,
  postingText: job.postingText,
  postingUrl: job.postingUrl, // attribution only; no posting fetch
  signal: supervisor.abortSignal,
});
const cv = await engine.tailor({
  workspace: supervisor.privateWorkspace,
  jobId: supervisor.tailoringJobId,
  evaluationJobId: evaluation.jobId,
  signal: supervisor.abortSignal,
});
```

Configuration and workspace selection belong to the supervisor. Provision confirmed `cv.md`, `config/profile.yml`, `config/cv-facts.json`, `modes/_profile.md` and an initialized canonical `data/applications.md`. No dotenv files or symlink entries are allowed. Hosted photo ingestion is unsupported: nonempty `candidate.photo` is rejected before tailoring.

An exclusive local mutation lock, bounded subprocess output, cancellation and a common deadline cover each operation. Each child gets an allowlisted environment and private home/temp directories. Model credentials are removed from validation/rendering environments. Fixed script names and separate argument arrays replace shell execution.

Tailoring accepts an evaluation job UUID, not a filesystem path. It verifies evaluation artifacts by hash, requires the original confirmed source context and a current tracker link, and runs the model in a fresh staging directory. Only strict fact passes proceed. Rendering uses the entire upstream CLI validation pipeline with an explicitly sandboxed Chromium, disabled page JavaScript and the upstream resource/CSP guards. Hosted publication additionally requires recognized source sections to remain present. This is not proof that every individual source fact/entry survived; HTML extraction has the upstream's supported-format limits.

CVs have unique paths under `output/hosted/<job-id>/`. A successful render must yield a PDF, a valid page count and the correct PDF-index row before `mark-pdf-ready.mjs` updates the tracker. Failed or overflowed output never gets a success receipt. A failed disposable workspace may still contain intermediate files; the supervisor must not publish it.

Receipts under `.hosted/<job-id>/` include operation, input/source/model/engine fingerprints and artifact hashes. Successful replay checks the hashes and avoids another model call. Changed inputs cause `idempotency_conflict`; a partial run causes `job_needs_recovery`; changed artifacts cause `artifact_changed`. Schema-1 receipts from the earlier evaluation-only prototype require recovery. Do not delete receipts and blindly retry paid work. The supervisor must supply the actual immutable image's source commit; this library does not attest a mutable checkout.

## JSON worker and container boundary

`node hosted/worker.mjs` reads one bounded JSON document from stdin and writes one sanitized JSON result to stdout. Exit 0 means success; exit 1 means failure. Job payloads accept only:

```json
{"operation":"evaluate","jobId":"<UUID>","postingText":"<posting>","postingUrl":"https://example.org/jobs/123"}
```

```json
{"operation":"tailor","jobId":"<new-UUID>","evaluationJobId":"<completed-evaluation-UUID>"}
```

Server-owned environment configuration: `HOSTED_MODEL_BASE_URL`, `HOSTED_MODEL`, `HOSTED_MODEL_API_KEY`, `HOSTED_ENGINE_REVISION`, optional `HOSTED_TIMEOUT_MS`, and `HOSTED_WORKSPACE_ROOT` (default `/workspace`). `HOSTED_ALLOW_LOCAL_PROVIDER=1` is for explicit loopback-only development fixtures. Payloads cannot choose a provider, executable, workspace or flags.

Build from the repository root:

```sh
docker build -f hosted/Dockerfile --build-arg ENGINE_REVISION=<source-commit> -t hosted-career-worker .
```

The image uses a non-root user, pinned Node/dependencies/browser and a build-context allowlist that excludes user-layer documents and credentials. It exposes no HTTP port. The supervisor must supply exactly one tenant workspace and enforce read-only image files, resource/PID limits, restricted egress, no host credentials/Docker socket, and a sandbox-compatible container security profile. Chromium sandbox startup failures are hard failures; do not add `--no-sandbox`, privileged mode or broad host mounts to make a job pass. See the [official Playwright container guidance](https://playwright.dev/docs/docker) for non-root user namespace requirements.

Prepare a policy with `node hosted/prepare-seccomp.mjs <output-path>`. This operator-only tool downloads the Playwright v1.65.0 default-Docker seccomp profile, verifies its exact SHA-256 and adds the `chroot` syscall to the existing namespace allowlist. The initial container retains no Linux capabilities: kernel checks still restrict chroot outside a newly created user namespace. The tool refuses source drift and existing destination files. Review this runtime policy for the deployment host; it is not a replacement for a tenant-isolation review.

For the reproducible container check, set `HOSTED_TEST_SECCOMP` to that policy's absolute path, then run `npm --prefix hosted run test:container`. It creates a uniquely named internal Docker network, a synthetic model server with no published ports, and separate worker containers mounting one candidate workspace each. Workers use the image's non-root UID 1000 on Docker Desktop; on native Linux the test matches the non-root host UID so private bind-mounted fixtures remain private. Read-only image files, dropped capabilities, no-new-privileges, PID/memory/CPU/shared-memory limits and a private temporary filesystem apply in both cases. Temporary containers, network and fixtures are removed afterward. The resulting local image is not pushed to a registry.

Local container verification completed for two independent candidates at source revision `4913678`: both evaluation and tailoring jobs succeeded and produced one-page PDFs. The test proves this constrained integration flow on the current Docker host; it does not establish adversarial isolation or durable recovery. CI repeats the native pipeline on Windows/Linux and the full Linux suite inside the constrained worker image, followed by the separate-container smoke flow.

Rendering uses a short private temporary directory for Chromium's Unix sockets. The nested tenant/job home can exceed the Unix socket path limit even when the source files themselves are valid. HOME stays workspace-scoped; the private browser temp directory is removed after process completion with containment checks. No diagnostic overlays or raw subprocess logging are part of the shipped worker.

This package does not yet implement the durable queue, production leases/fencing, snapshot publication, authentication, upload review, billing or hosted UI integration. Directory checks and child processes are not a tenant security boundary. Standalone evaluation is text-only and needs research/quality comparison before replacing richer agent-backed workflows. A real provider credential and budget are still needed for live model quality/cost tests.
