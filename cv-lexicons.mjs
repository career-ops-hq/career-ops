/**
 * cv-lexicons.mjs — per-language keyword tables shared by the two CV quality
 * gates, so a non-English CV is checked rather than waved through.
 *
 * WHY THIS EXISTS
 *
 * verify-cv-facts.mjs (does the CV claim anything cv.md does not?) and
 * verify-ats.mjs (can an ATS parse this CV at all?) were both written against
 * English word lists. AGENTS.md makes non-English output first-class —
 * `language.output` governs "reports, tracker notes, PDFs, cover letters ...
 * any user-visible prose", and the repo ships market mode sets under modes/ for
 * eighteen languages — so an English-only lexicon is not a missing edge case,
 * it is the gate silently not running:
 *
 *   - verify-cv-facts: a German CV's "6 Commercial Project Managern" and
 *     "22 Mitarbeitenden" produced NO count claim, so nothing was compared
 *     against cv.md. The gate reported a pass having checked zero counts —
 *     the exact silent-pass class the fact gate exists to prevent.
 *   - verify-ats: "Berufserfahrung / Ausbildung / Kenntnisse" are the correct
 *     German headings, emitted by build-cv-html.mjs's documented `sections`
 *     payload field, and were reported as "[critical] Missing standard section
 *     heading(s): Experience, Education, Skills" — costing 15 of 20 section
 *     points and failing every German CV the tool itself generates.
 *
 * DESIGN
 *
 * Both tables are keyed by CONCEPT, not by language, and every language's
 * surface forms live under the same concept. That makes cross-language
 * agreement structural rather than accidental, which matters because the two
 * sides of the fact gate need not be in the same language: a user may keep an
 * English cv.md and generate a German CV. "15 Jahren" and "15 years" both
 * canonicalize to `years`, so a truthful translation matches its source and a
 * changed number still does not.
 *
 * Metric-noun canonicals are always English nouns that verify-cv-facts.mjs's
 * own METRIC_NOUNS list already contains; its self-test asserts this, so a new
 * foreign form can never introduce a claim that has no English counterpart to
 * compare against (which would fail truthful CVs instead of protecting them).
 *
 * SCRIPT HANDLING
 *
 * Latin-script heading patterns are written WITHOUT accents and matched against
 * an asciiFold()ed copy of the headings, so "Expérience" / "Doświadczenie" /
 * "İş Deneyimi" all match plain ASCII stems and each entry stays readable.
 * Non-Latin patterns (Cyrillic, Arabic, Devanagari, CJK, Hangul) are written in
 * their own script and matched against the raw text, since asciiFold() folds
 * those to the empty string by design.
 *
 * Metric nouns cannot use that trick — folding would erase the surrounding
 * document — so their surface forms are listed literally, accents and all.
 */

/**
 * Language codes this file covers: every mode set shipped under modes/, plus
 * English. `ua` is the repo's directory name for Ukrainian (modes/ua/).
 */
export const SUPPORTED_LANGUAGES = [
  'en', 'ar', 'da', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja',
  'ko', 'nl', 'pl', 'pt', 'ru', 'tr', 'ua', 'zh', 'zh-TW',
];

// ── Section headings (verify-ats.mjs) ────────────────────────────────
//
// Values are regex SOURCE fragments, matched case-insensitively as substrings
// of the heading blob. They are stems on purpose ("erfahrung", not
// "berufserfahrung"), so inflected and compounded headings match: German glues
// its nouns together, Arabic prefixes the article ال, and Slavic languages
// decline. A stem also survives the decorations real templates add
// ("Berufserfahrung & Projekte").

/** @type {Record<string, Record<string, string[]>>} */
export const SECTION_HEADINGS = {
  experience: {
    en: ['experience', 'work history', 'employment', 'career'],
    ar: ['خبر', 'العمل', 'المهني'],
    da: ['erfaring', 'ansaettelse'],
    de: ['erfahrung', 'werdegang', 'berufspraxis', 'taetigkeit', 'beschaeftigung'],
    es: ['experiencia', 'trayectoria', 'laboral'],
    fr: ['experience', 'parcours', 'emplois'],
    hi: ['अनुभव'],
    id: ['pengalaman', 'riwayat pekerjaan'],
    it: ['esperienz', 'carriera'],
    ja: ['職務経歴', '職歴', '業務経験', '実務経験'],
    ko: ['경력', '업무 경험', '근무'],
    nl: ['ervaring', 'loopbaan', 'werkervaring'],
    pl: ['doswiadczen', 'zatrudnien', 'przebieg pracy'],
    pt: ['experienc', 'trajetoria'],
    ru: ['опыт', 'работы'],
    tr: ['deneyim', 'tecrube', 'is gecmisi'],
    ua: ['досвід', 'роботи'],
    zh: ['工作经历', '工作经验', '职业经历', '从业经历'],
    'zh-TW': ['工作經歷', '工作經驗', '職涯經歷', '從業經歷'],
  },
  education: {
    en: ['education', 'academic', 'degrees'],
    ar: ['تعليم', 'مؤهل', 'دراس', 'الأكاديم'],
    da: ['uddannelse'],
    de: ['ausbildung', 'bildung', 'studium', 'akademisch'],
    es: ['educaci', 'formaci', 'estudios', 'academic'],
    fr: ['formation', 'etudes', 'diplome', 'scolarite'],
    hi: ['शिक्ष', 'शैक्ष'],
    id: ['pendidikan'],
    it: ['istruzione', 'formazione'],
    ja: ['学歴', '教育'],
    ko: ['학력', '교육'],
    nl: ['opleiding', 'onderwijs'],
    pl: ['wyksztalcen', 'edukacj'],
    pt: ['educac', 'formac', 'academic'],
    ru: ['образование', 'обучение'],
    tr: ['egitim', 'ogrenim'],
    ua: ['освіта', 'навчання'],
    zh: ['教育', '学历'],
    'zh-TW': ['教育', '學歷'],
  },
  skills: {
    en: ['skills', 'competenc', 'proficienc', 'expertise'],
    ar: ['مهار', 'كفاء', 'قدرات'],
    da: ['kompetenc', 'faerdighed', 'kvalifikation'],
    de: ['kenntnis', 'faehigkeit', 'kompetenz', 'qualifikation', 'skills'],
    es: ['habilidad', 'competencia', 'aptitud', 'conocimiento'],
    fr: ['competence', 'savoir-faire', 'aptitudes'],
    hi: ['कौशल', 'दक्षत', 'योग्यत'],
    id: ['keahlian', 'keterampilan', 'kemampuan', 'kompetensi'],
    it: ['competenz', 'capacita', 'conoscenz'],
    ja: ['スキル', '技能', '能力', '得意分野'],
    ko: ['기술', '역량', '스킬', '보유'],
    nl: ['vaardighed', 'competenties', 'kennis'],
    pl: ['umiejetnos', 'kompetencj', 'kwalifikacj'],
    pt: ['competenc', 'habilidade', 'conhecimento'],
    ru: ['навык', 'компетенц', 'умения'],
    tr: ['yetenek', 'beceri', 'yetkinlik'],
    ua: ['навич', 'компетенц', 'уміння'],
    zh: ['技能', '能力', '专长'],
    'zh-TW': ['技能', '能力', '專長'],
  },
  // Bonus sections. Present-or-absent only; they add points, never remove them.
  summary: {
    en: ['summary', 'profile', 'objective', 'about me'],
    ar: ['نبذة', 'الملف الشخصي', 'الهدف'],
    da: ['profil', 'resume', 'om mig'],
    de: ['profil', 'zusammenfassung', 'ueber mich', 'kurzvorstellung'],
    es: ['perfil', 'resumen', 'objetivo', 'sobre mi'],
    fr: ['profil', 'resume', 'a propos', 'objectif'],
    hi: ['प्रोफ', 'सारांश', 'परिचय'],
    id: ['profil', 'ringkasan', 'tentang saya'],
    it: ['profilo', 'sintesi', 'obiettivo', 'chi sono'],
    ja: ['概要', '要約', 'プロフィール', '自己'],
    ko: ['프로필', '요약', '자기소개', '소개'],
    nl: ['profiel', 'samenvatting', 'over mij'],
    pl: ['profil', 'podsumowanie', 'o mnie'],
    pt: ['perfil', 'resumo', 'objetivo', 'sobre mim'],
    ru: ['профил', 'о себе', 'резюме'],
    tr: ['profil', 'ozet', 'hakkimda'],
    ua: ['профіл', 'про себе', 'резюме'],
    zh: ['简介', '概述', '简历', '自我评价'],
    'zh-TW': ['簡介', '概述', '簡歷', '自我評價'],
  },
  projects: {
    en: ['projects', 'portfolio'],
    ar: ['مشاريع', 'مشروع'],
    da: ['projekt'],
    de: ['projekt'],
    es: ['proyecto'],
    fr: ['projet'],
    hi: ['परियोजना', 'प्रोजेक्ट'],
    id: ['proyek'],
    it: ['progetti'],
    ja: ['プロジェクト', '実績'],
    ko: ['프로젝트'],
    nl: ['project'],
    pl: ['projekt'],
    pt: ['projeto'],
    ru: ['проект'],
    tr: ['proje'],
    ua: ['проєкт', 'проект'],
    zh: ['项目'],
    'zh-TW': ['專案', '項目'],
  },
  certifications: {
    en: ['certificat', 'licenses', 'licences', 'accreditation'],
    ar: ['شهاد', 'اعتماد'],
    da: ['certifi'],
    de: ['zertifi', 'bescheinigung', 'lizenz'],
    es: ['certifica', 'licencia'],
    fr: ['certificat', 'habilitation'],
    hi: ['प्रमाण'],
    id: ['sertifik'],
    it: ['certifica', 'abilitazion'],
    ja: ['資格', '認定', '免許'],
    ko: ['자격', '인증'],
    nl: ['certifi', 'diploma'],
    pl: ['certyfikat', 'uprawnien'],
    pt: ['certifica', 'licenc'],
    ru: ['сертификат', 'аттестат'],
    tr: ['sertifika', 'belge'],
    ua: ['сертифікат', 'атестат'],
    zh: ['证书', '认证', '资质'],
    'zh-TW': ['證書', '認證', '資格證'],
  },
};

// ── Metric nouns (verify-cv-facts.mjs) ───────────────────────────────
//
// concept -> language -> surface forms. The concept key IS the canonical
// English noun the claim normalizes to, so "22 Mitarbeitenden" and "22
// employees" compare equal.
//
// Inflected forms are listed explicitly rather than stemmed. The fact gate
// matches whole nouns with a Unicode word boundary, and a stem would bind the
// number to a fragment ("mitarbeit"), so the claim text a human reads in the
// failure message would not be the text in the CV.
//
// DELIBERATE OMISSIONS, because a wrong claim is worse than no claim:
//   - CJK bare 年/월/月 as a DURATION. "2024年3月" is March 2024, not "3
//     months"; only the unambiguous duration counters (ヶ月, 个月, 個月, 개월)
//     are listed, and `years` additionally carries a calendar-year guard in
//     verify-cv-facts.mjs.
//   - CJK days and weeks. 日 is the day-of-month marker in every CJK date, and
//     CVs almost never count days; the false-positive rate is not worth it.

/** @type {Record<string, Record<string, string[]>>} */
export const METRIC_NOUN_FORMS = {
  years: {
    ar: ['سنة', 'سنوات', 'سنه', 'عام', 'أعوام', 'عاما'],
    da: ['år', 'aar'],
    de: ['jahre', 'jahren', 'jahr'],
    es: ['años', 'anos', 'año'],
    fr: ['ans', 'années', 'annees'],
    hi: ['साल', 'वर्ष', 'वर्षों', 'बरस'],
    id: ['tahun'],
    it: ['anni', 'anno'],
    ja: ['年間', '年'],
    ko: ['년간', '년'],
    nl: ['jaar', 'jaren'],
    pl: ['lat', 'lata', 'roku', 'rok'],
    pt: ['anos', 'ano'],
    ru: ['лет', 'года', 'год', 'годов'],
    tr: ['yıl', 'yil', 'yıllık', 'yillik', 'senelik', 'sene'],
    ua: ['років', 'роки', 'рік', 'роках'],
    zh: ['年'],
    'zh-TW': ['年'],
  },
  months: {
    ar: ['شهر', 'أشهر', 'شهرا', 'شهور'],
    da: ['måneder', 'maaneder'],
    de: ['monate', 'monaten', 'monat'],
    es: ['meses', 'mes'],
    fr: ['mois'],
    hi: ['महीने', 'महीनों', 'माह'],
    id: ['bulan'],
    it: ['mesi', 'mese'],
    ja: ['ヶ月', 'カ月', 'か月', 'ケ月', '箇月'],
    ko: ['개월'],
    nl: ['maanden', 'maand'],
    pl: ['miesięcy', 'miesiecy', 'miesiące', 'miesiace'],
    pt: ['meses', 'mês', 'mes'],
    ru: ['месяцев', 'месяца', 'месяц'],
    tr: ['ay', 'aylık', 'aylik'],
    ua: ['місяців', 'місяці', 'місяць'],
    zh: ['个月', '個月'],
    'zh-TW': ['個月'],
  },
  weeks: {
    ar: ['أسبوع', 'أسابيع', 'اسبوع'],
    da: ['uger', 'uge'],
    de: ['wochen', 'woche'],
    es: ['semanas', 'semana'],
    fr: ['semaines', 'semaine'],
    hi: ['सप्ताह', 'हफ्ते'],
    id: ['minggu', 'pekan'],
    it: ['settimane', 'settimana'],
    nl: ['weken', 'week'],
    pl: ['tygodni', 'tygodnie'],
    pt: ['semanas', 'semana'],
    ru: ['недель', 'недели'],
    tr: ['hafta', 'haftalık', 'haftalik'],
    ua: ['тижнів', 'тижні'],
  },
  hours: {
    ar: ['ساعة', 'ساعات'],
    da: ['timer'],
    de: ['stunden', 'stunde'],
    es: ['horas', 'hora'],
    fr: ['heures', 'heure'],
    hi: ['घंटे', 'घंटों'],
    // 'ore'/'ora' are omitted: "4 ore samples" is ordinary English.
    ja: ['時間'],
    ko: ['시간'],
    nl: ['uren', 'uur'],
    pl: ['godzin', 'godziny'],
    pt: ['horas', 'hora'],
    ru: ['часов', 'часа'],
    tr: ['saat', 'saatlik'],
    ua: ['годин', 'години'],
    zh: ['小时'],
    'zh-TW': ['小時'],
  },
  employees: {
    ar: ['موظف', 'موظفا', 'موظفين', 'موظفون'],
    da: ['ansatte', 'medarbejdere'],
    de: ['mitarbeiter', 'mitarbeitern', 'mitarbeitende', 'mitarbeitenden',
      'beschäftigte', 'beschäftigten', 'angestellte', 'angestellten'],
    es: ['empleados', 'empleadas', 'trabajadores'],
    fr: ['employés', 'employes', 'salariés', 'salaries'],
    hi: ['कर्मचारी', 'कर्मचारियों'],
    id: ['karyawan', 'pegawai'],
    it: ['dipendenti', 'impiegati'],
    ja: ['従業員', '社員'],
    ko: ['직원'],
    nl: ['werknemers', 'medewerkers'],
    pl: ['pracowników', 'pracownikow', 'pracownicy'],
    pt: ['funcionários', 'funcionarios', 'empregados'],
    ru: ['сотрудников', 'сотрудника', 'работников'],
    tr: ['çalışan', 'çalışanı', 'calisan', 'çalışanlı'],
    ua: ['співробітників', 'працівників'],
    zh: ['员工'],
    'zh-TW': ['員工'],
  },
  staff: {
    ar: ['طاقم', 'كادر'],
    da: ['personale'],
    de: ['belegschaft', 'stammpersonal'],
    es: ['plantilla'],
    fr: ['personnel', 'effectifs'],
    hi: ['स्टाफ'],
    id: ['staf'],
    it: ['personale'],
    ja: ['スタッフ', '要員'],
    ko: ['인력'],
    nl: ['personeel'],
    pl: ['personelu'],
    pt: ['pessoal'],
    ru: ['персонала'],
    tr: ['personel', 'personeli'],
    ua: ['персоналу'],
    zh: ['人员'],
    'zh-TW': ['人員'],
  },
  people: {
    ar: ['شخص', 'أشخاص', 'شخصا', 'فرد', 'أفراد'],
    da: ['personer'],
    de: ['personen', 'leute', 'köpfe'],
    es: ['personas'],
    fr: ['personnes', 'collaborateurs', 'collaboratrices'],
    hi: ['लोग', 'लोगों', 'व्यक्ति'],
    id: ['orang'],
    it: ['persone'],
    ja: ['名', '人'],
    ko: ['명'],
    nl: ['personen', 'mensen'],
    pl: ['osób', 'osoby', 'osob'],
    pt: ['pessoas'],
    ru: ['человек', 'людей'],
    tr: ['kişi', 'kisi', 'kişilik', 'kisilik'],
    ua: ['осіб', 'людей'],
    zh: ['名', '人'],
    'zh-TW': ['名', '人'],
  },
  engineers: {
    ar: ['مهندس', 'مهندسين', 'مهندسا'],
    da: ['ingeniører', 'ingeniorer'],
    de: ['ingenieure', 'ingenieuren', 'ingenieur'],
    es: ['ingenieros', 'ingenieras'],
    fr: ['ingénieurs', 'ingenieurs'],
    hi: ['इंजीनियर'],
    id: ['insinyur'],
    it: ['ingegneri'],
    ja: ['エンジニア', '技術者'],
    ko: ['엔지니어'],
    nl: ['ingenieurs'],
    pl: ['inżynierów', 'inzynierow'],
    pt: ['engenheiros'],
    ru: ['инженеров', 'инженера'],
    tr: ['mühendis', 'muhendis', 'mühendisi'],
    ua: ['інженерів'],
    zh: ['工程师'],
    'zh-TW': ['工程師'],
  },
  developers: {
    ar: ['مطور', 'مطورين', 'مطورا'],
    da: ['udviklere'],
    de: ['entwickler', 'entwicklern'],
    es: ['desarrolladores', 'programadores'],
    fr: ['développeurs', 'developpeurs'],
    hi: ['डेवलपर'],
    id: ['pengembang'],
    it: ['sviluppatori'],
    ja: ['開発者', 'デベロッパー'],
    ko: ['개발자'],
    nl: ['ontwikkelaars'],
    pl: ['programistów', 'programistow', 'deweloperów'],
    pt: ['desenvolvedores'],
    ru: ['разработчиков', 'разработчика'],
    tr: ['geliştirici', 'gelistirici', 'yazılımcı'],
    ua: ['розробників'],
    zh: ['开发者', '开发人员'],
    'zh-TW': ['開發者', '開發人員'],
  },
  managers: {
    ar: ['مدير', 'مديرين', 'مديرا'],
    da: ['ledere', 'chefer'],
    de: ['manager', 'managern', 'führungskräfte', 'führungskräften'],
    es: ['gerentes', 'responsables'],
    fr: ['managers', 'responsables'],
    hi: ['प्रबंधक'],
    id: ['manajer'],
    it: ['manager', 'responsabili'],
    ja: ['マネージャー', '管理職'],
    ko: ['관리자', '매니저'],
    nl: ['managers', 'leidinggevenden'],
    pl: ['menedżerów', 'menedzerow', 'kierowników'],
    pt: ['gestores', 'gerentes'],
    ru: ['менеджеров', 'руководителей'],
    tr: ['yönetici', 'yonetici', 'yöneticiyi', 'müdür'],
    ua: ['менеджерів', 'керівників'],
    zh: ['经理', '管理者'],
    'zh-TW': ['經理', '管理者'],
  },
  directors: {
    de: ['direktoren', 'direktor'],
    es: ['directores', 'directoras'],
    fr: ['directeurs', 'directrices'],
    it: ['direttori'],
    nl: ['directeuren'],
    pl: ['dyrektorów'],
    pt: ['diretores'],
    ru: ['директоров'],
    tr: ['direktör', 'direktor'],
    ua: ['директорів'],
  },
  teams: {
    ar: ['فريق', 'فرق'],
    da: ['teams'],
    de: ['teams', 'team'],
    es: ['equipos', 'equipo'],
    fr: ['équipes', 'equipes', 'équipe'],
    hi: ['टीम', 'टीमों'],
    id: ['tim'],
    it: ['team', 'squadre'],
    ja: ['チーム'],
    ko: ['팀'],
    nl: ['teams'],
    pl: ['zespołów', 'zespolow', 'zespoły'],
    pt: ['equipes', 'equipas'],
    ru: ['команд', 'команды'],
    tr: ['ekip', 'ekibi', 'takım', 'takim'],
    ua: ['команд', 'команди'],
    zh: ['团队'],
    'zh-TW': ['團隊'],
  },
  customers: {
    ar: ['عميل', 'عميلا', 'عملاء', 'زبون', 'زبائن'],
    da: ['kunder'],
    de: ['kunden', 'kunde'],
    es: ['clientes'],
    fr: ['clients'],
    hi: ['ग्राहक', 'ग्राहकों'],
    id: ['pelanggan'],
    it: ['clienti'],
    ja: ['顧客'],
    ko: ['고객'],
    nl: ['klanten'],
    pl: ['klientów', 'klientow', 'klienci'],
    pt: ['clientes'],
    ru: ['клиентов', 'клиента'],
    tr: ['müşteri', 'musteri', 'müşteriyi'],
    ua: ['клієнтів'],
    zh: ['客户'],
    'zh-TW': ['客戶'],
  },
  users: {
    ar: ['مستخدم', 'مستخدمين', 'مستخدما'],
    da: ['brugere'],
    de: ['nutzer', 'nutzern', 'benutzer', 'anwender'],
    es: ['usuarios', 'usuarias'],
    fr: ['utilisateurs', 'utilisatrices'],
    hi: ['उपयोगकर्ता'],
    id: ['pengguna'],
    it: ['utenti'],
    ja: ['ユーザー', '利用者'],
    ko: ['사용자'],
    nl: ['gebruikers'],
    pl: ['użytkowników', 'uzytkownikow'],
    pt: ['usuários', 'usuarios', 'utilizadores'],
    ru: ['пользователей', 'пользователя'],
    tr: ['kullanıcı', 'kullanici', 'kullanıcıyı'],
    ua: ['користувачів'],
    zh: ['用户'],
    'zh-TW': ['用戶', '使用者'],
  },
  students: {
    ar: ['طالب', 'طلاب', 'طالبا'],
    da: ['studerende', 'elever'],
    de: ['studierende', 'studierenden', 'studenten', 'schüler', 'teilnehmende'],
    es: ['estudiantes', 'alumnos'],
    fr: ['étudiants', 'etudiants', 'élèves', 'eleves', 'apprenants'],
    hi: ['छात्र', 'छात्रों', 'विद्यार्थी'],
    id: ['siswa', 'mahasiswa', 'peserta'],
    it: ['studenti', 'allievi'],
    ja: ['受講者', '学生'],
    ko: ['학생', '수강생'],
    nl: ['studenten', 'leerlingen'],
    pl: ['studentów', 'studentow', 'uczniów'],
    pt: ['estudantes', 'alunos'],
    ru: ['студентов', 'учеников'],
    tr: ['öğrenci', 'ogrenci', 'öğrenciyi', 'katılımcı'],
    ua: ['студентів', 'учнів'],
    zh: ['学员', '学生'],
    'zh-TW': ['學員', '學生'],
  },
  patients: {
    ar: ['مريض', 'مرضى'],
    da: ['patienter'],
    de: ['patienten', 'patientinnen'],
    es: ['pacientes'],
    fr: ['patients', 'patientes'],
    hi: ['मरीज', 'रोगी'],
    id: ['pasien'],
    it: ['pazienti'],
    ja: ['患者'],
    ko: ['환자'],
    nl: ['patiënten', 'patienten'],
    pl: ['pacjentów', 'pacjentow'],
    pt: ['pacientes', 'doentes'],
    ru: ['пациентов'],
    tr: ['hastayı', 'hastaya'],
    ua: ['пацієнтів'],
    zh: ['患者', '病人'],
    'zh-TW': ['患者', '病人'],
  },
  projects: {
    ar: ['مشروع', 'مشاريع', 'مشروعا'],
    da: ['projekter'],
    de: ['projekte', 'projekten', 'projekt'],
    es: ['proyectos'],
    fr: ['projets'],
    hi: ['परियोजनाओं', 'प्रोजेक्ट'],
    id: ['proyek'],
    it: ['progetti'],
    ja: ['プロジェクト', '案件'],
    ko: ['프로젝트'],
    nl: ['projecten'],
    pl: ['projektów', 'projektow', 'projekty'],
    pt: ['projetos', 'projectos'],
    ru: ['проектов', 'проекта'],
    tr: ['proje', 'projeyi'],
    ua: ['проєктів', 'проектів'],
    zh: ['项目'],
    'zh-TW': ['專案', '項目'],
  },
  companies: {
    ar: ['شركة', 'شركات'],
    da: ['virksomheder'],
    de: ['unternehmen', 'firmen'],
    es: ['empresas', 'compañías', 'companias'],
    fr: ['entreprises', 'sociétés', 'societes'],
    hi: ['कंपनियों', 'कंपनी'],
    id: ['perusahaan'],
    it: ['aziende', 'società'],
    ja: ['企業', '会社'],
    ko: ['기업', '회사'],
    nl: ['bedrijven', 'ondernemingen'],
    pl: ['firm', 'przedsiębiorstw'],
    pt: ['empresas'],
    ru: ['компаний', 'компании'],
    tr: ['şirket', 'sirket', 'şirketi', 'firma'],
    ua: ['компаній'],
    zh: ['公司', '企业'],
    'zh-TW': ['公司', '企業'],
  },
  countries: {
    ar: ['دولة', 'دول', 'بلد', 'بلدان'],
    da: ['lande'],
    de: ['länder', 'laendern', 'ländern'],
    es: ['países', 'paises'],
    fr: ['pays'],
    hi: ['देशों', 'देश'],
    id: ['negara'],
    it: ['paesi'],
    ja: ['カ国', 'ヶ国', '国'],
    ko: ['개국', '국가'],
    nl: ['landen'],
    pl: ['krajów', 'krajow', 'kraje'],
    pt: ['países', 'paises'],
    ru: ['стран', 'страны'],
    tr: ['ülke', 'ulke', 'ülkede'],
    ua: ['країн'],
    zh: ['个国家', '国家'],
    'zh-TW': ['個國家', '國家'],
  },
  partners: {
    ar: ['شريك', 'شركاء'],
    da: ['partnere'],
    de: ['partner', 'partnern'],
    es: ['socios', 'partners'],
    fr: ['partenaires'],
    hi: ['भागीदार'],
    id: ['mitra'],
    it: ['partner'],
    ja: ['パートナー'],
    ko: ['파트너'],
    nl: ['partners'],
    pl: ['partnerów', 'partnerow'],
    pt: ['parceiros'],
    ru: ['партнёров', 'партнеров'],
    tr: ['iş ortağı', 'ortak', 'partner'],
    ua: ['партнерів'],
    zh: ['合作伙伴'],
    'zh-TW': ['合作夥伴'],
  },
  sites: {
    ar: ['موقع', 'مواقع'],
    da: ['lokationer'],
    de: ['standorte', 'standorten', 'standort'],
    es: ['sedes', 'centros'],
    fr: ['sites'],
    hi: ['स्थलों'],
    id: ['lokasi', 'situs'],
    it: ['sedi', 'siti'],
    ja: ['拠点'],
    ko: ['거점', '사업장'],
    nl: ['locaties', 'vestigingen'],
    pl: ['lokalizacji', 'oddziałów'],
    pt: ['unidades', 'sedes'],
    ru: ['площадок'],
    tr: ['tesis', 'tesiste', 'saha'],
    ua: ['майданчиків'],
    zh: ['站点', '基地'],
    'zh-TW': ['站點', '據點'],
  },
  locations: {
    da: ['steder'],
    de: ['orte', 'niederlassungen'],
    es: ['ubicaciones'],
    fr: ['implantations'],
    it: ['località'],
    nl: ['plaatsen'],
    pl: ['miejsc'],
    pt: ['localidades'],
    ru: ['локаций'],
    tr: ['konum', 'lokasyon'],
    ua: ['локацій'],
  },
  facilities: {
    ar: ['منشأة', 'منشآت', 'مرافق'],
    da: ['faciliteter', 'anlaeg'],
    de: ['anlagen', 'werke', 'einrichtungen'],
    es: ['instalaciones', 'plantas'],
    fr: ['installations', 'usines'],
    hi: ['सुविधाओं'],
    id: ['fasilitas', 'pabrik'],
    it: ['impianti', 'stabilimenti'],
    ja: ['施設', '工場'],
    ko: ['시설', '공장'],
    nl: ['faciliteiten', 'fabrieken'],
    pl: ['zakładów', 'obiektów'],
    pt: ['instalações', 'instalacoes', 'fábricas'],
    ru: ['объектов', 'заводов'],
    tr: ['tesisi', 'fabrika'],
    ua: ['об’єктів', 'заводів'],
    zh: ['设施', '工厂'],
    'zh-TW': ['設施', '工廠'],
  },
  courses: {
    ar: ['دورة', 'دورات'],
    da: ['kurser'],
    de: ['kurse', 'kursen', 'lehrgänge', 'schulungen'],
    es: ['cursos'],
    fr: ['cours', 'formations'],
    hi: ['पाठ्यक्रम', 'कोर्स'],
    id: ['kursus', 'pelatihan'],
    it: ['corsi'],
    ja: ['講座', 'コース'],
    ko: ['과정', '강의'],
    nl: ['cursussen', 'trainingen'],
    pl: ['kursów', 'szkoleń'],
    pt: ['cursos'],
    ru: ['курсов'],
    tr: ['kurs', 'eğitim', 'egitim'],
    ua: ['курсів'],
    zh: ['课程'],
    'zh-TW': ['課程'],
  },
  services: {
    ar: ['خدمة', 'خدمات'],
    da: ['services'],
    de: ['dienste', 'services'],
    es: ['servicios'],
    fr: ['services'],
    hi: ['सेवाओं'],
    id: ['layanan'],
    it: ['servizi'],
    ja: ['サービス'],
    ko: ['서비스'],
    nl: ['diensten'],
    pl: ['usług', 'serwisów'],
    pt: ['serviços', 'servicos'],
    ru: ['сервисов', 'услуг'],
    tr: ['servis', 'hizmet'],
    ua: ['сервісів', 'послуг'],
    zh: ['服务'],
    'zh-TW': ['服務'],
  },
  tickets: {
    da: ['sager'],
    de: ['tickets', 'vorgänge'],
    es: ['tickets', 'incidencias'],
    fr: ['tickets'],
    id: ['tiket'],
    it: ['ticket'],
    ja: ['チケット', '問い合わせ'],
    ko: ['티켓'],
    nl: ['tickets'],
    pl: ['zgłoszeń'],
    pt: ['chamados', 'tickets'],
    ru: ['заявок', 'тикетов'],
    tr: ['talep', 'kayıt'],
    ua: ['звернень'],
    zh: ['工单'],
    'zh-TW': ['工單'],
  },
};

// ── Derived views ────────────────────────────────────────────────────

/**
 * Scripts whose words are not separated by spaces, so a trailing word-boundary
 * assertion can never hold: in "45名の社員" the character after the noun is
 * itself a letter. Nouns in these scripts are matched WITHOUT a trailing
 * boundary, which is safe because the omissions documented above keep the
 * ambiguous single-character counters out of the table.
 */
const UNSPACED_SCRIPT_RE = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}]/u;

/**
 * Whether a surface form belongs to a script that writes without word spaces.
 * @param {string} form
 * @returns {boolean}
 */
export function isUnspacedScript(form) {
  return UNSPACED_SCRIPT_RE.test(form);
}

/**
 * Flatten METRIC_NOUN_FORMS into `{form -> canonical}`, longest form first so
 * an alternation built from it prefers "年間" over "年" and "個月" over "月".
 *
 * @returns {Map<string, string>} insertion-ordered by descending form length
 */
export function metricNounIndex() {
  /** @type {Array<[string, string]>} */
  const pairs = [];
  for (const [canonical, byLang] of Object.entries(METRIC_NOUN_FORMS)) {
    for (const forms of Object.values(byLang)) {
      for (const form of forms) pairs.push([form.toLowerCase(), canonical]);
    }
  }
  // Deduplicate on the form. A form shared by two languages (fr/pt "clients",
  // de/nl "teams") is the same concept in both, so first-wins is stable; a form
  // that ever meant two different concepts would be a lexicon bug, and the
  // self-test in verify-cv-facts.mjs asserts every canonical is a real English
  // metric noun.
  pairs.sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));
  const index = new Map();
  for (const [form, canonical] of pairs) if (!index.has(form)) index.set(form, canonical);
  return index;
}

/**
 * Normalize a language tag to a key in these tables: case-folded, `_` to `-`,
 * and falling back to the primary subtag ("de-AT" -> "de", "zh-Hant-TW" -> the
 * exact "zh-TW" when present, else "zh").
 *
 * @param {string|null|undefined} tag
 * @returns {string|null} a supported code, or null when unrecognized
 */
export function normalizeLanguageTag(tag) {
  if (typeof tag !== 'string') return null;
  const cleaned = tag.trim().replace(/_/g, '-');
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();
  const exact = SUPPORTED_LANGUAGES.find((code) => code.toLowerCase() === lower);
  if (exact) return exact;
  // Traditional-Chinese subtags that are not literally "zh-TW".
  if (/^zh\b/.test(lower) && /\b(hant|tw|hk|mo)\b/.test(lower)) return 'zh-TW';
  const primary = lower.split('-')[0];
  // The repo's Ukrainian directory is `ua`; the BCP-47 tag is `uk`.
  if (primary === 'uk') return 'ua';
  return SUPPORTED_LANGUAGES.find((code) => code.toLowerCase() === primary) ?? null;
}

/**
 * Read the document language from an HTML `<html lang="…">` attribute.
 * build-cv-html.mjs always emits one (from the payload's `lang` field), so this
 * is the primary signal for anything the tool generated itself.
 *
 * @param {string} html
 * @returns {string|null} a supported code, or null
 */
export function languageFromHtml(html) {
  const m = String(html ?? '').match(/<html\b[^>]*\blang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return m ? normalizeLanguageTag(m[1] ?? m[2] ?? m[3]) : null;
}

/**
 * Section-heading patterns for a set of languages, as a flat list of RegExp.
 *
 * @param {string} concept one of the SECTION_HEADINGS keys
 * @param {string[]} languages
 * @returns {RegExp[]}
 */
export function headingPatterns(concept, languages) {
  const table = SECTION_HEADINGS[concept] || {};
  const out = [];
  for (const lang of languages) {
    for (const stem of table[lang] || []) {
      out.push(new RegExp(stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }
  }
  return out;
}
