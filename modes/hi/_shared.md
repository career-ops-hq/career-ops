# साझा संदर्भ -- career-ops (हिन्दी)

<!-- ============================================================
     इस फ़ाइल को कस्टमाइज़ करें
     ============================================================
     इस फ़ाइल में career-ops के सभी हिन्दी मोड्स के लिए
     साझा संदर्भ है। career-ops उपयोग करने से पहले आपको:
     1. config/profile.yml में अपनी व्यक्तिगत जानकारी भरें
     2. प्रोजेक्ट की रूट में cv.md बनाएं (Markdown में CV)
     3. (वैकल्पिक) article-digest.md में अपने proof points बनाएं
     4. नीचे [कस्टमाइज़ करें] चिह्नित अनुभाग अनुकूलित करें
     ============================================================ -->

## सत्य के स्रोत (हर मूल्यांकन से पहले अवश्य पढ़ें)

| फ़ाइल | पथ | कब |
|-------|----|----|
| cv.md | `cv.md` (प्रोजेक्ट की रूट) | हमेशा |
| article-digest.md | `article-digest.md` (यदि मौजूद हो) | हमेशा (विस्तृत proof points के लिए) |
| profile.yml | `config/profile.yml` | हमेशा (पहचान और लक्षित भूमिकाओं के लिए) |

**नियम: proof points की metrics को कभी hardcode न करें।** इन्हें मूल्यांकन के समय `cv.md` और `article-digest.md` से पढ़ें।
**नियम: article/project metrics के लिए, `article-digest.md` को `cv.md` से प्राथमिकता दें** (`cv.md` में पुराने आंकड़े हो सकते हैं)।

---

## North Star -- लक्षित भूमिकाएं

यह skill सभी लक्षित भूमिकाओं को समान महत्व के साथ संभालता है। कोई भी प्राथमिक या द्वितीयक नहीं है — यदि compensation और विकास की संभावनाएं सही हों, तो हर भूमिका सफलता है:

| Archetype | थीमेटिक क्षेत्र | कंपनी क्या खरीदती है |
|-----------|----------------|----------------------|
| **AI Platform / LLMOps Engineer** | Evaluation, Observability, Reliability, Pipelines | कोई ऐसा व्यक्ति जो AI को metrics के साथ production में लाए |
| **Agentic Workflows / Automation** | HITL, Tooling, Orchestration, Multi-Agent | कोई ऐसा व्यक्ति जो reliable agentic systems बनाए |
| **Technical AI Product Manager** | GenAI/Agents, PRDs, Discovery, Delivery | कोई ऐसा व्यक्ति जो business को AI products में translate करे |
| **AI Solutions Architect** | Hyperautomation, Enterprise, Integrations | कोई ऐसा व्यक्ति जो end-to-end AI architectures डिज़ाइन करे |
| **AI Forward Deployed Engineer** | Client-facing, Rapid delivery, Prototyping | कोई ऐसा व्यक्ति जो client के यहाँ AI solutions तेज़ी से deploy करे |
| **AI Transformation Lead** | Change management, Adoption, Enablement | कोई ऐसा व्यक्ति जो संगठनों में AI transformation चलाए |

<!-- [कस्टमाइज़ करें] ऊपर के archetypes को अपनी लक्षित भूमिकाओं के अनुसार अनुकूलित करें।
     Backend engineering के लिए उदाहरण:
     - Senior Backend Engineer
     - Staff Platform Engineer
     - Engineering Manager
     आदि। -->

### Archetype के अनुसार अनुकूली framing

> **ठोस metrics: इन्हें मूल्यांकन के समय `cv.md` और `article-digest.md` से पढ़ें। यहाँ कभी hardcode न करें।**

| यदि भूमिका है... | उम्मीदवार में highlight करें... | Proof points के स्रोत |
|-----------------|--------------------------------|----------------------|
| Platform / LLMOps | Production experience, observability, evals, closed-loop | article-digest.md + cv.md |
| Agentic / Automation | Multi-agent orchestration, HITL, reliability, costs | article-digest.md + cv.md |
| Technical AI PM | Product discovery, PRDs, metrics, stakeholder management | cv.md + article-digest.md |
| Solutions Architect | System design, integrations, enterprise-ready | article-digest.md + cv.md |
| Forward Deployed Engineer | Rapid delivery, client proximity, prototype to production | cv.md + article-digest.md |
| AI Transformation Lead | Change management, team enablement, adoption | cv.md + article-digest.md |

<!-- [कस्टमाइज़ करें] ऊपर के archetypes को अपने concrete projects/articles से map करें -->

### Transition narrative (सभी framings में उपयोग करें)

<!-- [कस्टमाइज़ करें] अपना narrative यहाँ डालें। उदाहरण:
     - "5 साल बाद SaaS बनाई और बेची। अब 100% focus applied AI पर।"
     - "Series-B में 10x growth के दौरान engineering lead। अगली challenge की तलाश।"
     config/profile.yml -> narrative.exit_story से पढ़ें -->

सभी content को frame करने के लिए `config/profile.yml` से transition narrative उपयोग करें:
- **PDF summaries में:** पास्ट और future के बीच bridge बनाएं — "अब उन्हीं [skills] को [offer के domain] में apply कर रहे हैं।"
- **STAR stories में:** `article-digest.md` के proof points का संदर्भ लें।
- **Draft responses (Block G) में:** पहले response में transition narrative डालें।
- **जब offer "entrepreneurial", "autonomy", "builder", "end-to-end" mention करे:** यह differentiator #1 है। Match weight बढ़ाएं।

### Cross-cutting advantage

Profile को **"Demonstrable practice वाले Technical Builder"** के रूप में frame करें, भूमिका के अनुसार framing adapt करें:
- PM के लिए: "Builder जो prototypes से uncertainty reduce करता है, फिर disciplined तरीके से production में deliver करता है"
- FDE के लिए: "Builder जो Day 1 से observability और metrics के साथ deliver करता है"
- SA के लिए: "Builder जो real integration experience के साथ end-to-end systems design करता है"
- LLMOps के लिए: "Builder जो closed-loop quality systems के साथ AI को production में लाता है"

"Builder" को professional signal के रूप में position करें — "tinkerer" के रूप में नहीं। Real proof points इसे credible बनाते हैं।

### Portfolio as proof point (high-stakes applications में उपयोग करें)

<!-- [कस्टमाइज़ करें] यदि आपके पास live demo, dashboard, या public project है, तो यहाँ configure करें।
     उदाहरण:
     dashboard:
       url: "https://yourwebsite.dev/demo"
       password: "demo-2026"
       when_to_share: "LLMOps, AI Platform, Observability roles"
     config/profile.yml -> narrative.proof_points और narrative.dashboard से पढ़ें -->

यदि candidate के पास live demo / dashboard है (profile.yml जाँचें), तो relevant applications में access offer करें।

### Compensation Intelligence (वेतन बुद्धिमत्ता)

<!-- [कस्टमाइज़ करें] अपनी लक्षित भूमिकाओं के लिए salary ranges research करें और values adapt करें -->

**सामान्य सुझाव:**
- WebSearch से current market data लें (Glassdoor, Levels.fyi, Naukri, AmbitionBox, LinkedIn Salary)
- Title के आधार पर frame करें, skills के नहीं — titles salary bands define करते हैं
- India में Remote roles: geographic arbitrage काम करता है — कम cost of living = बेहतर net
- CTC (Cost to Company) और In-hand (Net) salary में हमेशा फ़र्क करें — India में CTC में PF, Gratuity, Medical, और अन्य benefits शामिल होते हैं

---

### भारतीय बाज़ार -- विशेष बातें (महत्वपूर्ण)

भारतीय job offers और negotiations में कुछ terms ऐसे होते हैं जो EN/ES markets में नहीं मिलते। इन्हें सही तरीके से समझना आवश्यक है:

| Term | अर्थ | मूल्यांकन पर प्रभाव |
|------|------|---------------------|
| **CTC** (Cost to Company) | नियोक्ता द्वारा उठाई जाने वाली कुल लागत। In-hand से 20-40% ज़्यादा हो सकता है | हमेशा CTC और In-hand दोनों माँगें। सिर्फ CTC से तुलना न करें |
| **In-hand / Net Salary** | वास्तविक take-home वेतन (taxes और deductions के बाद) | यही असली संख्या है। PF, professional tax, income tax काटने के बाद |
| **PF / EPF** (Provident Fund) | Employee 12% + Employer 12% basic salary का। EPFO में जाता है | Employer contribution CTC में शामिल, लेकिन locked। 5 साल में Gratuity eligible |
| **Gratuity** | Payment of Gratuity Act, 1972। 5+ साल बाद exit पर देय | Long-term commitment का bonus। CTC में शामिल लेकिन 5 साल बाद ही मिलता है |
| **Notice Period** | आमतौर पर 30/60/90 दिन। IT services में 90 दिन आम | Buyout option confirm करें (आमतौर पर 1-3 महीने का वेतन) |
| **Probation** | आमतौर पर 3-6 महीने। इस दौरान employment terms differ हो सकती हैं | Flag करें यदि 6 महीने से ज़्यादा। Confirmation date = increment date? |
| **Variable Pay / Performance Bonus** | Fixed CTC का 10-30%। KPI-linked, guaranteed नहीं | "CTC ₹X lakhs में ₹Y fixed और ₹Z variable है" — variable हमेशा verify करें |
| **ESOPs / RSUs** | Employee Stock Options। Startups में 4-year vesting (1-year cliff) आम | Liquidity पर सवाल करें — unlisted startup ESOPs = illiquid। Listed company RSUs ≠ ESOPs |
| **HRA** (House Rent Allowance) | Basic का 40% (non-metro) / 50% (metro)। Tax-exempt यदि rent paid | Salary structuring में important। Metro vs. non-metro distinction matters |
| **LTA** (Leave Travel Allowance) | Travel के लिए tax-exempt component। साल में 2 बार claim करने योग्य | Small but useful। Block of 4 years में 2 claims |
| **Bond / Service Agreement** | IT services में common। Exit पर training cost वापस लेते हैं (₹1-3 लाख आमतौर पर) | **Red flag** यदि senior role में। Bond amount, duration, exit penalty clearly पूछें |
| **Relieving Letter / Experience Letter** | Exit पर formal documents। Background verification के लिए आवश्यक | Verbally confirm करें कि offer acceptance के बाद दिए जाएंगे |
| **Moonlighting Policy** | कुछ companies dual employment prohibit करती हैं (खासकर Infosys, Wipro जैसी) | यदि freelancing करते हैं, तो policy check ज़रूरी |
| **Labour Codes 2020** | 4 new codes जो wage definition, working hours, और benefits restructure कर रहे हैं | Implementations अभी state-wise। CTC structuring affect कर सकते हैं |

### Negotiation Scripts

<!-- [कस्टमाइज़ करें] अपनी स्थिति के अनुसार adapt करें -->

**Expected CTC (सामान्य framework):**
> "मौजूदा market data के आधार पर, मैं ₹[RANGE from profile.yml] की range target कर रहा/रही हूँ। Structure पर flexible हूँ — overall package और growth opportunity ज़्यादा important है।"

**Geographic discount के जवाब में:**
> "जिन roles पर मैं compete कर रहा/रही हूँ वे results-driven हैं, location-driven नहीं। मेरा track record postal code के साथ नहीं बदलता।"

**यदि offer target से कम हो:**
> "मैं currently ₹[higher range] के packages पर discussions में हूँ। [Company] मुझे [reason] के लिए attract करती है। क्या ₹[target] तक पहुँचा जा सकता है?"

**CTC breakdown के लिए:**
> "Packages की fair comparison के लिए, क्या आप Fixed CTC, Variable component, ESOPs (यदि कोई हो), और joining bonus अलग-अलग share कर सकते हैं?"

**Notice period buyout के लिए:**
> "मेरा notice period [X] दिन है। क्या आपके यहाँ buyout का provision है? इससे joining date पर clarity आएगी।"

### Location Policy

<!-- [कस्टमाइज़ करें] अपनी स्थिति के अनुसार adapt करें। config/profile.yml -> location से पढ़ें -->

**Forms में:**
- Binary "क्या आप on-site हो सकते हैं?" questions: profile.yml में वास्तविक availability के अनुसार जवाब दें
- Free-text fields: timezone overlap और availability explicitly बताएं

**Evaluations में (scoring):**
<!-- India-market deviation: "city" instead of "country" — domestic single-country market, city proximity is the relevant threshold -->
- Hybrid के लिए जो आपके city में नहीं है: Score **3.0** (1.0 नहीं)
- Score 1.0 केवल तभी यदि offer explicitly कहे "4-5 दिन mandatory on-site, कोई exception नहीं"

### Time-to-offer priority
- Working demo + metrics > perfection
- जल्दी apply करें > और ज़्यादा सीखें
- 80/20 approach, सब कुछ timeboxed

---

## Global Rules

### कभी नहीं

1. Experience या metrics fabricate करना
2. `cv.md` या portfolio files modify करना
3. Candidate की तरफ से applications submit करना
4. Generated messages में phone number share करना
5. Market से नीचे compensation recommend करना
6. Offer पढ़े बिना PDF generate करना
7. Corporate jargon या hollow phrases उपयोग करना
8. Tracker ignore करना (हर evaluated offer record होता है)

### हमेशा

0. **Cover letter:** यदि form allow करे, हमेशा include करें। Same design वाला PDF। Offer की lines, proof points पर mapped। Max 1 page।
1. Offer evaluate करने से पहले `cv.md` और `article-digest.md` (यदि मौजूद हो) पढ़ें
1b. **हर session का पहला evaluation:** `node cv-sync-check.mjs` via Bash run करें। Alerts पर candidate को सूचित करें
2. Role का archetype detect करें और framing adapt करें
3. Matching करते समय CV की exact lines quote करें
4. Compensation और company data के लिए WebSearch उपयोग करें
5. हर evaluation के बाद tracker में record करें
6. Content offer की language में generate करें (Hindi offer के लिए Hindi, English के लिए English)
7. Direct और concrete रहें — बकवास नहीं
8. Natural Hindi tech language use करें। Short sentences, action verbs, passive avoid करें। Technical terms force-translate न करें (stack, pipeline, deployment, embedding)
8b. **PDF में case study URLs:** यदि PDF में case studies या demos mention हों, URLs Professional Summary के पहले paragraph में होने चाहिए। Recruiters अक्सर सिर्फ summary पढ़ते हैं। सभी URLs HTML में `white-space: nowrap` के साथ
9. **Tracker entries TSV में** — applications.md सीधे edit कभी नहीं करें (नई entries के लिए)। TSV `batch/tracker-additions/` में लिखें, `merge-tracker.mjs` merge करेगा
10. **हर report header में `**URL:**`** — Score और PDF के बीच

### Tools

| Tool | उपयोग |
|------|-------|
| WebSearch | Compensation research, trends, company culture, LinkedIn contacts, offer fallback |
| WebFetch | Static pages से offers extract करने के लिए fallback |
| Playwright | Verify if offers are active (browser_navigate + browser_snapshot), SPAs से offers extract करें। **Critical: कभी 2+ agents Playwright के साथ parallel में नहीं — वे same browser instance share करते हैं** |
| Read | cv.md, article-digest.md, cv-template.html |
| Write | PDF के लिए temporary HTML, applications.md, reports .md |
| Edit | Tracker update करें |
| Bash | `node generate-pdf.mjs` |
