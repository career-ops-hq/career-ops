import { MAX_CV_SOURCE_CHARS } from "./upload.mjs";

/** Extract text locally, without rendering or executing document actions.
 * @param {ArrayBuffer} bytes
 */
export async function pdfText(bytes) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, stopAtErrors: true, verbosity: 0 });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 30) throw new Error("That PDF has more than 30 pages. Upload only your CV pages.");
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const { items } = await page.getTextContent();
      text += items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("") + "\n\n";
      page.cleanup();
      if (text.length > MAX_CV_SOURCE_CHARS) throw new Error("That CV contains too much text. Upload a shorter CV.");
    }
    if (!text.trim()) throw new Error("That PDF has no readable text (it may be scanned). Upload the TeX source or paste the CV text instead.");
    return text.trim();
  } catch (error) {
    if (error?.name === "PasswordException") throw new Error("That PDF is password protected. Upload an unlocked copy or the TeX source.");
    if (error?.name === "InvalidPDFException") throw new Error("That PDF could not be read. Upload a valid PDF or the TeX source.");
    throw error;
  } finally {
    await task.destroy();
  }
}
