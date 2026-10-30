// The usage meter re-read every transcript touched in the last week, in full
// and synchronously, about once a minute. createUsageScanner reads only what
// was appended since the last scan, with async fs.
//
// Run: npm test -- tests/lib/claude-usage-scan.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fsPromises from "node:fs/promises";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, utimesSync, renameSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createUsageScanner } from "../../src/lib/claude-usage-scan.mjs";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const HOUR = 3600 * 1000;
const line = (hoursAgo, input, extra = {}) =>
  JSON.stringify({ timestamp: new Date(NOW - hoursAgo * HOUR).toISOString(), message: { usage: { input_tokens: input, output_tokens: 0, ...extra } } }) + "\n";

// Counts bytes the scanner reads, so a test can tell "read the new part" from
// "read the whole file again".
// `maxRead` caps what one read() returns, to exercise short reads.
function countingFs({ maxRead = Infinity } = {}) {
  const stats = { bytes: 0, opens: 0, reads: 0 };
  const fs = {
    ...fsPromises,
    async open(p, flags) {
      stats.opens++;
      const h = await fsPromises.open(p, flags);
      return {
        async read(buf, off, len, pos) {
          stats.reads++;
          const r = await h.read(buf, off, Math.min(len, maxRead), pos);
          stats.bytes += r.bytesRead;
          return r;
        },
        stat: () => h.stat(),
        close: () => h.close(),
      };
    },
  };
  return { fs, stats };
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), "co-usage-scan-"));
  mkdirSync(join(root, "proj-a"), { recursive: true });
  return root;
}

test("totals for the 5h and 7d windows, as before", async () => {
  const root = setup();
  try {
    writeFileSync(join(root, "proj-a", "s1.jsonl"), line(1, 100) + line(6, 20) + line(24 * 8, 999) + '{"type":"other"}\n' + "not json\n");
    writeFileSync(join(root, "proj-a", "s2.jsonl"), line(2, 5, { cache_read_input_tokens: 10 }));
    const scanner = createUsageScanner({ root, now: () => NOW });
    const r = await scanner.compute();
    assert.deepEqual(r.window5h, { tokens: 115, messages: 2 });
    assert.deepEqual(r.window7d, { tokens: 135, messages: 3 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a second scan reads only the bytes appended since the first", async () => {
  const root = setup();
  try {
    const file = join(root, "proj-a", "s1.jsonl");
    const big = line(1, 1).repeat(2000);
    writeFileSync(file, big);
    const { fs, stats } = countingFs();
    const scanner = createUsageScanner({ root, now: () => NOW, fs });
    assert.equal((await scanner.compute()).window5h.messages, 2000);
    assert.equal(stats.bytes, Buffer.byteLength(big));

    stats.bytes = 0;
    const added = line(0.5, 7);
    appendFileSync(file, added);
    const r = await scanner.compute();
    assert.equal(r.window5h.messages, 2001);
    assert.equal(r.window5h.tokens, 2007);
    assert.equal(stats.bytes, Buffer.byteLength(added), "the whole transcript was read again");

    stats.opens = 0;
    await scanner.compute();
    assert.equal(stats.opens, 0, "an unchanged file is not opened at all");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a line still being written is counted once it is complete", async () => {
  const root = setup();
  try {
    const file = join(root, "proj-a", "s1.jsonl");
    const full = line(1, 40);
    writeFileSync(file, line(1, 2) + full.slice(0, 20));
    const scanner = createUsageScanner({ root, now: () => NOW });
    assert.equal((await scanner.compute()).window5h.tokens, 2);
    appendFileSync(file, full.slice(20));
    assert.equal((await scanner.compute()).window5h.tokens, 42);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a file that got shorter is read again from the start", async () => {
  const root = setup();
  try {
    const file = join(root, "proj-a", "s1.jsonl");
    writeFileSync(file, line(1, 10) + line(1, 10) + line(1, 10));
    const scanner = createUsageScanner({ root, now: () => NOW });
    assert.equal((await scanner.compute()).window5h.tokens, 30);
    writeFileSync(file, line(1, 3));
    assert.equal((await scanner.compute()).window5h.tokens, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a file untouched for over a week is skipped, and a cached one drops out", async () => {
  const root = setup();
  try {
    const stale = join(root, "proj-a", "old.jsonl");
    writeFileSync(stale, line(1, 50));
    const old = new Date(NOW - 9 * 24 * HOUR);
    utimesSync(stale, old, old);
    // Dated three days ahead, so at NOW + 9 days its event is still inside the
    // 7-day window: only the file's own mtime can drop it.
    const cached = join(root, "proj-a", "cached.jsonl");
    writeFileSync(cached, line(-3 * 24, 4));
    utimesSync(cached, new Date(NOW), new Date(NOW));
    let t = NOW;
    const scanner = createUsageScanner({ root, now: () => t });
    assert.equal((await scanner.compute()).window7d.tokens, 4, "an old-mtime file is skipped");
    t = NOW + 9 * 24 * HOUR;
    assert.equal((await scanner.compute()).window7d.tokens, 0, "a cached file whose mtime aged out stops counting");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a deleted file stops counting", async () => {
  const root = setup();
  try {
    const live = join(root, "proj-a", "live.jsonl");
    writeFileSync(live, line(1, 4));
    const scanner = createUsageScanner({ root, now: () => NOW });
    assert.equal((await scanner.compute()).window7d.tokens, 4);
    rmSync(live);
    assert.equal((await scanner.compute()).window7d.tokens, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a transcript larger than one read chunk counts every line, across chunk boundaries", async () => {
  const root = setup();
  try {
    // ~2.6 MB: three 1 MiB chunks, with lines straddling both boundaries.
    const one = line(1, 3, { cache_creation_input_tokens: 1 });
    const n = Math.ceil((2.5 * (1 << 20)) / Buffer.byteLength(one));
    writeFileSync(join(root, "proj-a", "big.jsonl"), one.repeat(n));
    const r = await createUsageScanner({ root, now: () => NOW }).compute();
    assert.equal(r.window5h.messages, n);
    assert.equal(r.window5h.tokens, 4 * n);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("short reads are retried until the range is read", async () => {
  const root = setup();
  try {
    const n = 500;
    writeFileSync(join(root, "proj-a", "s1.jsonl"), line(1, 2).repeat(n));
    const { fs, stats } = countingFs({ maxRead: 97 });
    const scanner = createUsageScanner({ root, now: () => NOW, fs });
    assert.equal((await scanner.compute()).window5h.messages, n);
    assert.ok(stats.reads > 1, "test premise: the reads really were short");
    stats.opens = 0;
    assert.equal((await scanner.compute()).window5h.messages, n);
    assert.equal(stats.opens, 0, "nothing left unread for the next scan to find");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a file replaced by a larger one is read again from the start", async () => {
  const root = setup();
  try {
    const file = join(root, "proj-a", "s1.jsonl");
    writeFileSync(file, line(1, 10) + line(1, 10));
    const scanner = createUsageScanner({ root, now: () => NOW });
    assert.equal((await scanner.compute()).window5h.tokens, 20);
    // A new file (new inode) moved over the old one, longer than it was.
    const replacement = join(root, "proj-a", "s1.jsonl.tmp");
    writeFileSync(replacement, line(1, 1) + line(1, 1) + line(1, 1));
    renameSync(replacement, file);
    assert.equal((await scanner.compute()).window5h.tokens, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the same size with a new mtime is a rewrite, not an append", async () => {
  const root = setup();
  try {
    const file = join(root, "proj-a", "s1.jsonl");
    writeFileSync(file, line(1, 10));
    utimesSync(file, new Date(NOW - HOUR), new Date(NOW - HOUR));
    const scanner = createUsageScanner({ root, now: () => NOW });
    assert.equal((await scanner.compute()).window5h.tokens, 10);
    writeFileSync(file, line(1, 20)); // same byte length, rewritten in place
    utimesSync(file, new Date(NOW), new Date(NOW));
    assert.equal((await scanner.compute()).window5h.tokens, 20);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent callers share one scan", async () => {
  const root = setup();
  try {
    writeFileSync(join(root, "proj-a", "s1.jsonl"), line(1, 9));
    const { fs, stats } = countingFs();
    const scanner = createUsageScanner({ root, now: () => NOW, fs });
    const [a, b] = await Promise.all([scanner.compute(), scanner.compute()]);
    assert.equal(a, b);
    assert.equal(stats.opens, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing projects directory is zero, not an error", async () => {
  const scanner = createUsageScanner({ root: join(tmpdir(), "co-usage-scan-missing-dir"), now: () => NOW });
  const r = await scanner.compute();
  assert.deepEqual([r.window5h.tokens, r.window7d.tokens], [0, 0]);
});
