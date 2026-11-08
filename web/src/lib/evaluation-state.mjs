import { FULL_EVALUATION, parseEvaluationOptions } from './evaluation-options.mjs';

/** Persisted request metadata wins over model-written scope claims. */
export function evaluationState(markdown) {
  if (!markdown) return { kind: 'none', sections: [] };
  const marker = markdown.match(/^<!-- career-ops:evaluation (.+) -->$/m);
  if (marker) {
    try {
      const parsed = parseEvaluationOptions(JSON.parse(marker[1]).sections);
      if (parsed.ok) return { kind: parsed.full ? 'full' : 'partial', sections: parsed.sections };
    } catch { /* Older reports use their scope header. */ }
  }
  const header = markdown.split(/^##\s/m)[0];
  if (/\*\*Evaluation scope:\*\*\s*(?:Focused|Partial)\b/i.test(header)) {
    const sections = FULL_EVALUATION.filter(id => new RegExp(`\\b${id}\\b`).test(header.match(/\*\*Evaluation scope:\*\*([^\n]*)/i)?.[1] || ''));
    return { kind: 'partial', sections };
  }
  return { kind: 'full', sections: [...FULL_EVALUATION] };
}

export function stampEvaluationScope(markdown, sections) {
  const parsed = parseEvaluationOptions(sections);
  if (!parsed.ok) throw new Error(parsed.error);
  const cut = markdown.search(/^##\s/m);
  const header = (cut < 0 ? markdown : markdown.slice(0, cut))
    .replace(/^<!-- career-ops:evaluation .* -->\r?\n?/gm, '')
    .replace(/^\*\*Evaluation scope:\*\*[^\n]*\r?\n?/gmi, '');
  const body = cut < 0 ? '' : markdown.slice(cut);
  const scope = parsed.full ? 'Full' : `Focused — ${parsed.sections.join(', ') || 'fit score only'}.`;
  const metadata = `<!-- career-ops:evaluation ${JSON.stringify({ version: 1, sections: parsed.sections })} -->`;
  return header.replace(/^(# .+)$/m, `$1\n\n${metadata}\n**Evaluation scope:** ${scope}`) + body;
}
