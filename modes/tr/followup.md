# Mod: followup -- Takip Ritmi (Cadence) İzleyici

> **`voice-dna.md` dosyasını (varsa) oku ve oluşturulan her e-posta/LinkedIn taslağına uygula.** Bu mod bağımsızdır — `_shared.md` dosyasını YÜKLEMEZ, bu yüzden `voice-dna.md` dosyasını doğrudan oku. Takip taslakları sohbete dayalıdır (conversational), bu nedenle tam korumayı (guardrail) uygula: yasaklı kelimeler/ifadeler/kalıplar, m-tire (em-dash) yok, olumsuz paralellikler yok (§3-4) VE sohbete dayalı üslup — kısaltmalar, değişken ritim, doğrudan "Ben"/"Sen" kullanımı (§1-2). Asla `cv.md` içindeki gerçek bir metriği stil uğruna çıkarma veya yumuşatma.

## Amaç

Aktif başvurular için takip ritmini (cadence) izle. Gecikmiş (overdue) takipleri işaretle, notlardan kişileri çıkar ve rapor bağlamını kullanarak kişiselleştirilmiş Takip / Durum Kontrolü e-posta/LinkedIn taslakları oluştur.

**Bu modun kapsamında değil:** bir işe alım uzmanı/görüşmeci belirli bir arama saatini onaylayıp sonra aramadığında aynı gün yapılan takip. Bu, geçen süreye dayalı bir takvim durumu değildir; bunun yerine `modes/email.md` içindeki `confirmed_time_noshow` varyantına (`/career-ops email noshow`) bak.

## Girdiler

- `data/applications.md` — Başvuru takipçisi
- `data/active-interviews.md` — Mülakat turu tarihleri (Adım 1b okur)
- `data/follow-ups.md` — Takip geçmişi (ilk kullanımda oluşturulur)
- `reports/` — Değerlendirme raporları (taslaklarda bağlam için)
- `config/profile.yml` — Kullanıcı profili (isim, kimlik)
- `cv.md` — Taslaklardaki kanıt noktaları için CV

## Adım 0: Takiplerin açık olduğunu kontrol et

`config/profile.yml` dosyası `follow_ups.enabled: false` ayarlıyorsa burada dur. Kullanıcıya takiplerin kapalı olduğunu ve onları `config/profile.yml` içinde `follow_ups.enabled: true` ile veya web Config sayfasındaki "Track follow-ups" onay kutusuyla yeniden açabileceğini söyle. Ritim betiğini çalıştırma ve takip mesajı taslağı hazırlama. `contacto` modu bir takip değil ilk temastır, bu yüzden takipler kapalıyken de çalışır. Bu durumda `followup-cadence.mjs --json` da hiç giriş olmadan `"followupsEnabled": false` bildirir.

## Adım 1 — Ritim (Cadence) Komut Dosyasını Çalıştır

Şunu çalıştır:

```bash
node followup-cadence.mjs
```

JSON çıktısını ayrıştır. Şunları içerir:

| Anahtar | İçerik |
|-----|----------|
| `metadata` | Analiz tarihi, toplam izlenen, eyleme dönüştürülebilir sayı, gecikmiş (overdue)/acil (urgent)/soğuk (cold)/bekleyen (waiting) sayıları |
| `entries` | Başvuru başına: şirket, rol, durum, başvuru tarihinden itibaren geçen gün sayısı, takip sayısı, aciliyet, bir sonraki takip tarihi, çıkarılan kişiler, rapor yolu |
| `cadenceConfig` | Ritim kuralları (başvuruldu: 7 gün, yanıtlandı/değerlendirme: 3 gün, mülakat: 1 gün) |

Eğer eyleme dönüştürülebilir giriş yoksa, kullanıcıya şunu söyle:
> "Takip edilecek aktif başvuru yok. Önce `/career-ops` ile bazı rollere başvurun ve beklemeye geçtiklerinde tekrar gelin."

**Kalibrasyon çapraz kontrolü:** `node funnel-velocity.mjs --summary`, süreçteki hangi başvuruların tipik ilk yanıt penceresini aştığını bildirir (`waiting` bloğu). Bu satırlar doğal takip adaylarıdır; beklemenin kendisini bir karar olarak ele almak yerine onları bu ritim görünümüne aktar (pencerenin ötesindeki sessizlik yaygındır, ret değildir). Kullanıcı burada bir durum değişikliği bildirdiğinde ("yanıt verdiler", "reddedildi"), bunu `node set-status.mjs --report <report#> <state>` üzerinden yönlendir ve kullanıcı olayın gerçek gününü söylediğinde `--on YYYY-MM-DD` ver.

## Adım 1b — İşveren Yanıt Gecikmesi Kontrolü

Şunu çalıştır:

```bash
node rejection-latency.mjs
```

JSON çıktısını ayrıştır. Komut, `data/active-interviews.md` içindeki mülakat tarihlerini hâlâ `Interview` durumundaki takipçi satırlarıyla çapraz kontrol eder (başvuru başına şirket + rol ile eşleşir) ve mülakat sonrası sessizliği **nezaket** eşiğini (varsayılan 30 gün; `rejection_latency.courtesy_days` veya `--courtesy-days` ile ayarlanabilir) aşan başvuruları işaretler. `flags` boşsa bu adımı sessizce atla.

**Onay kapısı (bir işaretten herhangi bir şey göstermeden önce zorunlu):** bir işaretin alanları, kullanıcının bu konuşmada söylediği bir şeyden değil, doğrudan ham takipçi/mülakat günlüğü verisinden gelir. Bir işaretle ilgili kullanıcıya yönelik HERHANGİ bir içerik göstermeden önce (aşağıdaki hatırlatma satırı veya `blacklistSuggestion` satırı), kullanıcı bu konuşmada işaretin şirketini, tarihlerini (son mülakat tarihi / geçen gün sayısı) ve gösterilecek diğer her alanı açıkça söylemiş veya onaylamış olmalıdır. Bu, "{company} için son mülakatın {lastInterviewDate} tarihinden bu yana {daysSinceLastInterview} gün geçtiği görünüyor; hatırladığınla uyuşuyor mu?" diye sorup evet yanıtı almak kadar basit olabilir; ya da kullanıcı aynı şirketi/tarihleri sorulmadan kendisi gündeme getirebilir. **Kullanıcı bu ayrıntıları onaylamadıysa o işareti göstermeden sessizce atla**; onaylanmamış ham takipçi verisinden hatırlatma satırını veya kara liste satırını gösterme.

Onaylandıktan sonra Adım 2 paneliyle birlikte tek bir hatırlatma satırı göster:

```text
[{language.output} dilinde yaz: "⏳ {company} — son mülakatından ({lastInterviewDate}) bu yana {daysSinceLastInterview} gün geçti ve kayıtlı bir yanıt yok. Bu, {thresholdDays} günlük nezaket eşiğini aşıyor."]
```

Kullanıcı onaylanmış bir işaret için ne yapması gerektiğini sorarsa, işaretin hazır `blacklistSuggestion` satırını göster ve ([{language.output} dilinde yaz]) bunu `data/blacklist.md` dosyasına kendisinin kopyalayabileceğini söyle; bu yalnızca bir öneridir. `language.output` İngilizce değilse, hatırlatma metnini (ve kullanıcı kara liste gerekçelerini başka bir dilde tutuyorsa satırın Reason hücresini) İngilizce `reason` dizesini olduğu gibi aktarmak yerine işaretin yapılandırılmış alanlarından (`reasonCode`, `daysSinceLastInterview`, `thresholdDays`, `lastInterviewDate`) oluştur; tablonun sütun düzeni ve değişmez `company` kapsam değeri sabit kalır (`data/blacklist.md` dosya biçimiyle eşleşmeleri gerekir). **Bu adımdan `data/blacklist.md`, `data/applications.md` veya `data/active-interviews.md` dosyasına asla yazma** (#1742 isteğe bağlılık güvencesi, `modes/interview-redflag.md` ile aynı yalnızca öneri köprüsü).

## Adım 2 — Kontrol Panelini Göster

Aciliyete (urgent > overdue > waiting > cold) göre sıralanmış bir ritim kontrol paneli göster:

```
Takip Ritmi (Cadence) Paneli — {date}
{N} başvuru izleniyor, {N} eyleme dönüştürülebilir

| # | Şirket | Rol | Durum (Status) | Gün | Takipler | Sonraki | Aciliyet | Kişi (Contact) |
```

Görsel göstergeler kullan:
- **URGENT (ACİL)** — 24 saat içinde yanıt verin (şirket yanıt verdi)
- **OVERDUE (GECİKMİŞ)** — takip zamanı geçti
- **waiting (X days) (bekleniyor)** — yolunda, takip planlandı
- **COLD (SOĞUK)** — 2+ takip gönderildi, kapatmayı öner

`Assessment`, `Interview`'dan ayrı bir yaşam döngüsü aşamasıdır. Yanıtlandı ritmini kullanır: ilk kontrol 1 gün sonra gelir, ardından daha yeni bir takip kaydedilmediği sürece her 3 günde bir. Platform, konu, puan ve tamamlanma ayrıntıları için değerlendirme günlüğünü (`data/assessments.tsv`) kullan.

## Adım 3 — Takip Taslakları Oluştur

Yalnızca her **gecikmiş (overdue)** veya **acil (urgent)** giriş için:

1. Şirket bağlamı için bağlantılı raporu (JSON içindeki `reportPath`) oku
2. Kanıt noktaları için `cv.md` dosyasını oku
3. Aday ismi ve kimliği için `config/profile.yml` dosyasını oku

**Ajans aracılı başvurular (#1596):** girişin `via` alanı ayarlıysa (ritim JSON'u doğrudan başvurular için `via: null` verir), takip hedefi şirket değil **ajans kişisidir** (notlarda/kişilerde adı geçen işe alım uzmanı); müşteri ilişkisinin sahibi odur ve yanıt vermek için kendi nedeni vardır. Role ajansın çerçevesiyle atıfta bulun.

**Son işveren bilinmiyorsa (şirket `?`), bu dal aşağıdaki çerçeve kurallarının YERİNE GEÇER; onlara düşme.** Anılacak bir şirket adı ve şirkete özel atıfta bulunulacak bir şey yoktur, bu yüzden bunun yerine:
- 1. cümle role **ajansın çerçevesiyle** (ilan başlıkları + işe alım uzmanının adı) **ve ne zaman başvurduğunla** atıfta bulunur; başvuru tarihi, çerçevenin istediği gibi girişte kalır; yalnızca şirket atfı değiştirilir, asla yer tutucu bir şirket adıyla değil.
- 2. cümledeki katkı, ilandaki haliyle role uyan cv.md/rapor kanıt noktalarından gelir; "O şirkete özel" kuralını atla.
- Müşteri adı isteğini ekle: son işverenin adını takibin doğal bir parçası olarak iste ("doğru hazırlanabilmem için bu rolün hangi şirkette olduğunu paylaşabilir misiniz?"). Bu bilgi, takipçide kanallar arası yinelenen kayıt tespitini açan şeydir.

`via` ayarlı ama işveren BİLİNİYORSA, alıcı dışında aşağıdaki çerçeveyi değiştirmeden kullan: işe alım uzmanına hitap et, müşteri şirketi adıyla an.

### E-posta Takip Çerçevesi (ilk takip, followupCount == 0)

3-4 cümlelik bir e-posta oluştur:

1. **1. Cümle:** Belirli role + ne zaman başvurduğuna atıfta bulun. Belirgin ol — şirket adını ve rol başlığını belirt.
2. **2. Cümle:** Raporun B Bloğu eşleşmesinden somut bir değer katan nokta veya cv.md'den bir kanıt noktası. Mümkünse nicelleştir (quantify).
3. **3. Cümle:** Yumuşak bir istek + müsaitlik durumu. ("Bu hafta" veya "önümüzdeki Salı" gibi) spesifik bir zaman aralığı sun.
4. **4. Cümle (İsteğe bağlı):** İlgili yeni bir proje veya başarıdan kısaca bahset.

**Kurallar:**
- Profesyonel ama sıcak, çaresiz DEĞİL
- **ASLA** "sadece kontrol etmek istedim (just checking in)", "takip etmek istedim (just following up)", "iletişime geçmek istedim (touching base)" veya "geri dönüş yapmak istedim (circling back)" GİBİ İFADELER KULLANMA
- İstekle değil, değerle (value) başla
- O şirkete özel bir şeye (rapor A Bloğu'ndan) atıfta bulun
- 150 kelimenin altında tut
- Bir konu satırı ekle
- `config/profile.yml` dosyasındaki aday adını kullan

**Örnek ton:**
> Subject: Re: Senior PHP/Laravel Developer — IxDF
>
> Merhaba [kişi adı veya "team/takım"],
>
> 7 Nisan'da Senior PHP/Laravel Developer rolü için başvurumu iletmiştim. Canlıdaki (production) Laravel uygulamamın (Barbeiro.app — 120 model, 315 API uç noktası, tam test paketi) ilanda tarif edilen TDD odaklı kültürle yakından örtüştüğünü paylaşmak istedim.
>
> 15 yıllık PHP deneyimimin ve pratik AI araçları iş akışımın IxDF platformuna nasıl katkı sağlayabileceğini konuşmayı çok isterim. Bu hafta kısa bir görüşme için herhangi bir zaman size uygun olur mu?
>
> Sevgiler,
> [Name]

### LinkedIn Takibi (e-posta adresi bulunamazsa)

`contacto` çerçevesini yeniden kullan: 3 cümle, maksimum 300 karakter.
- Şirkete özel kanca (hook) → kanıt noktası → yumuşak istek
- Önce doğru kişiyi bulması için kullanıcıya `/career-ops contacto {company}` komutunu çalıştırmasını öner

### İkinci Takip (followupCount == 1)

İlkinden daha kısa (2-3 cümle). **Yeni bir açı (angle)** yakala:
- İlgili bir içgörü, makale veya proje güncellemesi paylaş
- İlk takibin içeriğini tekrar etme
- Yine de spesifik olarak role atıfta bulun

### Soğuk Başvuru (Cold Application) (followupCount >= 2)

Başka bir takip taslağı OLUŞTURMA. Bunun yerine şunu öner:
> "Bu başvuruya yanıt alınamayan {N} adet takip yapıldı. Şunları düşünebilirsiniz:
> - Rol dolmuş gibi görünüyorsa durumu `Discarded` olarak güncellemek
> - `/career-ops contacto` üzerinden farklı bir kişi denemek
> - `Applied` durumunda bırakıp ancak önceliğini düşürmek"

### Şirket geçmişi bağlamı (isteğe bağlı)

Taslaktan önce şirketin kartını kontrol et. Takipçinin şirket alanı `?` ise (bilinmeyen işveren işareti; getirilecek anlamlı bir kart yoktur) bu sorguyu tamamen atla. Aksi halde şirket adını kendi başına, tek ve tırnaklı bir argüman olarak vererek `node company-history.mjs --company <company>` çalıştır; şirket adları meşru olarak tırnak, `$`, ters tırnak veya `;` içerebileceği için onu asla daha uzun bir kabuk dizesine ekleme. `responsiveness.label` değeri `silent-on-you` ise takibi caydırmak yerine beklentiyi ayarla: birçok süreç gerçekten yavaştır, bu yüzden bunu açıkça söyle ve bu denemeden sonra da sessiz kalırsa bu şirkete daha fazla zaman ayırmayı sınırlamayı öner. Gönderme kararı (ve kaç kez daha) kullanıcıya aittir; bu etiket yüzünden bir takibi asla atlama veya düşürme. Takibe uyum asla cezalandırılmaz.

## Adım 4 — Taslakları Sun

Her taslak için şunu göster:

```
## Takip: {Company} — {Role} (#{num})

**Kime:** {e-posta veya "Kişi bulunamadı — önce `/career-ops contacto` çalıştırın"}
**Konu:** {konu satırı}
**Başvurudan itibaren geçen gün:** {N}
**Gönderilen takipler:** {N}
**Kanal:** Email / LinkedIn

{taslak metni}
```

## Adım 5 — Takipleri Kaydet

Kullanıcı inceleyip bir takip gönderdiğini söyledikten sonra, bunu kaydet:

1. Eğer `data/follow-ups.md` yoksa, oluştur (tam olarak bu başlıkla — web arayüzünün yazdığıyla aynı; `followup-cadence.mjs` bu sütunları ayrıştırır):

   ```markdown
   # Follow-ups

   | num | appNum | date | company | role | channel | contact | notes |
   |---|---|---|---|---|---|---|---|
   ```

2. Şu bilgilerle bir satır ekle:
   - `num` = takipler tablosundaki sıradaki numara
   - `appNum` = takipçideki (tracker) başvuru numarası
   - `date` = bugünün tarihi (YYYY-MM-DD)
   - `company` = şirket adı
   - `role` = rol başlığı
   - `channel` = Email / LinkedIn / Phone / Other
   - `contact` = kime gönderildiği
   - `notes` = kısa not (örn. "İlk takip, Barbeiro.app belirtildi")

3. İsteğe bağlı olarak satırın notlarına `node set-status.mjs --report {report#} {current status} --note "Follow-up {N} sent {YYYY-MM-DD}"` ile "Follow-up {N} sent {YYYY-MM-DD}" ekle. Satırın mevcut durumunu vermek durumu değiştirmeden notu ekler; `data/applications.md` dosyasını elle düzenleme

**ÖNEMLİ:** Sadece kullanıcının gerçekten gönderdiğini onayladığı takipleri kaydet. Asla bir taslağı gönderildi olarak kaydetme.

### Sabitlenmiş sonraki tarihler & otomatik ekleme (seeding)

`data/follow-ups.md` ayrıca tek bir başvuru için hesaplanan programı geçersiz kılan (override) sabitleme satırlarını da destekler:

```text
- next #42 2026-07-10 (set 2026-07-02)
```

`#42` başvuru numarasıdır, ilk tarih sabitlenmiş (pinned) SONRAKİ takip tarihidir ve `(set …)` sabitlemenin yapıldığı gündür. Sabitlemeler, ayarlanan tarih veya sonrasında bir takip kaydedilene kadar hesaplanan programdan önceliklidir; başvuru başına en son sabitleme geçerli olur; satırı silmek sabitlemeyi temizler.

Bir başvuru "Applied" (Başvuruldu) durumuna geçtiğinde sabitlemeler OTOMATİK olarak eklenebilir (seeded) — `apply` modunun Adım 9'u tarafından çalıştırılan `node followup-seed.mjs <num>`, ilk takibi "başvuru tarihi + `applied_first` ritmi" şeklinde planlayan bir sabitleme ekler. Ekleme (seeding) idempotenttır (tekrarı aynı sonucu verir) ve daha sonraki bir Rejected/Discarded geçişi tarafından geride bırakılan geçersiz bir sabitleme zararsızdır, çünkü ritim analizi eyleme dönüştürülemeyen durumları yok sayar.

## Adım 6 — Özet

Tüm taslakları gösterdikten sonra özetle:

> **Takip Paneli** ({date})
> - {N} başvuru izleniyor
> - {N} gecikmiş (overdue) — taslaklar yukarıda oluşturuldu
> - {N} acil (urgent) — bugün yanıtlayın
> - {N} bekleyen (waiting) — sonraki takip tarihleri gösterildi
> - {N} soğuk (cold) — kapatmayı düşünün
>
> Yukarıdaki taslakları inceleyin ve hangilerini gönderdiğinizi bana söyleyin, böylece onları kaydedebilirim.

## Ritim Kuralları Referansı

| Durum (Status) | İlk takip | Sonrakiler | Maksimum deneme |
|--------|----------------|------------|-------------|
| Applied | Başvurudan 7 gün sonra | Her 7 günde bir | 2 (sonra soğuk (cold) işaretle) |
| Responded | 1 gün (acil yanıt) | Her 3 günde bir | Sınır yok |
| Assessment | 1 gün (değerlendirme daveti/teslimi) | Her 3 günde bir | Sınır yok |
| Interview | 1 gün sonra (teşekkür) | Her 3 günde bir | Sınır yok |

Bu varsayılanlar `node followup-cadence.mjs --applied-days N` komutu ile geçersiz kılınabilir (override).
