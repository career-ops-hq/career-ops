import fs from "node:fs";
import path from "node:path";

export const MAX_ROLE_SOURCE_BYTES = 200_000;

export function loadRoleResumeSource(root) {
  const file = path.join(root, "cv.md");
  let cv;
  try { cv = fs.readFileSync(file, "utf8"); }
  catch (error) {
    if (error?.code === "ENOENT") throw new Error("General Role resume source CV is missing or empty.");
    throw new Error("General Role resume source CV could not be read.");
  }
  if (!cv.trim()) throw new Error("General Role resume source CV is missing or empty.");
  if (Buffer.byteLength(cv, "utf8") > MAX_ROLE_SOURCE_BYTES) throw new Error("General Role resume source CV exceeds the 200KB safety limit.");
  // This is a content signal, not an identity parser: the backend never guesses
  // a name. It only refuses a file that does not resemble the canonical Markdown CV.
  if (!/^#\s+\S/m.test(cv) || !/^##\s+\S/m.test(cv)) throw new Error("General Role resume source CV does not contain the expected profile headings.");
  return { cv, bytes: Buffer.byteLength(cv, "utf8"), file: "cv.md" };
}
