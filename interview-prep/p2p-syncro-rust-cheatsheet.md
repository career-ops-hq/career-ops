# P2P Syncro Coding Round - Rust + Algorithms Cheat-Sheet

The real test surface. Skim daily; drill the patterns until you can write them without lookup. Everything here is the "Coding Without AI" half's fair game.

---

## 1. Collections + complexity (know cold)

| Type | Use when | Key ops (complexity) | Notes |
|---|---|---|---|
| `Vec<T>` | Default sequence. Contiguous. | index O(1), `push` amortized O(1), `insert/remove(i)` O(n), `contains` O(n) | Cache-friendly. First choice almost always. `with_capacity(n)` to avoid reallocs. |
| `VecDeque<T>` | Queue / ring buffer, push+pop both ends | `push_front/back` O(1), `pop_front/back` O(1) | Use for BFS queue, sliding window. |
| `HashMap<K,V>` | Point lookup by key | `get/insert/remove` avg O(1), worst O(n) | Unordered. `entry` API avoids double lookup. |
| `BTreeMap<K,V>` | Sorted keys / range queries | `get/insert` O(log n), `range()` O(log n + k) | Ordered iteration, floor/ceil via `range`. |
| `HashSet<T>` | Membership / dedup | O(1) avg | `Vec` + sort + dedup is an alternative when order+space matter. |
| `BinaryHeap<T>` | Max-heap; top-k; Dijkstra | `push`/`pop` O(log n), `peek` O(1) | **Min-heap = `BinaryHeap<Reverse<T>>`**. |
| `String` / `&str` | Owned vs borrowed text | `push_str` amortized O(1) | Bytes not chars; `.chars()` for Unicode, `.as_bytes()` for ASCII speed. |

**`entry` API (memorize - shows fluency):**
```rust
*map.entry(key).or_insert(0) += 1;                 // frequency count
map.entry(key).or_insert_with(Vec::new).push(v);   // group-by / adjacency list
```

**Min-heap idiom:**
```rust
use std::cmp::Reverse;
use std::collections::BinaryHeap;
let mut heap = BinaryHeap::new();
heap.push(Reverse(cost));       // smallest cost pops first
if let Some(Reverse(c)) = heap.pop() { /* ... */ }
```

## 2. Iterators + adaptors (prefer over manual loops)

```rust
v.iter().map(|x| x * 2).filter(|x| x % 3 == 0).sum::<i32>();
v.iter().enumerate()                     // (index, &item)
v.iter().zip(other.iter())               // pairwise
v.windows(3)                             // overlapping slices [a,b,c],[b,c,d]  (slice method)
v.chunks(4)                              // non-overlapping groups
v.iter().fold(0, |acc, x| acc + x)       // general reduce
v.iter().scan(0, |st, &x| { *st += x; Some(*st) })  // running/prefix sums
(0..n).rev()                             // reverse range
it.take_while(|&x| x < 10)               // stop early
it.collect::<Vec<_>>()                   // materialize; collect::<HashMap<_,_>>(), Result<Vec<_>,E>, etc.
it.position(|x| x == target)             // first index matching
it.max_by_key(|x| x.len())               // argmax
```

**Sorting + searching:**
```rust
v.sort();                    // stable, O(n log n)
v.sort_unstable();           // faster, no stability guarantee - prefer when stability not needed
v.sort_by_key(|x| x.age);
v.sort_by(|a, b| b.cmp(a));  // descending
v.binary_search(&target);          // Ok(idx) | Err(insert_pos), requires sorted
v.partition_point(|&x| x < target); // first index where predicate is false (lower_bound)
```

**Why iterators, not loops:** the compiler elides bounds checks and fuses adaptors, so idiomatic iterator chains usually match or beat a hand-written indexed loop - and read cleaner. Say this if asked "is this slow?".

## 3. Ownership / borrow-checker fluency (don't fight it live)

- `&T` shared borrow (many), `&mut T` exclusive borrow (one), owned `T` moves.
- **The rule that bites in interviews:** you can't hold a `&mut` and a `&` to the same data at once. If you're mutating a `Vec` while iterating it, restructure: collect indices/changes first, or use `iter_mut()`, or index by position.
- `clone()` is a legitimate move to unblock yourself - **say so**: "I'll clone here for clarity; it's O(n) and I'd revisit it if this were hot." Cheap clones (`Copy` types: integers, `char`, bool) are free-ish.
- `String` (owned) vs `&str` (borrowed slice). Take `&str` in function args (`fn f(s: &str)`) - accepts both.
- Slices `&[T]` over `&Vec<T>` in signatures - more general, zero cost.
- Reach for `Rc<RefCell<T>>` only when you truly need shared mutable ownership (e.g. graph nodes); flag it as a smell in a hot path.

**Common fix patterns:**
```rust
// Mutating while reading: split the borrow
let n = v.len();
for i in 0..n { v[i] = compute(v[i]); }     // index, no overlapping borrow

// Two mutable pieces of one slice
let (left, right) = v.split_at_mut(mid);

// Avoid cloning a key just to look it up
if let Some(val) = map.get(key) { /* ... */ }  // get takes &Q, no clone needed
```

## 4. Algorithmic patterns (drill each; state Big-O every time)

**Two pointers** - sorted array pair/triple, in-place partition. O(n).
```rust
let (mut l, mut r) = (0, v.len() - 1);
while l < r { /* move l or r based on v[l]+v[r] vs target */ }
```

**Sliding window** - longest/shortest subarray under a constraint. O(n).
```rust
let mut left = 0; let mut sum = 0;
for right in 0..v.len() {
    sum += v[right];
    while sum > limit { sum -= v[left]; left += 1; }
    best = best.max(right - left + 1);
}
```

**Prefix sums** - range-sum queries in O(1) after O(n) build. Pair with a HashMap for "subarray sum == k".

**Frequency / hashing** - counting, anagrams, dedup, "seen before". `entry().or_insert(0)`.

**Sort + binary search** - `partition_point` for lower/upper bound. O(n log n) build, O(log n) query.

**Heap top-k** - `BinaryHeap<Reverse<_>>` of size k. O(n log k) time, O(k) space. Beats full sort when k << n.

**BFS / DFS on a graph** (adjacency list = `HashMap<usize, Vec<usize>>` or `Vec<Vec<usize>>`):
```rust
// BFS
let mut q = VecDeque::from([start]);
let mut seen = vec![false; n]; seen[start] = true;
while let Some(u) = q.pop_front() {
    for &v in &adj[u] { if !seen[v] { seen[v] = true; q.push_back(v); } }
}
// DFS: swap the VecDeque for a Vec + pop_back(), or recurse.
```

**Dynamic programming (lite)** - 1D/2D table, define state + transition out loud. Fibonacci/climbing-stairs, coin change, LIS, edit distance. State the recurrence before coding.

**Dijkstra** (if latency/routing framing shows up - on-theme for Syncro): min-heap of `(Reverse(dist), node)`, relax edges. O(E log V).

## 5. Performance-aware Rust idioms (the "performance-aware, low-latency" ask)

Be ready to give the O(n) answer, THEN the constant-factor win:

- **Avoid needless allocation:** `Vec::with_capacity(n)` when size is known; reuse a scratch buffer across iterations instead of allocating inside a loop; borrow (`&str`, `&[T]`) instead of `clone()`/`to_owned()`.
- **`Vec` over `LinkedList`, always.** Cache locality wins; `LinkedList` is almost never the right answer in Rust. Say this if offered a linked list.
- **`entry` over double-lookup:** `map.entry(k).or_insert(0)` beats `if map.contains_key(&k) { ... } else { ... }` (one hash, not two).
- **`sort_unstable` over `sort`** when you don't need stability - fewer allocations, faster.
- **Iterators fuse + elide bounds checks** - idiomatic chains are fast; you rarely need manual indexing for speed.
- **Avoid `Rc<RefCell<T>>` and `Box<dyn Trait>` in hot paths** - indirection + refcount/vtable cost. Fine for structure, not for inner loops.
- **`--release` matters:** debug builds are 10-100x slower. If asked to benchmark, say "in release" - the scaffold's `[profile.release]` has `lto`, `opt-level=3`, `codegen-units=1`.
- **Integer overflow:** debug panics on overflow, release wraps. Know `wrapping_add`, `checked_add`, `saturating_add` and mention the distinction if arithmetic is on the hot path.
- **`#[inline]`** on tiny hot functions crossing crate boundaries - awareness-level, don't over-apply.
- **Data-oriented:** prefer `Vec<Struct>` for iteration; consider struct-of-arrays (SoA) if you only touch one field in a hot loop (cache).

Framing line: *"Here's the asymptotically optimal version at O(n). If this were on the transaction hot path, the constant-factor wins would be pre-allocating the buffer and avoiding the per-item clone."*

## 6. Error handling fluency (so you never stall on plumbing)

```rust
fn parse(s: &str) -> Result<i32, std::num::ParseIntError> {
    let n: i32 = s.trim().parse()?;   // ? propagates the error
    Ok(n * 2)
}
opt.unwrap_or(default);
opt.unwrap_or_else(|| expensive());
opt.map(|x| x + 1).filter(|&x| x > 0);
opt.ok_or("was none")?;               // Option -> Result
result.map_err(|e| format!("ctx: {e}"))?;
```

- In throwaway interview code, `unwrap()`/`expect("reason")` is acceptable **if you name it**: "I'll unwrap here since the input is guaranteed non-empty; in production I'd return a Result."
- Prefer `?` over nested matches - reads senior.

## 7. Testing idioms (your debug loop)

```rust
#[test]
fn handles_empty() {
    assert_eq!(solve(&[]), 0);
}
#[test]
fn handles_dupes() {
    assert_eq!(solve(&[2, 2, 2]), 2);
}
```
- Write the **empty / single / duplicate / max** cases first - they're where bugs hide and where interviewers probe.
- `assert_eq!(got, want)` prints both on failure. Run the exact test via the CodeLens.
- `dbg!(x)` inside code for a quick value check without a debugger.

## 8. 60-second self-check before you say "done"

1. Empty input? Single element? All duplicates? Max size / overflow?
2. Did I state time AND space Big-O out loud?
3. Any allocation or O(n) op hiding inside a loop (making it O(n^2))?
4. Off-by-one on the window/pointer bounds?
5. Does it compile clean (no clippy warnings)? Tests green?
