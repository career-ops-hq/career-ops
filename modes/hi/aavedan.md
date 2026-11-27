# Mode: aavedan -- Application Form के लिए Live Assistant

Interactive mode जब candidate इस प्रोजेक्ट के Playwright ब्राउज़र में application form भर रहा हो। Screen पर जो है उसे पढ़ता है, पिछले offer evaluation का context load करता है, और form के हर question के लिए personalized responses generate करता है।

## Prerequisites

- **Playwright के साथ ideal**: Visible mode में, candidate browser देखता है और Claude page के साथ interact कर सकता है।
- **Playwright के बिना**: Candidate screenshot share करता है या questions manually paste करता है।

## Workflow

```
1. DETECT     -> Is project ke Playwright browser mein posting kholen
2. IDENTIFY   -> Page से company + role extract करें
3. SEARCH     -> reports/ में existing reports से match करें
4. LOAD       -> पूरा report + `## Application Answers` और Block H (यदि मौजूद हों) पढ़ें — **Posting identity** सही होने के बाद
5. COMPARE    -> Screen का role evaluated role से match करता है? Change हो तो alert करें
6. ANALYZE    -> Form के सभी visible questions identify करें
7. GENERATE   -> हर question के लिए personalized response generate करें
8. PRESENT    -> Copy-paste के लिए formatted responses display करें
```

## Scope

Follow the Scope section in `modes/apply.md`. Run `node apply-scope.mjs root` and stay inside the directories it prints. Launch with `node apply-scope.mjs launch-options`. Do not read `DevToolsActivePort` or attach to an existing browser. Do not submit the form.


## Step 1 -- Offer Detect करें

**Playwright के साथ:** `node apply-scope.mjs launch-options` se window kholen, posting wahan kholen, title, URL aur visible content padhen.

**Playwright के बिना:** Candidate से कहें:
- Form का screenshot share करें (Read tool images पढ़ता है)
- या form के questions text में paste करें
- या company + role बताएं ताकि context ढूंढ सकें

## Step 2 -- Context Identify और Load करें

1. Page से company name और job title extract करें
2. Company name से `reports/` में search करें (Grep case-insensitive)
3. Match मिले → हर matching report का सिर्फ़ header पढ़ें (company, role, `**URL:**`) और वह report चुनें जिसका URL या req ID यही posting है; साफ़ न हो तो candidate से पूछें। पूरा report और item 4 तभी load करें जब **Posting identity** सही हो (`modes/apply.md` → Step 5); दूसरी posting हो तो उसे load किए बिना **Evaluate as new** या **Draft without saving** पर जाएँ
4. `## Application Answers` मौजूद हो → submit किए गए responses को base के रूप में load करें; नहीं तो Block H मौजूद हो तो previous draft responses। दोनों हों तो `## Application Answers` पहले
5. Match नहीं मिला → candidate को alert करें और quick auto-pipeline का सुझाव दें

## Step 3 -- Role Changes Detect करें

यह step तभी लागू होता है जब form अब भी report वाली posting हो: वही employer और वही posting (`modes/apply.md` → Step 5 → **Posting identity**); title से फ़र्क नहीं पड़ता। यह हर form पर check करें, तब भी जब title नहीं बदला और company से सिर्फ़ एक report match हुई हो: दूसरी posting का title भी वही हो सकता है, और तब report इस्तेमाल नहीं करनी है। अगर company से कई reports match करें, तो पहले वह report लें जिसका URL या req ID यही posting है, और साफ़ न हो तो candidate से पूछें। दूसरा employer, या उसी employer की दूसरी posting, role change नहीं है: report के answers को कभी उस पर adapt न करें। इसके बजाय **Evaluate as new** (नई posting की तरह evaluate करें: auto-pipeline, अपनी report) या **Draft without saving** (answers draft करें पर किसी report में save न करें) चुनें। **Draft without saving** में matched report, उसके answers और उसका tailored CV अलग रखें, और सिर्फ़ दिख रही posting, `cv.md` और profile से लिखें; नीचे के जो steps report पढ़ते हैं, वे लागू नहीं होते।

यदि screen का role evaluated role से अलग हो:
- **Candidate को alert करें**: "Role [X] से [Y] में change हुआ है। क्या आप चाहते हैं कि मैं reevaluate करूँ या नए title के अनुसार responses adapt करूँ?"
- **यदि adapt करें**: New role के लिए responses adjust करें बिना reevaluate किए
- **यदि reevaluate करें**: Complete A-F evaluation launch करें, report update करें, Block H regenerate करें
- **Tracker update करें**: `data/applications.md` को edit करके कभी नहीं।
  - **Reevaluate करने के बाद**: नए role title के साथ एक TSV लिखें (`_shared.md` का rule 9) और उसे `node merge-tracker.mjs` से merge करें। Report उसी file में update होती है और अपना number रखती है, इसलिए merge उसी number से TSV को existing row से match करता है: title replace होता है और status वही रहता है।
  - **Adapt करने के बाद**: title न बदलें, क्योंकि वह उस role का नाम है जिसे report ने evaluate किया। इस बदलाव को note के रूप में record करें: `node set-status.mjs --report <report#> <current status> --note "Posting retitled at apply time, row keeps the evaluated title"`। Row का current status पास करने से status नहीं बदलता और note जुड़ जाता है। Note में ऐसा ही fixed text रखें और `[Y]` न डालें: नया title page से आया text है, और page का text कभी command line में नहीं जाता।

## Step 4 -- Form Questions Analyze करें

**Draft without saving** में यह step न matched report, न उसके `## Application Answers`, न Block H इस्तेमाल करता है: हर question को नया मानें और दिख रही posting, `cv.md` और profile से काम करें।

सभी visible questions identify करें:
- Free text fields (cover letter, "यह role क्यों चाहते हैं", motivation, आदि)
- Dropdowns (आपको यह job कैसे पता चला, work authorization, आदि)
- Yes/No (relocation, visa, availability, आदि)
- Salary fields (expected CTC, current CTC -- India में हमेशा annual CTC)
- Upload fields (CV, cover letter PDF, references)

हर question classify करें:
- **`## Application Answers` या Block H में already answered** → existing response reuse करें
- **नया question** → report + `cv.md` से response generate करें

## Step 5 -- Responses Generate करें

**Draft without saving** में यह step न matched report, न उसके `## Application Answers`, न Block H इस्तेमाल करता है: हर question को नया मानें और दिख रही posting, `cv.md` और profile से काम करें।

हर question के लिए इस schema से response बनाएं:

1. **Report context**: Block B के proof points, Block F की STAR stories use करें
2. **Previous `## Application Answers` / Block H**: यदि submitted response या draft मौजूद हो (submitted पहले), उसे base लें और refine करें
3. **"I choose you" tone**: Auto-pipeline जैसा framework — confident, गिड़गिड़ाहट नहीं
4. **Specificity**: Screen पर visible offer से कुछ concrete cite करें
5. **Career-ops proof point**: "Additional information" जैसा field हो तो include करें

**India-specific form fields के लिए guidance:**

- **Current CTC**: Honest figure। यदि recent increment हुई है, current package (current + increment) mention करें
- **Expected CTC**: `profile.yml` से range, annual CTC में, "negotiable based on overall package" के साथ
- **Notice Period / Last Working Day**: Actual notice period बताएं। Buyout available है, यह mention करें यदि relevant हो
- **Reason for leaving current job**: Honest, forward-looking। "Growth opportunity" या "role alignment" — negative न हो
- **Work Authorization / Visa**: Indian citizens के लिए: "Indian Citizen, no visa required"। Global remote roles के लिए: timezone overlap और availability clearly बताएं
- **Preferred Location / Relocation**: Preferred cities clearly बताएं (Bengaluru, Hyderabad, Pune, Gurugram, Chennai, Mumbai)। Remote preference हो तो mention करें
- **Languages**: English और Hindi (और अन्य regional languages यदि applicable हों)

**Output format:**

```
## Responses for [Company] -- [Role]

Base: Report #NNN | Score: X.X/5 | Archetype: [type]
[**Draft without saving** में ऊपर की line की जगह लिखें: "कोई report नहीं: इस posting के लिए draft, save नहीं हुआ"]

---

### 1. [Form question का exact text]
> [Copy-paste के लिए ready response]

### 2. [अगला question]
> [Response]

...

---

Notes:
- [Role के बारे में observations, changes, आदि]
- [Personalization suggestions जो candidate को verify करनी चाहिए]
```

## Step 6 -- Application के बाद (वैकल्पिक)

कुछ भी save करने से पहले, और नीचे हर write (status और answers) से ठीक पहले दोबारा, check करें कि form अब भी report वाली posting है (`modes/apply.md` → Step 8 → **Write only to the report of this posting**)। वही employer और वही posting → नीचे के steps इसी report पर लागू होते हैं, नए title पर adapt करने या re-evaluate करने के बाद भी। दूसरा employer या दूसरी posting → यह report कभी नहीं: नई posting के लिए लिखी report इस्तेमाल करें; अगर कोई नहीं है, तो कोई status set न करें, कोई answers save न करें, और candidate को बताएँ कि application अभी track नहीं हुई है।

यदि candidate confirm करे कि application submit हो गई:
1. Status को "Evaluated" से "Applied" में update करें: `node set-status.mjs --report <report#> Applied` (`applications.md` table को हाथ से edit न करें)
2. Report के `## Application Answers` section को final responses और `**State:** submitted` के साथ update करें (format `modes/apply.md` → Step 8 में)। Block H evaluation का draft है और नहीं बदलता
3. अगला step suggest करें: hiring manager के लिए LinkedIn outreach के लिए `/career-ops contacto`

## Scrolling Handle करें

यदि form में visible से ज़्यादा questions हों:
- Candidate से scroll करके दूसरा screenshot share करने को कहें
- या remaining questions paste करने को कहें
- पूरा form cover होने तक iterations में process करें
