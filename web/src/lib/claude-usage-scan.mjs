// Token totals for the web usage meter, from Claude Code's transcripts.
//
// /api/usage sums per-message usage across every project under
// ~/.claude/projects/**/*.jsonl for the rolling 5h and 7d windows. It used to
// re-read every transcript touched in the last week, in full and with
// synchronous fs calls, about once a minute, blocking the server for the whole
// walk. Transcripts are append-only, so this scanner remembers how far it got
// in each file and reads only the bytes added since, with async fs, a chunk at
// a time. A file that looks rewritten rather than appended to (a new inode, a
// shorter file, or the same size with a new mtime) is read again from the
// start.

import fsPromises from "node:fs/promises";
import path from "node:path";
import { claudeUsageTokens } from "./claude-usage.mjs";

const HOUR = 3600 * 1000;
// Read size per call: a first scan of a large transcript is parsed in pieces
// rather than held whole in memory.
const CHUNK_BYTES = 1 << 20;

/**
 * @param {object} options
 * @param {string} options.root - The projects directory (~/.claude/projects).
 * @param {() => number} [options.now]
 * @param {typeof fsPromises} [options.fs] - Injected for tests.
 */
export function createUsageScanner({ root, now = Date.now, fs = fsPromises }) {
  /** @type {Map<string, { offset: number, size: number, mtimeMs: number, events: { ts: number, tokens: number }[] }>} */
  const files = new Map();
  let inFlight = null;

  async function* walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) yield* walk(p);
      else if (e.isFile() && e.name.endsWith(".jsonl")) yield p;
    }
  }

  function parseLines(entry, bytes) {
    for (const line of bytes.toString("utf8").split("\n")) {
      if (!line.includes('"usage"')) continue;
      let d;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      const u = d?.message?.usage;
      const ts = d?.timestamp ? Date.parse(d.timestamp) : NaN;
      if (!u || Number.isNaN(ts)) continue;
      entry.events.push({ ts, tokens: claudeUsageTokens(u) });
    }
  }

  // Read [entry.offset, size) through an open handle, CHUNK_BYTES at a time,
  // and parse every complete line. The offset only moves past the last
  // newline, so a line still being written is read whole on the next scan; a
  // partial line is carried into the next chunk. A newline byte is never inside
  // a UTF-8 sequence, so decoding never splits a character. read() may return
  // fewer bytes than asked: it is called again until the chunk is full or the
  // file ends. Returns how far the file was actually read.
  async function readAppended(handle, entry, size) {
    let pos = entry.offset;
    let carry = Buffer.alloc(0);
    while (pos < size) {
      const want = Math.min(CHUNK_BYTES, size - pos);
      const buf = Buffer.allocUnsafe(want);
      let got = 0;
      while (got < want) {
        const { bytesRead } = await handle.read(buf, got, want - got, pos + got);
        if (bytesRead === 0) break;
        got += bytesRead;
      }
      if (got === 0) break;
      pos += got;
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, got)]) : buf.subarray(0, got);
      const end = data.lastIndexOf(0x0a);
      if (end === -1) {
        carry = data;
      } else {
        // `data` starts at entry.offset: the carry is exactly what is unparsed.
        parseLines(entry, data.subarray(0, end));
        entry.offset += end + 1;
        carry = data.subarray(end + 1);
      }
      if (got < want) break; // the file ended before the size it reported
    }
    return pos;
  }

  async function scan() {
    const t = now();
    const w5 = t - 5 * HOUR;
    const w7 = t - 7 * 24 * HOUR;
    const cutoffMtime = w7 - HOUR;
    const present = new Set();
    for await (const file of walk(root)) {
      let st;
      try {
        st = await fs.stat(file);
      } catch {
        continue;
      }
      if (st.mtimeMs < cutoffMtime) continue;
      present.add(file);
      const cached = files.get(file);
      // The path stat only decides whether to look closer: an unchanged file
      // is never opened.
      if (cached && cached.ino === st.ino && cached.size === st.size && cached.mtimeMs === st.mtimeMs) continue;
      let handle;
      try {
        handle = await fs.open(file, "r");
      } catch {
        continue; // unreadable now; retried on the next scan
      }
      try {
        // What is read is decided from the opened file, not the path stat: the
        // path may have been replaced in between.
        const hs = await handle.stat();
        let entry = cached;
        const rewritten = !entry
          || entry.ino !== hs.ino
          || hs.size < entry.offset
          || (hs.size === entry.size && hs.mtimeMs !== entry.mtimeMs);
        if (rewritten) {
          entry = { offset: 0, size: 0, mtimeMs: 0, ino: hs.ino, events: [] };
          files.set(file, entry);
        }
        // Recorded as read so far, not as the size reported: a file that came
        // up short is still "changed" on the next scan and read on from there.
        entry.size = await readAppended(handle, entry, hs.size);
        entry.mtimeMs = hs.mtimeMs;
      } catch {
        // unreadable now; retried on the next scan
      } finally {
        await handle.close().catch(() => {});
      }
    }
    let t5 = 0;
    let t7 = 0;
    let m5 = 0;
    let m7 = 0;
    for (const [file, entry] of files) {
      if (!present.has(file)) {
        files.delete(file); // gone, or untouched for over a week
        continue;
      }
      entry.events = entry.events.filter((e) => e.ts >= w7);
      for (const e of entry.events) {
        t7 += e.tokens;
        m7 += 1;
        if (e.ts >= w5) {
          t5 += e.tokens;
          m5 += 1;
        }
      }
    }
    return { window5h: { tokens: t5, messages: m5 }, window7d: { tokens: t7, messages: m7 }, computedAt: t };
  }

  return {
    /** Current totals. Concurrent callers share one scan. */
    compute() {
      if (!inFlight) inFlight = scan().finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}
