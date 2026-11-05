import path from "node:path";
import { careerOpsRoot, isRegularContainedFile, pdfPathStatusForReport } from "@/lib/career-ops";
import { cvDiskState } from "@/lib/cv-disk-state.mjs";
import { listOutputPdfNames } from "@/lib/output-pdf-names.mjs";
import { tailoredCvOnDisk } from "@/lib/tailored-cv-ready.mjs";

type CvRow = { n: string; company: string; trackerMarked?: boolean };

export async function readCvDiskForRows(rows: CvRow[]) {
  const filenames = listOutputPdfNames(path.join(careerOpsRoot(), "output"), isRegularContainedFile);
  const pairs = await Promise.all(
    rows.map(async (row) => {
      const indexStatus = (await pdfPathStatusForReport(String(row.n))).status;
      const onDisk = tailoredCvOnDisk({ indexStatus, filenames, company: row.company });
      return [row.n, cvDiskState({ onDisk, trackerMarked: Boolean(row.trackerMarked) })] as const;
    }),
  );
  return Object.fromEntries(pairs);
}

export async function readCvDiskState(n: string, company: string, trackerMarked = false) {
  const all = await readCvDiskForRows([{ n, company, trackerMarked }]);
  return all[n] ?? cvDiskState({ onDisk: false, trackerMarked });
}
