import fs from "node:fs";
import path from "node:path";

/**
 * @param {string} outputDir
 * @param {(abs: string, outputDir: string) => boolean} isRegularFile
 * @returns {string[]}
 */
export function listOutputPdfNames(outputDir, isRegularFile) {
  let names;
  try {
    names = fs.readdirSync(outputDir);
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
  return names.filter((name) => {
    if (typeof name !== "string" || !name.toLowerCase().endsWith(".pdf")) return false;
    return isRegularFile(path.join(outputDir, name), outputDir);
  });
}
