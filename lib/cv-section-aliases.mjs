// lib/cv-section-aliases.mjs — the section-title table: every heading spelling
// the CV tooling reads as a canonical section (experience, skills, education…).
//
// generate-pdf.mjs reads it to order and select a rendered CV's sections
// (sectionKey(), cv.sections). The cv.md checks read it too:
// lib/cv-markdown.mjs's isExperienceHeading() (cv-title-check.mjs,
// verify-cv-structure.mjs, doctor.mjs) and jd-skill-gap.mjs's skills headings.
// It lived inside generate-pdf.mjs, so each of those kept its own copy of the
// names, and each copy fell behind as languages were added here: a cv.md whose
// Experience section is "## Berufserfahrung" rendered as Experience while the
// checks found no Experience section. One table, read by all of them, keeps
// a title the PDF build understands from going unread by the checks.
//
// No imports and no side effects, so a script or a test sandbox can load it
// without generate-pdf.mjs's own dependencies.

/**
 * Strip diacritics so a heading is recognized regardless of how it was typed.
 *
 * Rendered Polish headings are not always spelled with their diacritics —
 * "Wykształcenie" and "Wyksztalcenie" both occur in already-generated CVs.
 * NFD splits most Polish letters into a base plus a combining mark we drop;
 * ł (U+0142) has no canonical decomposition, so it needs its own pass.
 *
 * Only used for alias lookup — display titles keep their diacritics.
 */
export function foldDiacritics(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l');
}

/**
 * Heading spelling -> canonical section key.
 *
 * Polish (modes/pl) and Chinese (modes/zh-TW, modes/zh) are here because without
 * these aliases the rendered non-English titles match nothing derived from the
 * English cv.md: validateCvSectionOrder() finds fewer than two comparable
 * sections and silently returns, leaving the section-order guard disabled on
 * every CV rendered in those modes, and cv.sections resolves no block at all.
 *
 * Keys are folded on construction so authored diacritics match stripped input.
 * Exported, with foldDiacritics(), for tests/section-aliases-unique.test.mjs,
 * which checks that no two entries fold to the same key.
 */
export const SECTION_ALIAS_ENTRIES = [
  // Japanese (modes/ja) and Korean (modes/ko) — the same failure as the blocks
  // below: no title in either resolved here, so cv.sections matched no section of
  // such a CV and the order guard compared raw titles. The skills and
  // career-history terms are the ones in the two READMEs (スキル, 職務経歴; 역량,
  // 기술 역량, 경력); the rest are each section's everyday headings. Japanese kanji
  // differ from the Chinese block's code points (学歴 is not 學歷), so nothing
  // here collides with it.
  ['職務要約', 'summary'],
  ['要約', 'summary'],
  ['プロフィール', 'summary'],
  ['自己紹介', 'summary'],
  ['自己pr', 'summary'],
  ['コアスキル', 'competencies'],
  ['主要スキル', 'competencies'],
  ['職務経歴', 'experience'],
  ['職歴', 'experience'],
  ['経歴', 'experience'],
  ['職務経験', 'experience'],
  ['プロジェクト', 'projects'],
  ['主なプロジェクト', 'projects'],
  ['プロジェクト経験', 'projects'],
  ['学歴', 'education'],
  ['資格', 'certifications'],
  ['保有資格', 'certifications'],
  ['資格・免許', 'certifications'],
  ['免許・資格', 'certifications'],
  ['受賞歴', 'awards'],
  ['受賞', 'awards'],
  ['スキル', 'skills'],
  ['技術スキル', 'skills'],
  ['テクニカルスキル', 'skills'],
  ['活かせる経験・知識・技術', 'skills'],
  ['趣味', 'interests'],
  ['興味・関心', 'interests'],
  ['요약', 'summary'],
  ['자기소개', 'summary'],
  ['프로필', 'summary'],
  ['경력 요약', 'summary'],
  ['핵심 역량', 'competencies'],
  ['핵심역량', 'competencies'],
  ['경력', 'experience'],
  ['경력 사항', 'experience'],
  ['경력사항', 'experience'],
  ['업무 경력', 'experience'],
  ['프로젝트', 'projects'],
  ['주요 프로젝트', 'projects'],
  ['프로젝트 경험', 'projects'],
  ['학력', 'education'],
  ['학력 사항', 'education'],
  ['학력사항', 'education'],
  ['자격증', 'certifications'],
  ['자격 사항', 'certifications'],
  ['자격사항', 'certifications'],
  ['수상', 'awards'],
  ['수상 경력', 'awards'],
  ['수상 내역', 'awards'],
  ['역량', 'skills'],
  ['기술 역량', 'skills'],
  ['보유 기술', 'skills'],
  ['기술 스택', 'skills'],
  ['관심사', 'interests'],
  ['취미', 'interests'],
  // English — cv.md is the source of truth and is written in English.
  ['summary', 'summary'],
  ['professional summary', 'summary'],
  ['competencies', 'competencies'],
  ['core competencies', 'competencies'],
  ['experience', 'experience'],
  ['work experience', 'experience'],
  ['professional experience', 'experience'],
  ['projects', 'projects'],
  ['selected projects', 'projects'],
  ['personal projects', 'projects'],
  ['education', 'education'],
  ['education & certifications', 'education'],
  ['certifications', 'certifications'],
  ['awards', 'awards'],
  ['honors', 'awards'],
  ['honours', 'awards'],
  ['awards & honors', 'awards'],
  ['awards and honors', 'awards'],
  ['honors & awards', 'awards'],
  ['awards & honours', 'awards'],
  ['skills', 'skills'],
  ['technical skills', 'skills'],
  ['interests', 'interests'],
  // German (modes/de, modes/at) — the same failure as the blocks below: no
  // German title resolved here, so cv.sections matched no section of a German
  // CV and the order guard compared raw titles. "Berufserfahrung" and
  // "Werdegang" are the career-history terms in modes/de/README.md; the rest are
  // each section's everyday headings. Umlauts fold through foldDiacritics.
  ['zusammenfassung', 'summary'],
  ['profil', 'summary'],
  ['kurzprofil', 'summary'],
  ['berufsprofil', 'summary'],
  ['berufliches profil', 'summary'],
  ['über mich', 'summary'],
  ['kernkompetenzen', 'competencies'],
  ['kompetenzen', 'competencies'],
  ['schlüsselkompetenzen', 'competencies'],
  ['berufserfahrung', 'experience'],
  ['berufliche erfahrung', 'experience'],
  ['beruflicher werdegang', 'experience'],
  ['werdegang', 'experience'],
  ['berufspraxis', 'experience'],
  ['projekte', 'projects'],
  ['ausgewählte projekte', 'projects'],
  ['projekterfahrung', 'projects'],
  ['ausbildung', 'education'],
  ['bildung', 'education'],
  ['bildungsweg', 'education'],
  ['akademischer werdegang', 'education'],
  ['studium', 'education'],
  ['zertifikate', 'certifications'],
  ['zertifizierungen', 'certifications'],
  ['weiterbildung', 'certifications'],
  ['weiterbildungen', 'certifications'],
  ['auszeichnungen', 'awards'],
  ['preise und auszeichnungen', 'awards'],
  ['kenntnisse', 'skills'],
  ['fähigkeiten', 'skills'],
  ['fachkenntnisse', 'skills'],
  ['technische kenntnisse', 'skills'],
  ['technische fähigkeiten', 'skills'],
  ['it-kenntnisse', 'skills'],
  ['interessen', 'interests'],
  ['hobbys', 'interests'],
  // Polish — the vocabulary documented in modes/pl/README.md, plus the word-order
  // variants that turn up in practice (both "Kompetencje kluczowe" and
  // "Kluczowe kompetencje" are used for the same section).
  ['podsumowanie', 'summary'],
  ['podsumowanie zawodowe', 'summary'],
  ['profil zawodowy', 'summary'],
  ['kompetencje', 'competencies'],
  ['kompetencje kluczowe', 'competencies'],
  ['kluczowe kompetencje', 'competencies'],
  ['doświadczenie', 'experience'],
  ['doświadczenie zawodowe', 'experience'],
  ['przebieg kariery', 'experience'],
  ['projekty', 'projects'],
  ['kluczowe projekty', 'projects'],
  ['wybrane projekty', 'projects'],
  ['wykształcenie', 'education'],
  ['edukacja', 'education'],
  ['wykształcenie i certyfikaty', 'education'],
  ['certyfikaty', 'certifications'],
  ['certyfikaty i szkolenia', 'certifications'],
  ['szkolenia i certyfikaty', 'certifications'],
  ['nagrody', 'awards'],
  ['wyróżnienia', 'awards'],
  ['nagrody i wyróżnienia', 'awards'],
  ['umiejętności', 'skills'],
  ['umiejętności techniczne', 'skills'],
  // French (modes/fr) — the same failure as the blocks around it: no French
  // title resolved here, so cv.sections matched no section of a French CV and
  // the order guard compared raw titles. A bare "Compétences" is the key-skills
  // block and "Compétences techniques" the skills list, as the Spanish and
  // Portuguese blocks read their own words. "Expérience" and "Éducation" fold
  // to the English keys and already resolve, so they are not repeated.
  ['résumé', 'summary'],
  ['résumé professionnel', 'summary'],
  // "Profil" is in the German block above.
  ['profil professionnel', 'summary'],
  ['à propos', 'summary'],
  ['à propos de moi', 'summary'],
  ['compétences', 'competencies'],
  ['compétences clés', 'competencies'],
  ['compétences principales', 'competencies'],
  ['expérience professionnelle', 'experience'],
  ['expériences professionnelles', 'experience'],
  ['parcours professionnel', 'experience'],
  ['projets', 'projects'],
  ['projets sélectionnés', 'projects'],
  ['projets personnels', 'projects'],
  ['formation', 'education'],
  ['formations', 'education'],
  ['études', 'education'],
  ['parcours académique', 'education'],
  ['diplômes', 'education'],
  ['certificats', 'certifications'],
  ['distinctions', 'awards'],
  ['prix', 'awards'],
  ['prix et distinctions', 'awards'],
  ['compétences techniques', 'skills'],
  ['connaissances techniques', 'skills'],
  ["centres d'intérêt", 'interests'],
  ["centres d'intérêts", 'interests'],
  // The same heading with the typographic apostrophe (U+2019), which word
  // processors and generated CVs write; foldDiacritics keeps it as is.
  ['centres d’intérêt', 'interests'],
  ['centres d’intérêts', 'interests'],
  ['intérêts', 'interests'],
  ['loisirs', 'interests'],
  // Hindi (modes/hi) — the same failure as the blocks around it: no Hindi title
  // resolved here, so cv.sections matched no section of a CV written in Hindi,
  // which modes/hi/README.md lists as a reason to use those modes, and the order
  // guard compared raw titles. "कौशल" and "करियर इतिहास" are the skills and
  // career-history terms in its glossary; the rest are each section's everyday
  // headings. Plurals are listed in both the anusvara spelling (दक्षताएं,
  // रुचियां) and the chandrabindu one (दक्षताएँ, रुचियाँ), and "प्रोफ़ाइल" with
  // and without the nukta: both are in common use, and foldDiacritics folds
  // neither onto the other.
  ['सारांश', 'summary'],
  ['पेशेवर सारांश', 'summary'],
  ['व्यावसायिक सारांश', 'summary'],
  ['करियर सारांश', 'summary'],
  ['प्रोफ़ाइल', 'summary'],
  ['प्रोफाइल', 'summary'],
  ['परिचय', 'summary'],
  ['मुख्य दक्षताएं', 'competencies'],
  ['मुख्य दक्षताएँ', 'competencies'],
  ['प्रमुख दक्षताएं', 'competencies'],
  ['प्रमुख दक्षताएँ', 'competencies'],
  ['दक्षताएं', 'competencies'],
  ['दक्षताएँ', 'competencies'],
  ['अनुभव', 'experience'],
  ['कार्य अनुभव', 'experience'],
  ['पेशेवर अनुभव', 'experience'],
  ['व्यावसायिक अनुभव', 'experience'],
  ['करियर इतिहास', 'experience'],
  ['परियोजनाएं', 'projects'],
  ['परियोजनाएँ', 'projects'],
  ['प्रमुख परियोजनाएं', 'projects'],
  ['प्रमुख परियोजनाएँ', 'projects'],
  ['प्रोजेक्ट्स', 'projects'],
  ['शिक्षा', 'education'],
  ['शैक्षिक योग्यता', 'education'],
  ['शैक्षणिक योग्यता', 'education'],
  ['शैक्षिक पृष्ठभूमि', 'education'],
  ['प्रमाणपत्र', 'certifications'],
  ['प्रमाण पत्र', 'certifications'],
  ['प्रमाणन', 'certifications'],
  ['पुरस्कार', 'awards'],
  ['सम्मान', 'awards'],
  ['पुरस्कार और सम्मान', 'awards'],
  ['पुरस्कार एवं सम्मान', 'awards'],
  ['कौशल', 'skills'],
  ['तकनीकी कौशल', 'skills'],
  ['स्किल्स', 'skills'],
  ['रुचियां', 'interests'],
  ['रुचियाँ', 'interests'],
  ['शौक', 'interests'],
  // Spanish — the same failure again: with no entries here, a Spanish CV
  // rendered in the documented modes/pdf.md order (Experiencia before Formación)
  // was rejected against a cv.md listing Formación first, and --allow-reorder was
  // the only way through. The vocabulary is what generated Spanish CVs render
  // (Perfil Profesional, Competencias Clave, Experiencia Profesional, Formación,
  // Certificaciones, Habilidades) plus each section's everyday synonyms. Keys are
  // folded through foldDiacritics below, so accented and unaccented spellings
  // both resolve.
  ['perfil', 'summary'],
  ['perfil profesional', 'summary'],
  ['resumen', 'summary'],
  ['resumen profesional', 'summary'],
  ['competencias', 'competencies'],
  ['competencias clave', 'competencies'],
  ['competencias principales', 'competencies'],
  ['experiencia', 'experience'],
  ['experiencia profesional', 'experience'],
  ['experiencia laboral', 'experience'],
  ['trayectoria profesional', 'experience'],
  ['proyectos', 'projects'],
  ['proyectos destacados', 'projects'],
  ['proyectos personales', 'projects'],
  ['proyectos y laboratorios', 'projects'],
  ['formación', 'education'],
  ['formación académica', 'education'],
  ['educación', 'education'],
  ['estudios', 'education'],
  ['certificaciones', 'certifications'],
  ['certificados', 'certifications'],
  ['premios', 'awards'],
  ['reconocimientos', 'awards'],
  ['premios y reconocimientos', 'awards'],
  ['habilidades', 'skills'],
  ['habilidades técnicas', 'skills'],
  ['conocimientos técnicos', 'skills'],
  ['herramientas e idiomas', 'skills'],
  ['intereses', 'interests'],
  // Turkish (modes/tr) — the same failure as the blocks around it: no Turkish
  // title resolved here, so cv.sections matched no section of a Turkish CV and
  // the order guard compared raw titles. "Beceriler" and "İş deneyimi" are the
  // skills and career-history terms in modes/tr/README.md; the rest are each
  // section's everyday headings. Lower-casing turns "İ" into "i" plus a dot that
  // foldDiacritics drops, so "İş" folds to "is"; the dotless "ı" stays as written.
  ['özet', 'summary'],
  // "Profil" is in the German block above.
  ['profesyonel özet', 'summary'],
  ['kariyer özeti', 'summary'],
  ['hakkımda', 'summary'],
  ['temel yetkinlikler', 'competencies'],
  ['yetkinlikler', 'competencies'],
  ['iş deneyimi', 'experience'],
  ['iş deneyimleri', 'experience'],
  ['deneyim', 'experience'],
  ['profesyonel deneyim', 'experience'],
  ['projeler', 'projects'],
  ['öne çıkan projeler', 'projects'],
  ['eğitim', 'education'],
  ['eğitim bilgileri', 'education'],
  ['sertifikalar', 'certifications'],
  ['ödüller', 'awards'],
  ['ödüller ve başarılar', 'awards'],
  ['beceriler', 'skills'],
  ['teknik beceriler', 'skills'],
  ['yetenekler', 'skills'],
  ['ilgi alanları', 'interests'],
  ['hobiler', 'interests'],
  // Vietnamese (modes/vi) — the same failure as the blocks around it: no
  // Vietnamese title resolved here, so cv.sections matched no section of a
  // Vietnamese CV and the order guard compared raw titles. "Kỹ năng" and "Lịch sử
  // nghề nghiệp" are the skills and career-history terms in modes/vi/README.md;
  // the rest are each section's everyday headings. foldDiacritics drops the tone
  // and vowel marks on both sides of the lookup; "đ" has no decomposition and
  // stays as written.
  ['tóm tắt', 'summary'],
  ['tóm tắt bản thân', 'summary'],
  ['giới thiệu bản thân', 'summary'],
  ['mục tiêu nghề nghiệp', 'summary'],
  ['năng lực cốt lõi', 'competencies'],
  ['năng lực chính', 'competencies'],
  ['kinh nghiệm làm việc', 'experience'],
  ['kinh nghiệm', 'experience'],
  ['lịch sử nghề nghiệp', 'experience'],
  ['quá trình làm việc', 'experience'],
  ['dự án', 'projects'],
  ['dự án tiêu biểu', 'projects'],
  ['dự án nổi bật', 'projects'],
  ['học vấn', 'education'],
  ['trình độ học vấn', 'education'],
  ['quá trình học tập', 'education'],
  ['chứng chỉ', 'certifications'],
  ['chứng nhận', 'certifications'],
  ['giải thưởng', 'awards'],
  ['danh hiệu', 'awards'],
  ['kỹ năng', 'skills'],
  ['kỹ năng chuyên môn', 'skills'],
  ['kỹ năng kỹ thuật', 'skills'],
  ['sở thích', 'interests'],
  // Italian (modes/it) — the same failure as the blocks around it: no Italian
  // title resolved here, so cv.sections matched no section of an Italian CV and
  // the order guard compared raw titles. A bare "Competenze" is the key-skills
  // block and "Competenze tecniche" the skills list, as the Spanish block reads
  // its own words.
  ['profilo', 'summary'],
  ['profilo professionale', 'summary'],
  ['sommario', 'summary'],
  ['riepilogo', 'summary'],
  ['chi sono', 'summary'],
  ['competenze', 'competencies'],
  ['competenze chiave', 'competencies'],
  ['competenze principali', 'competencies'],
  ['esperienza', 'experience'],
  ['esperienza professionale', 'experience'],
  ['esperienze professionali', 'experience'],
  ['esperienza lavorativa', 'experience'],
  ['esperienze lavorative', 'experience'],
  ['percorso professionale', 'experience'],
  ['progetti', 'projects'],
  ['progetti selezionati', 'projects'],
  ['progetti personali', 'projects'],
  ['formazione', 'education'],
  ['istruzione', 'education'],
  ['istruzione e formazione', 'education'],
  ['titoli di studio', 'education'],
  ['certificazioni', 'certifications'],
  ['certificati', 'certifications'],
  ['premi', 'awards'],
  ['riconoscimenti', 'awards'],
  ['premi e riconoscimenti', 'awards'],
  ['competenze tecniche', 'skills'],
  ['conoscenze tecniche', 'skills'],
  ['capacità tecniche', 'skills'],
  ['interessi', 'interests'],
  // Danish (modes/da) and Norwegian Bokmål (modes/nb) — the same failure as the
  // blocks around them: no title in either resolved here, so cv.sections matched
  // no section of such a CV and the order guard compared raw titles. The skills
  // and career-history terms are the ones in the two READMEs (Kompetencer,
  // Karriereforløb, Erhvervserfaring; Kompetanse, Arbeidserfaring, Yrkeserfaring);
  // the rest are each section's everyday headings, listed once where the two
  // languages share a spelling (Erfaring, Priser, Interesser).
  // "Profil" is in the German block and "Resumé" folds to the French "résumé", both above.
  ['sammenfatning', 'summary'],
  ['om mig', 'summary'],
  ['sammendrag', 'summary'],
  ['om meg', 'summary'],
  ['kernekompetencer', 'competencies'],
  ['kjernekompetanse', 'competencies'],
  ['erhvervserfaring', 'experience'],
  ['karriereforløb', 'experience'],
  ['arbejdserfaring', 'experience'],
  ['arbeidserfaring', 'experience'],
  ['yrkeserfaring', 'experience'],
  ['erfaring', 'experience'],
  ['projekter', 'projects'],
  ['prosjekter', 'projects'],
  ['uddannelse', 'education'],
  ['utdanning', 'education'],
  ['utdannelse', 'education'],
  ['certificeringer', 'certifications'],
  ['certifikater', 'certifications'],
  ['sertifiseringer', 'certifications'],
  ['sertifikater', 'certifications'],
  ['priser', 'awards'],
  ['udmærkelser', 'awards'],
  ['utmerkelser', 'awards'],
  ['kompetencer', 'skills'],
  ['kompetanse', 'skills'],
  ['færdigheder', 'skills'],
  ['tekniske færdigheder', 'skills'],
  ['ferdigheter', 'skills'],
  ['tekniske ferdigheter', 'skills'],
  ['interesser', 'interests'],
  ['fritidsinteresser', 'interests'],
  // Indonesian (modes/id) — the same failure as the blocks around it: no
  // Indonesian title resolved here, so cv.sections matched no section of an
  // Indonesian CV and the order guard compared raw titles. "Keahlian",
  // "Kompetensi" and "Riwayat karier" are the skills and career-history terms
  // in modes/id/README.md; the rest are each section's everyday headings.
  // "Profil" is already in the German block above.
  ['ringkasan', 'summary'],
  ['ringkasan profesional', 'summary'],
  ['tentang saya', 'summary'],
  ['kompetensi inti', 'competencies'],
  ['kompetensi utama', 'competencies'],
  ['pengalaman kerja', 'experience'],
  ['pengalaman', 'experience'],
  ['pengalaman profesional', 'experience'],
  ['riwayat karier', 'experience'],
  ['riwayat pekerjaan', 'experience'],
  ['proyek', 'projects'],
  ['proyek pilihan', 'projects'],
  ['pendidikan', 'education'],
  ['riwayat pendidikan', 'education'],
  ['sertifikasi', 'certifications'],
  ['sertifikat', 'certifications'],
  ['penghargaan', 'awards'],
  ['keahlian', 'skills'],
  ['kompetensi', 'skills'],
  ['keterampilan', 'skills'],
  ['keahlian teknis', 'skills'],
  ['keterampilan teknis', 'skills'],
  ['minat', 'interests'],
  ['hobi', 'interests'],
  // Chinese — the same failure the Polish block above fixes, for the two Chinese
  // markets this repo ships modes for: Traditional (modes/zh-TW) and Simplified
  // (modes/zh), rendered through templates/cv-template.zh-minimal.html. Both
  // scripts are listed against every key because a CV written in either renders
  // through this one alias table. The vocabulary is the repo's own: the
  // `sections` payload in tests/zh-minimal-template.test.mjs (个人简介, 核心能力,
  // 工作经历, 精选项目, 教育经历, 认证, 技术栈) and the modes' wording
  // (e.g. "專業摘要" in modes/zh-TW/oferta.md), plus the everyday synonyms of
  // each — the titles have no single canonical spelling because they come from
  // a user-supplied `sections` override, not from DEFAULT_SECTION_TITLES.
  ['專業摘要', 'summary'],
  ['专业摘要', 'summary'],
  ['摘要', 'summary'],
  ['個人簡介', 'summary'],
  ['个人简介', 'summary'],
  ['簡介', 'summary'],
  ['简介', 'summary'],
  ['核心能力', 'competencies'],
  ['核心競爭力', 'competencies'],
  ['核心竞争力', 'competencies'],
  ['工作經歷', 'experience'],
  ['工作经历', 'experience'],
  ['工作經驗', 'experience'],
  ['工作经验', 'experience'],
  ['專業經歷', 'experience'],
  ['专业经历', 'experience'],
  ['專案', 'projects'],
  ['项目', 'projects'],
  ['專案經驗', 'projects'],
  ['项目经验', 'projects'],
  ['專案經歷', 'projects'],
  ['项目经历', 'projects'],
  ['專案成就', 'projects'],
  ['项目成就', 'projects'],
  ['精選專案', 'projects'],
  ['精选项目', 'projects'],
  ['學歷', 'education'],
  ['学历', 'education'],
  ['教育背景', 'education'],
  ['教育經歷', 'education'],
  ['教育经历', 'education'],
  ['證照', 'certifications'],
  ['证照', 'certifications'],
  ['證書', 'certifications'],
  ['证书', 'certifications'],
  ['專業證照', 'certifications'],
  ['专业证书', 'certifications'],
  ['認證', 'certifications'],
  ['认证', 'certifications'],
  ['資格認證', 'certifications'],
  ['资格认证', 'certifications'],
  ['獲獎', 'awards'],
  ['获奖', 'awards'],
  ['獎項', 'awards'],
  ['奖项', 'awards'],
  ['榮譽', 'awards'],
  ['荣誉', 'awards'],
  ['技能', 'skills'],
  ['專長', 'skills'],
  ['专长', 'skills'],
  ['技術能力', 'skills'],
  ['技术能力', 'skills'],
  ['技術棧', 'skills'],
  ['技术栈', 'skills'],
  ['興趣', 'interests'],
  ['兴趣', 'interests'],
  // Arabic (modes/ar) — the same failure as the blocks around it: no Arabic
  // title resolved here, so cv.sections matched no section of an Arabic CV and
  // the order guard compared raw titles. "مهارات" and "التاريخ المهني" /
  // "الخبرات المهنية" are the skills and career-history terms in
  // modes/ar/README.md; the rest are each section's everyday headings, with and
  // without the definite article where both are common.
  ['ملخص', 'summary'],
  ['الملخص', 'summary'],
  ['ملخص مهني', 'summary'],
  ['نبذة', 'summary'],
  ['نبذة عني', 'summary'],
  ['الملف الشخصي', 'summary'],
  ['الكفاءات الأساسية', 'competencies'],
  ['الكفاءات', 'competencies'],
  ['الخبرات المهنية', 'experience'],
  ['الخبرة المهنية', 'experience'],
  ['الخبرة العملية', 'experience'],
  ['الخبرات العملية', 'experience'],
  ['التاريخ المهني', 'experience'],
  ['الخبرة', 'experience'],
  ['المشاريع', 'projects'],
  ['مشاريع', 'projects'],
  ['التعليم', 'education'],
  ['المؤهلات العلمية', 'education'],
  ['المؤهل العلمي', 'education'],
  ['الشهادات', 'certifications'],
  ['الشهادات المهنية', 'certifications'],
  ['الجوائز', 'awards'],
  ['الجوائز والتكريمات', 'awards'],
  ['المهارات', 'skills'],
  ['مهارات', 'skills'],
  ['المهارات التقنية', 'skills'],
  ['الاهتمامات', 'interests'],
  ['الهوايات', 'interests'],
  // Dutch (modes/nl) — the same failure as the blocks around it: no Dutch title
  // resolved here, so cv.sections matched no section of a Dutch CV and the
  // order guard compared raw titles. "Interesses" folds to the Portuguese key
  // below and already resolves, so it is not repeated.
  ['profiel', 'summary'],
  ['persoonlijk profiel', 'summary'],
  ['samenvatting', 'summary'],
  ['over mij', 'summary'],
  ['kerncompetenties', 'competencies'],
  ['competenties', 'competencies'],
  ['werkervaring', 'experience'],
  ['professionele ervaring', 'experience'],
  ['ervaring', 'experience'],
  ['loopbaan', 'experience'],
  ['projecten', 'projects'],
  ['geselecteerde projecten', 'projects'],
  ['opleiding', 'education'],
  ['opleidingen', 'education'],
  ['onderwijs', 'education'],
  ['certificaten', 'certifications'],
  ['certificeringen', 'certifications'],
  ['prijzen', 'awards'],
  ['onderscheidingen', 'awards'],
  ['vaardigheden', 'skills'],
  ['technische vaardigheden', 'skills'],
  ['kennis en vaardigheden', 'skills'],
  ["hobby's", 'interests'],
  // With the typographic apostrophe (U+2019), which foldDiacritics keeps.
  ['hobby’s', 'interests'],
  // Portuguese (pt-BR / pt-PT) — the same failure as Spanish above: modes/pt/
  // ships a Portuguese market set, but no Portuguese title resolved here, so
  // cv.sections matched no section of a Portuguese CV and the order guard fell
  // back to comparing raw titles. Titles that fold to a Spanish spelling
  // (competências, experiência, habilidades, perfil, certificados, prêmios)
  // already resolve through the Spanish block and are not repeated.
  ['resumo', 'summary'],
  ['resumo profissional', 'summary'],
  ['perfil profissional', 'summary'],
  ['sobre mim', 'summary'],
  ['competências principais', 'competencies'],
  ['competências-chave', 'competencies'],
  ['principais competências', 'competencies'],
  ['experiência profissional', 'experience'],
  ['experiências profissionais', 'experience'],
  ['histórico profissional', 'experience'],
  ['projetos', 'projects'],
  ['projetos pessoais', 'projects'],
  ['projetos selecionados', 'projects'],
  ['formação', 'education'],
  ['formação acadêmica', 'education'],
  // "Formação académica" (pt-PT) folds to the key above.
  ['educação', 'education'],
  ['escolaridade', 'education'],
  ['certificações', 'certifications'],
  ['cursos e certificações', 'certifications'],
  ['prêmios e reconhecimentos', 'awards'],
  ['competências técnicas', 'skills'],
  ['conhecimentos técnicos', 'skills'],
  ['interesses', 'interests'],
  // Russian (modes/ru) and Ukrainian (modes/ua) — the same failure as the blocks
  // above: no title in either resolved here, so cv.sections matched no section
  // of such a CV and the order guard compared raw titles. The skills and
  // career-history terms are the ones in the two READMEs (Навыки, Опыт работы;
  // Навички, Досвід роботи); the rest are each section's everyday headings.
  // foldDiacritics turns й into и and ї into і on both sides of the lookup.
  ['о себе', 'summary'],
  ['обо мне', 'summary'],
  ['профиль', 'summary'],
  ['про себе', 'summary'],
  ['профіль', 'summary'],
  ['ключевые навыки', 'competencies'],
  ['ключевые компетенции', 'competencies'],
  ['компетенции', 'competencies'],
  ['ключові навички', 'competencies'],
  ['ключові компетенції', 'competencies'],
  ['компетенції', 'competencies'],
  ['опыт работы', 'experience'],
  ['опыт', 'experience'],
  ['профессиональный опыт', 'experience'],
  ['досвід роботи', 'experience'],
  ['досвід', 'experience'],
  ['професійний досвід', 'experience'],
  ['проекты', 'projects'],
  ['проєкти', 'projects'],
  ['проекти', 'projects'],
  ['образование', 'education'],
  ['освіта', 'education'],
  ['сертификаты', 'certifications'],
  ['сертифікати', 'certifications'],
  ['награды', 'awards'],
  ['нагороди', 'awards'],
  ['навыки', 'skills'],
  ['технические навыки', 'skills'],
  ['навички', 'skills'],
  ['технічні навички', 'skills'],
  ['интересы', 'interests'],
  ['хобби', 'interests'],
  ['інтереси', 'interests'],
  ['хобі', 'interests'],
];
export const SECTION_ALIASES = new Map(SECTION_ALIAS_ENTRIES.map(([alias, key]) => [foldDiacritics(alias), key]));

/**
 * The canonical section key for a heading title, or null when the table has
 * no entry for it. Emphasis markers (`*`, `_`, backticks, `~`), case, runs of
 * whitespace and diacritics are ignored, the same folding generate-pdf.mjs's
 * sectionKey() applies, so `## *Kenntnisse*` is Skills here as it is in the
 * PDF build. The title must otherwise match an entry whole, so
 * "Doświadczenie projektowe" is not Experience.
 *
 * @param {string} title heading text
 * @returns {string|null}
 */
export function aliasSectionKey(title) {
  const folded = foldDiacritics(String(title ?? '').normalize('NFC').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim().toLowerCase());
  return SECTION_ALIASES.get(folded) ?? null;
}
