# Mod: followup -- Takip Ritmi (Cadence) İzleyici

> **`voice-dna.md` dosyasını (varsa) oku ve oluşturulan her e-posta/LinkedIn taslağına uygula.** Bu mod bağımsızdır — `_shared.md` dosyasını YÜKLEMEZ, bu yüzden `voice-dna.md` dosyasını doğrudan oku. Takip taslakları sohbete dayalıdır (conversational), bu nedenle tam korumayı (guardrail) uygula: yasaklı kelimeler/ifadeler/kalıplar, m-tire (em-dash) yok, olumsuz paralellikler yok (§3-4) VE sohbete dayalı üslup — kısaltmalar, değişken ritim, doğrudan "Ben"/"Sen" kullanımı (§1-2). Asla `cv.md` içindeki gerçek bir metriği stil uğruna çıkarma veya yumuşatma.

## Amaç

Aktif başvurular için takip ritmini (cadence) izle. Gecikmiş (overdue) takipleri işaretle, notlardan kişileri çıkar ve rapor bağlamını kullanarak kişiselleştirilmiş Takip / Durum Kontrolü e-posta/LinkedIn taslakları oluştur.

## Girdiler

- `data/applications.md` — Başvuru takipçisi
- `data/follow-ups.md` — Takip geçmişi (ilk kullanımda oluşturulur)
- `reports/` — Değerlendirme raporları (taslaklarda bağlam için)
- `config/profile.yml` — Kullanıcı profili (isim, kimlik)
- `cv.md` — Taslaklardaki kanıt noktaları için CV

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
| `cadenceConfig` | Ritim kuralları (başvuruldu: 7 gün, yanıtlandı: 3 gün, mülakat: 1 gün) |

Eğer eyleme dönüştürülebilir giriş yoksa, kullanıcıya şunu söyle:
> "Takip edilecek aktif başvuru yok. Önce `/career-ops` ile bazı rollere başvurun ve beklemeye geçtiklerinde tekrar gelin."

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

## Adım 3 — Takip Taslakları Oluştur

Yalnızca her **gecikmiş (overdue)** veya **acil (urgent)** giriş için:

1. Şirket bağlamı için bağlantılı raporu (JSON içindeki `reportPath`) oku
2. Kanıt noktaları için `cv.md` dosyasını oku
3. Aday ismi ve kimliği için `config/profile.yml` dosyasını oku

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
   - `channel` = Email / LinkedIn / Other
   - `contact` = kime gönderildiği
   - `notes` = kısa not (örn. "İlk takip, Barbeiro.app belirtildi")

3. İsteğe bağlı olarak `data/applications.md` dosyasındaki Notes sütununu "Follow-up {N} sent {YYYY-MM-DD}" şeklinde güncelle

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
| Interview | 1 gün sonra (teşekkür) | Her 3 günde bir | Sınır yok |

Bu varsayılanlar `node followup-cadence.mjs --applied-days N` komutu ile geçersiz kılınabilir (override).
