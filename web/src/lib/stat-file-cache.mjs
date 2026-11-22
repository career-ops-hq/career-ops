import fs from "node:fs";

const slots = new Map();

function stamp(st) {
  return `${st.mtimeNs}:${st.size}:${st.ctimeNs}`;
}

// A dependency that is missing stays a stable stamp. Appearing later is a
// different stamp, so the parsed value is read again.
function fileStamp(file) {
  try {
    return stamp(fs.statSync(file, { bigint: true }));
  } catch (err) {
    if (err && err.code === "ENOENT") return "missing";
    if (err && err.code) return `err:${err.code}`;
    throw err;
  }
}

function dependencyToken(deps) {
  if (!deps || deps.length === 0) return "";
  return `\n${deps.map(fileStamp).join("\n")}`;
}

/**
 * Parsed contents of one file, reused until that file's mtime, size, or ctime
 * changes. ctime catches a same-size edit whose mtime was put back with utimes.
 * `kind` separates two parsers of the same path. `deps` are other files the
 * parsed value depends on. A change to any of them drops the cached value.
 * A missing file is null and not cached. Any other stat or read error is
 * thrown. The value is the object `parse` returned, so callers must not mutate it.
 *
 * A read whose stamp changed before the second stat is returned and not cached.
 * The file was moving, so the next call reads it again.
 *
 * @template T
 * @param {string} file
 * @param {string} kind
 * @param {(text: string) => T} parse
 * @param {string[]} [deps]
 * @returns {T | null}
 */
export function cachedFileValue(file, kind, parse, deps) {
  const key = `${file}\0${kind}`;
  let st;
  try {
    st = fs.statSync(file, { bigint: true });
  } catch (err) {
    if (err && err.code === "ENOENT") {
      slots.delete(key);
      return null;
    }
    throw err;
  }
  const token = stamp(st) + dependencyToken(deps);
  const hit = slots.get(key);
  if (hit && hit.token === token) return hit.value;

  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    // Deleted after the stat: same answer as a file that was never there.
    if (err && err.code === "ENOENT") {
      slots.delete(key);
      return null;
    }
    throw err;
  }
  const value = parse(text);
  let after;
  try {
    after = fs.statSync(file, { bigint: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return value;
    throw err;
  }
  if (stamp(after) + dependencyToken(deps) === token) slots.set(key, { token, value });
  return value;
}
