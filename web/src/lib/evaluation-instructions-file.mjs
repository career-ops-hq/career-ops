
import fs from "node:fs";
import path from "node:path";

/**
 * Keep selected instructions off argv (#6583). Store them inside the worker's
 * data root so read-only sandboxes can read them without additional grants.
 * Each run owns its directory; remove it only after its worker closes.
 * @param {string} root
 * @param {string} instructions
 */
export function writeEvaluationInstructions(root, instructions) {
  const dir = fs.mkdtempSync(path.join(root, ".evaluation-instructions-"));
  const file = path.join(dir, "instructions.md");

  const cleanup = () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      console.error("[career-ops] Failed to remove evaluation instructions:", error);
    }
  };

  try {
    fs.writeFileSync(file, instructions, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    cleanup();
    throw error;
  }

  return {
    file,
    reference: `Read the selected canonical evaluation instructions from ${JSON.stringify(file)} before evaluating. Follow only those selected instructions; do not load the full evaluation mode or omitted sections.`,
    cleanup,
  };
}
