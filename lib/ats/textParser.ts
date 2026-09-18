export async function parseTextFile(file: File): Promise<{ text: string; pageCount: number; isImageBased: boolean }> {
  try {
    const text = await file.text();
    const cleanText = text.trim();
    const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
    const pageCount = Math.max(1, Math.ceil(wordCount / 400));
    const isImageBased = cleanText.length < 20;

    return {
      text: cleanText,
      pageCount,
      isImageBased
    };
  } catch (error) {
    console.error('TXT parsing error:', error);
    throw new Error('Failed to read plain text file.');
  }
}
