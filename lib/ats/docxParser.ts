import mammoth from 'mammoth';

export async function parseDocxFile(file: File): Promise<{ text: string; pageCount: number; isImageBased: boolean }> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const rawText = result.value || '';
    const cleanText = rawText.trim();
    
    // Estimate page count for DOCX (~400 words per page)
    const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
    const pageCount = Math.max(1, Math.ceil(wordCount / 400));
    const isImageBased = cleanText.length < 50;

    return {
      text: cleanText,
      pageCount,
      isImageBased
    };
  } catch (error) {
    console.error('DOCX parsing error:', error);
    throw new Error('Failed to parse DOCX file. The file may be corrupted or invalid.');
  }
}
