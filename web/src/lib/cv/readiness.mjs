// Client-safe (no node). Deterministic "is this CV good enough to score?" signal —
// ZERO tokens. Advisory only: it drives a green-check vs amber hint, NEVER blocks
// saving (the minimal-CV principle: even a rough parse is enough for a first score).

/** @typedef {{ scoreable: boolean; words: number; hasExperience: boolean; hasSkills: boolean; hint?: string }} CvReadiness */

const ROLE_HEADING = /^(#{1,3})\s*(?:work\s+experience|professional\s+experience|experience|work|employment|empleo|experiencia)\s*:?\s*#*\s*$/i;
// A markdown rule such as "---" or "* * *" draws a line, not a role.
const MD_RULE = /^([-*_])(?:\s*\1){2,}$/;
// The end may carry a month, as in "Jan 2020 – Dec 2023" or "01/2020 - 12/2023".
const MONTH_NAME = String.raw`septiembre|september|noviembre|november|diciembre|december|february|febrero|january|octubre|october|august|agosto|julio|junio|marzo|march|abril|april|enero|mayo|june|july|sept|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|ene|abr|ago|dic`;
const END_MONTH = String.raw`(?:(?:${MONTH_NAME})(?![a-z])\.?\s*|(?:0?[1-9]|1[0-2])/)?`;
const YEAR_RANGE = new RegExp(String.raw`\b((?:19|20)\d\d)\s*[-–—]\s*${END_MONTH}((?:19|20)\d\d|present|current|now|actualidad)\b`, "i");
// A section that can sit under Experience by mistake, as in
// "## Experience\n### Skills". Its heading is not a role.
const SECTION_HEADING = /^#+\s*(?:skills|technical\s+skills|technologies|tools|competenc\w*|education|certifications?|languages|projects|summary|profile|interests|awards|references|habilidades|educaci[oó]n|idiomas|certificaciones|proyectos)\s*:?\s*#*\s*$/i;

/** @param {string} text */
function experienceHeading(text) {
  return text.split("\n").some((line) => ROLE_HEADING.test(line));
}

// A year range, a line under the heading, or a deeper heading such as
// "### Floor lead" counts. "Work Authorization" is not that heading, and a
// sibling section such as "## Skills" is not a role under it.
/** @param {string} text */
function experienceHasRole(text) {
  if (YEAR_RANGE.test(text)) return true;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(ROLE_HEADING);
    if (!heading) continue;
    const level = heading[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j].trim();
      if (!line || MD_RULE.test(line)) continue;
      const sub = /^(#+)\s+\S/.exec(line);
      if (sub) {
        if (sub[1].length <= level || SECTION_HEADING.test(line)) break;
        return true;
      }
      return true;
    }
  }
  return false;
}

// An HTML comment never renders, so a template note under the heading is not a
// role. Openers are matched against the kept text, so "<!-<!-- x -->- y -->"
// leaves no comment, in one pass. An unclosed opener stays as text.
/** @param {string} md */
function withoutHtmlComments(md) {
  /** @type {string[]} */
  const kept = [];
  let i = 0;
  while (i < md.length) {
    kept.push(md[i++]);
    const n = kept.length;
    if (n < 4 || kept[n - 4] !== "<" || kept[n - 3] !== "!" || kept[n - 2] !== "-" || kept[n - 1] !== "-") continue;
    const close = md.indexOf("-->", i);
    if (close === -1) break;
    kept.length -= 4;
    i = close + 3;
  }
  return kept.join("") + md.slice(i);
}

/**
 * @param {string} md
 * @returns {CvReadiness}
 */
export function cvReadiness(md) {
  const text = withoutHtmlComments(md || "").trim();
  const words = text ? text.split(/\s+/).length : 0;
  const hasExperience = experienceHeading(text) || YEAR_RANGE.test(text);
  const hasSkills = /(^|\n)#{1,3}\s*(skills|technologies|competenc|habilidad)/i.test(text);
  const hasRole = experienceHasRole(text);
  const scoreable = hasRole || (words >= 80 && (hasSkills || words >= 200));
  /** @type {string | undefined} */
  let hint;
  if (!scoreable) hint = words < 40 ? "That's very short — add your experience for real matches (you can save anyway)." : "Looks thin — add a role or two for better matches (you can save anyway).";
  return { scoreable, words, hasExperience, hasSkills, hint };
}
