# career-ops — हिन्दी मोड्स (`modes/hi/`)

यह folder career-ops modes के हिन्दी अनुवाद रखता है, उन candidates के लिए जो भारतीय job market में नौकरी ढूंढ रहे हैं या हिन्दी job listings के साथ काम कर रहे हैं।

## कब उपयोग करें?

निम्नलिखित में से कम से कम एक condition true होने पर `modes/hi/` use करें:

- आप मुख्यतः **हिन्दी या भारतीय job listings पर** apply कर रहे हैं (Naukri.com, Instahyre, Cutshort, Wellfound India, LinkedIn India)
- आपका **CV हिन्दी में है** या आप offer के अनुसार HI/EN switch करते हैं
- आपको **natural Hindi tech language** में responses और cover letters चाहिए — machine translation नहीं
- आपको **India-specific contractual terms** handle करने हैं: CTC vs. In-hand salary, PF/EPF, Gratuity, Notice period/buyout, Bond clause, ESOPs, HRA/LTA

यदि आपकी ज़्यादातर listings English में हैं, तो standard `modes/` folder use करते रहें।

## कैसे Enable करें?

### Option 1 — Session के लिए

Session की शुरुआत में Claude को explicitly बताएं:

> "अब से `modes/hi/` के हिन्दी मोड्स use करो।"

या

> "Evaluation और applications हिन्दी में करो — `modes/hi/_shared.md` और `modes/hi/naukri.md` use करो।"

Claude फिर `modes/` की जगह इस folder की files पढ़ेगा।

### Option 2 — Permanently, Profile से

`config/profile.yml` में language preference add करें:

```yaml
language:
  primary: hi
  modes_dir: modes/hi
```

पहले session में Claude को यह setting याद दिलाएं ("profile.yml में देखो, मैंने `language.modes_dir` set किया है")। इसके बाद Claude automatically हिन्दी मोड्स use करेगा।

## कौन से Modes Translated हैं?

| File | Translated From | Purpose |
|------|-----------------|---------|
| `_shared.md` | `modes/_shared.md` (EN) | Shared context, archetypes, global rules, India market specifics |
| `naukri.md` | `modes/oferta.md` (ES) | Single job offer का complete evaluation (Blocks A-F) |
| `aavedan.md` | `modes/apply.md` (EN) | Application form के लिए live assistant |
| `pipeline.md` | `modes/pipeline.md` (ES) | URL inbox / collected offers के लिए second brain |

बाकी modes (`scan`, `batch`, `pdf`, `tracker`, `auto-pipeline`, `deep`, `contacto`, `ofertas`, `project`, `training`) EN/ES originals से काम करते रहते हैं — उनकी content mostly tooling, paths, और configuration commands हैं जो language-independent रहनी चाहिए।

---

## भारतीय बाज़ार — विशेष कवरेज

`_shared.md` file निम्नलिखित India-specific concepts को cover करती है:

- **CTC vs. In-hand salary** — CTC और net take-home के बीच 20-40% gap को navigate करना
- **PF/EPF** — Employee और employer contributions (basic का ~12% each), EPFO में जमा
- **Gratuity** — Payment of Gratuity Act 1972, 5-year vesting, exit पर देय
- **Notice period** — 30/60/90 days, IT services में 90 days आम, buyout option verify करना
- **Variable pay / Performance bonus** — Target-linked components, guaranteed नहीं
- **ESOPs / RSUs** — Startup ESOPs (4-year vesting, 1-year cliff), listed company RSUs
- **Bond / Service agreement** — IT services में common, exit penalty amount और duration
- **HRA / LTA** — Tax-exempt salary components, metro vs. non-metro distinction
- **Moonlighting policy** — Dual employment restrictions (large IT services companies)
- **Labour Codes 2020** — Wage definition, working hours, और benefits पर impact

---

## क्या English में रहता है

जानबूझकर translate नहीं किया — standard tech vocabulary:

- `cv.md`, `pipeline`, `tracker`, `report`, `score`, `archetype`, `proof point`
- Tool names (`Playwright`, `WebSearch`, `WebFetch`, `Read`, `Write`, `Edit`, `Bash`)
- Tracker status values (`Evaluated`, `Applied`, `Interview`, `Offer`, `Rejected`)
- Code snippets, file paths, commands

Modes वैसी Hindi tech language use करते हैं जैसी Bengaluru, Hyderabad, Pune, और Gurugram की real engineering teams में बोली जाती है: Hindi prose, English technical terms जहाँ यह standard है। "Pipeline" को ज़बरदस्ती "पाइपलाइन" में translate नहीं किया जाता, "Deploy" को "तैनाती" नहीं कहा जाता।

---

## शब्द-कोश (Reference Glossary)

Modes customize या extend करते समय इस vocabulary का उपयोग करें — consistent tone के लिए:

| English | हिन्दी (इस codebase में) |
|---------|--------------------------|
| Job posting | नौकरी की पोस्टिंग / जॉब पोस्टिंग |
| Application | आवेदन |
| Cover letter | Cover letter / परिचय पत्र |
| Resume / CV | CV / बायोडेटा |
| Salary | वेतन / सैलरी |
| Compensation | मुआवज़ा / Package |
| Skills | कौशल / Skills |
| Interview | साक्षात्कार / Interview |
| Hiring manager | Hiring Manager |
| Recruiter | Recruiter / HR |
| AI | AI (Artificial Intelligence) |
| Requirements | आवश्यकताएं |
| Career history | करियर इतिहास / Work experience |
| Notice period | Notice period / नोटिस अवधि |
| Probation | Probation / परिवीक्षा अवधि |
| Annual leave | Annual leave / वार्षिक छुट्टी |
| Gratuity | Gratuity / ग्रेच्युटी |
| Provident Fund | PF / EPF / भविष्य निधि |
| Cost to Company | CTC |
| In-hand salary | In-hand / Net salary / Take-home |
| Variable pay | Variable pay / Performance bonus |
| Stock options | ESOPs / RSUs |
| Bond clause | Bond / Service agreement |
| Buyout | Notice period buyout |
| Work from home | WFH / Work from home |
| Remote work | Remote / दूरस्थ कार्य |
| Hybrid | Hybrid |
| Health insurance | Health insurance / Medical insurance |
| Permanent employment | Permanent / Full-time |
| Contract employment | Contract / Contractual |
| Freelance | Freelance |

---

## Contribute करें

किसी translation को improve करना हो या नया mode add करना हो:

1. `CONTRIBUTING.md` के अनुसार Issue खोलें
2. ऊपर के vocabulary का follow करें — consistent tone के लिए
3. Word-for-word translation नहीं — idiomatic और natural Hindi
4. Structural elements (Blocks A-F, tables, code blocks, tool instructions) exactly वैसे ही रखें
5. PR खोलने से पहले एक real Indian job offer (Naukri.com, Instahyre, या LinkedIn India) से test करें
