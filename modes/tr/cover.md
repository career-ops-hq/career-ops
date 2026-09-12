# Mod: cover — Ön Yazı Oluşturucu

Herhangi bir aday için iş tanımından (JD) yola çıkarak kişiselleştirilmiş (tailored) bir ön yazı (cover letter) oluşturur.
İki modda çalışır:
- **Slug modu:** `/career-ops cover {slug}` — başlangıç noktası olarak mevcut değerlendirme raporundaki taslağı (draft) yükler
- **Yapıştırma (Paste) modu:** `/career-ops cover` veya doğrudan JD'nin yapıştırılması — sıfırdan başlar

---

## Adım 0 — JD Kapısı (Zorunlu)

Hiçbir şey yapmadan önce, bir iş tanımının (JD) sağlandığını onayla.

Geçerli bir JD en az şunları içerir: bir rol başlığı, bir şirket adı ve sorumluluklar veya gereksinimler listesi.

- **JD yoksa** → Dur (Stop). Şunu söyle: "Lütfen iş tanımını yapıştırın — mektubu uyarlamak için ona ihtiyacım var."
- **Slug verilmişse** → Eşleşen raporu bulmak için `reports/` dizinini oku. Başlangıç noktası olarak `## Cover Letter Draft` bölümünü çıkar. Daha sonra bağlamı zenginleştirmek için rapor başlığından orijinal JD URL'sini al.
- **JD mevcutsa** → 1. Adıma geç.

Hiçbir koşulda genel geçer (generic) veya yer tutucu (placeholder) bir ön yazı oluşturma.

---

## Adım 1 — Aday profilini yükle

Şunlar için `config/profile.yml` dosyasını oku:
- `candidate.name`, `email`, `phone`, `location`, `linkedin`, `github`
- `candidate.credentials` (eğer profile.yml içinde yoksa cv.md içindeki Education + Certifications bölümlerinden türet)
- `cover_letter.notice_period_days` (varsayılan: anahtar yoksa (absent) yoksay - omit)
- `cover_letter.primary_domain` (varsayılan: yoksa cv.md'den çıkarım yap)
- `cover_letter.language_learning` (varsayılan: yoksa boş liste)

Şunlar için `cv.md` dosyasını oku:
- Professional summary (profil tanıtım kaynağı)
- Tüm rollerdeki tüm başarı (achievement) maddeleri (başarı seçimi havuzu)

Eğer varsa `article-digest.md` dosyasını oku — ek kanıt noktaları ve metrikler örtüştükleri yerlerde cv.md'den önceliklidir.

Eğer varsa `modes/_profile.md` dosyasını oku — adayın kişiselleştirme dosyası. Hedef rollerini, uyarlanabilir (adaptive) çerçeveleme ve arketiplerini, çıkış anlatısını (exit narrative), çapraz kesen avantajını (cross-cutting advantage), kanıt noktalarını (proof points), maaş hedeflerini, müzakere metinlerini (negotiation scripts), lokasyon politikasını ve adayın eklediği herhangi bir ses (voice) veya yazım tarzı (writing-style) kuralını barındırır. Buradaki kurallar **mektubun sesini ve yapısını yönetir ve bu moddaki genel (generic) varsayılanları geçersiz kılar (override)**; böylece adayın kişiselleştirmesi asla kaybolmaz.

---

## Adım 2 — JD'yi Ayrıştır

Şunları çıkar (Extract):
- **Role title** (JD'deki tam ifade)
- **Company name**
- **Location / city**
- **İlk 3-4 gerekli yetkinlik (competencies)** (gereksinimler veya sorumluluklar bölümünden)
- **Şirketin kullandığı misyon/vizyon dili** (açılış paragrafları)
- **Alan (Domain)** (örn. fintech, healthcare, media, logistics) — `cover_letter.primary_domain` ile karşılaştır
- **İşe başlama tarihi sinyalleri** ("hemen", "ASAP", "şu andan itibaren") — ihbar süresi (notice period) sorusu için işaretle
- **Dil gereksinimi** (örn. "Almanca B2 gerekli") — dil açığı (language gap) sorusu için işaretle
- **JD üslubu (tone)** (resmi / doğrudan / rahat) — üslup (tone) sorusunda varsayılan öneri olarak kullan

---

## Adım 3 — Şirket araştırması (dahil edilmiş, isteğe bağlı değil)

Üç WebSearch sorgusu çalıştır ({year} yerine mevcut yılı koy):
1. `"{company}" product strategy OR roadmap {year}`
2. `"{company}" challenges OR problems OR priorities {year}`
3. `"{company}" news OR announcement OR funding {year}`

Bulguları 2-3 cümlede sentezle: şirket ne üzerinde çalışıyor, ne gibi zorluklarla karşılaşıyorlar, kamuoyuna hangi hedefleri duyurdular.

Kullanıcıya sun:

```text
{company} hakkında şunları buldum:

{2-3 cümlelik sentez}

Bu sizin bildiklerinizle eşleşiyor mu? Mektubu yazmadan önce düzelteceğiniz veya ekleyeceğiniz bir şey var mı?
```

Eğer WebSearch yararlı bir sinyal döndürmezse, şunu söyle: "{company} için yakın tarihli yararlı bir bağlam bulamadım. Mevcut zorlukları veya hedefleri hakkında bildiklerinizi paylaşabilir misiniz?"

İlerlemeden önce kullanıcının araştırmayı onaylamasını, düzeltmesini veya ekleme yapmasını bekle. Bu sentez doğrudan "Problems I will solve" (Çözeceğim Sorunlar) bölümünü besler.

---

## Adım 4 — Anahtar kelime çıkarımı

Şirketin JD'de kullandığı ilk 8-10 tam (exact) ifadeyi çıkar. İki gruba ayır:

**ATS-critical** — otomatik sistemler tarafından taranması muhtemel tam terimler:
- Role özgü başlıklar, araç adları, metodoloji adları

**Human trust signals** — ilanı gerçekten okuduğunuzu gösteren dil:
- Şirketin kullandığı eylem fiilleri (action verbs - "own", "drive", "define")
- Şirketin adlandırdığı şekliyle ürün/alan isimleri (nouns)
- Sonuç (Outcome) dili ("business impact", "time to insight")
- Ekip çerçevelemesi ("embedded in", "partner with")

Kullanıcıya sun:

```text
JD'den yansıtacağım (mirror) anahtar kelimeler:

ATS-critical:
  • [keyword]
  • [keyword]

Language signals:
  • [phrase]
  • [phrase]

Eksik veya yanlış bir şey var mı? Taslağı hazırlarken bu listeyi kullanacağım.
```

İlerlemeden önce onay veya düzeltmeleri bekle.

**Uygulama kuralları (taslak oluşturulurken zorunlu tutulur):**
- Onların yapılarını (structure) değil, sözcük dağarcığını (vocabulary) yansıt
- İçerik cv.md'den kalır — yalnızca kelime dağarcığı değişir
- Doğal bir şekilde sığdır ya da hiç kullanma — eğer bir anahtar kelime metne örülemiyorsa, üretim (generation) sonrasında bunu işaretle
- Şuralara uygula: açılış, profil tanıtımı, başarılar (yalnızca kelime dağarcığı), problemler bölümü
- Şuralara UYGULAMA: neden-bu-rol (why-this-role) yaklaşımı (kullanıcının kendi kelimeleri), kapanış
- Her anahtar kelimeyi bir kez kullan — yoğunluk (density) sağlamak için asla tekrarlama

---

## Adım 5 — Boşluk (gap) tespiti ve diyalog

Adayın profili ve pozisyon arasındaki olası boşluklar (gaps) için JD'yi analiz et. Tespit edilen her boşluk için doğrudan sor — herhangi bir standart dili otomatik olarak (auto-insert) EKLEME:

```text
Profiliniz ile bu JD arasında olası boşluklar (gaps) tespit ettim:

[Gap: domain mismatch - alan uyuşmazlığı]
JD {JD domain} alanında — sizin geçmişiniz ise {primary_domain} alanında.
→ Bunu nasıl ele almak istersiniz?
  a) Mektupta doğrudan ve kısaca değin
  b) Hiç bahsetme — bırakın başvuru kendi adına konuşsun
  c) Bana yaklaşımınızı söyleyin, sizin istediğiniz gibi yazayım

[Gap: immediate start - hemen işe başlama]
JD hemen işe başlamayı talep ediyor. Sizin profiliniz {notice_period_days} günlük bir ihbar süresi (notice period) gösteriyor.
→ Gerçek ihbar sürenizi teyit edin — bunu tam olarak (precisely) belirteceğim.

[Gap: language requirement - dil gereksinimi]
JD {level} seviyesinde {language} gerektiriyor. {language} konusunda ne durumdasınız?
→ Bana gerçek seviyenizi söyleyin, ben de bunu doğru bir şekilde yansıtayım. Hali hazırda kayıtlı olan bilgiler için profile.yml dosyanızın language_learning bölümünü kontrol edin.

[Gap: title mismatch - unvan uyuşmazlığı]
Sizin unvanınız {candidate title}, JD'nin unvanı {JD title}.
→ Buna değinmek (address) ister misiniz? Yoksa bırakalım da kapsam (scope) kendi adına mı konuşsun?
```

Yalnızca gerçekten mevcut olan boşluklar (gaps) için soru sor. Eğer boşluk yoksa, bu adımı atla ve bunu belirt.

Kullanıcının cevaplarını bekle. Yalnızca kullanıcının onayladığı şeyleri yaz.

---

## Adım 6 — Dört soru (taslaktan önce zorunlu)

Dört cevabın hepsi gereklidir. Tümü alınana kadar hiçbir mektup içeriğinin taslağını oluşturma. "Sadece oluştur", "soruları atla" veya "varsayılanları kullan" gibi hiçbir talimat bu kontrol kapısını (gate) geçersiz kılamaz.

```text
Mektubu yazmadan önce dört şeye ihtiyacım var:

**A. Neden bu rol / şirket?**
İşte yakaladığım bazı yaklaşımlar (angles) — 1-2 tanesini seçin ya da kendiniz yazın:
  1. {JD'den gelen ölçek (Scale) sinyali}
  2. {JD'den gelen teknolojik hedefler (Tech ambition) sinyali}
  3. {JD açılışından gelen alan/misyon (Domain/mission) sinyali}
  4. {Büyüme (Growth) veya aşama sinyali — örn. Series B, pre-IPO, kategori belirleyen}
  5. {Stratejik öğrenim (Strategic learning) — bu rolün sizin için doldurduğu belirli bir boşluk}
  6. Diğer — kendi yaklaşımınızı yazın

**B. Onlar için hangi sorunu çözersiniz?**
Araştırmalarıma dayanarak: {Adım 3'teki onaylanmış sentez}.
Bu, sizin ele almak istediğiniz şeyle örtüşüyor mu? İyileştirin (Refine) veya onaylayın.

**C. Konuya (Approach) nasıl yaklaşırsınız?**
1-2 cümleyle: Birinci gün katılırsanız açılış hamleniz (opening move) ne olur?
(Bu, mektubun en farklılaşan / öne çıkan kısmıdır — spesifik hale getirin.)

**D. Üslup (Tone)?**
  1. Formal (Resmi) — yapılandırılmış, saygılı bir mesafe, kurumsal/büyük işletme JD'lerine uygundur
  2. Direct (Doğrudan) — sade cümleler, laf kalabalığı yok, hemen sadede gelir
  3. Conversational (Sohbet havasında) — sıcak ama profesyonel, düşünceli (thoughtful) bir insan gibi okunur
  4. Mirror the JD (JD'yi Yansıt) — şirketin kullandığı dil tonu (register) her neyse onunla eşleştireceğim
```

Adım 7'ye geçmeden önce dört cevabın da alınmasını bekle.

---

## Adım 7 — Başarı (Achievement) seçimi (yalnızca cv.md'den)

SADECE `cv.md` dosyasından 4-5 başarı maddesi (achievement bullets) seç (`article-digest.md` bağlam (context) için okunabilir ancak başarı maddesi kaynağı değildir):
1. cv.md içindeki tüm rollerin altında yer alan tüm madde işaretlerini (bullets) oku
2. Her birini JD'nin ilk 3-4 gerekli yetkinliğine (required competencies) göre puanla
3. Her maddede en az bir metrik olacak şekilde en yüksek puanlı 4-5 tanesini seç
4. Tam olarak cv.md'deki kelimeleri ve metrikleri kullan — asla kendi kelimelerinle özetleme (paraphrase) veya yeni bir şey uydurma
5. Adım 4'teki anahtar kelime yansıtmasını (keyword mirroring) her maddenin etrafındaki kelime dağarcığına (metriklere değil) uygula

Format: `**Bold lead phrase,** one sentence of impact with metric.`

---

## Adım 8 — Sohbette mektup taslağını oluştur (PDF öncesi zorunlu)

Mektubun tamamını sohbette (chat) düz metin (plain text) olarak taslakla (Draft). Şu yapıyı (structure) takip et:

```text
[Candidate Name]
[Location] | [Email] | [Phone if available] | [LinkedIn if available]
[Credentials line if available]

Cover Letter: [Role Title]
[Company], [City]   [Date]

────────────────────────────────────────────────

[Salutation — optional]
Biliniyorsa işe alım yöneticisine (hiring manager) hitap et, örn. "Dear Jane Smith,". İsim yoksa atla (omit).

[Opening — 2 sentences]
Neden başvuruluyor + işlevsel özet (functional summary). Yaklaşım (Angle) A'dan türetilir. JD ayna kelime dağarcığını (mirror vocabulary) kullanır.

[Profile introduction — 1 paragraph]
Deneyim yılı, mevcut/en son rol, alan (domain). cv.md özetinden (summary) oku.
Üslup (Tone), kullanıcının Adım 6D'deki seçimiyle eşleşir.

[Achievements — 4-5 bullets]
• **Lead phrase,** impact sentence with metric.
• **Lead phrase,** impact sentence with metric.
• **Lead phrase,** impact sentence with metric.
• **Lead phrase,** impact sentence with metric.

[Problems I will solve — 2-3 sentences]
Şunlardan türetilir: onaylanmış araştırma (Adım 3) + Yaklaşım B + Yaklaşım C.
Bu şirketin mevcut fiili durumuna (actual situation) özel olmalıdır. Genel geçer (generic) olmamalıdır.

[Closing — 1-2 sentences]
Uygunluk (Availability) + kullanıcının dahil etmeyi seçtiği herhangi bir boşluk kabulü/açıklaması (gap acknowledgments - Adım 5).

[Language closing — if applicable]
Yalnızca kullanıcı Adım 5'te dahil etmeyi onayladıysa. O dilde yazılır. PDF'de italik (Italic) olur.
```

Taslağı şu şekilde bitir: "Bu nasıl okunuyor? Onayladığınız an PDF'i oluşturacağım."

**Kullanıcı açıkça onaylamadan (explicitly approves) hiçbir PDF OLUŞTURMA.** Onay; "güzel görünüyor", "oluştur", "evet", uygulanacak belirli düzenlemeler veya bunlara eşdeğer anlamlara gelir. Bir soru sorması veya sessiz kalması onay değildir.

---

## Dil kuralları (her cümlede zorunlu kılınmıştır)

1. **Yalnızca etken çatı (Active voice only)** — asla "was delivered", "has been built", "were led" yok.
2. **JD'de kullanılmadığı sürece kısaltma (abbreviation) yok** — ilk kullanımda tam terimi yaz, kısaltmayı parantez içinde belirt. Bundan sonra kısaltma kullanılabilir.
3. **Uzun tire (em dashes) yok** — virgül, nokta ile değiştir veya cümleyi yeniden yaz.
4. **Moda kelimeler (buzzwords) yok** — kesin yasak: leverage, synergy, seamless, holistic, robust, cutting-edge, spearheaded, championed, orchestrated, passionate, excited, stakeholder alignment, data-driven (bunun yerine verinin neyi yönlendirdiğini söyleyin), actionable insights, move the needle, north star, unique opportunity, perfect fit, strong track record.
5. **Doldurma açılış kelimeleri (filler openers) yok** — asla "I am pleased to", "I am writing to express", "I am excited to" yok.
6. **Soyut (abstract) yerine Somut (Concrete)** — her iddianın bir sayıya, sistem adına veya belirli bir sonuca ihtiyacı vardır. "Improved performance" (Performansı artırdı) yasaktır. "Cut latency from 2s to 380ms" (Gecikmeyi 2s'den 380ms'ye düşürdü) uygundur.
7. **Toplam gövde (body) metni 350-420 kelime** (başlık + kimlik bilgileri (credentials) sayılmaz).
8. **Madde formatı (Bullet format)** — `**Bold lead phrase,** impact sentence with metric.` Başlık cümlesi (lead) ve cümle arasında uzun tire (em dash) yok.
9. **Kendi kendini denetle (Self-check)** — son halini vermeden önce her cümleyi yeniden oku: bu cümle herhangi bir şirkete yazılmış herhangi bir ön yazıda kullanılabilir mi? Yanıt evet ise, o cümleyi yeniden yaz.
10. **Üslup tutarlılığı (Tone consistency)** — seçilen üslubu (Adım 6D) tek tip (uniformly) uygula. Mektubun ortasında dili/tonu değiştirme.

---

## Adım 9 — PDF Oluştur

Yalnızca kullanıcının açık onayı (explicit user approval) geldikten sonra.

JSON yükünü (payload) birleştir:

```json
{
  "candidate": {
    "name": "{from profile.yml}",
    "email": "{from profile.yml}",
    "phone": "{from profile.yml, omit if empty}",
    "location": "{from profile.yml}",
    "linkedin": "{from profile.yml, omit if empty}",
    "github": "{from profile.yml, omit if empty}",
    "credentials": ["{degree}", "{MBA}", "{cert}"]
  },
  "letter": {
    "role_title": "{exact from JD}",
    "company": "{company name}",
    "city": "{JD city}",
    "date": "{YYYY-MM-DD}",
    "greeting": "{optional salutation, e.g. 'Dear Jane Smith,'; omit the key to skip the salutation}",
    "opening": "{approved opening paragraph}",
    "profile_intro": "{approved profile intro}",
    "achievements": [
      {"lead": "...", "impact": "..."}
    ],
    "problems_section": "{approved problems paragraph}",
    "closing": "{approved closing}",
    "language_closing": "{approved language sentence or null}"
  },
  "output_path": "output/{company-slug}-{role-slug}-cover.pdf"
}
```

Yükü (Payload) `/tmp/cover-payload-{company-slug}.json` konumuna yaz.

Çalıştır:
```bash
node generate-cover-letter.mjs --payload /tmp/cover-payload-{company-slug}.json
```

Çıktı yolunu (output path) ve dosya boyutunu Raporla.

---

## Adım 10 — Üretim sonrası not

PDF onaylandıktan sonra kısa bir not ekle:

- Adım 4'te çıkarılan, ancak doğal bir şekilde metne dahil edilemeyen JD anahtar kelimeleri (manuel inceleme için işaretle)
- Hangi boşluk onaylarının (gap acknowledgments) dahil edildiği, hangilerinin dahil edilmediği ve nedenleri
- Kelime sayısının 350-420 hedefini tutup tutmadığı (kısa veya uzunsa bunu not et)

---

## Slug modu özellikleri

`/career-ops cover {slug}` olarak çağrıldığında:

1. `reports/` dizininde slug'a göre eşleşen raporu bul
2. `## Cover Letter Draft` bölümünü çıkar — bunu taslak (draft) için önceden doldurulmuş (pre-populated) bir başlangıç noktası olarak kullan
3. Tüm adımları normal şekilde çalıştır (araştırma, anahtar kelimeler, sorular (prompts), boşluklar (gaps)) — taslak (draft) son çıktı değil, bir başlangıç noktasıdır
4. Adım 8'de taslağı sunarken neyin otomatik olarak üretildiğini (auto-generated) ve kullanıcının cevaplarına göre neyin değiştirildiğini göster
5. PDF üretiminden (generation) sonra, raporun `## Cover Letter Draft` bölümünü şu notla güncelle: `PDF generated: output/{path} on {date}`
