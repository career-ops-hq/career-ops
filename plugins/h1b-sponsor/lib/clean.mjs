// Text from the backend goes through this before any non-JSON output, whether
// it came from an endpoint or off the index: collapse whitespace so a line
// stays a line, then strip C0, DEL, and C1 control characters so a crafted
// name cannot smuggle terminal escapes or forged rows into the text output.
// JSON output keeps the raw fields. The collapse runs first because newlines
// and tabs are control chars too, and stripping them before the collapse
// would glue words together instead of separating them; what survives the
// collapse (ESC, BEL, DEL, C1) is not whitespace.
// eslint-disable-next-line no-control-regex
export const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

export function displayClean(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(CONTROL_CHARS, '').trim();
}
