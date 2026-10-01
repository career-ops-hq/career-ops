/**
 * lib/story-bank.mjs — the one definition of what a story-bank.md story is.
 *
 * interview-prep/story-bank.md has three readers: match-star.mjs (`npm run
 * star`), negotiation-roi.mjs, and story-provenance-check.mjs. They used to
 * carry two separate parsers that agreed on how to split the file but not on
 * what counts as a story — match-star dropped a block with no Action line,
 * the provenance checker kept it. A contract the readers can disagree on is a
 * contract no writer can satisfy (#4514), so splitting, field lookup and
 * validity live here, and every reader goes through them.
 *
 * The entry shape, shown in full in templates/story-bank.template.md:
 *
 *   ### [Theme] Title
 *   **Source:** Report #NNN — Company — Role
 *   **S (Situation):** …
 *   **A (Action):** …            ← required: a block without it is not a story
 *   …
 *
 * Three ways the previous split went wrong, each fixed here:
 *
 *   - A `### ` line inside an HTML comment or a code fence was read as a real
 *     story. The template removed in #944 kept its example inside `<!-- -->`,
 *     so every install from that period carries one phantom story titled
 *     "Story Title". Comments and fences are blanked before splitting.
 *   - A block ran to the next `### `, so Block F table rows appended after a
 *     story became part of that story's body, and the provenance checker
 *     attributed their figures to it. A block now ends at the first table row
 *     or `#`/`##` heading.
 *   - Table rows were dropped without a word. They are returned separately,
 *     so readers can say how many stories they cannot see instead of
 *     reporting an empty bank as clean.
 *
 * Imports nothing, like lib/placeholder-cell.mjs and lib/ascii-fold.mjs.
 */

/**
 * Field → accepted labels, first match wins. The long form is what the
 * template teaches; the short form is what earlier entries used.
 */
export const STORY_FIELDS = Object.freeze({
  source:     Object.freeze(['Source']),
  situation:  Object.freeze(['S (Situation)', 'Situation']),
  task:       Object.freeze(['T (Task)', 'Task']),
  action:     Object.freeze(['A (Action)', 'Action']),
  result:     Object.freeze(['R (Result)', 'Result']),
  reflection: Object.freeze(['Reflection']),
  tags:       Object.freeze(['Best for questions about']),
});

const HEADING_RE = /^### (.*)$/;
const BLOCK_END_RE = /^#{1,2}\s/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR_RE = /^\s*\|[\s:|-]+\|\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;

/**
 * Blank out HTML comments and fenced code blocks, keeping every newline so
 * line numbers still point into the original file.
 * @param {string} content
 * @returns {string[]} lines
 */
function contentLines(content) {
  const noComments = String(content ?? '').replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ''));
  const lines = noComments.split(/\r?\n/);
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(FENCE_RE);
    if (fence) {
      if (m && m[1] === fence) fence = null;
      lines[i] = '';
    } else if (m) {
      fence = m[1];
      lines[i] = '';
    }
  }
  return lines;
}

function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/**
 * Turn a run of consecutive table lines into data rows. A line followed by a
 * separator row is a header, not a story.
 */
function tableDataRows(run) {
  const hasHeader = run.length > 1 && TABLE_SEPARATOR_RE.test(run[1].text);
  const header = hasHeader ? tableCells(run[0].text) : null;
  const storyCol = header ? header.findIndex((c) => /story/i.test(c)) : -1;
  const rows = [];
  for (const [i, { line, text }] of run.entries()) {
    if (hasHeader && i < 2) continue;
    if (TABLE_SEPARATOR_RE.test(text)) continue;
    const cells = tableCells(text);
    const label = (storyCol >= 0 && cells[storyCol])
      || cells.find((c) => c && !/^#?\d*$/.test(c))
      || '';
    rows.push({ line, text: text.trim(), cells, label });
  }
  return rows;
}

/**
 * Split story-bank.md into `### ` blocks and the table rows outside them.
 *
 * `raw` is the heading line plus the body, which is what the provenance
 * checker scans, so a figure in a title is still checked.
 *
 * @param {string} content
 * @returns {{
 *   blocks: Array<{header: string, theme: string, title: string, body: string, raw: string, line: number}>,
 *   tableRows: Array<{line: number, text: string, cells: string[], label: string}>
 * }} `line` is 1-based.
 */
export function splitStoryBlocks(content) {
  const lines = contentLines(content);
  const blocks = [];
  const tableRows = [];
  let current = null; // the block whose body is still open
  let run = [];       // consecutive table lines

  const flushRun = () => {
    if (run.length) tableRows.push(...tableDataRows(run));
    run = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    const heading = text.match(HEADING_RE);

    if (TABLE_ROW_RE.test(text)) {
      current = null;
      run.push({ line: i + 1, text });
      continue;
    }
    flushRun();

    if (heading) {
      const header = heading[1].trim();
      const themeMatch = header.match(/^\[([^\]]+)\]\s*(.+)/);
      current = {
        header,
        theme: themeMatch ? themeMatch[1].trim() : '',
        title: themeMatch ? themeMatch[2].trim() : header,
        bodyLines: [],
        line: i + 1,
      };
      blocks.push(current);
      continue;
    }

    if (BLOCK_END_RE.test(text)) {
      current = null;
      continue;
    }

    if (current) current.bodyLines.push(text);
  }
  flushRun();

  return {
    blocks: blocks.map(({ bodyLines, ...b }) => {
      const body = bodyLines.join('\n').trim();
      return { ...b, body, raw: `${b.header}\n${body}` };
    }),
    tableRows,
  };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Value of the first `**Label:** value` line matching any of `labels`.
 * @param {string} body
 * @param {readonly string[]} labels - plain text; escaped here
 * @returns {string} '' when absent
 */
export function getField(body, labels) {
  for (const label of labels) {
    // `[ \t]*`, not `\s*`: an empty `**Action:**` must not borrow the next
    // line as its value and pass isValidStory() on someone else's field.
    const hit = String(body ?? '').match(new RegExp(`\\*\\*${escapeRegExp(label)}:\\*\\*[ \\t]*(.+)`));
    if (hit && hit[1].trim()) return hit[1].trim();
  }
  return '';
}

/**
 * THE validity rule every reader shares: a title and an Action. A block that
 * fails it is invisible to `npm run star` and negotiation-roi, and the
 * provenance checker reports it as malformed (while still scanning it).
 * @param {{title: string, body: string}} block
 */
export function isValidStory(block) {
  return Boolean(block && block.title && getField(block.body, STORY_FIELDS.action));
}

/**
 * Parse story-bank.md into the STAR stories match-star scores and
 * negotiation-roi mines. Only blocks passing isValidStory().
 * @param {string} content
 * `line` (1-based, the heading's line) lets callers and the contract test
 * tell same-titled stories apart.
 * @returns {Array<{title, theme, source, situation, task, action, result, reflection, tags, line}>}
 */
export function parseStories(content) {
  return splitStoryBlocks(content).blocks.filter(isValidStory).map((b) => {
    const tagsRaw = getField(b.body, STORY_FIELDS.tags);
    return {
      title:      b.title,
      theme:      b.theme,
      source:     getField(b.body, STORY_FIELDS.source),
      situation:  getField(b.body, STORY_FIELDS.situation),
      task:       getField(b.body, STORY_FIELDS.task),
      action:     getField(b.body, STORY_FIELDS.action),
      result:     getField(b.body, STORY_FIELDS.result),
      reflection: getField(b.body, STORY_FIELDS.reflection),
      tags:       tagsRaw ? tagsRaw.split(/[,;]/).map((t) => t.trim().toLowerCase()).filter(Boolean) : [],
      line:       b.line,
    };
  });
}
