<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/wordmark-dark.svg"><img src="docs/wordmark-light.svg" alt="career-ops" width="250" height="56"></picture></p>

<p align="center">نظام إدارة وتخطيط البحث عن وظائف باستخدام الذكاء الاصطناعي (وكيل مأتمت)</p>

<div align="center">

[English](README.md) | [Español](README.es.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md) | [한국어](README.ko-KR.md) | [日本語](README.ja.md) | [简体中文](README.cn.md) | [繁體中文](README.zh-TW.md) | [Українська](README.ua.md) | [Русский](README.ru.md) | [Polski](README.pl.md) | [Dansk](README.da.md) | [العربية](README.ar.md) | [हिन्दी](README.hi.md)

</div>

<p align="right" dir="rtl">
  <a href="https://x.com/santifer"><img src="docs/hero-banner.jpg" alt="career-ops — نظام البحث عن وظائف القائم على عدة وكلاء ذكاء اصطناعي" width="800"></a>
</p>

<p align="center" dir="rtl">
  <em>لقد قضيت شهوراً في التقديم على الوظائف بالطريقة التقليدية الصعبة. لذا قمت ببناء وتطوير النظام الذي تمنيت لو كان لدي.</em><br>
  تستخدم الشركات الذكاء الاصطناعي لتصفية المرشحين. <strong>أنا ببساطة أعطيت المرشحين الذكاء الاصطناعي ليختاروا هم الشركات المناسبة.</strong><br>
  <em>الآن، هذا النظام مفتوح المصدر بالكامل.</em>
</p>

<p align="center">
  <a href="https://claude.com/claude-code"><img src="https://img.shields.io/badge/Built_with-Claude_Code-000?style=for-the-badge&logo=anthropic&logoColor=white" alt="Built with Claude Code"></a>
</p>

<p align="center">
  <sub>يعمل أيضاً على أي واجهة سطر أوامر تدعم معيار agent-skill</sub><br>
  <img src="https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/OpenCode-111827?style=flat&logo=terminal&logoColor=white" alt="OpenCode">
  <img src="https://img.shields.io/badge/Gemini_CLI-4285F4?style=flat&logo=google&logoColor=white" alt="Gemini CLI">
  <img src="https://img.shields.io/badge/Codex-412991?style=flat&logo=openai&logoColor=white" alt="Codex">
  <img src="https://img.shields.io/badge/Qwen-615CED?style=flat" alt="Qwen">
  <img src="https://img.shields.io/badge/GitHub_Copilot-000?style=flat&logo=githubcopilot&logoColor=white" alt="GitHub Copilot">
  <br>
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white" alt="Playwright">
  <img src="https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white" alt="Bubble Tea">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT">
  <a href="TRADEMARK.md"><img src="https://img.shields.io/badge/Trademark-Policy-blue.svg" alt="Trademark Policy"></a>
</p>

---

<p align="center">
  <img src="docs/demo.gif" alt="عرض توضيحي لـ career-ops" width="800">
</p>

<p align="center" dir="rtl"><strong>أكثر من 740 عرض عمل تم تقييمه · أكثر من 100 سيرة ذاتية مخصصة وموجهة · الحصول على الوظيفة الحلم</strong></p>

<p align="center"><a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/Join_the_community-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a></p>

## ما هو هذا المشروع؟ (What Is This)

يقوم **career-ops** ([career-ops.org](https://career-ops.org)) بتحويل أي واجهة سطر أوامر للبرمجة بالذكاء الاصطناعي (AI coding CLI) إلى مركز قيادة كامل للبحث عن الوظائف. بدلاً من تتبع طلبات التوظيف يدوياً في جداول البيانات، تحصل على مسار عمل مدعوم بالذكاء الاصطناعي يقوم بـ:

- **تقييم العروض الوظيفية** بنظام تقييم هيكلي من A إلى F (خمسة أبعاد تُنتج درجة من 1.0 إلى 5.0).
- **إنشاء سير ذاتية مخصصة وموجهة بصيغة PDF** متوافقة مع أنظمة تتبع المتقدمين (ATS).
- **فحص بوابات التوظيف تلقائياً** (مثل Greenhouse و Ashby و Lever وصفحات الشركات).
- **المعالجة بالدفعة (Batch Processing)** لتقييم أكثر من 10 عروض عمل بالتوازي باستخدام وكلاء فرعيين.
- **تتبع كل شيء** في مستودع موثق واحد مع فحوصات سلامة البيانات وتناسقها.

> **هام جداً: هذا ليس أداة لإرسال الطلبات العشوائية أو إغراق السوق.** career-ops يعمل كمصفاة دقيقة لمساعدتك في العثور على الفرص القليلة التي تستحق وقتك وجهدك فعلاً من بين المئات. ينصح النظام بشدة بعدم التقديم على أي وظيفة يقل تقييمها عن 4.0/5. وقتك ثمين، ووقت مسؤولي التوظيف كذلك. قم دائماً بمراجعة النتائج قبل الإرسال.

يعتمد النظام على الوكلاء الأذكياء (Agentic): حيث يتصفح وكيلك صفحات التوظيف، ويدرس مدى التوافق من خلال تحليل ومقارنة سيرتك الذاتية مع متطلبات الوظيفة (وليس مجرد مطابقة الكلمات المفتاحية)، ويقوم بتحديث السيرة الذاتية لتناسب الفرصة المستهدفة تماماً.

> **تنبيه: التقييمات الأولى لن تكون مثالية.** النظام لا يعرفك بعد. يجب أن تغذيه بالمعلومات الكافية — سيرتك الذاتية، قصتك المهنية، نقاط الإثبات والإنجازات الخاصة بك، تفضيلاتك، وما تبرع فيه وما تود تجنبه. كلما زدت من تدريبه وتخصيصه، أصبح أفضل. فكر في الأمر كأنك تقوم بتدريب مسؤول توظيف جديد يعمل لصالحك: في الأسبوع الأول يحتاج ليتعلم عنك، ثم يصبح لا غنى عنه.

تم تطوير هذا النظام بواسطة مهندس برمجيات وريادي أعمال استخدمه شخصياً لتقييم أكثر من 740 عرض عمل، وتوليد أكثر من 100 سيرة ذاتية مخصصة، حتى حصل على منصب "رئيس قسم الذكاء الاصطناعي التطبيقي". [اقرأ دراسة الحالة الكاملة](https://santifer.io/career-ops-system).

---

## الميزات (Features)

| الميزة | الوصف |
| :--- | :--- |
| **المسار التلقائي (Auto-Pipeline)** | الصق رابط الوظيفة، واحصل على تقييم كامل + سيرة ذاتية PDF + تسجيل فوري في التتبع |
| **تقييم سداسي الأبعاد** | ملخص الدور، مطابقة السيرة الذاتية، استراتيجية المستوى الوظيفي، أبحاث الرواتب، التخصيص، والتحضير للمقابلات (STAR+R) |
| **بنك قصص المقابلات** | تجميع قصص بصيغة STAR + الدروس المستفادة (Reflection) عبر التقييمات لتشكيل 5-10 قصص رئيسية تجيب على أي سؤال سلوكي |
| **سيناريوهات التفاوض** | أطر عمل جاهزة للتفاوض على الرواتب، ومواجهة سياسات الخصم الجغرافي، والاستفادة من العروض المنافسة |
| **توليد ملفات PDF متوافقة مع ATS** | سير ذاتية مخصصة وموجهة مكتوبة بخطوط احترافية وتصميم جذاب خاضعة لتحسين الكلمات المفتاحية |
| **ماسح بوابات التوظيف** | معد مسبقاً لأكثر من 45 شركة رائدة (Anthropic, OpenAI, ElevenLabs, Retool, n8n...) مع استعلامات مخصصة |
| **المعالجة الجماعية والBatch** | تقييم متوازي لعدة وظائف دفعة واحدة باستخدام وكلاء فرعيين يعملون بالتوازي |
| **لوحة تحكم سطر الأوامر (TUI)** | واجهة طرفية تفاعلية لتصفح وفلترة وترتيب مسار وظائفك بمرونة فائقة |
| **المرشح في قلب القرار (Human-in-the-Loop)** | يقوم الذكاء الاصطناعي بالتقييم والتوصية، بينما تتخذ أنت القرار النهائي وتنفذه. النظام لا يقوم بالتقديم التلقائي أبداً دون إذنك |
| **سلامة وموثوقية البيانات** | دمج تلقائي، إزالة التكرار، توحيد الحالات المهنية، وفحوصات سلامة المسار البرمجي |

---

## البدء السريع (Quick Start)

```bash
# 1. استنساخ المشروع وتثبيت الاعتماديات
git clone https://github.com/santifer/career-ops.git
cd career-ops && npm install
npx playwright install chromium   # مطلوب لتوليد ملفات الـ PDF وسحب البيانات

# 2. فحص إعدادات النظام
npm run doctor                     # للتحقق من جاهزية كل المتطلبات البرمجية

# 3. تكوين البيانات الشخصية
cp config/profile.example.yml config/profile.yml  # قم بتعديله وإضافة معلوماتك
cp templates/portals.example.yml portals.yml       # لتخصيص الشركات المستهدفة بالبحث

# 4. إضافة سيرتك الذاتية
# قم بإنشاء ملف cv.md في المجلد الرئيسي للمشروع وضع فيه سيرتك الذاتية بصيغة Markdown نظيفة

# 5. تشغيل الوكيل المساعد للتخصيص
claude   # افتح واجهة Claude Code في هذا المجلد
# أو يمكنك استخدام Gemini CLI أو أي بيئة ذكاء اصطناعي متوافقة
```

ثم اطلب من الوكيل تخصيص النظام ليناسبك تماماً:
> "قم بتغيير الأدوار المستهدفة (archetypes) لتناسب مهندس برمجيات خلفية (Backend Engineer)"
> "أضف هذه الشركات الخمس إلى ملف portals.yml الخاص بي"
> "قم بتحديث ملف تعريفي الشخصي باستخدام هذه السيرة الذاتية التي سألصقها لك الآن"

---

## تكامل واجهة سطر أوامر جميناي (Gemini CLI Integration)

يدعم career-ops بشكل أصلي واجهة [Gemini CLI](https://github.com/google-gemini/gemini-cli) بنفس الكفاءة والقواعد التي يدعم بها بيئات التوظيف الأخرى. جميع الأوامر الـ 15 متاحة وتستخدم نفس منطق التقييم تحت المجلد `modes/`.

### الخيار أ — استخدام Gemini CLI الأصلي (موصى به)

```bash
# 1. تثبيت Gemini CLI
npm install -g @google/gemini-cli

# 2. تسجيل الدخول والتوثيق (مجاني بالكامل عبر حساب جوجل)
gemini auth

# 3. تشغيل جميناي داخل مجلد المشروع
cd career-ops
gemini

# 4. استخدام الأوامر المباشرة بكل سهولة
/career-ops "Senior AI Engineer at Anthropic..."
/career-ops-evaluate --file ./jds/openai.txt
/career-ops-scan
/career-ops-pdf
/career-ops-tracker
```

يتم تحميل ملف `GEMINI.md` تلقائياً كجزء من سياق عمل الوكيل.

### الخيار ب — تشغيل سكريبت مستقل عبر الـ API مباشرة

```bash
# 1. احصل على مفتاح API مجاني من https://aistudio.google.com/apikey
cp .env.example .env
# قم بتحرير الملف .env واكتب فيه: GEMINI_API_KEY=your_key_here

# 2. تثبيت الاعتماديات
npm install

# 3. تقييم تفاصيل الوظيفة مباشرة
node gemini-eval.mjs "We are looking for a Senior AI Engineer..."
node gemini-eval.mjs --file ./jds/my-job.txt
npm run gemini:eval -- "نص تفاصيل الوظيفة هنا"
```

---

## الاستخدام البرمجي (Usage)

يتيح لك النظام تفعيل عدة أوضاع ومهام مختلفة باستخدام أوامر مباشرة:

```text
/career-ops                ← لعرض كافة الأوامر المتاحة وتفاصيلها
/career-ops {رابط الوظيفة} ← تشغيل المسار التلقائي بالكامل (تقييم + PDF + تسجيل)
/career-ops scan           ← مسح بوابات التوظيف بحثاً عن فرص جديدة
/career-ops pdf            ← توليد سيرة ذاتية محسنة ومتوافقة مع ATS
/career-ops batch          ← تقييم مجموعة وظائف دفعة واحدة بالتوازي
/career-ops tracker        ← عرض وتحديث حالات التقديم الحالية
/career-ops apply          ← تعبئة نماذج التوظيف والردود بمساعدة الذكاء الاصطناعي
/career-ops pipeline       ← معالجة وفحص روابط الوظائف المنتظرة
/career-ops contacto       ← صياغة رسائل التواصل الموجهة عبر LinkedIn
/career-ops deep           ← إجراء بحث معمق واستخباراتي حول الشركة المستهدفة
/career-ops training       ← تقييم دورة تدريبية أو شهادة مهنية ومدى فائدتها لك
/career-ops project        ← تقييم مشروع شخصي في معرض أعمالك وكيفية عرضه
```

أو يمكنك ببساطة لصق رابط الوظيفة أو وصفها مباشرة — سيتعرف النظام عليها تلقائياً ويطلق المسار الكامل فوراً.

---

## كيف يعمل النظام؟ (How It Works)

```text
تلصق رابط الوظيفة أو تفاصيلها
         │
         ▼
┌──────────────────┐
│  تحديد النمط     │  تصنيف تلقائي للنمط الوظيفي المستهدف
│  (Archetype)     │
└────────┬─────────┘
         │
┌────────▼─────────┐
│  تقييم A-F       │  تحليل التوافق والفجوات، وبحث الرواتب، وتجميع قصص المقابلة
│ (قراءة cv.md)    │
└────────┬─────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
  تقرير  سيرة  تسجيل
  MD    PDF   TSV
```

---

## بوابات التوظيف المهيأة مسبقاً (Pre-configured Portals)

يحتوي الفاحص التلقائي على **أكثر من 45 شركة رائدة ومبتكرة** مهيأة للفحص المباشر والسريع، مع **19 استعلام بحث** عبر منصات التوظيف الرئيسية. يمكنك نسخ وتخصيص إعداداتك الخاصة عبر `portals.yml`.

لضمان سلامة الإعلانات المنشورة وتفادي الوظائف المنتهية صلاحيتها أو الوهمية (Ghost Jobs)، يمكنك تشغيل الفاحص مع خيار التحقق الحي باستخدام Playwright:

```bash
node scan.mjs --verify          # كشف سريع بدون استهلاك للرموز + فحص حيوية الإعلان عبر المتصفح
```

---

## لوحة تحكم سطر الأوامر (Dashboard TUI)

تتيح لك لوحة التحكم المصممة بلغة Go تصفح مسارات البحث وفلترة العروض بصرياً وتفاعلياً داخل الطرفية:

```bash
cd dashboard
go build -o career-dashboard .
./career-dashboard --path ..
```

تتميز اللوحة بدعم التصفح السريع والكسول (lazy-loaded previews)، والتبديل المباشر لحالات الطلب، وواجهات ملونة وجذابة مبنية باستخدام Bubble Tea و Lipgloss.

---

## هيكلية المشروع (Project Structure)

```text
career-ops/
├── AGENTS.md                    # تعليمات وقواعد الوكلاء البرمجية الموحدة
├── CLAUDE.md                    # واجهة Claude Code والتعليمات المرفقة
├── cv.md                        # سيرتك الذاتية المصدرية بصيغة Markdown
├── article-digest.md            # نقاط الإثبات والإنجازات الخاصة بمشاريعك (اختياري)
├── config/
│   └── profile.example.yml      # نموذج إعدادات ملفك الشخصي وأهدافك
├── modes/                       # أنماط وأدوات العمل الـ 14
│   ├── _shared.md               # السياق البرمجي العام وقواعد التقييم
│   ├── oferta.md                # منطق تقييم عرض عمل فردي
│   ├── pdf.md                   # منطق توليد وتعديل ملف السيرة الذاتية
│   ├── scan.md                  # إعدادات وعمليات مسح منصات التوظيف
│   └── ...
├── templates/
│   ├── cv-template.html         # قالب السيرة الذاتية المهيأ للـ ATS
│   ├── portals.example.yml      # نموذج إعدادات بوابات فحص الوظائف
│   └── states.yml               # تعريف الحالات القانونية للطلبات
├── dashboard/                   # لوحة تحكم TUI مبنية بلغة Go
├── data/                        # بيانات التتبع والمتابعة الخاصة بك
├── reports/                     # تقارير التقييم المفصلة للوظائف
├── output/                      # ملفات الـ PDF المولدة النهائية
└── docs/                        # وثائق التثبيت، التخصيص، والبنية التحتية
```

---

## إخلاء المسؤولية (Disclaimer)

**career-ops هي أداة محلية مفتوحة المصدر بالكامل — وليست خدمة مستضافة.** عند استخدامك لهذا البرنامج، فإنك تقر وتوافق على التالي:

1. **أنت المتحكم الوحيد ببياناتك:** تظل سيرتك الذاتية وبيانات الاتصال والبيانات الشخصية على جهازك المحلي، ولا تُرسل إلا مباشرة إلى مزود الذكاء الاصطناعي الذي تختاره بنفسك. لا نقوم بجمع أو الاطلاع على أي من بياناتك بأي شكل.
2. **أنت المشرف على الذكاء الاصطناعي:** تمنع التعليمات الافتراضية النظام من تقديم الطلبات تلقائياً، ولكن النماذج قد تتصرف أحياناً بشكل غير متوقع. أي تعديل للتعليمات يقع تحت مسؤوليتك الخاصة. **قم دائماً بمراجعة النصوص المولدة للتأكد من دقتها المهنية قبل التقديم.**
3. **الالتزام بشروط الاستخدام للجهات الخارجية:** يجب استخدام هذه الأداة بما يتوافق تماماً مع شروط الاستخدام الخاصة بالمنصات التي يتم التفاعل معها (مثل LinkedIn و Greenhouse و Lever وغيرها). يمنع تماماً استخدام الأداة لإرسال رسائل مزعجة أو إغراق الأنظمة.
4. **لا توجد ضمانات:** التقييمات والنتائج هي توصيات استشارية وليست حقائق مطلقة. لا يتحمل مطورو الأداة أي مسؤولية عن نتائج التوظيف، أو طلبات التوظيف المرفوضة، أو تقييد الحسابات، أو أي تبعات أخرى.

البرنامج مرخص بالكامل بموجب رخصة **MIT**.

---

## المساهمة والمطورين (Contributors)

نرحب بكافة المساهمات والمقترحات لتطوير هذا النظام ودعمه! انضم إلى مجتمعنا على Discord وشارك تجربتك وقصتك معنا.

<a href="https://github.com/santifer/career-ops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=santifer/career-ops" alt="Contributors" />
</a>

هل نجحت في الحصول على وظيفة أحلامك باستخدام هذا النظام؟ [شارك قصتك معنا لتلهم الآخرين!](https://github.com/santifer/career-ops/issues/new?template=i-got-hired.yml)
