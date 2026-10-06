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
// CommonMark 0.31.2 §4.5. Opening: ≤3 spaces of indentation, then 3+
// backticks or 3+ tildes (never mixed); after a backtick run the info string
// may not contain a backtick, or the line is inline code, not a fence.
// Closing: ≤3 spaces, the SAME character, a run AT LEAST as long as the
// opening one, then only spaces or tabs. Anything looser lets a ``` line
// inside a ```` fence close it early and hide the rest of the file.
const OPEN_FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CLOSE_FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * Blank out HTML comments and fenced code blocks, keeping every newline so
 * line numbers still point into the original file.
 * @param {string} content
 * @returns {string[]} lines
 */
function contentLines(content) {
  const noComments = String(content ?? '').replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ''));
  const lines = noComments.split(/\r?\n/);
  let fence = null; // the opening run, e.g. '````' — its character and length both matter
  for (let i = 0; i < lines.length; i++) {
    if (fence) {
      const close = lines[i].match(CLOSE_FENCE_RE);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      lines[i] = '';
      continue;
    }
    const open = lines[i].match(OPEN_FENCE_RE);
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      fence = open[1];
      lines[i] = '';
    }
  }
  // An unclosed fence runs to the end of the document, as in CommonMark.
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
 * Split story-bank.md into `### ` blocks, the table rows outside them, and the
 * text a story was cut off from.
 *
 * `raw` is the heading line plus the body, which is what the provenance
 * checker scans, so a figure in a title is still checked.
 *
 * A story ends at a table row or a `#`/`##` heading, so a table's figures are
 * never credited to the story above it. But the lines AFTER that point, up to
 * the next `### `, are still in the file: a Result line below a `## Notes`
 * heading, or an Action below a table. They come back as `trailing`, one
 * entry per run of text between headings or tables, tied to the story they
 * follow (`story` is its index in `blocks`), so the provenance checker can
 * still scan them. Text before the first story belongs to no story and is not
 * returned. Table rows carry the same `story` index, or -1 before any story.
 *
 * @param {string} content
 * @returns {{
 *   blocks: Array<{header: string, theme: string, title: string, body: string, raw: string, line: number}>,
 *   tableRows: Array<{line: number, text: string, cells: string[], label: string, story: number}>,
 *   trailing: Array<{story: number, line: number, after: 'heading'|'table', text: string}>
 * }} `line` is 1-based.
 */
export function splitStoryBlocks(content) {
  const lines = contentLines(content);
  const blocks = [];
  const tableRows = [];
  const trailing = [];
  let current = null; // the block whose body is still open
  let run = [];       // consecutive table lines
  let segment = null; // the trailing run being collected
  let cutBy = null;   // what ended the last story or segment: 'heading' | 'table'

  const flushRun = () => {
    const story = blocks.length - 1;
    if (run.length) tableRows.push(...tableDataRows(run).map((r) => ({ ...r, story })));
    run = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    const heading = text.match(HEADING_RE);

    if (TABLE_ROW_RE.test(text)) {
      current = null;
      segment = null;
      cutBy = 'table';
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
      segment = null;
      continue;
    }

    if (BLOCK_END_RE.test(text)) {
      current = null;
      segment = null;
      cutBy = 'heading';
      continue;
    }

    if (current) {
      current.bodyLines.push(text);
    } else if (blocks.length && text.trim()) {
      if (!segment) {
        segment = { story: blocks.length - 1, line: i + 1, after: cutBy, lines: [] };
        trailing.push(segment);
      }
      segment.lines.push(text);
    }
  }
  flushRun();

  return {
    blocks: blocks.map(({ bodyLines, ...b }) => {
      const body = bodyLines.join('\n').trim();
      return { ...b, body, raw: `${b.header}\n${body}` };
    }),
    tableRows,
    trailing: trailing.map(({ lines: segLines, ...t }) => ({ ...t, text: segLines.join('\n') })),
  };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Value of the first non-empty `**Label:** value` line for any of `labels`.
 *
 * The label must START the line, optionally after indentation and one list or
 * quote marker (`-`, `*`, `+`, `>`). Unanchored, a label quoted inside another
 * field's value counted as that field: a Situation reading "…had a line
 * reading **A (Action):** TBD…" passed isValidStory() with no Action of its
 * own, and this function decides validity for every reader.
 *
 * `[ \t]*`, not `\s*`: an empty `**Action:**` must not borrow the next line as
 * its value.
 * @param {string} body
 * @param {readonly string[]} labels - plain text; escaped here
 * @returns {string} '' when absent
 */
export function getField(body, labels) {
  const text = String(body ?? '');
  for (const label of labels) {
    const re = new RegExp(`^[ \\t]*(?:[-*+>][ \\t]+)?\\*\\*${escapeRegExp(label)}:\\*\\*[ \\t]*(.+)$`, 'gm');
    for (const hit of text.matchAll(re)) {
      if (hit[1].trim()) return hit[1].trim();
    }
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
