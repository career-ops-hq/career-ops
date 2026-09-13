import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ResumeParseResult } from './types.ts';

// Configure pdfjs worker for browser execution
if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
}

export async function parsePdfFile(file: File): Promise<ResumeParseResult> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
    const pdfDoc = await loadingTask.promise;
    const pageCount = pdfDoc.numPages;
    let fullText = '';

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      let pageText = '';

      for (const item of textContent.items) {
        if ('str' in item && typeof item.str === 'string') {
          const str = item.str;
          const hasEOL = Boolean((item as any).hasEOL);
          pageText += str;
          if (hasEOL) {
            pageText += '\n';
          } else if (str && !str.endsWith(' ')) {
            pageText += ' ';
          }
        }
      }
      
      fullText += pageText.trim() + '\n\n';
    }

    const rawLines = fullText
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    const lines: string[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      const isBullet = /^[•\-\*\–\—\d.\)]/.test(line) || /^(?:Spearheaded|Implemented|Managed|Built|Engineered|Architected|Developed|Created|Led|Designed)\b/i.test(line);
      
      if (isBullet) {
        let combined = line;
        while (i + 1 < rawLines.length) {
          const next = rawLines[i + 1];
          const isNextBullet = /^[•\-\*\–\—\d.\)]/.test(next) || /^(?:Spearheaded|Implemented|Managed|Built|Engineered|Architected|Developed|Created|Led|Designed)\b/i.test(next);
          const isNextHeading = next.length <= 60 && !/[.?;]$/.test(next) && /^[A-Z0-9\s&—–|\-+#.:]{3,60}$/.test(next);
          const isNextEntry = next.includes('|') || next.includes('IFF') || /(?:19|20)\d\d/.test(next);
          
          if (!isNextBullet && !isNextHeading && !isNextEntry) {
            combined += (combined.endsWith('-') ? '' : ' ') + next;
            i++;
          } else {
            break;
          }
        }
        lines.push(combined);
      } else {
        lines.push(line);
      }
    }

    const reconstructedText = lines.join('\n');
    const finalText = reconstructedText || fullText.replace(/\s+/g, ' ').trim();
    const isImageBased = finalText.length < 50 && pageCount > 0;
    const words = finalText
      .split(/\s+/)
      .map(w => w.replace(/[^a-zA-Z0-9+#.-]/g, '').trim())
      .filter(Boolean);

    return {
      text: finalText,
      pageCount,
      isImageBased,
      fileType: 'pdf',
      fileName: file.name,
      fileSize: file.size,
      lines,
      words
    };
  } catch (error) {
    console.error('PDF parsing error:', error);
    throw new Error('Failed to parse PDF file. The file may be corrupted or password-protected.');
  }
}
