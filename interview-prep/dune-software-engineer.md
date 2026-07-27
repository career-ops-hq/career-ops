# Dune - Software Engineer (Data Platform) - Interview Intel

**URL:** https://jobs.ashbyhq.com/dune/3b55c339-d6f0-4713-92f5-bf74dcfb39d9
**Tracker:** #45 | **Status:** Interview | **CV:** output/dune-2026-07-25/

## Call log

- **2026-07-25 - Intro call with Nick.** Discussed the hiring process. I said explicitly I am not an expert in any single technology but I am good at learning new stuff; Nick said that should be okay. Next steps: several technical interviews, both live coding and system design.

## What the role is

Data-platform engineer at Dune (~60 people, remote Europe/US, Series B by Coatue + USV). The team builds the platform that ingests and decodes petabytes of blockchain data and serves performant SQL across it. Code is mostly Kotlin and Go, some Java and Rust. The JD explicitly wants "a strong generalist with fundamental computer science knowledge" who adapts to new technologies - distributed systems understanding matters more than any specific language.

## My honest angles

- **Generalist arc:** C/C++ (Automotive, real-time audio) -> C# (Civil-Engineering desktop) -> Solidity/EVM (auditing, protocol work) -> Rust/Solana (Mainnet programs). Four paradigm switches, productive fast in each.
- **Blockchain data at the deepest layer:** main contributor to SabVM, a REVM fork - execution-layer work is exactly the layer Dune's ingestion/decoding sits on top of. I know what EVM state, logs, and calldata look like from inside the VM.
- **Rust:** their "some Rust" is my strongest recent language.
- **RPC / blockchain tech understanding:** shipping and operating Mainnet programs on both EVM and Solana.

## Gaps (prep, never claim)

- Kotlin / JVM ecosystem - zero experience. Closest analog: C# (statically-typed, GC, OOP). If asked, say exactly that.
- Datalake formats (parquet, delta, iceberg) - none.
- Large-scale distributed databases / SQL engines - no production experience; this is the system-design interview risk area.

## Prep priorities

1. **Anti-freeze ritual for live coding** (restate, ask for example, state approach, narrate, edge cases) - known #1 risk, see interview-prep/technical-interview-under-pressure.md.
2. **System design fundamentals for data pipelines:** ingestion -> decode -> store -> query; partitioning, backpressure, idempotent reprocessing, schema evolution. Frame answers around principles, not name-dropping tools I have not used.
3. **Skim parquet/iceberg concepts** enough to reason about columnar storage trade-offs out loud.
