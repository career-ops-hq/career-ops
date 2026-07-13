# Mode: naukri -- पूर्ण मूल्यांकन A-F

जब candidate कोई offer paste करे (text या URL), हमेशा सभी 6 blocks deliver करें।

## Step 0 -- Archetype Detection

Offer को 6 archetypes में से एक में classify करें (देखें `_shared.md`)। यदि hybrid हो, तो 2 सबसे करीबी indicate करें। यह निर्धारित करता है:
- Block B में कौन से proof points prioritize करें
- Block E में summary कैसे rewrite करें
- Block F में कौन सी STAR stories तैयार करें

## Block A -- Role Summary (भूमिका का सारांश)

इस जानकारी के साथ table:
- Detected archetype
- Domain (Platform / Agentic / LLMOps / ML / Enterprise)
- Function (Build / Consulting / Management / Deploy)
- Seniority
- Remote (Full remote / Hybrid / On-site)
- Team size (यदि mention हो)
- TL;DR एक sentence में

## Block B -- CV के साथ Match

`cv.md` पढ़ें। एक table बनाएं जहाँ offer की हर requirement CV की exact lines पर map हो।

**Archetype के अनुसार adapt करें:**
- FDE → rapid delivery और client proximity proof points prioritize करें
- SA → system design और integrations prioritize करें
- PM → product discovery और metrics prioritize करें
- LLMOps → evals, observability, pipelines prioritize करें
- Agentic → multi-agent, HITL, orchestration prioritize करें
- Transformation → change management, adoption, scaling prioritize करें

**Gaps** section: हर gap के लिए mitigation strategy। हर gap के लिए:
1. क्या यह hard blocker है या nice-to-have?
2. क्या candidate adjacent experience demonstrate कर सकता है?
3. क्या कोई portfolio project इस gap को cover करता है?
4. Concrete mitigation plan (cover letter के लिए phrase, quick mini-project, आदि)

## Block C -- Level और Strategy

1. **Offer में detected level** बनाम **इस archetype के लिए candidate का natural level**
2. **"Senior बेचो बिना झूठ बोले" plan**: archetype के अनुसार specific formulations, highlight करने के लिए concrete achievements, founder experience को asset के रूप में position कैसे करें
3. **"यदि मैं downleveled हूँ" plan**: यदि compensation सही हो तो accept करें, 6-month review negotiate करें, clear promotion criteria माँगें

## Block D -- Compensation और Demand (मुआवज़ा और माँग)

WebSearch उपयोग करें:
- Role की current salaries (Glassdoor, AmbitionBox, Naukri, Levels.fyi, LinkedIn Salary)
- Company की compensation reputation (Glassdoor, Glassdoor India)
- Indian market में role की demand trend

Table बनाएं data और cited sources के साथ। यदि data नहीं मिला, clearly बताएं — कुछ invent न करें।

**India market -- अनिवार्य checks:**
- CTC और In-hand (net) salary दोनों mention हैं? In-hand calculate करने में मदद करें।
- Variable pay / Performance bonus mentioned? Guaranteed है या target-linked?
- ESOPs / RSUs / Joining bonus mention है? Vesting schedule और liquidity confirm करें।
- PF: Employer contribution CTC में शामिल? Basic salary का कितना % है?
- Gratuity: CTC में शामिल? 5-year vesting mentioned?
- Bond / Service agreement clause है? Exit penalty amount और duration?
- Notice period: 30/60/90 days? Buyout option है?
- HRA mentioned? Metro vs. non-metro applicable?
- Health insurance coverage: Individual या family? Pre-existing conditions?
- Flexible / WFH policy: Full remote, hybrid (कितने days?), या full on-site?

## Block E -- Personalization Plan (व्यक्तिगतकरण योजना)

| # | Section | Current State | Proposed Change | Justification |
|---|---------|---------------|-----------------|---------------|
| 1 | Summary | ... | ... | ... |
| ... | ... | ... | ... | ... |

CV में Top 5 changes + LinkedIn में Top 5 changes match maximize करने के लिए।

## Block F -- Interview Plan (साक्षात्कार योजना)

Offer की requirements पर mapped 6-10 STAR+R stories (STAR + **Reflection**):

| # | Offer Requirement | STAR+R Story | S | T | A | R | Reflection |
|---|-------------------|--------------|---|---|---|---|------------|

**Reflection** column वह capture करता है जो सीखा गया या अलग किया जाता। यह seniority signal करता है — juniors describe करते हैं क्या हुआ, seniors उससे lessons लेते हैं।

**Story Bank:** यदि `interview-prep/story-bank.md` मौजूद है, check करें कि ये stories पहले से वहाँ हैं या नहीं। यदि नहीं, तो नई stories add करें। समय के साथ, यह 5-10 master stories का reusable bank बन जाता है।

**Archetype के अनुसार selected और framed:**
- FDE → delivery speed और client proximity highlight करें
- SA → architecture decisions highlight करें
- PM → discovery और trade-offs highlight करें
- LLMOps → metrics, evals, production hardening highlight करें
- Agentic → orchestration, error handling, HITL highlight करें
- Transformation → adoption और organizational change highlight करें

इसके अलावा include करें:
- 1 recommended case study (कौन सा project present करें और कैसे)
- Red-flag questions और उनके जवाब (जैसे: "आपने notice period serve नहीं की?", "क्या आपके पास team थी?", "इतने कम समय में change क्यों?")

---

## Post-evaluation (मूल्यांकन के बाद)

**हमेशा** Blocks A-F के बाद execute करें:

### 1. Report .md Save करें

पूरा evaluation `reports/{###}-{company-slug}-{YYYY-MM-DD}.md` में save करें।

- `{###}` = अगला sequential number (3 digits, zero-padded)। इसे atomically allocate करने के लिए `node reserve-report-num.mjs` run करें (stdout `{###}` return करता है), report लिखें, फिर sentinel release करने के लिए `node reserve-report-num.mjs --release {###}` run करें।
- `{company-slug}` = company name lowercase, no spaces (dashes use करें)
- `{YYYY-MM-DD}` = आज की date

**Report format:**

```markdown
# मूल्यांकन: {Company} -- {Role}

**Date:** {YYYY-MM-DD}
**Archetype:** {detected}
**Score:** {X/5}
**URL:** {offer URL}
**PDF:** {path या pending}

---

## A) Role Summary
(Block A का पूरा content)

## B) CV के साथ Match
(Block B का पूरा content)

## C) Level और Strategy
(Block C का पूरा content)

## D) Compensation और Demand
(Block D का पूरा content)

## E) Personalization Plan
(Block E का पूरा content)

## F) Interview Plan
(Block F का पूरा content)

## G) Application के लिए Draft Responses
(केवल यदि score >= 4.5 -- application form के लिए draft responses)

---

## निकाले गए Keywords
(ATS optimization के लिए offer के 15-20 keywords की list)
```

### 2. Tracker में Record करें

**हमेशा** `data/applications.md` में record करें:
- अगला sequential number
- आज की date
- Company
- Role
- Score: match का average (1-5)
- Status: `Evaluated`
- PDF: नहीं (या हाँ यदि auto-pipeline ने PDF generate किया)
- Report: report file का relative link (जैसे: `[001](reports/001-company-2026-01-01.md)`)

**Tracker format:**

```markdown
| # | Date | Company | Role | Score | Status | PDF | Report |
```
