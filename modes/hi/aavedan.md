# Mode: aavedan -- Application Form के लिए Live Assistant

Interactive mode जब candidate Chrome में application form भर रहा हो। Screen पर जो है उसे पढ़ता है, पिछले offer evaluation का context load करता है, और form के हर question के लिए personalized responses generate करता है।

## Prerequisites

- **Playwright के साथ ideal**: Visible mode में, candidate browser देखता है और Claude page के साथ interact कर सकता है।
- **Playwright के बिना**: Candidate screenshot share करता है या questions manually paste करता है।

## Workflow

```
1. DETECT     -> Active Chrome tab पढ़ें (capture/URL/title)
2. IDENTIFY   -> Page से company + role extract करें
3. SEARCH     -> reports/ में existing reports से match करें
4. LOAD       -> पूरा report + Block G (यदि मौजूद हो) पढ़ें
5. COMPARE    -> Screen का role evaluated role से match करता है? Change हो तो alert करें
6. ANALYZE    -> Form के सभी visible questions identify करें
7. GENERATE   -> हर question के लिए personalized response generate करें
8. PRESENT    -> Copy-paste के लिए formatted responses display करें
```

## Step 1 -- Offer Detect करें

**Playwright के साथ:** Active page का snapshot। Title, URL और visible content पढ़ें।

**Playwright के बिना:** Candidate से कहें:
- Form का screenshot share करें (Read tool images पढ़ता है)
- या form के questions text में paste करें
- या company + role बताएं ताकि context ढूंढ सकें

## Step 2 -- Context Identify और Load करें

1. Page से company name और job title extract करें
2. Company name से `reports/` में search करें (Grep case-insensitive)
3. Match मिले → पूरा report load करें
4. Block G मौजूद हो → previous draft responses को base के रूप में load करें
5. Match नहीं मिला → candidate को alert करें और quick auto-pipeline का सुझाव दें

## Step 3 -- Role Changes Detect करें

यदि screen का role evaluated role से अलग हो:
- **Candidate को alert करें**: "Role [X] से [Y] में change हुआ है। क्या आप चाहते हैं कि मैं reevaluate करूँ या नए title के अनुसार responses adapt करूँ?"
- **यदि adapt करें**: New role के लिए responses adjust करें बिना reevaluate किए
- **यदि reevaluate करें**: Complete A-F evaluation launch करें, report update करें, Block G regenerate करें
- **Tracker update करें**: यदि ज़रूरी हो तो applications.md में role title modify करें

## Step 4 -- Form Questions Analyze करें

सभी visible questions identify करें:
- Free text fields (cover letter, "यह role क्यों चाहते हैं", motivation, आदि)
- Dropdowns (आपको यह job कैसे पता चला, work authorization, आदि)
- Yes/No (relocation, visa, availability, आदि)
- Salary fields (expected CTC, current CTC -- India में हमेशा annual CTC)
- Upload fields (CV, cover letter PDF, references)

हर question classify करें:
- **Block G में already answered** → existing response reuse करें
- **नया question** → report + `cv.md` से response generate करें

## Step 5 -- Responses Generate करें

हर question के लिए इस schema से response बनाएं:

1. **Report context**: Block B के proof points, Block F की STAR stories use करें
2. **Previous Block G**: यदि draft मौजूद हो, उसे base लें और refine करें
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

यदि candidate confirm करे कि application submit हो गई:
1. `applications.md` में status "Evaluated" से "Applied" में update करें
2. Report के Block G को final responses से update करें
3. अगला step suggest करें: hiring manager के लिए LinkedIn outreach के लिए `/career-ops contacto`

## Scrolling Handle करें

यदि form में visible से ज़्यादा questions हों:
- Candidate से scroll करके दूसरा screenshot share करने को कहें
- या remaining questions paste करने को कहें
- पूरा form cover होने तक iterations में process करें
