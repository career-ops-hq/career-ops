import { stripVTControlCharacters } from 'node:util';

// Text from the backend goes through this before any non-JSON output, whether
// it came from an endpoint or off the index: remove complete terminal escape
// sequences, collapse whitespace so a line stays a line, then strip any
// remaining C0, DEL, and C1 control characters so a crafted name cannot
// smuggle terminal commands or forged rows into the text output. JSON output
// keeps the raw fields. The collapse runs before the remaining control-character
// pass because newlines and tabs are control chars too, and stripping them first
// would glue words together instead of separating them.
// eslint-disable-next-line no-control-regex
export const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

export function cleanForDisplay(s) {
  const text = stripVTControlCharacters(String(s ?? ''));
  return text.replace(/\s+/g, ' ').replace(CONTROL_CHARS, '').trim();
}

export const displayClean = cleanForDisplay;
