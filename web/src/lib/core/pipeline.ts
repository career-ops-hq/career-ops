import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import type { DiscoveredOffer } from "./scan";

/**
 * "Add to pipeline" — appends user-selected discovered offers to data/pipeline.md
 * AND records them in data/scan-history.tsv (so future scans dedup them). We reuse
 * the CANONICAL writers exported by the core's scan.mjs (`appendToPipeline`,
 * `appendToScanHistory`) instead of re-implementing the line format / section
 * markers — single source of truth, per the web↔core contract. We invoke them in
 * a short-lived node process (cwd = the user's career-ops root) so the core's own
 * code does the writing; the web never owns a parallel copy of that logic.
 *
 * Discovered-but-not-added offers stay "new" (a dry-run scan writes nothing);
 * only an explicit add records them as seen. No tokens are spent here.
 */
export type AddResult = { added: number; error?: string };

export function addOffersToPipeline(offers: DiscoveredOffer[]): Promise<AddResult> {
  const clean = offers
    .filter((o) => o && typeof o.url === "string" && /^https?:\/\//i.test(o.url))
    .map((o) => ({
      url: o.url,
      company: o.company || "",
      title: o.title || "",
      location: o.location || "",
      source: o.source || o.ats || "explorer",
      opportunityType: o.opportunityType,
      // Preserve the optional per-offer signal so it survives to pipeline.md.
      // The core writer treats an empty note as absent (byte-identical output).
      note: o.note || "",
    }));
  if (clean.length === 0) return Promise.resolve({ added: 0 });

  // Data-only / pre-scan-ats checkout has no scan.mjs writers → fail with an
  // actionable message instead of a silent added:0.
  const scanScript = rootScript("scan");
  if (!fs.existsSync(scanScript)) {
    return Promise.resolve({ added: 0, error: "Esta instalação contém apenas dados e não inclui o módulo que atualiza as oportunidades (scan.mjs)." });
  }

  const scanUrl = pathToFileURL(scanScript).href;
  const localTodayUrl = pathToFileURL(path.join(path.dirname(scanScript), "lib", "local-today.mjs")).href;
  const code = `
import { appendToPipeline, appendToScanHistory } from ${JSON.stringify(scanUrl)};
import { localToday } from ${JSON.stringify(localTodayUrl)};
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", async () => {
  try {
    const offers = JSON.parse(input);
    // LOCAL calendar day, not the UTC one — west of Greenwich, an evening
    // add would otherwise stamp scan-history.tsv's first_seen a day ahead,
    // opening scan.mjs's recheck/cooldown gate a day late for this row (#3070).
    const date = localToday();
    await appendToPipeline(offers);
    await appendToScanHistory(offers, date, "added");
    process.stdout.write(JSON.stringify({ added: offers.length }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ added: 0, error: String((e && e.message) || e) }));
  }
});
`;

  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
      cwd: careerOpsRoot(),
      env: process.env,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => resolve({ added: 0, error: e instanceof Error ? e.message : "spawn failed" }));
    child.on("close", (code, signal) => {
      const stderr = err.trim().slice(0, 200);
      if (code !== 0 || signal) {
        resolve({ added: 0, error: stderr || (signal ? `O processo de escrita terminou com ${signal}.` : `O processo de escrita terminou com o código ${code}.`) });
        return;
      }
      if (!out.trim()) {
        resolve({ added: 0, error: stderr || "O processo de escrita não devolveu um resultado." });
        return;
      }
      try {
        const parsed = JSON.parse(out.trim()) as AddResult;
        if (!Number.isFinite(parsed.added) || parsed.added < 0) {
          resolve({ added: 0, error: stderr || "O processo de escrita devolveu um resultado inválido." });
          return;
        }
        resolve({ added: parsed.added, error: parsed.error });
      } catch {
        resolve({ added: 0, error: stderr || "O processo de escrita devolveu um resultado inválido." });
      }
    });
    child.stdin.write(JSON.stringify(clean));
    child.stdin.end();
  });
}
