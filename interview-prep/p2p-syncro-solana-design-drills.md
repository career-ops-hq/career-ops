# p2p.org Syncro - Solana System-Design Drills

Write-path, Solana-specific practice problems calibrated to the p2p.org design/architecture round.
Companion to `system-design-generic-prep.md` (the 3-act arc lives there). This file adds the
domain vocabulary and the problem set that matches Syncro's actual shape.

---

## 0. Intel: their actual stack (from `p2p-org/rust-backend-service-template`)

The interview tasks themselves are not public. But their service scaffold is, and it fixes the
dialect you should design in:

- **Rust + tokio** async everywhere (tasks/futures, not threads).
- **RabbitMQ** = their message queue. "Put it on a queue" is idiomatic here.
- **jsonrpsee** = JSON-RPC (server + client). Their APIs are RPC methods, not REST resources.
- **sqlx + Postgres** = system-of-record DB.
- **backoff** crate = retries with exponential backoff + jitter, first-class.
- **solana-sdk / borsh / bs58 / base64** = Solana-native serialization.
- **tracing + OpenTelemetry** = observability baked in; name your SLIs.

Design out loud in this dialect: "RPC method enqueues onto RabbitMQ -> worker submits with
backoff -> status in Postgres -> spans via tracing." That is speaking their language.

---

## 1. Glossary: Solana delivery / networking terms (READ THIS FIRST)

These are the terms the deep-dive will drill. Each is explained plainly; the point is to be
*fluent enough to stay in the conversation two questions deep*, not to be an expert.

### The landing pipeline

- **Slot** - a ~400ms time window assigned to one leader. A block may or may not be produced in it.
- **Leader schedule** - Solana publishes, in advance per epoch, exactly which validator is leader
  for each slot. It is deterministic and known ahead of time. This is the whole basis of how you
  send transactions well.
- **Gulf Stream** - Solana's "mempool-less" design. There is **no global mempool**. Instead, clients
  and RPC nodes forward transactions directly to the validator(s) expected to be leader soon, using
  the leader schedule. Consequence: *where* and *when* you push a tx matters enormously.
- **TPU (Transaction Processing Unit)** - the leader validator's ingestion pipeline / port where
  transactions arrive to be processed. "Landing a tx" = getting it accepted by the current/upcoming
  leader's TPU and included in a block.
- **Landing / inclusion** - your transaction actually made it into a produced block. The entire job
  of a sender service is to maximize landing rate and minimize landing latency.

### The transport layer (this is your gap - study it)

- **QUIC** - a UDP-based transport protocol (the same transport HTTP/3 uses). Solana moved TPU
  ingestion from raw UDP to QUIC to get **connection management, flow control, and backpressure**.
  With QUIC a validator can throttle per-source, cap concurrent streams, and refuse abusive senders
  - impossible with fire-and-forget UDP. Practical implication for a sender: you maintain QUIC
  connections to upcoming leaders and manage stream limits; a poorly managed connection = dropped txs.
- **SWQoS (Stake-Weighted Quality of Service)** - validators prioritize incoming QUIC connections in
  proportion to the **stake** of the peer the connection comes from. A tx forwarded through a
  high-stake validator's connection gets preferential ingestion during congestion; a tx from an
  anonymous low/no-stake source gets throttled or dropped first. **This is the entire commercial
  reason Syncro exists**: p2p runs staked validators, so routing your tx through their staked
  connections buys you landing priority you could not get alone. When you design the sender, SWQoS
  is *the* asset - "route through our staked nodes" is the differentiator.

### Fees and prioritization

- **Priority fee / compute-unit price** - via a ComputeBudget instruction, a tx can bid an extra fee
  per compute unit. During congestion, leaders order txs partly by priority fee. Higher bid = higher
  landing odds. A good sender *estimates* the right priority fee dynamically (too low = doesn't land,
  too high = user overpays).
- **Jito / bundles / tip** - Jito is alternative landing infrastructure. You submit a **bundle**
  (an atomic, ordered group of txs) with a **tip** to Jito's block engine/relayers, which gives you
  guaranteed ordering and a separate inclusion path. A sophisticated sender treats Jito as a second
  delivery lane alongside direct-to-leader TPU.

### Validity windows (why senders retry)

- **Recent blockhash + expiry** - every tx references a recent blockhash and is only valid for
  ~150 slots (~60-90 seconds). After that it is rejected as **expired** ("blockhash not found").
  A sender must land the tx inside that window or refresh the blockhash and rebuild/resubmit.
- **Durable nonce** - a nonce account provides a long-lived blockhash substitute that does not expire
  until consumed. Used for offline signing or delayed submission. Relevant if the design says
  "transactions may be submitted minutes or hours after signing."

### Certainty ladder (commitment levels)

- **processed** - a node has seen/executed it; the block may still be dropped. NOT terminal.
- **confirmed** - voted on by a supermajority (~1 confirmation). Practically safe for most UX.
- **finalized** - rooted, 31+ confirmations deep, irreversible. Terminal.
- Terminal outcomes overall: **finalized** (success, permanent), **failed** (landed but the tx
  reverted), **dropped** (never landed, blockhash expired). Non-terminal: unknown, processed, confirmed.

---

## 2. Problem set (write-path, Solana, matched to Syncro)

Each problem lists: the prompt, why they would ask it, where the deep-dive will aim, and the
skeleton of a senior answer. Run them with the 3-act arc from `system-design-generic-prep.md`.

Difficulty is calibrated to the tracker you already practiced, but shifted onto the **write path**
(retries, idempotency, latency budgets, backpressure) where the tracker was light.

### Problem 1 - Transaction Submission Service ★ (THE centerpiece - this IS Syncro)

**Prompt:** "Design a service that accepts a signed Solana transaction from a client and reliably
lands it on-chain with the lowest possible latency, even during network congestion."

**Why they ask it:** It is literally the product. If you can run this cleanly you have proven you
understand the role's core.

**Deep-dive will aim at:** the delivery strategy. Expect: "The leader is congested and your tx isn't
landing. Walk me through everything you do." That is where QUIC/SWQoS/priority-fee/Jito/multi-path
all have to come out.

**Senior-answer skeleton:**
- *Understand:* Inputs = signed tx (or unsigned + we sign?). Success = landed at what commitment?
  Latency budget (p50/p99 targets)? Throughput (tx/sec)? At-least-once landing but the chain gives
  us idempotency for free (a given signature can only land once). Do we retry expired txs (rebuild
  blockhash) or fail them back to the client?
- *Sketch:* JSON-RPC `submitTransaction` -> validate/decode -> enqueue -> submission worker. Worker
  computes the upcoming leader set from the leader schedule, opens QUIC connections, and fans the tx
  out on **multiple paths in parallel**: direct-to-leader TPU (via our staked SWQoS nodes) + Jito
  bundle lane. A status tracker polls commitment and reports back. Postgres records terminal state.
- *Harden:* The hard parts - (a) **blockhash expiry**: retry loop must resubmit within ~60-90s or
  surface expiry; (b) **priority-fee estimation**: dynamic, feeds the tx bid; (c) **multi-path
  racing**: first path to land wins, dedupe by signature; (d) **backpressure**: bound the queue,
  shed or 429 when submission workers saturate; (e) SWQoS is the moat - degrade gracefully if our
  staked path is down (fall back to public RPC, warn on reduced landing odds).

### Problem 2 - Priority-Fee Estimator Service ★

**Prompt:** "Design a service that tells clients what priority fee to attach to a Solana transaction
right now so it lands quickly without overpaying."

**Why they ask it:** It is the read-path sibling that feeds Problem 1, and it is a clean
scale/caching/freshness problem in Solana clothing - close to the tracker you already did well.

**Deep-dive will aim at:** freshness vs load. Fees move every few slots; how fresh must the estimate
be, how do you avoid hammering RPC, how do you handle a fee spike (congestion) without lagging.

**Senior-answer skeleton:** ingest recent block fee data (via RPC `getRecentPrioritizationFees` or
by reading recent blocks) -> compute percentiles per account/program -> cache with a short,
slot-aware TTL -> serve via RPC. Deep dive: state-dependent TTL, request coalescing on cache miss
(single-flight - the stampede lesson from the tracker), degraded mode returns last-known + staleness
flag when the ingest path lags.

### Problem 3 - Durable-Nonce Relayer (delayed / offline submission)

**Prompt:** "Design a service where users sign transactions now but the service submits them later
(e.g., scheduled payouts, or offline-signed txs), guaranteeing they still land."

**Why they ask it:** Tests whether you understand blockhash expiry deeply - a normal blockhash would
be dead by submission time, so the answer *requires* durable nonces. It also introduces scheduling
and a persistence-heavy design.

**Deep-dive will aim at:** the nonce-account lifecycle (advance-nonce, one in-flight tx per nonce
account at a time), and how you pool/allocate nonce accounts under concurrency.

**Senior-answer skeleton:** Postgres-backed job store of pending signed txs + their nonce accounts ->
scheduler -> submission worker (reuse Problem 1's lander). Hard parts: a nonce account serializes to
one in-flight tx, so you need a **pool** of nonce accounts and careful allocation; failure recovery
must not double-submit (idempotent on signature); ordering guarantees if the user expects them.

### Problem 4 - Staking-Reward Distribution Pipeline

**Prompt:** "Design the pipeline that computes and distributes staking rewards to thousands of
delegators every epoch, on-chain."

**Why they ask it:** It is p2p's actual core business (staking), and it is a batch + queue + reliable
submission problem - RabbitMQ and Postgres front and center, exactly their template's shape.

**Deep-dive will aim at:** reliability of thousands of payout txs (this reuses Problem 1 at scale),
and correctness/idempotency of the computation (never pay twice, survive a mid-run crash).

**Senior-answer skeleton:** per-epoch trigger -> compute rewards (Postgres, idempotent, checkpointed)
-> enqueue payout jobs on RabbitMQ -> submission workers (Problem 1's lander) with backoff -> reconcile
landed vs pending -> retry the stragglers. Hard parts: exactly-once *accounting* over at-least-once
*submission*, crash recovery via checkpoints, rate-limiting submission so you don't self-congest.

### Problem 5 (transfer check - non-blockchain) - Webhook Delivery Service

**Prompt:** "Design a service that reliably delivers webhook notifications to customer endpoints with
retries and ordering guarantees."

**Why include it:** Same skeleton as Problem 1 (enqueue -> deliver -> retry-with-backoff -> track
status -> dead-letter) with zero Solana vocabulary. Run it once near the end to prove the arc
transfers off the blockchain domain - that is the reassurance that you learned the *pattern*, not
just memorized Solana facts.

---

## 3. How to use this

1. Read section 1 (glossary) until QUIC / SWQoS / blockhash-expiry / priority-fee are fluent.
2. Run **Problem 1** as Rung 4 (guided full pass, less scaffolding) - it exercises both gaps at once
   (write-path shape + networking deep dive).
3. Then Problem 2 (closest to your already-strong read-path tracker) to rebuild confidence.
4. Problems 3-4 for depth; Problem 5 as the transfer check.

## 4. Drill log (this file)

| # | Problem | Mode | Result | Weakest dimension | Notes |
|---|---------|------|--------|-------------------|-------|
| 1 | Transaction Submission Service | Rung 4 (guided full pass) | ~3.6/5 - strong-senior pass | Surfacing key insights unprompted; Solana fundamentals | Strong: dedup map+deque, submission state machine w/ stop conditions, state-dep TTL transfer, expiry-aware routing. Fixed: "validate vs consensus" (not local; cheap checks only + sig-verify on spawn_blocking), "leader confirms received" (no ack; poll getSignatureStatuses), unify submission-monitor with query cache (in-flight status = free, don't double-poll RPC). Learned: **multi-path** = fan same tx across N leaders + channels (TPU/Jito/RPC) in parallel, safe b/c chain dedups on signature. Backpressure: shed at the door (bounded intake, 429-when-full) + retry-after w/ jitter to avoid retry storm. Boxed routing as "separate problem" when it IS the product. |
