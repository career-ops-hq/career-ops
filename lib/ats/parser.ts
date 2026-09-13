import type { ResumeParseResult } from './types';
import { parsePdfFile } from './pdfParser';
import { parseDocxFile } from './docxParser';
import { parseTextFile } from './textParser';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit

export async function parseResumeFile(file: File): Promise<ResumeParseResult> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File size exceeds 10MB limit. Please upload a smaller file.');
  }

  const fileName = file.name.toLowerCase();
  let fileType: 'pdf' | 'docx' | 'txt';

  if (fileName.endsWith('.pdf') || file.type === 'application/pdf') {
    fileType = 'pdf';
  } else if (fileName.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    fileType = 'docx';
  } else if (fileName.endsWith('.txt') || file.type === 'text/plain') {
    fileType = 'txt';
  } else {
    throw new Error('Unsupported file format. Please upload a .pdf, .docx, or .txt file.');
  }

  let parsed: { text: string; pageCount: number; isImageBased: boolean };

  if (fileType === 'pdf') {
    parsed = await parsePdfFile(file);
  } else if (fileType === 'docx') {
    parsed = await parseDocxFile(file);
  } else {
    parsed = await parseTextFile(file);
  }

  const text = parsed.text;
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const words = text
    .split(/\s+/)
    .map(w => w.replace(/[^a-zA-Z0-9+#.-]/g, '').trim())
    .filter(Boolean);

  if (words.length === 0) {
    throw new Error('We couldn\'t find any readable text in this file. It may be empty or password protected.');
  }

  return {
    text,
    pageCount: parsed.pageCount,
    isImageBased: parsed.isImageBased,
    fileType,
    fileName: file.name,
    fileSize: file.size,
    lines,
    words
  };
}
