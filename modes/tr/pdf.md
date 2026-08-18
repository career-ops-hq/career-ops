# Mod: pdf — ATS Optimize Edilmiş PDF Üretimi

## Tam Ardışık Düzen (Full pipeline)

1. `cv.md` dosyasını tek gerçek kaynak (source of truth) olarak oku.
2. Eğer JD (İş Tanımı) bağlamda (metin veya URL olarak) yoksa, kullanıcıdan JD'yi iste.
3. JD içerisinden 15-20 anahtar kelime çıkar.
4. JD dilini tespit et → CV dilini ayarla (varsayılan EN).
5. Şirket lokasyonunu tespit et → kağıt boyutu (paper format):
   - ABD/Kanada → `letter`
   - Dünyanın geri kalanı → `a4`
6. Rol arketipini (archetype) tespit et → çerçevelemeyi (framing) uyarla.
7. JD'yi kullanarak `modes/heuristics/recruiter-side.md` üzerinden şirket içi (internal) işe alımcıya (recruiter) yönelik bir risk haritası oluştur: olası şüpheler, eşleşen kanıtlar ve hangi doküman bölümünün hangi şüpheyi gidereceği.
8. Profesyonel Özeti (Professional Summary) JD anahtar kelimeleri + çıkış anlatısı köprüsü ("Built and sold a business. Now applying systems thinking to [JD domain].") enjekte ederek yeniden yaz.
9. İş için en alakalı ilk 3-4 projeyi seç.
10. Deneyim (experience) maddelerini JD ilgisine ve risk haritasına göre yeniden sırala: en güçlü eşleşme kanıtı en başa.
11. JD gereksinimlerinden yetkinlik ızgarasını (competency grid) oluştur (6-8 anahtar kelime öbeği).
12. Anahtar kelimeleri mevcut başarılara doğal bir şekilde enjekte et (ASLA yeni bir şey uydurma).
13. `modes/heuristics/recruiter-side.md` içerisindeki altı saniyelik netlik kuralını (six-second clarity gate) uygula: üstteki üçte birlik kısım; hedef rolü, en güçlü uyumu ve kanıtı apaçık belli etmelidir.
14. Şablon (template) + kişiselleştirilmiş içerik kullanarak tam HTML oluştur.
15. `config/profile.yml` dosyasından `name` değerini oku → bunu kebab-case küçük harfe çevir (örn. "John Doe" → "john-doe") → `{candidate}`
16. HTML'i `output/cv-{candidate}-{company}.html` dosyasına yaz (geçici - temp - bir dizine DEĞİL — kaydedilen HTML, kontrol panelindeki `D` kısayol tuşunun yeniden oluşturma yaparken kullandığı asıl kaynaktır; bu nedenle geçici dizin temizliğinden sağ çıkmalıdır).
17. Yürüt (Execute): `node generate-pdf.mjs output/cv-{candidate}-{company}.html output/cv-{candidate}-{company}-{YYYY-MM-DD}.pdf --format={letter|a4} --report={report number}` — buradaki `{report number}`, takipçi (tracker) tablosundaki `#` sütunu DEĞİL, rapor dosya adı/bağlantısındaki NNN'dir (örn. `reports/008-acme-….md` için `008`). Başvurunun bir raporu varsa (veya olacaksa) bunu aktar; kontrol panelinin doğrudan aynı PDF'i açıp yeniden oluşturabilmesi için PDF↔rapor bağlantısını `data/pdf-index.tsv` içine kaydeder. Yalnızca takipçi girişi olmayan tek seferlik (one-off) CV'ler için bu argümanı dahil etme.
18. Report: PDF dosya yolu, sayfa sayısı, anahtar kelime kapsama (coverage) yüzdesi.

## ATS Kuralları (temiz ayrıştırma)

- Tek sütunlu (single-column) düzen (kenar çubuğu yok, paralel sütun yok)
- Standart başlıklar: "Professional Summary", "Work Experience", "Education", "Skills", "Certifications", "Projects"
- Resim/SVG içinde metin (text) yok
- PDF üst bilgi/alt bilgi (header/footer) kısımlarında kritik bilgi yok (ATS bunları yoksayar)
- UTF-8, seçilebilir metin (rasterize edilmiş resim değil)
- İç içe geçmiş tablo (nested tables) yok
- JD anahtar kelimeleri dağıtılmış olmalı: Özet (ilk 5), her rolün ilk maddesi, Yetenekler (Skills) bölümü
- Gizli metin (hidden text), anahtar kelime doldurma (keyword stuffing) veya beyaz yazı tipi (white-font) hileleri yok. Ayrıştırılabilirlik (parseability) artı insan incelemesi (human review) için optimize et.

## İşe Alım Uzmanı İnceleme Kapıları (Recruiter Review Gates)

- Özet bölümü (summary) şu soruyu yanıtlamalıdır: "Bu kişi hangi rolü hedefliyor ve neden bu rolü?"
- İlk ekran, JD'nin en yüksek riskli gereksinimleriyle eşleşen 1-2 kanıt noktasını (proof points) göstermelidir.
- Madde işaretleri (bullets) görev geçmişinden ziyade sonuçları (outcomes), sistemleri, kullanıcıları veya iş etkilerini (business effects) vurgulamalıdır.
- Konum (location), çalışma izni (work authorization), maaş (salary) ve uygunluk (availability) gibi lojistik konular, yalnızca pazar ve profil için uygun olduğunda CV'de yer almalıdır; aksi takdirde bunları form cevaplarında veya işe alımcı konuşma metinlerinde (recruiter scripts) ele alın.

## PDF Tasarımı

- **Fonts**: Space Grotesk (headings, 600-700) + DM Sans (body, 400-500)
- **Fonts self-hosted**: `fonts/`
- **Header**: Space Grotesk 24px bold isim + gradient çizgi `linear-gradient(to right, hsl(187,74%,32%), hsl(270,70%,45%))` 2px + iletişim satırı (contact row)
- **Section headers**: Space Grotesk 13px, uppercase, letter-spacing 0.05em, color cyan primary
- **Body**: DM Sans 11px, line-height 1.5
- **Company names**: accent purple color `hsl(270,70%,45%)`
- **Margins**: 0.6in
- **Background**: pure white

## Bölüm sırası (optimize edilmiş "6 saniyelik İK taraması")

1. Header (büyük isim, gradient, iletişim, portfolyo bağlantısı)
2. Professional Summary (3-4 satır, yoğun anahtar kelime içeren)
3. Core Competencies (esnek ızgarada - flex-grid - 6-8 anahtar kelime öbeği)
4. Work Experience (ters kronolojik)
5. Projects (en alakalı ilk 3-4 proje)
6. Education & Certifications
7. Skills (diller + teknik yetenekler)

## Anahtar kelime ekleme stratejisi (etik, gerçeğe dayalı)

Meşru (legitimate) yeniden formüle etme örnekleri:
- JD "RAG pipelines" istiyor ve CV "LLM workflows with retrieval" diyorsa → bunu "RAG pipeline design and LLM orchestration workflows" olarak değiştir.
- JD "MLOps" istiyor ve CV "observability, evals, error handling" diyorsa → bunu "MLOps and observability: evals, error handling, cost monitoring" olarak değiştir.
- JD "stakeholder management" istiyor ve CV "collaborated with team" diyorsa → bunu "stakeholder management across engineering, operations, and business" olarak değiştir.

**ASLA adayın sahip olmadığı yetenekleri (skills) ekleme. Yalnızca JD'nin tam sözcük dağarcığını kullanarak gerçek deneyimi yeniden kelimelere dök (reword).**

## Şablon HTML (Template HTML)

`cv-template.html` içerisindeki şablonu (template) kullan. `{{...}}` yer tutucularını (placeholders) kişiselleştirilmiş içerikle değiştir:

| Placeholder | Content |
|-------------|-----------|
| `{{LANG}}` | CV dil kodu (örn. `en`, `es`, `ja`, `ar`). Şablondaki dile özgü CSS'i tetikler: `ja`, Japonca karakterlerin tofu (□) yerine doğru oluşturulması için bir CJK font (yazı tipi) yedeğini (fallback) etkinleştirir; `ar`, RTL (sağdan sola) ve Arapça yazı tiplerini etkinleştirir. CV diliyle eşleşen BCP-47/ISO-639 kodunu kullan. |
| `{{PAGE_WIDTH}}` | `8.5in` (letter) veya `210mm` (a4) |
| `{{PHOTO}}` | İsteğe bağlı (opt-in) profil fotoğrafı (#264). `profile.yml` dosyasında boş olmayan bir `candidate.photo` ayarı varsa, burayı `<img class="cv-photo" src="<path-or-data-URL>" alt="{{NAME}}">` ile değiştir; aksi takdirde **tüm `{{PHOTO}}` satırını kaldır**, böylece hiçbir biçimlendirme (markup) (ve `<img>`) oluşturulmaz. DACH/Avrupa pazarları için isteğe bağlıdır — fotoğrafın olmadığı durum (absent photo), fotoğrafsız düzenle (US/UK ve birçok pazar ATS'si fotoğrafları cezalandırır) piksel-piksel tamamen aynı görünür. |
| `{{NAME}}` | (profile.yml'den) |
| `{{PHONE}}` | (profile.yml'den — ayırıcı (separator) işaretiyle birlikte yalnızca `profile.yml` dosyasında boş olmayan bir `phone` değeri olduğunda dahil et; aksi takdirde hem `<a href="tel:…">` elementini hem de onu takip eden `<span class="separator">` etiketini kaldır) |
| `{{EMAIL}}` | (profile.yml'den) |
| `{{LINKEDIN_URL}}` | [profile.yml'den] |
| `{{LINKEDIN_DISPLAY}}` | [profile.yml'den] |
| `{{PORTFOLIO_URL}}` | [profile.yml'den] (veya dile bağlı olarak /es vb.) |
| `{{PORTFOLIO_DISPLAY}}` | [profile.yml'den] (veya dile bağlı olarak /es vb.) |
| `{{LOCATION}}` | [profile.yml'den] |
| `{{SECTION_SUMMARY}}` | Professional Summary |
| `{{SUMMARY_TEXT}}` | Anahtar kelimeler eklenmiş kişiselleştirilmiş özet |
| `{{SECTION_COMPETENCIES}}` | Core Competencies |
| `{{COMPETENCIES}}` | `<span class="competency-tag">keyword</span>` × 6-8 |
| `{{SECTION_EXPERIENCE}}` | Work Experience |
| `{{EXPERIENCE}}` | Yeniden sıralanmış maddelerle (bullets) her iş için HTML |
| `{{SECTION_PROJECTS}}` | Projects |
| `{{PROJECTS}}` | İlk 3-4 proje için HTML |
| `{{SECTION_EDUCATION}}` | Education |
| `{{EDUCATION}}` | Eğitim (Education) HTML'i |
| `{{SECTION_CERTIFICATIONS}}` | Certifications |
| `{{CERTIFICATIONS}}` | Sertifikalar (Certifications) HTML'i |
| `{{SECTION_SKILLS}}` | Skills |
| `{{SKILLS}}` | Yetenekler (Skills) HTML'i |

### Profil fotoğrafı (isteğe bağlı, pazara özel)

`{{PHOTO}}` yuvası (slot) **varsayılan olarak kapalıdır** ve kasıtlı olarak pazara özgüdür:

- **DACH / Avrupa kıtasının büyük bölümü** (Almanya, Avusturya, İsviçre): Profesyonel bir fotoğraf standarttır ve genellikle beklenir. `config/profile.yml` içindeki `candidate.photo` ayarını doldurarak katılın (yerel bir dosya yolu veya `data:` URL'si).
- **ABD / İngiltere / Kanada / Avustralya ve pek çok ATS odaklı pazar**: Fotoğraf kullanılması tavsiye edilmez ve ön yargı (bias) engelleme filtrelerine takılabilir. `candidate.photo` ayarını boş bırakın — `{{PHOTO}}` satırı tamamen düşürülür, hiçbir `<img>` etiketi basılmaz ve CV, bugünkü fotoğrafsız düzenle (layout) **piksel-piksel tamamen aynı** (pixel-for-pixel identical) şekilde oluşturulur.

Ayarlandığında, fotoğraf üst köşeye doğru kayar (RTL/Arapça için yansıtılır) ve başlık/özet metni onun etrafına sarılır; `cv-template.html` içindeki `.cv-photo` boyutu ve çerçevelemeyi (framing) kontrol eder.

## Canva CV Üretimi (isteğe bağlı)

Eğer `config/profile.yml` içerisinde `cv.canva_resume_design_id` ayarlanmışsa, oluşturmadan önce kullanıcıya şu seçenekleri sun:
- **"HTML/PDF (fast, ATS-optimized)"** — yukarıdaki mevcut iş akışı
- **"Canva CV (visual, design-preserving)"** — aşağıdaki yeni iş akışı

Kullanıcının bir `cv.canva_resume_design_id` değeri yoksa, bu istemi (prompt) atla ve doğrudan HTML/PDF iş akışını (flow) kullan.

### Canva iş akışı (workflow)

#### Adım 1 — Temel tasarımı çoğalt

a. Temel tasarımı (`cv.canva_resume_design_id` kullanarak) PDF olarak `export-design` et → indirme (download) URL'sini al
b. O indirme URL'sini kullanarak `import-design-from-url` yap → düzenlenebilir yeni bir tasarım (kopya - duplicate) oluşturur
c. Kopya için yeni `design_id` değerini not et

#### Adım 2 — Tasarım yapısını oku

a. Yeni tasarım üzerinde `get-design-content` çalıştır → tüm metin öğelerini (text elements / richtexts) içerikleriyle birlikte döndürür
b. İçerik eşleştirmesi (content matching) yaparak metin öğelerini CV bölümleriyle eşle:
   - Adayın adını ara → başlık (header) bölümü
   - "Summary" veya "Professional Summary" ara → özet (summary) bölümü
   - cv.md dosyasındaki şirket isimlerini ara → deneyim (experience) bölümleri
   - Derece/okul (degree/school) isimlerini ara → eğitim (education) bölümü
   - Yetenek anahtar kelimelerini (skill keywords) ara → yetenekler (skills) bölümü
c. Eşleştirme başarısız olursa, kullanıcıya ne bulunduğunu göster ve rehberlik etmesini iste

#### Adım 3 — Özelleştirilmiş içerik üret

HTML iş akışıyla (yukarıdaki Adım 1-11) tamamen aynı içerik üretim (generation) süreci:
- Profesyonel Özeti (Professional Summary) JD anahtar kelimeleri + çıkış anlatısıyla yeniden yaz
- Deneyim maddelerini JD ilgisine (relevance) göre yeniden sırala
- JD gereksinimlerinden (requirements) en iyi yetkinlikleri seç
- Anahtar kelimeleri doğal bir şekilde enjekte et (ASLA yeni bir şey uydurma)

**ÖNEMLİ — Karakter bütçesi (Character budget) kuralı:** Her yeni yedek (replacement) metin, yerine geçtiği orijinal metinle YAKLAŞIK OLARAK aynı uzunlukta (karakter sayısı açısından ±%15 sapma payıyla) OLMALIDIR. Uyarlanmış (tailored) içerik daha uzunsa, bunu kısalt (condense). Canva tasarımı sabit boyutlu (fixed-size) metin kutularına sahiptir — daha uzun bir metin, komşu öğelerle (adjacent elements) üst üste binmesine (overlapping) neden olur. 2. Adımdaki her orijinal öğenin karakterlerini say ve yeni alternatifleri üretirken bu bütçe kuralını sıkıca uygula.

#### Adım 4 — Düzenlemeleri uygula

a. Kopya tasarım (duplicate design) üzerinde `start-editing-transaction` başlat
b. Her bölüm için `find_and_replace_text` kullanarak `perform-editing-operations` komutunu çalıştır:
   - Özet metnini uyarlanmış (tailored) özetle değiştir
   - Her deneyim maddesini (experience bullet) yeniden sıralanmış/yeniden yazılmış olanlarla değiştir
   - Yetkinlik/Yetenekler metnini JD uyumlu (JD-matched) terimlerle değiştir
   - Proje açıklamalarını en alakalı projelerle değiştir
c. **Metin değişiminden sonra düzeni (layout) yeniden akıt (Reflow):**
   Tüm metin değişiklikleri uygulandıktan sonra metin kutuları otomatik olarak yeniden boyutlanır, ancak komşu öğeler oldukları yerde kalır. Bu durum, iş deneyimi bölümleri arasında eşitsiz (uneven) boşluklar oluşmasına neden olur. Bunu düzelt:
   1. Güncellenmiş öğe pozisyonlarını ve boyutlarını `perform-editing-operations` yanıtından (response) oku
   2. Her iş deneyimi bölümü için (yukarıdan aşağıya), maddeler (bullets) metin kutusunun nerede bittiğini hesapla: `end_y = top + height`
   3. Bir sonraki bölümün başlığı `end_y + consistent_gap` noktasından başlamalıdır (şablondaki orijinal boşluğu, tipik olarak ~30px, kullan)
   4. Eşit boşluğu (even spacing) korumak amacıyla sonraki bölümün tarihini, şirket adını, rol başlığını ve madde öğelerini taşımak için `position_element` kullan
   5. Tüm iş deneyimi bölümleri için bunu tekrar et
d. **Kaydetmeden (commit) önce düzeni (layout) doğrula:**
   - transaction_id ve page_index=1 kullanarak `get-design-thumbnail` al
   - Oluşturulan küçük resmi (thumbnail) şunlar için gözle (visually) incele: üst üste binen metin (text overlapping), eşitsiz boşluk (uneven spacing), kesilmiş metin (text cut off), çok küçük metin (text too small)
   - Eğer sorun devam ediyorsa, `position_element`, `resize_element` veya `format_text` ile ayarla (adjust)
   - Düzen tertemiz (clean) olana kadar bunu tekrarla
e. Kullanıcıya son önizlemeyi (final preview) göster ve onay (approval) iste
f. Kaydetmek için `commit-editing-transaction` yap (YALNIZCA kullanıcı onayından sonra)

#### Adım 5 — Dışa aktar ve PDF'i indir

a. Kopya tasarımı PDF olarak `export-design` yap (format: JD konumuna göre a4 veya letter)
b. Bash kullanarak PDF'i **DERHAL** indir (download):
   ```bash
   curl -sL -o "output/cv-{candidate}-{company}-canva-{YYYY-MM-DD}.pdf" "{download_url}"
   ```
   Dışa aktarma (export) URL'si, yaklaşık 2 saat içinde süresi dolan, önceden imzalanmış (pre-signed) bir S3 bağlantısıdır. Bekletmeden hemen indir.
c. İndirmeyi doğrula:
   ```bash
   file output/cv-{candidate}-{company}-canva-{YYYY-MM-DD}.pdf
   ```
   Dönüş değeri "PDF document" olmalıdır. Eğer XML veya HTML gösteriyorsa URL'nin süresi dolmuştur — yeniden `export-design` yap ve tekrar dene.
d. Report: PDF dosya yolu, dosya boyutu, Canva tasarım URL'si (manuel ince ayarlar (tweaking) için)

#### Hata yönetimi (Error handling)

- `import-design-from-url` başarısız olursa → hata mesajıyla HTML/PDF ardışık düzenine (pipeline) geri dön
- Metin öğeleri eşleştirilemezse → kullanıcıyı uyar, neyin bulunduğunu göster, manuel eşleştirme yapmasını iste
- `find_and_replace_text` hiçbir eşleşme bulamazsa → daha geniş alt dize (substring) eşleştirmesini dene
- Otomatik düzenleme başarısız olursa kullanıcının manuel olarak düzenleyebilmesi için daima Canva tasarım URL'sini sun

## Ön Yazı Alt Akışı (Cover Letter Sub-flow)

CV PDF'sini ürettikten sonra, kullanıcıya bir ön yazı (cover letter) oluşturmayı teklif et:

```text
CV PDF oluşturuldu: output/{path}

Bu rol için bir ön yazı (cover letter) da ister misiniz?
- Hemen bir tane oluşturmak için "yes" (evet) veya "cover letter" (ön yazı) deyin
- Ya da daha sonra `/career-ops cover {slug}` çalıştırın
```

Ön yazıya `voice-dna.md` (eğer varsa) uygula — tam bariyer koruması (guardrail) ve sohbete dayalı (conversational) ses (Seviye 1 + Seviye 2) dahildir. CV PDF'sinin kendisi yalnızca Seviye 1 (formal ATS dili - register) kalır. Bkz. `_writing.md` → Voice DNA.

Kullanıcı "evet" derse, slug modunda `modes/cover.md` dosyasından tam ön yazı akışını çalıştır:
1. Başlangıç noktası olarak değerlendirme raporundan mevcut `## Cover Letter Draft` bölümünü yükle (Load)
2. Şirket araştırmasını çalıştır (cover.md Adım 3)
3. Onay (confirmation) için anahtar kelime (keyword) listesi sun (Adım 4)
4. Varsa her türlü eksiği/boşluğu (gap) ortaya çıkar (Adım 5)
5. Dört temel soruyu sor: neden (why) / sorunlar (problems) / yaklaşım (approach) / üslup (tone) (Adım 6)
6. Sohbette (chat) taslağı çıkar, onay bekle (Adım 7-8)
7. `node generate-cover-letter.mjs` üzerinden ön yazı PDF'i üret (Adım 9)
8. Her iki PDF dosya yolunu (path) da rapora (Report) dahil et

Yukarıdaki etkileşimli adımlardan geçmeden ön yazı PDF'ini otomatik (auto-generate) OLUŞTURMA.

## Üretim Sonrası (Post-generation)

Eğer iş (job) zaten kayıtlıysa takipçiyi (tracker) güncelle: PDF sütununu ❌ değerinden ✅ değerine değiştir.
