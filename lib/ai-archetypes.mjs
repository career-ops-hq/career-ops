/**
 * lib/ai-archetypes.mjs — which kind of AI work a posting is (job-engine
 * tracks: ai_gigs).
 *
 * The AI track covers more than "AI Engineer": agent builders, evaluation
 * work, automation consulting. Each archetype has title patterns and body
 * keywords; a posting can match several. Crowd-tier data labelling is
 * recognised too, so it can be told apart from expert evaluation work rather
 * than scored as an engineering role.
 */

export const AI_ARCHETYPES = [
  {
    id: 'llm_engineer', label: 'LLM / GenAI engineer',
    title: /\b(llm|gen ?ai|generative ai|large language model|rag|prompt)\b[^,|]{0,30}\b(engineer|developer|entwickler\w*|architect|specialist|integration)|\bai (?:software |product |application |backend |full[- ]?stack )?(engineer|developer)\b|\bki[- ]?(entwickler\w*|ingenieur\w*|engineer|softwareentwickler\w*)|\b(engineer|developer|entwickler\w*)\b[^,|]{0,20}\b(llm|gen ?ai|generative ai)\b/i,
    body: ['llm', 'rag', 'retrieval-augmented', 'langchain', 'llamaindex', 'openai', 'anthropic', 'claude', 'gpt-', 'prompt engineering', 'fine-tun', 'vector database', 'embedding', 'generative ai', 'genai'],
  },
  {
    id: 'agent_engineer', label: 'Agent / agentic systems engineer',
    title: /\bagent(?:ic|s)?\b[^,|]{0,30}\b(engineer|developer|entwickler\w*|architect|builder)|\b(agentic|multi[- ]agent|ai agents?)\b/i,
    body: ['ai agent', 'agentic', 'tool calling', 'function calling', 'model context protocol', 'mcp server', 'langgraph', 'crewai', 'autogen', 'multi-agent', 'orchestration', 'human-in-the-loop'],
  },
  {
    id: 'applied_ai', label: 'Applied AI / forward-deployed',
    title: /\bapplied (ai|ml|scientist)\b|\bforward[- ]deployed\b|\bFDE\b|\bai (solutions?|implementation|deployment|integration|adoption)\b[^,|]{0,20}\b(engineer|architect|consultant|lead|specialist)|\b(solutions?|customer) engineer\b[^,|]{0,20}\bai\b/i,
    body: ['forward deployed', 'customer-facing', 'prototype', 'proof of concept', 'poc', 'solution design', 'pre-sales', 'implementation', 'applied ai'],
  },
  {
    id: 'ml_engineer', label: 'ML engineer / data scientist',
    title: /\b(machine learning|ml|deep learning|nlp|computer vision)\b[^,|]{0,20}\b(engineer|scientist|developer|researcher|entwickler\w*)|\bdata scientist\b|\bmle\b/i,
    body: ['pytorch', 'tensorflow', 'scikit', 'model training', 'training pipeline', 'feature store', 'hugging face', 'transformers', 'xgboost', 'computer vision', 'nlp'],
  },
  {
    id: 'llmops', label: 'LLMOps / ML platform',
    title: /\b(llmops|mlops|ml platform|ai platform|ai infrastructure|ml infrastructure|inference)\b/i,
    body: ['mlflow', 'kubeflow', 'model serving', 'inference', 'gpu', 'observability', 'langfuse', 'langsmith', 'vllm', 'triton', 'ray serve', 'model registry'],
  },
  {
    id: 'evals', label: 'AI evaluation / quality / safety',
    title: /\b(evals?|evaluation|red[- ]team\w*|ai quality|model quality|ai safety|trust (?:and|&) safety|benchmark\w*)\b[^,|]{0,30}\b(engineer|lead|specialist|expert|scientist|researcher|designer)|\b(llm|ai|model) (evaluator|evaluation|quality|qa)\b/i,
    body: ['evals', 'evaluation harness', 'benchmark', 'llm-as-a-judge', 'llm as judge', 'red teaming', 'red-teaming', 'guardrails', 'rubric', 'golden set', 'regression suite', 'hallucination'],
  },
  {
    id: 'ai_automation', label: 'AI automation / workflow builder',
    title: /\b(ai|ki|llm|intelligent)[- ]?(automation|automatisierung\w*|workflow\w*)\b|\bautomation (engineer|developer|specialist|consultant|expert)\b|\b(n8n|zapier|make\.com|power automate|rpa)\b|\bprozessautomatisierung\w*/i,
    body: ['n8n', 'zapier', 'make.com', 'workflow automation', 'rpa', 'uipath', 'power automate', 'airtable', 'process automation', 'prozessautomatisierung', 'hyperautomation'],
  },
  {
    id: 'ai_consulting', label: 'AI consulting / enablement',
    title: /\b(ai|ki|gen ?ai|generative ai|llm)[- ]?(consultant|consulting|berater\w*|beratung|strateg\w*|advisor|transformation|enablement|lead|manager|architect\w*)\b|\bfractional\b[^,|]{0,20}\b(ai|cto)\b|\binterim\b[^,|]{0,20}\b(ai|ki|cto)\b/i,
    body: ['workshop', 'stakeholder', 'discovery', 'roadmap', 'use case', 'use-case', 'change management', 'enablement', 'ai strategy', 'ki-strategie', 'mittelstand', 'ai literacy'],
  },
  {
    id: 'ai_product', label: 'AI product management',
    title: /\b(ai|ml|llm|gen ?ai)\b[^,|]{0,20}\bproduct (manager|owner|lead)\b|\bproduct (manager|owner|lead)\b[^|]{0,25}\b(ai|ml|llm|gen ?ai)\b/i,
    body: ['product discovery', 'prd', 'roadmap', 'user research', 'go-to-market', 'ai features', 'product strategy'],
  },
];

// Paid-per-task model training work: real income for some, but a different
// product from an engineering or consulting engagement.
const CROWD_TITLE_RE = /\b(data (annotat\w+|label\w+|trainer|rater)|ai (trainer|tutor|rater|annotat\w+|data trainer)|(search|ads) (quality )?rater|prompt writer|rlhf|model trainer|annotat(?:or|ion) specialist|crowd ?worker|ki[- ]?trainer)\b/i;
const EXPERT_EVAL_RE = /\b(expert|senior|domain|coding|subject[- ]matter|phd|specialist|red[- ]team\w*|rubric)\b/i;

const count = (body, words) => words.filter(w => body.includes(w)).length;

/**
 * @param {{ title?: string, description?: string }} posting
 * @returns {{ isAiRole: boolean, primary: string | null, archetypes: Array<{ id: string, label: string, score: number, titleMatch: boolean, keywords: string[] }>, crowdWork: 'no' | 'crowd' | 'expert' }}
 */
export function classifyAiRole(posting) {
  const title = typeof posting?.title === 'string' ? posting.title : '';
  const body = (typeof posting?.description === 'string' ? posting.description : '').slice(0, 40000).toLowerCase();
  const archetypes = [];
  for (const a of AI_ARCHETYPES) {
    const titleMatch = a.title.test(title);
    const keywords = a.body.filter(w => body.includes(w));
    const score = (titleMatch ? 3 : 0) + Math.min(keywords.length, 3);
    if (titleMatch || keywords.length >= 2) archetypes.push({ id: a.id, label: a.label, score, titleMatch, keywords });
  }
  archetypes.sort((x, y) => y.score - x.score);
  const crowdTitle = CROWD_TITLE_RE.test(title);
  // The title decides whether it is task work; the body may still show that the
  // tasks need expertise (rubric design, code review, red teaming).
  const crowdWork = crowdTitle ? (EXPERT_EVAL_RE.test(title + ' ' + body.slice(0, 3000)) ? 'expert' : 'crowd') : 'no';
  const generalAi = count(body, ['artificial intelligence', 'machine learning', 'künstliche intelligenz', ' ai ', ' ki ', 'llm']) >= 2;
  return {
    isAiRole: archetypes.some(a => a.titleMatch) || archetypes.length >= 2 || (archetypes.length === 1 && generalAi) || crowdTitle,
    primary: archetypes.length ? archetypes[0].id : null,
    archetypes,
    crowdWork,
  };
}
