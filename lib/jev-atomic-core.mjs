/**
 * jev-atomic-core.mjs — the centralized question sets and decoders that let Jev
 * (System One) replace the generative-reasoning loops in an `oferta`
 * evaluation. This is the foundation file of the atomic-core plan: one home for
 * the Block A / D / G question schemas, so block content lives as data, not in
 * a prose mode file that the LLM must re-derive on every run.
 *
 * WHY THIS FILE EXISTS
 *   The substitution boundary is: Jev cannot emit strings (no requirement-list
 *   extraction, no verbatim quotes, no free prose) — see the Jev API vocabulary
 *   in the exchange that produced this file. Everything it CAN answer is one of
 *   three question types, and an `oferta` report is mostly bounded enums (work
 *   authorization tier, company type, legitimacy tier, risk level, archetype).
 *   Every one of those enums is a categorical `choice` question the current
 *   gatekeeper has never used — it only knows `score` and `noul`. The lowest-
 *   cost path to Envelope B (75% token reduction) is therefore: express each
 *   bounded enum as a `choice`, run them all in ONE parallel request, decode
 *   them deterministically, and let the LLM keep only the prose slots.
 *
 * WHAT THIS FILE OWNS
 *   - The canonical question sets for Block A (Role Summary, incl. Step 0
 *     archetype), Block D (Comp and Demand), Block G (Posting Legitimacy).
 *   - Pure validators enforcing the Jev payload contract (choice <= 255
 *     options with a criteria map, score with 2-10 ordered levels, noul for
 *     booleans) so a mis-shaped schema fails loudly at build time instead of
 *     being silently rejected by the API.
 *   - `decodeAnswer` / `decodeAnswers`, which surface the raw probability
 *     vector and the confidence score (not just the argmax) so a caller can
 *     run the confidence-gated escalation policy.
 *   - `buildRequest`, which strips non-API metadata (`machineField`) and can
 *     attach `providerOptions.gateway.models` escalation rules.
 *   - The Machine Summary field map, so a deterministic renderer can write the
 *     YAML without the LLM re-enumerating the same enums it already voted on.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 *   - No extraction. Requirement strings, the verbatim advertised figure, and
 *     verbatim JD quotes are out of Jev's reach and stay an explicit LLM/residual
 *     concern (Envelope B keeps a minimal structured-JSON extraction pass for
 *     exactly that).
 *   - No scoring. It classifies and decodes; the 1-5 Block A-G scoring stays in
 *     the mode instructions and the Machine Summary contract in
 *     batch/batch-prompt.md.
 *   - No network. Requests go through scripts/jev_gatekeeper.py's --questions
 *     decide mode; this module is a pure in-memory library.
 *
 * The question objects carry a `machineField` inheritance key that maps a
 * decision to its `## Machine Summary` key (batch/batch-prompt.md is the schema
 * source of truth for those keys). `toApiQuestions` strips it before the
 * payload goes over the wire — the API must never see metadata about the caller.
 */

export const CORE_VERSION = '1.0.0';

export const QUESTION_TYPES = Object.freeze({
  CHOICE: 'choice',
  SCORE: 'score',
  BOOLEAN: 'noul',
});

/** Jev contract: a score rubric is 2-10 ordered level labels. */
export const SCORE_MIN_LEVELS = 2;
export const SCORE_MAX_LEVELS = 10;

/** Jev contract: a choice question carries at most 255 options. */
export const MAX_CHOICE_OPTIONS = 255;

/** Escalation floor used when a caller does not state its own threshold. */
export const DEFAULT_CONFIDENCE_FLOOR = 0.6;

export const DEFAULT_BLOCKS = Object.freeze(['A', 'D', 'G']);

const BOOLEAN_ALIASES = new Set([QUESTION_TYPES.BOOLEAN, 'boolean']);

/**
 * Normalize a type spelling to the API name. Accepts `boolean` as an alias for
 * `noul`; returns null for anything else.
 */
export function normalizeType(type) {
  if (typeof type !== 'string') return null;
  const t = type.trim().toLowerCase();
  if (BOOLEAN_ALIASES.has(t)) return QUESTION_TYPES.BOOLEAN;
  if (t === QUESTION_TYPES.CHOICE || t === QUESTION_TYPES.SCORE) return t;
  return null;
}

function choice({ instructions, criteria, options, machineField }) {
  const map = criteria ?? options;
  if (map === undefined) throw new TypeError('choice question needs criteria (or options)');
  const q = { type: QUESTION_TYPES.CHOICE, instructions, criteria: { ...map } };
  if (machineField !== undefined) q.machineField = machineField;
  return q;
}

function score({ instructions, criteria, levels, machineField }) {
  const list = criteria ?? levels;
  if (list === undefined) throw new TypeError('score question needs criteria (or levels)');
  const q = { type: QUESTION_TYPES.SCORE, instructions, criteria: [...list] };
  if (machineField !== undefined) q.machineField = machineField;
  return q;
}

function booleanQuestion({ instructions, trueDescription, falseDescription, machineField }) {
  const q = { type: QUESTION_TYPES.BOOLEAN, instructions };
  if (trueDescription !== undefined || falseDescription !== undefined) {
    q.criteria = {
      ...(trueDescription !== undefined ? { true: trueDescription } : {}),
      ...(falseDescription !== undefined ? { false: falseDescription } : {}),
    };
  }
  if (machineField !== undefined) q.machineField = machineField;
  return q;
}

/**
 * Validate one question object against the Jev payload contract.
 *
 * @returns {{ok: boolean, name: string, type: string|null, errors: string[]}}
 */
export function validateQuestion(name, question) {
  const errors = [];
  if (typeof name !== 'string' || !name.trim()) errors.push('name must be a non-empty string');
  if (question === null || typeof question !== 'object' || Array.isArray(question)) {
    return { ok: false, name, type: null, errors: [...errors, 'question must be an object'] };
  }

  const type = normalizeType(question.type);
  if (!type) {
    errors.push(`unsupported question type ${JSON.stringify(question.type)}`);
  } else if (type === QUESTION_TYPES.CHOICE) {
    errors.push(...validateChoice(question));
  } else if (type === QUESTION_TYPES.SCORE) {
    errors.push(...validateScore(question));
  } else if (question.criteria !== undefined) {
    if (question.criteria === null || typeof question.criteria !== 'object' || Array.isArray(question.criteria)) {
      errors.push('noul criteria must be an object with optional true/false descriptions');
    }
  }

  if (typeof question.instructions !== 'string' || !question.instructions.trim()) {
    errors.push('instructions must be a non-empty string');
  }
  return { ok: errors.length === 0, name, type, errors };
}

function validateChoice(q) {
  const errors = [];
  const c = q.criteria;
  if (c === null || typeof c !== 'object' || Array.isArray(c)) {
    return ['choice criteria must be an object mapping option key to description'];
  }
  const keys = Object.keys(c);
  if (keys.length < 2) errors.push(`choice needs at least 2 options (got ${keys.length})`);
  if (keys.length > MAX_CHOICE_OPTIONS) errors.push(`choice has ${keys.length} options, over the ${MAX_CHOICE_OPTIONS} cap`);
  for (const k of keys) {
    if (typeof c[k] !== 'string' || !c[k].trim()) errors.push(`choice option ${JSON.stringify(k)} needs a non-empty description`);
  }
  return errors;
}

function validateScore(q) {
  const errors = [];
  const c = q.criteria;
  if (!Array.isArray(c)) return ['score criteria must be an array of ordered level labels'];
  if (c.length < SCORE_MIN_LEVELS) errors.push(`score needs at least ${SCORE_MIN_LEVELS} levels (got ${c.length})`);
  if (c.length > SCORE_MAX_LEVELS) errors.push(`score has ${c.length} levels, over the ${SCORE_MAX_LEVELS} cap`);
  c.forEach((label, i) => {
    if (typeof label !== 'string' || !label.trim()) errors.push(`score level at index ${i} needs a non-empty label`);
  });
  return errors;
}

/**
 * Validate a whole `{name: question}` set.
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateQuestionSet(questions) {
  if (questions === null || typeof questions !== 'object' || Array.isArray(questions)) {
    return { ok: false, errors: ['question set must be an object'] };
  }
  const errors = [];
  const names = Object.keys(questions);
  if (names.length === 0) errors.push('question set is empty');
  for (const name of names) {
    for (const e of validateQuestion(name, questions[name]).errors) errors.push(`${name}: ${e}`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Strip caller metadata (machineField and any other non-API keys) so the wire
 * payload carries only `type`, `instructions` and `criteria`.
 */
export function toApiQuestions(questions) {
  const out = {};
  for (const [name, q] of Object.entries(questions)) {
    const apiQ = { type: normalizeType(q.type), instructions: q.instructions };
    if (q.criteria !== undefined) apiQ.criteria = q.criteria;
    out[name] = apiQ;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Block A — Role Summary (oferta.md, incl. Step 0 archetype detection)
// ---------------------------------------------------------------------------

export const BLOCK_A_QUESTIONS = deepFreeze({
  archetype: choice({
    instructions:
      'Classify the posting into the single best-fit archetype. Choose other only when none fit or it is a genuine hybrid the list does not cover.',
    options: {
      ai_platform_llmops: 'AI Platform / LLMOps: observability, evals, pipelines, monitoring, reliability',
      agentic_automation: 'Agentic / Automation: agent, HITL, orchestration, workflow, multi-agent',
      technical_ai_pm: 'Technical AI PM: PRD, roadmap, discovery, stakeholder, product manager',
      ai_solutions_architect: 'AI Solutions Architect: architecture, enterprise, integration, design, systems',
      ai_forward_deployed: 'AI Forward Deployed: client-facing, deploy, prototype, fast delivery, field',
      ai_transformation: 'AI Transformation: change management, adoption, enablement, transformation',
      other: 'None of the above, or a hybrid the list does not cover',
    },
    machineField: 'archetype',
  }),
  domain: choice({
    instructions: 'Which application domain does the role live in? Choose closest.',
    options: {
      platform: 'Platform / infrastructure engineering',
      agentic: 'Agent / autonomous-workflow systems',
      llmops: 'LLM operations, evals, monitoring, pipelines',
      ml: 'Model building / applied machine learning',
      enterprise: 'Enterprise systems integration and data',
      other: 'Another domain not listed',
    },
  }),
  roleFunction: choice({
    instructions: 'What is the dominant day-to-day function?',
    options: {
      build: 'Build / hands-on implementation',
      consult: 'Consult / advise on solutions',
      manage: 'Manage / lead a team or program',
      deploy: 'Deploy / customer-facing rollout and cutover',
      mixed: 'A blend with no single dominant function',
    },
  }),
  seniority: choice({
    instructions: 'What seniority level does the posting target?',
    options: {
      intern: 'Intern / co-op / trainee',
      junior: 'Junior / early-career',
      mid: 'Mid-level / individual contributor',
      senior: 'Senior IC with ownership',
      staff: 'Staff / principal IC',
      lead: 'Lead / manager',
      director: 'Director / head of',
      executive: 'VP / C-level',
      unknown: 'Not discernible from the posting',
    },
  }),
  remote: choice({
    instructions: 'What does the posting say about work location?',
    options: {
      fully_remote: 'Fully remote',
      hybrid: 'Hybrid: some in-office attendance expected',
      onsite: 'On-site / in-office required',
      unknown: 'Not stated',
    },
  }),
  geo_mismatch: booleanQuestion({
    instructions:
      'Does the structured location field of the posting contradict a BINDING attendance requirement inside the JD body (hybrid, X days in office, onsite, or relocation)? Negations, optional events, and generic boilerplate are NOT contradictions. Silence in the body about location is absence of signal.',
    trueDescription: 'Contradiction found: structured field says remote but the body binds attendance in office',
    falseDescription: 'No contradiction found',
  }),
  work_authorization: choice({
    instructions:
      'From the JD text alone, classify what it says about visa sponsorship and work eligibility. Neutral when silent. Quote evidence verbatim in the report, never paraphrase.',
    options: {
      sponsors: 'JD explicitly offers visa sponsorship or relocation',
      not_needed: "Role and candidate's region make sponsorship irrelevant (authorized already), or no sponsorship constraint stated for an authorized region",
      unstated: 'Silence: nothing stated about sponsorship or eligibility',
      no_sponsorship: 'JD explicitly refuses to sponsor (no sponsorship, must already hold work authorization)',
    },
    machineField: 'work_auth',
  }),
  culture_screen: choice({
    instructions:
      'Apply the culture screen from the scoring system: does the posting provide positive evidence for the candidate culture requirements (remote policy, stability, org structure)?',
    options: {
      pass: 'Positive evidence found for most stated culture requirements',
      caution: 'Some evidence, none contradicted, or a deprioritized requirement',
      fail: 'Evidence directly contradicts a stated culture requirement',
      not_evaluated: 'No culture screen was run for this posting',
    },
  }),
});

// ---------------------------------------------------------------------------
// Block D — Comp and Demand (oferta.md)
// ---------------------------------------------------------------------------

export const BLOCK_D_QUESTIONS = deepFreeze({
  salary_stated: booleanQuestion({
    instructions:
      'Does the JD text itself state a salary figure or range (a number), as opposed to only benefits like equity?',
    trueDescription: 'The JD states a salary figure or range',
    falseDescription: 'The JD states no salary figure',
  }),
  company_type: choice({
    instructions:
      'Classify the employer into the closest company type, using the SIGNALS in each description. If the brand and the hiring entity differ, classify the actual hiring entity, not the brand. Uncertain: choose unknown.',
    options: {
      public_tech: 'Public big tech / mature tech — public company, structured levels, large org, repeatable hiring',
      growth_startup: 'Growth-stage / VC-backed startup — funded, competitive hiring, base + equity + bonus',
      early_startup: 'Early-stage / pre-revenue startup — small team, vague scope, equity-heavy promises',
      enterprise: 'Enterprise / traditional corporate — formal HR, stable base, slower bands',
      agency: 'Agency / outsourcing / consulting vendor — client allocation, project-based, billability',
      local_smb: 'Local SMB / service business — small company, broad role, informal HR',
      sales_commission: 'Sales / commission-heavy org — OTE, uncapped, target-based pay',
      recruiter: 'Recruiter / staffing listing — third-party posting for a client budget',
      gov_academic_nonprofit: 'Government / academic / nonprofit — published grades or bands',
      community_education: 'Open-source community / education community — foundation or association sponsor',
      unknown: 'Could not classify the hiring entity',
    },
  }),
  comp_reliability: choice({
    instructions:
      'How reliable is any advertised compensation? High only when the figure reads as a fixed base or is backed by structured public bands.',
    options: {
      high: 'Stated base salary or backed by structured public bands / consistent sources',
      medium: 'Plausible range, but components are not fully separated',
      low: 'Likely includes variable / attendance / commission / subsidy / up-to components',
      unknown: 'No usable salary data',
    },
  }),
  demand_trend: choice({
    instructions: 'What is the current demand trend for this role, from your knowledge of the market?',
    options: {
      rising: 'Demand is rising',
      stable: 'Demand is stable',
      declining: 'Demand is declining',
      unknown: 'Unknown',
    },
  }),
});

// ---------------------------------------------------------------------------
// Block G — Posting Legitimacy (oferta.md)
// ---------------------------------------------------------------------------

export const BLOCK_G_QUESTIONS = deepFreeze({
  legitimacy_tier: choice({
    instructions:
      'Is this posting likely a real, active opening? Three tiers. Never default to Suspicious on absence of evidence alone; absence of a date with no other concern is Proceed with Caution.',
    options: {
      high_confidence: 'High Confidence — most legitimacy signals are positive; real active opening',
      proceed_with_caution: 'Proceed with Caution — mixed signals worth noting',
      suspicious: 'Suspicious — multiple ghost-job indicators; investigate before investing time',
    },
    machineField: 'legitimacy_tier',
  }),
  risk_level: choice({
    instructions: 'Overall risk of joining this company, combining legitimacy, stability and red-flag signals observed.',
    options: {
      low: 'Low — no material red flags observed',
      medium: 'Medium — some concerns that should be verified',
      high: 'High — multiple red flags or instability signals',
    },
    machineField: 'risk_level',
  }),
  posting_age: choice({
    instructions: 'How old is the posting? Assess from any date, days-ago marker, or opening context in the material.',
    options: {
      under_30d: 'Under 30 days — fresh',
      mature_30_60d: '30-60 days — mixed freshness',
      stale_60d_plus: 'Over 60 days — concerning, unless niche/executive/government',
      unknown: 'No age signal available',
    },
  }),
  apply_button: choice({
    instructions: 'What is the state of the Apply path described in the material?',
    options: {
      active: 'An Apply action is live and functional',
      closed: 'Apply is closed or the role is withdrawn',
      missing: 'No Apply path at all; only lookup/generic redirect',
      unavailable: 'No page-snapshot data was available to this assessment',
    },
  }),
  description_quality: score({
    instructions:
      'Rate the JD description quality: specificity of technologies, org context, realistic requirements, clear scope, and its role-specific-to-boilerplate ratio.',
    levels: [
      '1 — Generic boilerplate, no specifics, contradictions, unrealistic requirements',
      '2 — Mostly generic, few specifics, some vague requirements',
      '3 — Average: some real detail, some boilerplate',
      '4 — Specific and realistic, clear scope, org context present',
      '5 — Highly specific, realistic requirements, concrete 6-12 month scope',
    ],
  }),
  repost_signal: booleanQuestion({
    instructions:
      'Is there a signal this exact role was re-posted repeatedly (same title, multiple postings) rather than a one-off opening?',
    trueDescription: 'Repeated posting pattern observed',
    falseDescription: 'No reposting pattern observed',
  }),
  layoff_signal: booleanQuestion({
    instructions:
      'Is there evidence of recent layoffs or a hiring freeze reported for the hiring department or the company as a whole?',
    trueDescription: 'Layoff or hiring-freeze signal observed',
    falseDescription: 'No layoff or freeze signal observed',
  }),
  employment_classification_risk: booleanQuestion({
    instructions:
      'Does the JD use explicit contractor/services-status wording AND have at least one corroborating omission (no benefits, no PTO, no defined end date, no statutory-deduction phrasing)? Contract position alone is NOT enough. This signal is separate from the legitimacy tier.',
    trueDescription: 'Contractor-status wording plus a corroborating omission found',
    falseDescription: 'No contractor-status signal found',
  }),
  ai_infrastructure_mismatch: booleanQuestion({
    instructions:
      'Does the JD promise AI enablement / transformation while sitting on infrastructure clearly unready for it (heavy aspirational language with no underpinning maturity evidence)?',
    trueDescription: 'AI-promise vs infrastructure mismatch observed',
    falseDescription: 'No mismatch observed',
  }),
});

export const BLOCKS = deepFreeze({
  A: BLOCK_A_QUESTIONS,
  D: BLOCK_D_QUESTIONS,
  G: BLOCK_G_QUESTIONS,
});

export const ALL_QUESTIONS = deepFreeze(questionsForBlocks());

/**
 * Merge the question sets for a list of block keys.
 * @param {string[]} [blocks] Defaults to ['A', 'D', 'G'].
 * @throws {RangeError} on an unknown block key.
 */
export function questionsForBlocks(blocks = DEFAULT_BLOCKS) {
  const out = {};
  for (const b of blocks) {
    const set = BLOCKS[b];
    if (!set) throw new RangeError(`unknown block ${JSON.stringify(b)} (known: ${Object.keys(BLOCKS).join(', ')})`);
    Object.assign(out, set);
  }
  return out;
}

/**
 * Build the wire payload for scripts/jev_gatekeeper.py decide mode.
 *
 * @param {object} opts
 * @param {string} opts.model  Jev model id (typesafe-ai/jev, typesafe/jev-1.13).
 * @param {string} opts.state  The state string sent alongside the questions.
 * @param {object} opts.questions  `{name: question}` set (metadata stripped).
 * @param {Array|object} [opts.escalation]  Escalation rules; each entry is
 *   `{model, question, confidenceBelow}` or the raw `{model, when}` shape.
 */
export function buildRequest({ model, state, questions, escalation } = {}) {
  if (typeof model !== 'string' || !model) throw new TypeError('model is required');
  if (typeof state !== 'string' || !state) throw new TypeError('state is required');
  if (questions === null || typeof questions !== 'object' || Array.isArray(questions)) {
    throw new TypeError('questions must be an object');
  }
  const payload = { model, state, questions: toApiQuestions(questions) };
  const models = normalizeEscalation(escalation);
  if (models.length) payload.providerOptions = { gateway: { models } };
  return payload;
}

/**
 * One escalation rule: rerun a single question on a stronger model when its
 * confidence is below a floor (`providerOptions.gateway.models` shape).
 */
export function escalationWhen(question, confidenceBelow, model) {
  if (typeof question !== 'string' || !question) throw new TypeError('question name is required');
  if (typeof model !== 'string' || !model) throw new TypeError('model is required');
  return { model, when: { question, confidenceBelow } };
}

/**
 * Questions whose reported confidence sits below a threshold.
 * @returns {string[]}
 */
export function lowConfidenceQuestions(decoded, { threshold = DEFAULT_CONFIDENCE_FLOOR } = {}) {
  if (decoded === null || typeof decoded !== 'object') return [];
  const out = [];
  for (const [name, d] of Object.entries(decoded)) {
    if (d && typeof d === 'object' && d.confidence !== null && d.confidence < threshold) out.push(name);
  }
  return out;
}

/**
 * Build one escalation rule per low-confidence question.
 * @param {object|null} [opts.model] Required: the stronger model to rerun on.
 */
export function confidenceEscalations(decoded, { threshold = DEFAULT_CONFIDENCE_FLOOR, model } = {}) {
  if (typeof model !== 'string' || !model) throw new TypeError('model is required for escalation building');
  return lowConfidenceQuestions(decoded, { threshold }).map((q) => escalationWhen(q, threshold, model));
}

function normalizeEscalation(esc) {
  if (esc === null || esc === undefined) return [];
  const arr = Array.isArray(esc) ? esc : [esc];
  return arr.map((e) => {
    if (e === null || typeof e !== 'object') throw new TypeError('escalation entry must be an object');
    const when = e.when ?? { question: e.question, confidenceBelow: e.confidenceBelow };
    if (typeof e.model !== 'string' || !e.model || !when || typeof when.question !== 'string' || !when.question) {
      throw new TypeError('escalation entry needs a model and a when.question');
    }
    return { model: e.model, when: { question: when.question, confidenceBelow: when.confidenceBelow ?? DEFAULT_CONFIDENCE_FLOOR } };
  });
}

function extractConfidence(answer) {
  if (answer === null || typeof answer !== 'object') return null;
  for (const k of ['confidence', 'confidence_score']) {
    const v = numberOrNull(answer[k]);
    if (v !== null) return v;
  }
  const meta = answer.providerMetadata;
  if (meta !== null && typeof meta === 'object') {
    if (meta.typesafe !== null && typeof meta.typesafe === 'object') {
      const v = numberOrNull(meta.typesafe.confidence);
      if (v !== null) return v;
    }
    const v = numberOrNull(meta.confidence);
    if (v !== null) return v;
  }
  return null;
}

function numberOrNull(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function normalizeProbabilities(value) {
  if (value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = numberOrNull(v) ?? v;
  }
  return out;
}

/**
 * Decode a single answer into `{name, type, value, probability, probabilities,
 * confidence, raw, error}`. `value` is the human-facing decode (noul -> boolean
 * at 0.5 threshold, choice -> option key, score -> numeric level). `probability`,
 * `probabilities` and `confidence` are surfaced verbatim for ranking/escalation.
 */
export function decodeAnswer(name, question, answer) {
  const q = question ?? {};
  const type = normalizeType(q.type);
  const decoded = {
    name,
    type,
    value: null,
    probability: null,
    probabilities: null,
    confidence: null,
    machineField: q.machineField ?? null,
    raw: answer ?? null,
    error: null,
  };
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) {
    decoded.error = 'answer was not an object';
    return decoded;
  }
  decoded.probabilities = normalizeProbabilities(answer.probabilities);
  decoded.confidence = extractConfidence(answer);

  if (type === QUESTION_TYPES.SCORE) {
    const s = numberOrNull(answer.score);
    if (s === null) {
      decoded.error = 'missing numeric score';
    } else {
      decoded.value = s;
    }
  } else if (type === QUESTION_TYPES.CHOICE) {
    if (typeof answer.choice !== 'string') {
      decoded.error = 'missing choice';
    } else {
      decoded.value = answer.choice;
    }
  } else if (type === QUESTION_TYPES.BOOLEAN) {
    let p = numberOrNull(answer.noul);
    if (p === null) p = numberOrNull(answer.probability);
    if (p === null) {
      decoded.error = 'missing noul/probability';
    } else {
      decoded.probability = p;
      decoded.value = p >= 0.5;
    }
  } else {
    decoded.error = `unknown answer type ${JSON.stringify(type)}`;
  }
  return decoded;
}

/**
 * Decode a full `{name: answer}` response against the question set.
 * @returns {Record<string, ReturnType<typeof decodeAnswer>>}
 */
export function decodeAnswers(questions, answers) {
  const out = {};
  for (const [name, question] of Object.entries(questions)) {
    if (Object.prototype.hasOwnProperty.call(answers, name)) {
      out[name] = decodeAnswer(name, question, answers[name]);
    } else {
      out[name] = {
        name,
        type: normalizeType(question.type),
        value: null,
        probability: null,
        probabilities: null,
        confidence: null,
        machineField: question.machineField ?? null,
        raw: null,
        error: 'missing answer',
      };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Machine Summary mapping — deterministic YAML without re-deriving enums
// ---------------------------------------------------------------------------

/**
 * question name -> Machine Summary key for the questions that carry a
 * `## Machine Summary` field (batch/batch-prompt.md is the schema source).
 */
export function machineSummaryFields(questions) {
  const out = {};
  for (const [name, q] of Object.entries(questions)) {
    if (q.machineField) out[name] = q.machineField;
  }
  return out;
}

/**
 * Build a `{Machine Summary key: decoded value}` map from decoded answers,
 * skipping unanswered or errored decisions.
 */
export function machineSummaryFrom(decoded) {
  const out = {};
  if (decoded === null || typeof decoded !== 'object') return out;
  for (const d of Object.values(decoded)) {
    if (d && d.machineField && d.value !== null && !d.error) out[d.machineField] = d.value;
  }
  return out;
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const k of Object.keys(value)) deepFreeze(value[k]);
    Object.freeze(value);
  }
  return value;
}