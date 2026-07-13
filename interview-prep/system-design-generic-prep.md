# System Design Interview - Generic Prep Plan + Mock Protocol

**Purpose:** Get to a confident Staff-level bar on *generic, non-P2P-specific* system design / architectural-thinking rounds.
**Context:** Next likely P2P round is a design interview. This doc trains the transferable skill; `p2p-syncro-*` docs hold the domain-specific layer.
**Status:** No official feedback or next-round invite yet as of Jul 10. Prep in parallel with waiting; don't burn out on a call that isn't booked.

---

## 0. The one thing to internalize

A system design round is **not a knowledge test. It's a thinking-under-ambiguity test.** The interviewer scores: do you *drive*, do you make *defensible tradeoffs* (a decision, not a survey), do you see *failure modes*, do you *prioritize*. A "correct" architecture with no reasoning loses to a rougher one with sharp tradeoffs stated out loud.

This is doubly good news for you as a ramp candidate: the scored trait is process, and process is fully learnable in a week. You do not need to have built a distributed cache to design one well - you need the vocabulary and the arc.

---

## 1. The universal arc (memorize; run it every time)

Time budget shown for a 45-minute round. Say each phase name out loud as you enter it - it signals structure.

1. **Clarify requirements (~5 min).** Functional ("what must it do") + non-functional ("how well"): scale, read/write ratio, latency target, consistency vs availability, durability. Restate the problem. Ask "how big is it" before designing anything. **Write the requirements down** and refer back.
2. **Back-of-envelope estimate (~3-5 min).** QPS (peak = ~2-3x average), storage/year, bandwidth. This is not busywork - the numbers *pick your architecture* (a 10 QPS system and a 1M QPS system are different designs).
3. **API contract (~3 min).** The entry points. `POST /x`, the key params, what comes back. Forces you to nail down the interface before the internals.
4. **High-level design (~10 min).** Boxes and arrows. Client → LB → service → data store, plus the happy path end to end. Keep it coarse; don't rabbit-hole yet.
5. **Deep dive (~15 min).** The interviewer picks 1-2 components and says "go deeper." **This is where Staff is won or lost.** Have an opinion, name the tradeoff, pick, defend.
6. **Bottlenecks / failure / scale (~5-7 min).** What breaks first under 10x load? How would you *know* (metrics)? How do you recover (retries, backpressure, failover)? Volunteer this - don't wait to be asked.
7. **Wrap (~2 min).** What I'd ship as MVP, what's v2, the single biggest risk, what I'd measure in prod.

If you only remember one thing under stress: **Requirements → Estimate → API → Boxes → Deep dive → Failures → MVP.**

---

## 2. Building blocks (the vocabulary you must own)

For each: *what it is / when to reach for it / the tradeoff.* You should be able to say a sentence on each without thinking.

**Traffic & routing**
- **Load balancer (L4 vs L7):** L4 routes by IP/port (fast, dumb); L7 routes by content/path (smart, more overhead). Reach for L7 when you need routing logic; L4 for raw throughput. Tradeoff: intelligence vs latency.
- **Reverse proxy / API gateway:** single ingress for auth, rate limiting, routing. Tradeoff: convenient choke point vs single point of failure/latency hop.
- **CDN / edge:** cache static (or cacheable) content close to users. Tradeoff: cheap latency win vs staleness + invalidation pain.

**Caching**
- **Cache-aside** (app reads cache, on miss reads DB + populates) is the default. **Write-through** (write to cache + DB together) for read-heavy consistency; **write-back** for write-heavy (risk: data loss on crash).
- **Eviction:** LRU default; LFU for skewed popularity; TTL for freshness.
- **The hard part is invalidation.** Say it out loud: "stale reads are the tradeoff I'm accepting here, bounded by a 30s TTL."

**Data stores**
- **SQL:** strong consistency, joins, transactions, mature. Reach for it by default unless you have a specific reason not to. Scales via read replicas + vertical, then sharding (painful).
- **NoSQL (KV / document / wide-column):** horizontal scale, flexible schema, high write throughput. Reach for it at massive scale or simple access patterns. Tradeoff: you give up joins + often strong consistency.
- **Indexing:** speeds reads, slows writes, costs storage. Name which fields you'd index and why.
- **Replication:** sync (consistent, slower writes) vs async (fast, replica lag / possible loss). Primary-replica for read scaling; multi-primary for write availability (conflict resolution cost).
- **Partitioning / sharding:** by hash (even spread, no range queries), by range (range queries, hotspot risk), by geography. **Consistent hashing** to minimize reshuffling when nodes change.

**Async & decoupling**
- **Message queue (SQS-style):** decouple producer/consumer, absorb spikes, retry. Reach for it whenever a step can be async. Tradeoff: eventual consistency + operational complexity.
- **Log/stream (Kafka-style):** ordered, replayable, multi-consumer fan-out. Reach for it for event pipelines, CQRS, audit. Tradeoff: heavier to run.
- **Backpressure:** when consumers can't keep up - bounded queues, drop/shed load, or slow the producer. *Always* name what happens when the queue fills.

**Consistency & coordination**
- **CAP:** under a network partition you pick Consistency or Availability. Most systems are AP with tunable consistency. **PACELC** adds: even without partitions, you trade Latency vs Consistency.
- **Quorum (R + W > N):** tune read/write quorums for consistency vs latency.
- **Consensus (Raft/Paxos, talking level):** leader election + replicated log for strong consistency across nodes. You don't implement it; you say "I'd use a Raft-backed store like etcd for the leader schedule / config."
- **Idempotency:** dedup via idempotency keys so retries don't double-apply. Critical for anything money- or exactly-once-flavored.

**Reliability patterns**
- **Retries with exponential backoff + jitter** (jitter prevents thundering-herd retries).
- **Circuit breaker:** stop hammering a failing dependency; fail fast, recover gradually.
- **Timeouts + bulkheads:** isolate failures so one slow dependency doesn't sink the pool.
- **Rate limiting:** token bucket (allows bursts), leaky bucket (smooths), sliding window (accurate). Per-client quotas live here.

**Observability & ops**
- **Metrics / logs / traces.** SLI (measured), SLO (target), SLA (contractual). Latency as **histograms (p50/p99/p999), never averages.**
- Health checks, graceful degradation, canary/blue-green deploys.

---

## 2b. The vocabulary, mapped to blockchain you already know

The generic terms in §2 feel alien on a first read. They shouldn't - you already reason about most of them, just under blockchain names. Learn the generic word by attaching it to the primitive you own. **On the starred rows you are ahead of a typical backend candidate**, because blockchain made you learn the hard version.

| Generic system-design term | You already know it as | 
|---|---|
| Load balancer / request routing | An RPC provider spreading calls across many nodes; picking a healthy endpoint and failing over |
| Caching + the invalidation problem | Caching account state / a recent blockhash. Staleness is real to you: a cached blockhash *expires* (~150 slots). That's TTL invalidation. |
| SQL vs NoSQL / storage choice | An indexer's DB storing parsed events for querying |
| Sharding / partitioning | Splitting load by account/program; geo-distributing RPC nodes across regions |
| Replication (sync/async) | Every validator holding the same ledger; RPC read replicas lagging the tip |
| **Consensus (Raft/Paxos)** ★ | BFT consensus + finality. You reason about a *harder* version than Raft daily. Raft = "one leader, one replicated log." |
| **CAP / tunable consistency** ★ | Commitment levels: `processed` (fast, can revert = AP) vs `finalized` (safe, slower = CP). You've *chosen* one in code. |
| **Idempotency / dedup** ★ | A transaction signature *is* an idempotency key. Duplicate submit = safe no-op. This is native to you. |
| Message queue / backpressure | The mempool / tx queue; leaders dropping txns under load = load shedding |
| **Rate limiting** ★ | RPC 429s you've hit; priority fees as a market-based rate limiter |
| Retries + exponential backoff | Resubmitting a txn until it lands before the blockhash expires |
| Observability / SLO (p99) | Landing rate, confirmation-latency p99 - literally Syncro's pitch |

**Takeaway:** you're not starting from zero. You're translating. When a term scares you, ask "what's the blockchain version of this?" - there almost always is one, and you already understand it.

---

## 3. The numbers (estimation + latency anchors)

**Estimation shortcuts**
- 1 day ≈ 86,400 s ≈ round to **100k s**. So 1M events/day ≈ ~12/s; 1B/day ≈ ~12k/s.
- Powers of 2: 2^10 ≈ 1 thousand (KB), 2^20 ≈ 1 million (MB), 2^30 ≈ 1 billion (GB), 2^40 ≈ 1 trillion (TB).
- Peak QPS ≈ 2-3x average. Size for peak.
- Typical small record: 100s of bytes to ~1 KB. 1 char ≈ 1 byte (ASCII).

**Latency anchors (order-of-magnitude, memorize the ladder)**
- L1 cache: ~1 ns · mutex lock/unlock: ~17 ns · main memory: ~100 ns
- Read 1 MB sequentially from RAM: ~few µs · SSD random read: ~16-150 µs
- Round trip within a datacenter: ~0.5 ms · read 1 MB from SSD: ~0.2-1 ms
- Disk seek (HDD): ~10 ms · round trip across continents: ~100-150 ms

The point isn't precision - it's knowing that **RAM >> SSD >> disk >> network**, and cross-region is ~150 ms (which is why you put compute at the edge).

---

## 4. Staff-level differentiators (the scored deltas vs a mid engineer)

- **Drive the room.** Don't wait to be fed requirements - propose them and confirm. "I'll assume X unless you'd steer otherwise."
- **Decide, don't survey.** "There are three caching strategies; I'll use cache-aside here because reads dominate" beats listing all three and stopping.
- **Volunteer failure modes.** Name what breaks at 10x before they ask.
- **Prioritize explicitly.** MVP vs v2. "I'd ship the single-region version first, add multi-region once we have paying load."
- **Talk cost + ops, not just correctness.** Who runs this? On-call burden? Migration path? Dollar cost of the fancy option.
- **Know when to measure.** "I'd instrument the submit path and let p99 tell me whether to optimize allocation before I add complexity."
- **Manage your own time.** If you're 15 min in and still on requirements, you're failing. Move.

---

## 5. Common traps (self-audit after every mock)

1. Jumping to a solution before pinning requirements.
2. Surveying options without committing to one.
3. Over-engineering the MVP (sharding a system with 100 QPS).
4. Ignoring failure/ops entirely.
5. Going silent while thinking (narrate, always).
6. Time mismanagement (20 min on requirements, 3 min on the deep dive).
7. Hand-waving the deep dive - "I'd use Kafka" with no *why*.

---

## 6. Practice problem set (blockchain-flavored; ranked)

Every problem drills the *same generic building blocks* as a standard system-design set - just wrapped in a domain you can reason about from experience. The building blocks each one teaches are tagged so you see the transfer. Starred ones sit closest to the Syncro / low-latency-infra shape.

1. **Airdrop claim service** - you *built* Merkle Instant, so max home-turf. Drills: idempotency (double-claim prevention), rate limiting (claim-day spike), caching (eligibility / Merkle proofs), hot-key skew, read-heavy scale. **Start here.**
2. **RPC load balancer / gateway** ★ - closest generic analog to Syncro. Drills: load balancing, health checks, failover, response caching, per-key rate limiting, routing.
3. **Blockchain indexer** - ingest blocks → queryable API. Drills: high-write ingestion, storage choice, partitioning, backfill, reorg handling (a consistency problem you understand natively).
4. **Transaction submission service** ★ - Syncro-lite, generic version. Drills: queue, retries + backoff, dedup, multi-path delivery, confirmation tracking, backpressure.
5. **Validator / node monitoring + alerting** ★ - drills: high-write metrics ingest, time-series storage, aggregation, SLO/alerting, backpressure.
6. **Wallet balance / portfolio API** - drills: read-heavy caching, fan-out across chains/RPCs, staleness tradeoffs, invalidation.
7. **Price oracle aggregator** - drills: multi-source ingestion, aggregation, staleness/liveness, manipulation resistance, quorum-style trust.
8. **NFT mint service (hot launch)** - drills: extreme write spike, fairness, idempotency, queue-based load shedding.

**Transfer check (do 1 near the end):** once the arc is automatic, run *one* non-blockchain problem (rate limiter, or URL shortener) cold - to prove the skill generalizes in case they throw a generic prompt. If it feels doable, you're ready.

---

## 7. Study cadence (adaptable - no invite booked yet)

**Tier 0 - Foundations (Day 1, ~2-3h).** Read this doc end to end. Memorize the arc (§1) and the building-block one-liners (§2). Drill the estimation anchors (§3) until QPS math is reflexive.

**Tier 1 - Mock reps (Days 2-5, one mock/day, ~1h each).** Run mocks with me on problems 1-4 + 8 from §6. After each: self-audit against §5 traps, log gaps below. Goal: the arc becomes automatic.

**Tier 2 - Harder + realistic (ongoing, as timeline firms up).** Problems 7, 9, 11 (the infra-flavored ones). Switch to realistic-timed mode (I go quiet, score at the end). Add the P2P domain layer from `p2p-syncro-gap-topics.md` once the invite lands.

If the invite comes fast, compress: Tier 0 + two mocks (rate limiter + API gateway) is the minimum viable prep.

---

## 8. Mock protocol (how we run the simulation)

I play the interviewer. You drive the arc out loud (in chat: describe the boxes, or paste ASCII/lists - no need for real diagrams).

1. I pose the prompt with the sparse detail a real interviewer gives.
2. You run the arc: clarify → estimate → API → boxes → (I pick a deep dive) → failures → wrap.
3. I probe ("why that store?"), hint if you stall, and throw 1-2 curveballs ("now it's 100x the traffic" / "the primary just died mid-write").
4. I score on the rubric below and give you the 2-3 highest-leverage fixes.

**Two modes:**
- **Coaching** - I interrupt early, hint fast, teach as we go. Best for building the skill. Start here.
- **Realistic** - I stay quiet, let you drive and even stumble, score only at the end. Best for calibration once the arc is solid.

---

## 9. Scoring rubric (1-5 each)

| Dimension | What a 5 looks like |
|---|---|
| Requirements & scoping | Drove them unprompted; separated functional/non-functional; confirmed scale |
| Estimation | Quick, sane QPS/storage math that informed the design |
| High-level architecture | Clean happy-path, right components, no premature complexity |
| Deep-dive depth | Went genuinely deep on the picked component with real tradeoffs |
| Tradeoff reasoning | Decided and defended; didn't just survey options |
| Failure & ops | Volunteered failure modes, recovery, observability |
| Prioritization | Clear MVP vs v2; named the biggest risk |
| Communication & structure | Narrated throughout; managed time; took hints well |

---

## Drill log (updated as we go)

| Mock | Mode | Problem | Arc followed? | Weakest dimension | Fixes for next time |
|---|---|---|---|---|---|
| 1 | Coaching (step-by-step) | Solana tx-status tracker | Yes - full pass | Failure-mode completeness | Cache stampede / single-flight; RPC pool = redundancy + rate-limit spread; treat cache as a dependency too |
| 2 | _tbd_ | _tbd_ | | | |
| 3 | _tbd_ | _tbd_ | | | |

## Running gap list
- **Cache stampede / thundering herd:** when a hot key's TTL expires, concurrent misses all hit the source at once. Fix: request coalescing (single-flight) - one fetch per key, others wait and share.
- **RPC pool serves two purposes:** failover (a provider dies) AND rate-limit distribution (429 throttling long before full down). Distinguish "throttled" from "down".
- **Every added component is a new failure mode:** after adding a shared cache, must answer "what if the cache dies?" (→ fall back to direct RPC, degraded).
- **Scale the service tier explicitly:** at Nx traffic, horizontally add API instances behind the LB; shared cache keeps RPC load bounded by distinct-signature rate, not request rate.
- **Strengths to keep leaning on:** load-skew sizing, avoiding DB over-engineering, MVP-first cuts, naming concrete degraded behavior.
