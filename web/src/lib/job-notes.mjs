/** Display the existing tracker's semicolon-separated notes as individual notes. */
export function splitJobNotes(value) {
  return String(value ?? '').split('; ').map(note => note.trim()).filter(note => note && !['—', '-'].includes(note));
}
