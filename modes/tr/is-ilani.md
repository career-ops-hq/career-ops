# Mod: is-ilani — Tam Değerlendirme A-G

Aday bir ilan yapıştırdığında (metin veya URL) HER ZAMAN 7 bloğun tamamını sun (A-F değerlendirme + G meşruiyet).

## Adım 0 — Arketip Tespiti

İlanı `_shared.md`'deki arketiplerden birine sınıflandır. Hibrit ise en yakın ikisini belirt. Bu tespite göre:
- B bloğunda hangi kanıt noktalarını öne çıkaracağın belirlenir
- E bloğunda CV özeti nasıl yeniden yazılacağı belirlenir
- F bloğunda hangi STAR hikayeleri hazırlanacağı belirlenir

## Blok A — Rol Özeti

Şu alanları içeren bir tablo oluştur:
- Tespit edilen arketip
- Alan (fintech / e-ticaret / kurumsal yazılım / SaaS / oyun / telekom vb.)
- İşlev (geliştirme / danışmanlık / yönetim / deployment)
- Kıdem seviyesi (junior / mid / senior / staff)
- Çalışma şekli (tam uzaktan / hibrit / ofis)
- Takım büyüklüğü (ilanda belirtilmişse)
- 1 cümlelik TL;DR

## Blok B — CV Eşleştirmesi

`cv.md` dosyasını oku. İlandaki her gereksinimi CV'deki tam satırlarla karşılaştıran bir tablo oluştur.

**Arketipe göre öne çıkarılacaklar:**
- FDE → hızlı teslimat ve müşteri yönlü kanıt noktaları
- SA → sistem tasarımı ve entegrasyon deneyimi
- PM → product discovery ve metrikler
- LLMOps → evals, observability, pipeline'lar
- Agentic → multi-agent, HITL, orchestration
- Transformation → değişim yönetimi, benimseme, ölçekleme

**Eksikler bölümü** — her eksiklik için şunları değerlendir:
1. Sert engel mi yoksa "olsa iyi olur" mu?
2. Aday yakın bir deneyimle telafi edebilir mi?
3. Portfolyoda bu boşluğu kapatan bir proje var mı?
4. Somut azaltma planı (ön yazıda kullanılacak ifade, kısa proje vb.)

## Blok C — Seviye ve Strateji

1. **İlanda belirtilen seviye** ile **adayın bu arketip için doğal seviyesi** karşılaştırması
2. **"Kıdemliyi dürüstçe sat" planı:** Arketipe göre uyarlanmış somut ifadeler, öne çıkarılacak başarılar, özgün geçmiş deneyimi nasıl avantaja çevireceğin
3. **"Seviye düşürülürsem" planı:** Teklif adil ise kabul et, 6. ay incelemesi müzakere et, terfi kriterlerini netleştir

## Blok D — Maaş ve Piyasa

WebSearch ile araştır:
- Rolün güncel maaş aralıkları (Kariyer.net Maaş Rehberi, Glassdoor TR, LinkedIn Maaş, Secretcv.com)
- Şirketin ücret itibarı (Glassdoor/Kariyer.net yorumları varsa)
- Bu rolün Türkiye'deki ve küresel talep trendi

Tablo olarak sun: veriler + kaynaklar. Veri bulunamazsa uydurmak yerine açıkça belirt.

**Türkiye'ye özgü kontrol listesi:**
- İlan net mi brüt mu belirtiyor?
- Yemek kartı, özel sağlık sigortası, servis var mı?
- Yıllık TÜFE bazlı zam garantisi sunuluyor mu?
- Prim/bonus yapısı nedir?

## Blok E — Kişiselleştirme Planı

| # | CV Bölümü | Mevcut hali | Önerilen değişiklik | Gerekçe |
|---|-----------|-------------|---------------------|---------|
| 1 | Özet | ... | ... | ... |
| ... | ... | ... | ... | ... |

CV için en etkili 5 değişiklik + LinkedIn profili için en etkili 5 değişiklik.

## Blok F — Mülakat Hazırlığı

İlanın gereksinimlerine eşlenmiş 6-10 STAR+R hikayesi (STAR + **Yansıma**):

| # | İlan Gereksinimi | STAR+R Hikayesi | S | T | A | R | Yansıma |
|---|-----------------|-----------------|---|---|---|---|---------|

**Yansıma** sütunu: öğrenilen dersi veya bugün farklı yapılacak şeyi yakalar. Bu kıdemi gösterir — junior adaylar ne olduğunu anlatır, kıdemli adaylar ders çıkarır.

**Story Bank:** `interview-prep/story-bank.md` varsa bu hikayelerin orada olup olmadığını kontrol et. Yoksa ekle. Zamanla her mülakat sorusuna uyarlanabilecek 5-10 ana hikayeden oluşan yeniden kullanılabilir bir banka oluşur.

**Arketipe göre seçim ve çerçeveleme:**
- FDE → teslimat hızı ve müşteri yönlü yaklaşım ön planda
- SA → mimari kararlar ön planda
- PM → discovery süreci ve trade-off'lar ön planda
- LLMOps → metrikler, evals, production sağlamlaştırma ön planda
- Agentic → orchestration, hata yönetimi, HITL ön planda
- Transformation → benimseme ve kurumsal değişim ön planda

Ayrıca ekle:
- 1 önerilen vaka çalışması (hangi projeyi nasıl sunacağın)
- Kırmızı bayrak sorular ve nasıl yanıtlanacağı (örn. "Neden bu kadar kısa sürede ayrılıyorsunuz?", "Yönettiğiniz bir ekip var mıydı?")

---

## Değerlendirme Sonrası

Bloklar A-F tamamlandıktan sonra **HER ZAMAN** şunları yap:

### 1. Rapor .md Kaydet

Değerlendirmenin tamamını `reports/{###}-{sirket-slug}-{YYYY-MM-DD}.md` olarak kaydet.

- `{###}` = sıradaki numara (3 haneli, sıfır dolgulu). Bu numarayı atomik olarak atamak ve yarış durumlarını (race condition) önlemek için, numarayı rezerve etmek üzere `node reserve-report-num.mjs` komutunu çalıştırmalısınız (standart çıktı `{###}` değerini döndürür), raporu yazmalı ve ardından sentineli serbest bırakmak için `node reserve-report-num.mjs --release {###}` komutunu çalıştırmalısınız.
- `{sirket-slug}` = şirket adı küçük harfle, boşluksuz (tire kullan)
- `{YYYY-MM-DD}` = bugünün tarihi

**Rapor formatı:**

```markdown
# Değerlendirme: {Şirket} — {Rol}

**Tarih:** {YYYY-MM-DD}
**Arketip:** {tespit edilen}
**Puan:** {X.X}/5
**URL:** {ilan URL'si}
**PDF:** ✅/❌
**Meşruiyet:** {Güvenilir | Dikkatli İlerle | Şüpheli}

---

## A) Rol Özeti
(Blok A'nın tam içeriği)

## B) CV Eşleştirmesi
(Blok B'nin tam içeriği)

## C) Seviye ve Strateji
(Blok C'nin tam içeriği)

## D) Maaş ve Piyasa
(Blok D'nin tam içeriği)

## E) Kişiselleştirme Planı
(Blok E'nin tam içeriği)

## F) Mülakat Hazırlığı
(Blok F'nin tam içeriği)

## G) İlan Meşruiyeti
(Blok G'nin tam içeriği)

## H) Başvuru Formu Taslak Yanıtları
(yalnızca puan >= 4,5 ise — form alanları için taslak yanıtlar)

---

## Çıkarılan Anahtar Kelimeler
(ATS optimizasyonu için ilandan 15-20 anahtar kelime)
```

### 2. Takipçiye Kaydet

**Yeni** kayıt için `data/applications.md`'yi doğrudan düzenleme. Bunun yerine `batch/tracker-additions/{num}-{sirket-slug}.tsv` dosyasına tek satır TSV yaz (8 veya 9 sekme ile ayrılmış sütun):

```tsv
{num}\t{date}\t{company}\t{role}\t{status}\t{score}\t{pdf_emoji}\t[{num}](reports/{num}-{slug}-{date}.md)\t{note}
```

- `{num}` = sıradaki numara (tam sayı, `reports/` klasöründen hesapla)
- `{status}` = `Evaluated`
- `{score}` = `X.X/5` formatı (örn. `4.2/5`)
- `{pdf_emoji}` = `✅` veya `❌`
- `{note}` = kısa not (isteğe bağlı, sütun atlanabilir)

Ardından `node merge-tracker.mjs` çalıştır.

**Mevcut** kayıt için `data/applications.md`'de ilgili satırı doğrudan güncelle (durum, PDF, rapor bağlantısı).

---

## İlan Meşruiyeti (Blok G)

İlanın gerçek ve aktif olup olmadığını değerlendir. Bu değerlendirme global puanı (1-5) **etkilemez** — ayrı bir nitel tespittir.

**Etik çerçeve:** Gözlemler sun, iddialarda bulunma. Her sinyalin meşru açıklaması olabilir. Kararı kullanıcı verir.

### Analiz Edilecek Sinyaller (önem sırasıyla):

**1. İlan Tazeliği** (Playwright snapshot'ından):
- Yayın tarihi veya "X gün önce" bilgisi — sayfadan çıkar
- Başvur butonu durumu (aktif / kapalı / yok / genel sayfaya yönlendiriyor)
- URL genel kariyer sayfasına yönlendirdiyse not düş

**2. İlan İçerik Kalitesi** (ilan metninden):
- Belirli teknoloji, framework veya araçlar adlandırıyor mu?
- Takım büyüklüğü, raporlama yapısı veya organizasyon bağlamı var mı?
- Gereksinimler gerçekçi mi? (deneyim yılı vs. teknolojinin yaşı)
- İlk 6-12 ay için net bir kapsam var mı?
- Maaş/ücret bilgisi var mı?
- İlanın role özgü vs. genel şablon oranı nedir?
- İç çelişki var mı? (junior başlık + kıdemli gereksinimler gibi)

**3. Şirketin İşe Alım Sinyalleri** (2-3 WebSearch sorgusu, Blok D araştırmasıyla birleştir):
- `"{şirket}" işten çıkarma {yıl}` — tarih, kapsam, departmanları not et
- `"{şirket}" işe alım dondurma {yıl}` — varsa duyuruları not et
- İşten çıkarma varsa: bu roldeki departmanı etkiliyor mu?

**4. Yeniden Yayın Tespiti** (`scan-history.tsv`'den):
- Şirket + benzer rol başlığının farklı URL ile daha önce göründüğünü kontrol et
- Kaç kez ve hangi süre içinde tekrarlandığını not et

**5. Rol Piyasa Bağlamı** (ek sorgu gerektirmez):
- Bu, genellikle 4-6 haftada dolan yaygın bir rol mü?
- Rol bu şirketin işine uygun mu?

### Çıktı Formatı:

**Değerlendirme:** Üç seviyeden biri:
- **Güvenilir** — Birden fazla sinyal gerçek ve aktif bir ilan olduğunu gösteriyor
- **Dikkatli İlerle** — Dikkat edilmesi gereken karma sinyaller var
- **Şüpheli** — Birden fazla hayalet ilan göstergesi mevcut; zaman harcamadan önce araştır

**Sinyaller tablosu:** Her sinyal, bulgusu ve ağırlığıyla (Olumlu / Nötr / Endişe Verici).

**Bağlam Notları:** İlgili uyarılar (niş rol, kamu kurumu ilanı, sürekli açık pozisyon vb.).

**Türkiye'ye özgü sinyaller:**
- Kariyer.net / Yenibiris.com'da yayın tarihi (30 günden eski mi?)
- Şirket köklü mü yoksa yeni kurulan mı?
- İlan çok genel mi (kopyala-yapıştır şablonu gibi görünüyor mu)?
- Maaş "rekabetçi" dışında herhangi bir bilgi içeriyor mu?
- Şirkete ilişkin son dönemde işten çıkarma veya kapanma haberleri var mı?

### Özel durumlar:
- **Kamu/akademik ilanlar:** Uzun süreçler standarttır. Eşikleri ayarla (60-90 gün normal kabul edilir).
- **Sürekli açık pozisyonlar:** İlan "süregelen" veya "dönemsel alım" diyorsa not düş — bu hayalet ilan değil, pipeline rolüdür.
- **Üst düzey / niş roller:** Staff+, VP, Direktör veya yüksek uzmanlaşma gerektiren roller meşru olarak aylarca açık kalabilir.
- **Erken aşama startup:** Rol henüz tam şekillenmemiş olduğundan ilanın muğlak yazılmış olması normaldir. İçerik belirsizliğine daha az ağırlık ver.
- **Tarih bilgisi yok:** Yayın tarihi belirlenemiyorsa ve başka endişe verici sinyal yoksa varsayılan olarak "Dikkatli İlerle" kullan. Kanıt olmaksızın asla "Şüpheli" deme.
- **Recruiter kaynağı (kamuya açık ilan yok):** Tazelik sinyali alınamaz. Aktif recruiter temasının kendisinin olumlu bir meşruiyet sinyali olduğunu not et.

---

## Puanlama (1-5 global)

| Boyut | Ne ölçülüyor |
|-------|-------------|
| CV Eşleşmesi | Beceriler, deneyim ve kanıt noktalarının örtüşmesi |
| Hedef Rol Uyumu | İlanın hedef arketiplerle uyumu (`_profile.md`'den) |
| Maaş | Teklifin piyasa konumu |
| Kültürel Sinyaller | Şirket kültürü, büyüme, istikrar, çalışma şekli |
| Kırmızı Bayraklar | Engelleyiciler ve uyarılar (negatif düzeltme) |
| **Global** | Yukarıdakilerin ağırlıklı ortalaması |

**Puan yorumu:**
- 4,5+ → Güçlü eşleşme, hemen başvur
- 4,0-4,4 → İyi eşleşme, başvurmaya değer
- 3,5-3,9 → Kabul edilebilir ama ideal değil; özel bir neden olmadıkça geç
- 3,5'in altı → Başvuru önerilmez
