import fs from "node:fs";

const slots = new Map();

function stamp(st) {
  return `${st.mtimeNs}:${st.size}`;
}

/**
 * Parsed contents of one file, reused until that file's mtime or size changes.
 * `kind` separates two parsers of the same path. A missing file is null and
 * not cached. Any other stat or read error is thrown. The value is the object
 * `parse` returned, so callers must not mutate it.
 *
 * @template T
 * @param {string} file
 * @param {string} kind
 * @param {(text: string) => T} parse
 * @returns {T | null}
 */
export function cachedFileValue(file, kind, parse) {
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
  const token = stamp(st);
  const hit = slots.get(key);
  if (hit && hit.token === token) return hit.value;

  const text = fs.readFileSync(file, "utf8");
  const value = parse(text);
  let after;
  try {
    after = fs.statSync(file, { bigint: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return value;
    throw err;
  }
  if (stamp(after) === token) slots.set(key, { token, value });
  return value;
}
