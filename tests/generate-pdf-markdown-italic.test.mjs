// tests/generate-pdf-markdown-italic.test.mjs — normalizeTextForATS renders
// markdown italic (_Title_) as <em>, the way it already renders **bold**.
// cv.md writes game and product titles in italics, and tailored payloads copy
// them verbatim, so without this the PDF showed literal underscores. Only an
// underscore pair on word boundaries is italic: snake_case, a_b paths and
// __double__ underscores stay as written.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\ngenerate-pdf.mjs — markdown italic becomes <em>');

const { normalizeTextForATS } = await import(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href);
const body = (html) => normalizeTextForATS(`<p>${html}</p>`).html;

const cases = [
  ['Lead developer on the puzzle game _Lantern Grove_.', 'Lead developer on the puzzle game <em>Lantern Grove</em>.'],
  ['Shipped _Orbit_, which won awards', 'Shipped <em>Orbit</em>, which won awards'],
  ['the console game _Paper Tigers!_ (2019)', 'the console game <em>Paper Tigers!</em> (2019)'],
  ['_A_ and _B_', '<em>A</em> and <em>B</em>'],
  ['_x_', '<em>x</em>'],
  ['Set max_retry_count in config', 'Set max_retry_count in config'],
  ['See docs/my_file_name.md', 'See docs/my_file_name.md'],
  ['See docs/_draft_/cv.md', 'See docs/_draft_/cv.md'],
  ['Saved to C:\\cv\\_old_\\cv.md', 'Saved to C:\\cv\\_old_\\cv.md'],  ['Use __dunder__ names', 'Use __dunder__ names'],
  ['A lone _ underscore', 'A lone _ underscore'],
  ['Not _ spaced _ out', 'Not _ spaced _ out'],
  ['_open but never closed', '_open but never closed'],
  ['**Bold** and _italic_', '<strong>Bold</strong> and <em>italic</em>'],
];
for (const [input, want] of cases) {
  const got = body(input);
  if (got === `<p>${want}</p>`) pass(`"${input}" -> "${want}"`);
  else fail(`"${input}" became ${got}, want <p>${want}</p>`);
}

const attr = normalizeTextForATS('<a href="https://example.com/_x_/">link</a>').html;
if (attr.includes('href="https://example.com/_x_/"')) pass('leaves underscores in tag attributes untouched');
else fail(`attribute changed: ${attr}`);

const plain = normalizeTextForATS('<title>CV - _Orbit_</title><textarea>_x_</textarea><p>_Orbit_</p>');
if (plain.html === '<title>CV - _Orbit_</title><textarea>_x_</textarea><p><em>Orbit</em></p>' && plain.replacements['markdown-italic'] === 1) {
  pass('leaves underscores in text-only elements (title, textarea) as written');
} else fail(`text-only element changed: ${JSON.stringify(plain)}`);

const { replacements } = normalizeTextForATS('<p>_One_ and _Two_ but snake_case</p>');
if (replacements['markdown-italic'] === 2) pass('counts each italic run once');
else fail(`markdown-italic count wrong: ${JSON.stringify(replacements)}`);
