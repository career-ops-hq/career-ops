# Mod: pipeline — İlan Gelen Kutusu

`data/pipeline.md` dosyasına biriktirilen iş ilanı URL'lerini işler. İstediğin zaman URL ekle, hazır olduğunda `/career-ops pipeline` komutunu çalıştır.

## İş Akışı

1. **Oku** `data/pipeline.md` → "Bekleyenler" bölümündeki `- [ ]` satırlarını bul
2. **Her bekleyen URL için:**
   a. Sıradaki `REPORT_NUM` değerini atomik olarak rezerve etmek üzere `node reserve-report-num.mjs` komutunu çalıştır (ve rapor yazıldıktan sonra `node reserve-report-num.mjs --release <num>` çalıştırarak sentineli serbest bırak)
   b. **İlan içeriğini çek:** Playwright (browser_navigate + browser_snapshot) → WebFetch → WebSearch. **Playwright kullanılmadıysa** (toplu/headless mod veya yedek yola düşüldüyse) rapor başlığına `**Doğrulama:** doğrulanmamış (toplu mod)` etiketini ekle.
   c. URL erişilemiyorsa → `- [!]` olarak işaretle, not ekle ve bir sonrakine geç
   d. **Tam pipeline'ı çalıştır:** A-G değerlendirmesi → Rapor (.md) → PDF (puan ≥ 3,0 ise) → Takipçi
   e. **"Bekleyenler"den "İşlenenler"e taşı:** `- [x] #NNN | URL | Şirket | Rol | Puan/5 | PDF ✅/❌`
3. **3 veya daha fazla URL varsa ve Playwright kullanılmıyorsa** paralel ajan başlat (Agent aracı, `run_in_background`) — hızı artırır. Playwright etkinse tek tarayıcı örneği paylaşıldığından sıralı işle.
4. **Tamamlanınca** özet tabloyu göster:

```text
| # | Şirket | Rol | Puan | PDF | Önerilen eylem |
```

## pipeline.md Formatı

```markdown
## Bekleyenler
- [ ] https://kariyer.net/is-ilani/12345
- [ ] https://boards.greenhouse.io/sirket/jobs/456 | Şirket A.Ş. | Senior Backend Engineer
- [!] https://ozel.url/ilan — Hata: giriş gerekiyor

## İşlenenler
- [x] #143 | https://kariyer.net/is-ilani/789 | Acme Teknoloji | Backend Developer | 4.2/5 | PDF ✅
- [x] #144 | https://boards.greenhouse.io/xyz/jobs/012 | BigCo | Frontend Engineer | 2.1/5 | PDF ❌
```

> Not: Bölüm başlıkları EN ("Pending"/"Processed"), ES ("Pendientes"/"Procesadas") veya TR ("Bekleyenler"/"İşlenenler") olabilir. Okurken esnek ol; yazarken mevcut dosyanın stilini koru.

## URL'den İlan İçeriği Çekme

1. **Playwright (tercih edilen):** `browser_navigate` + `browser_snapshot` — tüm SPA'larla çalışır.
   - **İsteğe bağlı — CLI çıkarıcı (`config/profile.yml` içinde `scan.extractor: cli`):** bunun yerine `node browser-extract.mjs <url>` (`--mode jd`) çalıştır — kompakt `{ "url", "title", "text" }`, daha az token (portala bağlı). Hata veya eksiklik durumunda **sessizce** `browser_navigate` + `browser_snapshot`'a geri dön.
2. **WebFetch (yedek):** Playwright mevcut değilse (toplu/headless mod). Bu durumda rapor başlığına `**Doğrulama:** doğrulanmamış (toplu mod)` ekle — kullanıcı daha sonra manuel doğrulayabilir.
3. **WebSearch (son çare):** İlanı indeksleyen diğer platformlarda ara. WebFetch'te olduğu gibi rapor başlığına `**Doğrulama:** doğrulanmamış (toplu mod)` ekle.

**Özel durumlar:**
- **Kariyer.net:** Playwright ile sorunsuz çalışır; giriş gerektirmez.
- **Yenibiris.com:** Playwright ile çalışır.
- **LinkedIn:** Giriş gerektirebilir → `[!]` olarak işaretle, adaydan ilan metnini yapıştırmasını iste.
- **PDF linki:** URL doğrudan bir PDF'e işaret ediyorsa Read aracıyla oku.
- **`local:` öneki:** Yerel dosyayı oku. Örnek: `local:jds/kariyer-backend.md` → `jds/kariyer-backend.md` oku.

## Rapor Numaralandırma

1. Sıradaki rapor numarasını atomik olarak rezerve etmek için `node reserve-report-num.mjs` komutunu çalıştır (standart çıktı `{###}` değerini döndürür).
2. Bu numarayı kullanarak rapor dosyasını yaz.
3. Rapor yazıldıktan sonra `node reserve-report-num.mjs --release {###}` komutunu çalıştırarak sentineli serbest bırak.

## Başlamadan Önce

Herhangi bir URL'yi işlemeden önce yapılandırma kontrolü çalıştır:
```bash
node cv-sync-check.mjs
```
Uyarı varsa adayı bilgilendirmeden devam etme.
