# Mod: is-ilani — Tam Değerlendirme A-G

Aday bir ilan yapıştırdığında (metin veya URL) HER ZAMAN 7 bloğun tamamını sun (A-F değerlendirme + G meşruiyet).

## Adım 0 — Arketip Tespiti

İlanı `_shared.md`'deki arketiplere göre sınıflandır — yani, tanımlı olduğu
yerde, kullanıcının `modes/_profile.md` → *Your Target Roles* altındaki kendi
arketiplerine göre. `_profile.md` yoksa, *Your Target Roles* bölümü yoksa ya da
o tabloda hiç satır yoksa, `_shared.md`'deki varsayılan tabloya göre sınıflandır
ve oradaki bir eşleşmeyi hedef say. Kullanıcının hedeflerinden ikisinin hibritiyse
ikisini de belirt.

**"Hiçbiri" geçerli bir sonuçtur ve öyle raporlanmalıdır.** Rol, kullanıcının
hedeflediği hiçbir şeyle eşleşmiyorsa en yakın etiketi seçme ve hibrit deme:
bunu açıkça söyle, North Star'a 1 ver ve değerlendirmeye diğer boyutlarda devam
et — raporun geri kalanı yine de işe yarar; dürüst bir gerekçeyle verilmiş düşük
bir uyum puanı, kullanıcının başvurmadığı bir iş için kendinden emin bir uyum
anlatısından daha faydalıdır. `_profile.md`'de hedefler tanımlıysa, yalnızca
`_shared.md`'deki varsayılan tabloyla eşleşmek onlarla eşleşmek demek değildir.

Bu tespite göre:
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

Değerlendirmenin tamamını `reports/{###}-{company-slug}-{YYYY-MM-DD}.md` olarak kaydet.

- `{###}` = sıradaki numara (3 haneli, sıfır dolgulu). Bu numarayı atomik olarak atamak ve yarış durumlarını (race condition) önlemek için, numarayı rezerve etmek üzere `node reserve-report-num.mjs` komutunu çalıştırmalısınız (standart çıktı `{###}` değerini döndürür), raporu yazmalı ve ardından sentineli serbest bırakmak için `node reserve-report-num.mjs --release {###}` komutunu çalıştırmalısınız.
- `{company-slug}` = şirket adının yalnızca küçük ASCII harf, rakam ve tireden oluşan biçimi: küçük harfe çevir, aksanları ve Türkçe harfleri ASCII karşılıklarına indir (`ç` → `c`, `ğ` → `g`, `ı` → `i`, `ö` → `o`, `ş` → `s`, `ü` → `u`, `é` → `e`), diğer karakterlerin (boşluk, `&`, `.`, tırnak, `/`) her dizisini tek bir `-` ile değiştir ve baştaki ve sondaki `-` işaretlerini kırp. Sonuç `^[a-z0-9-]+$` ile eşleşmelidir; aşağıdaki arşiv ve anahtar kelime komutları başka bir değeri reddeder. Latin harf ya da rakam içermeyen bir addan geriye hiçbir şey kalmaz: harf çevirisi tahmin etmek yerine şirketin ilandaki kendi Latin harfli adını (kariyer sitesinin alan adı ya da ATS pano adı) kullan.
- `{YYYY-MM-DD}` = bugünün tarihi

**Rapor formatı:**

```markdown
# Değerlendirme: {Şirket} — {Rol}

**Date:** {YYYY-MM-DD}
**Archetype:** {tespit edilen}
<!-- Rol kullanıcının hedeflerinden biriyle eşleşiyorsa onun adını yaz. Hiçbiriyle
     eşleşmiyorsa bu alan boş BIRAKILMAZ ve muğlak geçilmez — boş bir alan aracın
     çalışmadığı gibi okunur, "muhtemelen X ile Y'nin hibriti" ise burada önlenmek
     istenen zorlamanın ta kendisidir. Şunlardan birini yaz:
       Hedef değil — en yakın varsayılan: {_shared.md tablosundaki satır}
       Hedef değil — yakın eşleşme yok
     Varsayılan satırı adlandırmak okuyucunun rolü konumlandırmasına yine yardım
     eder; yapmaması gereken, kullanıcının gerçekten sahip olduğu bir hedefin yerine
     geçmektir. -->
**Score:** {X/5}
**Karar:** {Başvur | Değerlendir | Önce araştır | Geç}
**URL:** {ilan URL'si}
**PDF:** ✅/❌
**Legitimacy:** {Güvenilir | Dikkatli İlerle | Şüpheli}

{`## Karar (lead)` cümlesi, kelimesi kelimesine}

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

## Karar (lead)
(başvurulup başvurulmayacağı tek cümlede — `final_decision` alanını yeniden ifade eder, yukarıdaki Karar bölümüne bakın)

## Risk Summary
(her risk sinyali için bir satır, sabit sıra — yukarıdaki Risk Summary bölümüne bakın)

## H) Başvuru Formu Taslak Yanıtları
(yalnızca puan >= 4,5 ise — form alanları için taslak yanıtlar)

---

## Çıkarılan Anahtar Kelimeler
(ATS optimizasyonu için ilandan 15-20 anahtar kelime)

## Keyword Coverage
(`keyword-match.mjs` (1b) tarafından üretilir — kapsam %, present, thin, missing)

## Job Description (archived verbatim)
(the posting's full text, pasted verbatim — see requirement below)

## Machine Summary
(sonraki betikler için YAML bloğu — aşağıdaki gereksinime bakın)
```

**Machine Summary (zorunlu):** raporun sonunda, `## Job Description (archived verbatim)` bölümünden sonra gelen bir YAML bloğu. Betikler onu konumuyla değil başlığıyla bulur; bu yüzden okuyucu ile Blok A arasına girmemesi için en sona konur. Şema, alan adlarının tam yazımı ve kurallar `batch/batch-prompt.md` içindedir (kaynak orasıdır; burada tekrarlamayın). `## Machine Summary` başlığı ve alan adları İngilizce kalır. `advertised_comp` (ilandaki maaş rakamı olduğu gibi, yoksa `null`), `risk_summary` (Risk Summary bloğunun eşlem hali) ve `requirement_importance` (Blok B satır satır; ilan kullanılabilir bir gereksinim listesi vermiyorsa `[]`) alanlarını içerir.

**JD arşivi (zorunlu, #2789):** Her rapor, ilanın tam metnini olduğu gibi içeren bir `## Job Description (archived verbatim)` bölümü taşır; metin asla özetlenmez, asla başka sözcüklerle yeniden yazılmaz. Başlık İngilizce kalır, çünkü `check-jd-archive.mjs` bölümü adıyla arar. `**URL:**` alanı bir arşiv değildir: ilan kapandığında bağlantı çalışmaz olur ve özgün gereksinimleri geri getirmenin bir yolu kalmaz. Bölümün ilk satırı, kaynakta göründüğü haliyle yayın tarihidir (`Posted: {tarih ya da göründüğü gibi göreli ifade}`, gerçekten görünmüyorsa `Posted: not visible in source`); bu satır asla rapor dosyasının tarihiyle doldurulmaz. İlan çok uzunsa ya da tamamı alıntılanamıyorsa, `archive-posting.mjs` (aşağıdaki komut) ile kaydedin ve bölüme başka hiçbir metin eklemeden **tam olarak** şu cümleyi yazın: `See jds/{filename} for the full archive (archive-posting.mjs --report={num}).` Metnin yerine başka sözcüklerle yazılmış bir özet konmaz; kuralın tamamı `modes/oferta.md` içinde (**JD archival**).

**Komut argümanları (#5853):** ilanın URL'sini, şirket slug'ını ya da rapor yolunu asla bir komut satırına yazmayın, tırnak içinde bile. Değerleri dosya aracınızla bir JSON dosyasına yazın (`{"url": "…", "company": "{company-slug}", "report": "{num}"}`) ve aşağıdaki komutu çalıştırın: her değeri denetler (slug `^[a-z0-9-]+$` ile eşleşmelidir) ve her birini betiğe shell olmadan ayrı bir argüman olarak verir. Denetimden geçemeyen bir değer çalıştırmayı durdurur: değeri düzeltin, denetimi asla. Kuralın tamamı `modes/oferta.md` içinde (**Command arguments**).

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const p = JSON.parse(readFileSync(process.argv[1] ?? 0, "utf8"));
const fail = msg => { console.error("archive-posting: " + msg); process.exit(1); };
if (p === null || typeof p !== "object" || Array.isArray(p)) fail("the JSON file must hold one object");
if (typeof p.url !== "string" || !/^https?:\/\//i.test(p.url)) fail("url must be an http(s) URL");
const args = ["archive-posting.mjs", p.url];
if (p.company != null) { if (typeof p.company !== "string" || !/^[a-z0-9-]+$/.test(p.company)) fail("company must match ^[a-z0-9-]+$"); args.push("--company=" + p.company); }
if (p.report != null) { if (!/^[0-9]+$/.test(String(p.report))) fail("report must be a report number"); args.push("--report=" + p.report); }
process.exit(spawnSync(process.execPath, args, { stdio: "inherit" }).status ?? 1);
' {json-file}
```

Raporu kaydettikten sonra `keyword-match.mjs` (aşağıdaki komut) komutunu çalıştırın ve çıktıdaki `## Keyword Coverage` bloğunu çıkarılan anahtar kelimelerin hemen altına, `## Job Description (archived verbatim)` bölümünden önce yapıştırın. Başlık İngilizce kalır. Yalnızca tanı amaçlıdır: bir anahtar kelimeyi CV'ye ancak gerçek bir deneyime karşılık geliyorsa ekleyin.

Bunun için `{"report": "reports/{###}-{company-slug}-{YYYY-MM-DD}.md"}` değerini bir JSON dosyasına yazın (yukarıdaki **Komut argümanları** bölümüne bakın) ve çalıştırın:

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const p = JSON.parse(readFileSync(process.argv[1] ?? 0, "utf8"));
const fail = msg => { console.error("keyword-match: " + msg); process.exit(1); };
if (p === null || typeof p !== "object" || Array.isArray(p)) fail("the JSON file must hold one object");
if (typeof p.report !== "string" || !/^reports\/[0-9]{3,}-[a-z0-9-]+-[0-9]{4}-[0-9]{2}-[0-9]{2}\.md$/.test(p.report)) fail("report must be reports/{###}-{company-slug}-{YYYY-MM-DD}.md");
const args = ["keyword-match.mjs", p.report];
if (p.cv != null) { if (typeof p.cv !== "string" || p.cv === "" || p.cv.startsWith("-")) fail("cv must be a file path"); args.push("--cv", p.cv); }
process.exit(spawnSync(process.execPath, args, { stdio: "inherit" }).status ?? 1);
' {json-file}
```

### 2. Takipçiye Kaydet

**Yeni** kayıt için `data/applications.md`'yi doğrudan düzenleme. Bunun yerine `{DATA_ROOT}/batch/tracker-additions/{num}-{company-slug}.tsv` dosyasına sekmeyle ayrılmış **iki** satır yaz: önce **sütun adları** satırı, hemen altına tam olarak bir veri satırı.

```tsv
num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl
{num}\t{date}\t{company}\t{role}\t{status}\t{score}\t{pdf_emoji}\t[{num}](reports/{num}-{company-slug}-{date}.md)\t{note}\t{url}
```

Her iki satırı da **tam olarak yukarıdaki gibi** yaz: sütun adları İngilizce, değerler ise **üstlerindeki adlarla aynı sırada**. `merge-tracker.mjs` alanları ADA göre çözer; tam da bu yüzden adların altlarındaki satırı tarif etmesi gerekir — satırlardan yalnızca birini yeniden sıralarsan `company` ile `role` sessizce yer değiştirir (ikisi de serbest metin olduğu için içerik kontrolü bunu yakalayamaz).

- `{num}` = sıradaki numara (tam sayı, `reports/` klasöründen hesapla)
- `{status}` = `Evaluated`
- `{score}` = `X.X/5` formatı (örn. `4.2/5`)
- `{pdf_emoji}` = `✅` veya `❌`
- `{note}` = kısa not (hücre boş bırakılabilir)
- `{url}` = ilanın URL'si. Bu **belirleyici yinelenen-kayıt anahtarıdır**: `merge-tracker.mjs` satırları önce buna göre eşler, yalnızca URL yoksa şirket+rol bulanık eşleşmesine düşer. URL yoksa hücreyi **boş** bırak — asla `N/A` veya `-` yazma; bu yer tutucular atılır ve satır anahtarsız kalır.

Ardından `node merge-tracker.mjs` çalıştır.

**Mevcut** kayıt için `data/applications.md`'yi elle düzenleme: durum ve notları `node set-status.mjs` ile, PDF işaretini `node mark-pdf-ready.mjs <rapor no>` ile güncelle.

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
- **Recruiter kaynağı (ilan linki gönderen recruiter teması dahil):** Tazelik sinyali sadece ilanın snapshot'ı yoksa alınamaz; recruiter'ın gönderdiği ilan kontrol edildiyse tarih ve Apply butonu bulguları korunur. Recruiter teması tek başına Nötr'dür, olumlu bir meşruiyet sinyali değildir. Seviye vermeden önce recruiter'ın kimliğini doğrula: (a) şirketin kendi kariyer sayfası veya herkese açık ATS board'u bu rolü listeliyor mu; (b) bilinen bir markaya eklenmiş tanıdık olmayan bir isim ayrı bir kurum olarak kontrol edilir; (c) recruiter'ın email domain'i veya bağımsız bir kaynak onu şirkete bağlıyor mu; (d) tek bir arama: `"{isim}" scam OR "fake recruiter" OR "fake job"`; (e) gönderdiği kodu klonlamanı, kurmanı veya çalıştırmanı, bu kod açıkken ekran paylaşmanı, Telegram/WhatsApp/Discord'a geçmeni ya da herhangi bir ödeme yapmanı istiyor mu. (a) tek bir sorgu, (d) tek bir arama kullanır; (b), (c) ve (e) yeni arama yapmaz, sadece yapıştırılan metni, (a) ve (d)'nin sonuçlarını ve zaten yapılmış araştırmayı kullanır. Kanıt yoksa kontrol Bilinmiyor (Nötr) kalır, asla Endişe Verici sayılmaz. (a) veya (d) Endişe Verici ve bir kontrol daha Endişe Verici ise "Şüpheli". Bu doğrulama yüzünden seviye "Şüpheli" olursa kısa ve suçlamayan bir not ekle: hangi kontroller Endişe Verici çıktı ve kaynakları ne, rolü şirketin kendi domain'indeki bir email adresinden teyit etmesi ve recruiter'ın gönderdiği kodu çalıştırmaması. Recruiter'ın gönderdiği repo, arşiv veya linki asla klonlama, kurma, açma ya da çalıştırma.

---

## Karar (lead)

Blok G'den hemen sonra, `## Risk Summary` bloğundan önce bir `## Karar (lead)` bloğu yazın. Okuyucunun raporu açarken sorduğu tek soruyu yanıtlar: başvurmalı mıyım?

**Türetilmiş, asla özgün.** `## Machine Summary` içindeki `final_decision` tek doğruluk kaynağıdır. Bu blok aynı kararı tek bir insan cümlesiyle yeniden ifade eder ve başka bir karar ortaya atmaz. Cümle ile alan çelişirse alan doğrudur, kusur cümledir. Kalın yazılan karar o alanın değerindir: Apply, Consider, Research first veya Skip.

**`(lead)` işareti işlevseldir, ve bilinçli olarak dilden bağımsızdır.** Web rapor görünümü, işareti taşıyan bloğu sayfanın giriş vurgusuna yükseltir ve onu başlık sözcüğüne ya da blok harfine göre değil işarete göre tanır. Bu yüzden her çeviri kendi adını ve aynı parantezi korur: `## Karar (lead)`, `## Verdict (lead)`. `(lead)` asla çevrilmez, bu bloğa asla harf verilmez. A–H dizisinin dışındadır.

**Yeni yargı yok.** Bu blok yazıldığında tüm girdiler zaten toplanmıştır. Kararı ve raporun daha önce ortaya koyduğu tek bir gerekçeyi yazın. Yeniden puanlamayın, yeni kanıt eklemeyin.

Blok biçimi:

```markdown
## Karar (lead)

**Apply.** Rolün temel ekseninde güçlü eşleşme, sert engel yok, ve Blok G High Confidence döndürdü.
```

---

## Risk Summary (Blok G'den sonra)

Rapor gövdesini, Blok G'yi izleyen `## Karar (lead)` bloğunun hemen ardından, Blok H'den önce bir `## Risk Summary` bloğuyla kapatın — her risk sinyali için bir satır, sabit sıra. Böylece adayın gerçekten sorduğu soru ("bu şirkete katılmak güvenli mi?") Blok A, Blok G ve harici bir dosyayı zihinde birleştirmek yerine tek ekranda yanıtlanır.

**Yalnızca toplama, sıfır yeni yargı.** Her satır, kaynak sinyalin zaten ürettiği kararı alıntılar veya ona bağlanır. Özet asla yeniden puanlamaz, yeniden ağırlıklandırmaz veya kararı geçersiz kılmaz — bir satır yanlış görünüyorsa düzeltme buraya değil, kaynak sinyale aittir.

Satır başına üç durum: `✅ {net karar}` / `⚠️ {bulgu}` / `— not evaluated`. **`— not evaluated` birinci sınıf bir durumdur:** bir sinyal çalıştırılamadıysa satırı atlamak yerine bunu açıkça belirtin; ancak o zaman tamamı ✅ olan bir özete güvenilebilir. **Adlandırılmış istisna:** Mülakat kırmızı bayrakları satırı, değerlendirilmemiş durumunu `— no interview sessions yet` olarak yazar — aynı "değerlendirilmedi" kavramının o satıra özgü, daha belirgin ifadesi (çapraz kontrol çalıştı, yalnızca redflags dosyası bulunamadı); dördüncü bir durum değildir.

Satır etiketleri, `| Signal | Status |` başlıkları ve durum sözcükleri sabit literaldir, çevrilmez: Machine Summary'deki `risk_summary` alanı bunlara dayanır.

| Sinyal | Kaynak | Satırın yazımı |
|--------|--------|----------------|
| Posting legitimacy | Blok G değerlendirme kademesi | `✅ High Confidence`; Proceed with Caution / Suspicious için `⚠️ {tier} — {tek cümlelik gerekçe}` |
| Employment classification | Blok G içindeki çalışma biçimi sinyali | Kontrol çalıştı ve bir şey bulunmadıysa `✅ clear`; bayrak tetiklendiyse `⚠️ contractor-style language: "{alıntı ifade}"`; kontrol çalışamadıysa `— not evaluated` |
| Culture screen | Blok A'daki kültür taraması alanı | `✅ pass` veya `⚠️ caution — {kanıt}` / `⚠️ fail — {kanıt}`; tarama yapılmadıysa `— not evaluated` |
| Interview red flags | `interview-prep/{company-slug}-redflags.md` (`interview-redflag` modundan) | **Kopya değil, çapraz referans:** dosya varsa mevcut uyarı düzeyini ve göreli bağlantısını yazın — `[{level}](../interview-prep/{company-slug}-redflags.md)` (`reports/` klasörüne göre); yoksa `— no interview sessions yet` |
| AI claims vs. infrastructure | Blok G'deki AI/altyapı tutarlılık kontrolü (varsa) | Bu rapor kontrolü içeriyorsa kararını yansıtın (`✅ consistent` / `⚠️ {bulgu}`); aksi halde `— not evaluated`. Kontrol var olduğunda satır kendiliğinden etkinleşir, sıralama bağımlılığı yoktur |

Blok biçimi:

```markdown
## Risk Summary

| Signal | Status |
|--------|--------|
| Posting legitimacy | ✅ High Confidence |
| Employment classification | ⚠️ contractor-style language: "{quoted phrase}" |
| Culture screen | ⚠️ caution — {evidence} |
| Interview red flags | — no interview sessions yet |
| AI claims vs. infrastructure | — not evaluated |
```

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
