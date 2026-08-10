import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

// THE one place every user-layer write goes through. The core's #1 historical
// pain was data-loss (#649/#704/#920/#958); these guards make a web write
// crash-safe + non-clobbering by construction:
//   - atomic: write a UNIQUE temp file (pid + uuid → no concurrent-write race on
//     a single long-lived Next pid) in the SAME dir, then rename (atomic on POSIX),
//     so a kill mid-write can never truncate the real file.
//   - backup: optionally snapshot the prior contents to {file}.bak-{ts} before
//     overwriting, so a bad write is recoverable even though user files are gitignored.

export function atomicWrite(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
  renderBrandedResumePdfIfNeeded(file);
}

/** Snapshot the file (if it has content) to a timestamped .bak before a write. */
export function backup(file: string): string | null {
  try {
    const cur = fs.readFileSync(file, "utf8");
    if (!cur.trim()) return null;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const bak = `${file}.bak-${ts}`;
    fs.writeFileSync(bak, cur, "utf8");
    return bak;
  } catch {
    return null; // no prior file → nothing to back up
  }
}

/** Atomic write that first backs up any existing content. Returns the backup path. */
export function atomicWriteWithBackup(file: string, content: string): string | null {
  const bak = backup(file);
  atomicWrite(file, content);
  return bak;
}

function renderBrandedResumePdfIfNeeded(file: string): void {
  const root = process.env.CAREER_OPS_ROOT?.trim() || path.resolve(process.cwd(), "..");
  const outputDir = path.join(root, "output");
  const absFile = path.resolve(file);
  const rel = path.relative(outputDir, absFile);
  if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`)) return;
  if (!path.basename(absFile).endsWith("-resume.md")) return;

  const script = path.join(root, "scripts", "build_resumes.py");
  const pdf = absFile.slice(0, -3) + ".pdf";
  const previewDir = path.join("/private/tmp", "resume-previews", path.basename(absFile, ".md"));
  const proc = spawnSync("python3", [script, absFile, pdf, "--preview-dir", previewDir], {
    cwd: root,
    env: {
      ...process.env,
      PYTHONPYCACHEPREFIX: process.env.PYTHONPYCACHEPREFIX || "/private/tmp/pycache",
    },
    encoding: "utf8",
  });
  if (proc.status !== 0) {
    const detail = [proc.stdout, proc.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`Branded resume PDF generation failed for ${path.basename(absFile)}${detail ? `\n${detail}` : ""}`);
  }
}
