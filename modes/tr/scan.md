# Mod: scan — Portal Tarayıcı (İş Keşfi)

Yapılandırılmış iş portallarını tara, başlık ilgisine göre filtrele ve yeni iş ilanlarını sonradan değerlendirilmek üzere ardışık düzene (pipeline) ekle.

> **Not (v1.6+):** Varsayılan tarayıcı (`scan.mjs` / `npm run scan`) **sıfır jeton** (zero-token) kullanır ve yapılandırılmış kaynaklardan yararlanır: şirket başına yapılandırılmış yerel ayrıştırıcılar (local parsers) ve genel Greenhouse, Ashby, Lever API'leri. Aşağıda açıklanan Playwright/WebSearch seviyeleri tarayıcının kendisinin değil, **ajan** iş akışının (yapay zeka ajanı tarafından yürütülen) temsilidir. Bir şirketin yerel ayrıştırıcısı veya Greenhouse/Ashby/Lever API'si yoksa, `scan.mjs` o şirketi yok sayar; bu durumlarda ajan Seviye 1 (Playwright) veya Seviye 3'ü (WebSearch) manuel olarak tamamlamalıdır.
>
> **Kural (v1.8+):** Bir şirketin yerel ayrıştırıcısı Seviye 0'da başarıyla tamamlanırsa, ajan o şirketi Playwright (Seviye 1) veya API (Seviye 2) içinde **tekrarlamamalıdır**. Seviye 3'te genel sorgular aktif kalır, ancak halihazırda bir ayrıştırıcı tarafından kapsanmış olan şirketlerden gelen sonuçlar reddedilir. Bkz: [Kural: Başarılı Yerel Ayrıştırıcı](#kural-başarılı-yerel-ayrıştırıcı--pahalı-kazıma-tekrarı-yok).

## Önerilen Çalıştırma (Recommended Execution)

Ana etkileşimli bağlamı (interactive context) tüketmekten kaçınmak için, eğer komut satırı arayüzün (CLI) destekliyorsa bunu bir çalışan (worker) / alt ajan (subagent) olarak yürüt:

```python
Agent(
    subagent_type="general-purpose",
    prompt="[content of this file + specific data]",
    run_in_background=True
)
```

Oluşturulan alt ajan bir **tek geçişli çalışandır** (single-pass worker): aşağıda adlandırılan ayrıştırıcılar (parsers)/API'ler/Playwright/WebSearch ile taramayı doğrudan çalıştırır. Başka alt ajanlar oluşturmamalı veya diğer becerileri (skills) çağırmamalıdır (bkz. `modes/_shared.md` → Subagent delegation). Tarama işlemi `portals.yml` ile sınırlandırılmıştır; asla açık uçlu bir araştırma görevi değildir.

## Yapılandırma (Configuration)

Şunları içeren `portals.yml` dosyasını oku:
- `search_queries`: Portal bazında `site:` filtrelerine sahip WebSearch sorguları listesi (geniş keşif).
- `tracked_companies`: Doğrudan navigasyon için `careers_url` içeren belirli şirketler.
- `tracked_companies[].parser`: SSR sayfaları veya kararlı HTML için isteğe bağlı yerel ayrıştırıcı.
- `title_filter`: İş unvanlarını filtrelemek için anahtar kelimeler (olumlu/olumsuz/kıdem_artışı).

## Keşif Stratejisi (4 Seviye)

### Seviye 0 — Yerel Ayrıştırıcı (EN UCUZ)

**Yapılandırılmış bir `parser` değerine sahip `tracked_companies` içindeki her şirket için:** `portals.yml` içinde tanımlanan yerel ayrıştırıcıyı (local parser) yürüt. Bu seviye, kariyer sayfası SSR veya kararlı HTML kullandığında ve halihazırda ajan yardımı olmadan iş ilanlarını çıkaran yerel bir JavaScript, Python veya başka bir çalışma zamanı betiği (runtime script) olduğunda idealdir.

Önerilen Sözleşme (Contract):

```yaml
- name: Example Company
  careers_url: https://example.com/careers
  scan_method: local_parser
  parser:
    command: node
    script: scripts/parsers/example-company-jobs.js
    format: jobs-json-v1
  enabled: true
```

Genellikle ayrıştırıcı şirkete özeldir ve URL'yi, seçicileri (selectors) ve sayfalandırmayı (pagination) zaten bilir. `args` isteğe bağlıdır: betik yazarına nasıl yardımcı olacaksa öyle kullanın; örneğin şirketler arasında yeniden kullanmak, `{careers_url}` veya `{company}` aktarmak, bir hata ayıklama (debug) bayrağını etkinleştirmek, bir JSON anlık görüntüsü (snapshot) kaydetmek veya ayrıştırıcıya özel herhangi bir davranışı kontrol etmek için.

Ayrıştırıcı stdout'a JSON formatında çıktı vermelidir:

Dizi (Array) formatı:

```json
[
  { "title": "Senior AI Engineer", "url": "https://example.com/jobs/123", "location": "Remote" }
]
```

`jobs` içeren nesne (Object) formatı:

```json
{
  "jobs": [
    { "title": "Senior AI Engineer", "url": "https://example.com/jobs/123", "location": "Remote" }
  ]
}
```

`results` içeren nesne formatı:

```json
{
  "results": [
    { "title": "Senior AI Engineer", "url": "https://example.com/jobs/123", "location": "Remote" }
  ]
}
```

`company` isteğe bağlıdır; eğer sağlanmazsa, `scan.mjs` ismi `tracked_companies` üzerinden kullanır.

Tarayıcının (scanner) stdout okunduktan sonra tam JSON'u kalıcı olarak saklamasına gerek yoktur. Bir ayrıştırıcı denetim (auditing) veya hata ayıklama için ayrıca bir yapı (artifact) oluşturursa, bunu `data/parser-output/{company}/` altına kaydedin ve git haricinde tutun (`.gitignore` içindeki JSON dosyaları; dizin yapısını korumak için `.gitkeep` dosyaları git'te tutulur).

### Kural: Başarılı Yerel Ayrıştırıcı — Pahalı Kazıma Tekrarı Yok

`scan_method: local_parser` işleminin amacı **jeton sayısını azaltmaktır** (reduce tokens): LLM'nin aynı şirketi Playwright veya gereksiz API'ler kullanarak tekrar taramasını (rescraping) engellemek.

Ajanın taraması sırasında, **`local_parser_ok`** kümesini bellekte tut. Bu küme, Seviye 0'ın başarıyla tamamlandığı şirketlerin isimlerini (`tracked_companies[].name`) içerir:

- `parser.command` + `parser.script` mevcuttur ve betik ölümcül (fatal) bir hata vermeden çalışmıştır.
- stdout geçerli bir JSON'dur (`[]`, `{ jobs: [] }`, veya `{ results: [] }`).
- Herhangi bir zaman aşımı (timeout) veya süreç çökmesi yaşanmamıştır.

| Level | If the company is in `local_parser_ok` |
|-------|----------------------------------------|
| **1 — Playwright** | **Atla (Skip)** — söz konusu `careers_url`'ye `browser_navigate` yapma (jeton tüketen en pahalı yöntem) |
| **2 — API** | **Atla** — `api:` uç noktasına WebFetch yapma (halihazırda ayrıştırıcı tarafından kapsanmaktadır; `scan.mjs` de başarılı bir ayrıştırıcı sonrasında API kullanmaz) |
| **3 — WebSearch** | **Genel** sorguları çalıştır (`site:`, rol unvanları); normalize edilmiş şirketi `local_parser_ok` ile eşleşen tüm bulguları **reddet** |

**İstisnalar:**

- Ayrıştırıcı **başarısız olduysa** → şirket `local_parser_ok` içine **eklenmez**; Seviye 1 ve 2 normal olarak uygulanır (ayrıştırıcı başarısız olduğunda ve ATS API'si mevcut olduğunda `scan.mjs` içindeki yedek yöntemle (fallback) aynı kriterler geçerlidir).
- Seviye 3: kapsamlı sorguları devreden çıkarma (`site:jobs.ashbyhq.com`, `site:boards.greenhouse.io`, vb.) — bunlar **yeni** şirketleri keşfetmek için kullanılır. Yalnızca halihazırda başarılı bir ayrıştırıcıyla `tracked_companies` içinde yer alan şirketlere ait sonuçları filtrele.
- Aktif bir yerel ayrıştırıcısı olan bir şirket için özel `search_queries` oluşturma (örneğin `site:jobs.ashbyhq.com/cohere "AI Engineer"`); ayrıştırıcıyı kullan, başarısız olursa Playwright/API'ye başvur.

**Önerilen Seviye 0:** Tüm sıfır jetonluk (zero-token) yerel ayrıştırıcıları + API'leri tek adımda kapsamak için ajan iş akışının en başında `node scan.mjs` (veya `npm run scan`) komutunu çalıştır ve `local-parser` yöntemini başarıyla kullanan şirketleri geri döndür.

### Seviye 1 — Doğrudan Playwright (BİRİNCİL)

**`local_parser_ok` içinde bulunmayan `tracked_companies` listesindeki her bir şirket için:** Playwright ile ilgili şirketin `careers_url` adresine git (`browser_navigate` + `browser_snapshot`), GÖRÜNÜR durumdaki tüm iş ilanlarını (job listings) oku ve her biri için başlık (title) + URL'yi çıkar. Bu en güvenilir yöntemdir, çünkü:
- Sayfayı eşzamanlı olarak görüntüler (önbelleğe alınmış Google sonuçlarını değil)
- SPA'lar ile çalışır (Ashby, Lever, Workday)
- Yeni ilanları anında tespit eder
- Google'ın indekslemesine bağlı değildir

**Her şirketin portals.yml dosyasında bir `careers_url` tanımlaması OLMALIDIR.** Eğer yoksa, bir kez ara, kaydet ve gelecekteki taramalarda kullan.

### Seviye 2 — ATS API'leri / Akışları (TAMAMLAYICI)

Açık bir API'si veya yapılandırılmış akışı (feed) olan ve **`local_parser_ok` içinde bulunmayan** şirketler için, Seviye 1'e hızlı bir tamamlayıcı olarak JSON/XML yanıtını kullan. Bu yöntem Playwright'tan daha hızlıdır ve görsel kazıma (scraping) hatalarını azaltır.

**Mevcut Destek (`{}` içindeki değişkenler):**
- Tam sağlayıcı (provider) tablosu: [Supported job boards](../docs/SUPPORTED_JOB_BOARDS.md)

- **Greenhouse**: `https://boards-api.greenhouse.io/v1/boards/{company}/jobs`
- **Ashby**: `https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true`
- **BambooHR**: liste `https://{company}.bamboohr.com/careers/list`; ilan detayları `https://{company}.bamboohr.com/careers/{id}/detail`
- **Lever**: `https://api.(eu.)?lever.co/v0/postings/{company}`
- **Teamtailor**: `https://{company}.teamtailor.com/jobs.rss`
- **Workday**: `https://{company}.{shard}.myworkdayjobs.com/wday/cxs/{company}/{site}/jobs`
- **Breezy**: `https://{company}.breezy.hr/json`

**Sağlayıcıya Göre Ayrıştırma (Parsing) Kuralları:**
- `greenhouse`: `jobs[]` → `title`, `absolute_url`
- `ashby`: GET REST API → `jobs[]` üzerinden `title`, `jobUrl`, `location`, `publishedAt`; slug, `careers_url` yapısından (`jobs.ashbyhq.com/{slug}`) türetilir
- `bamboohr`: liste `result[]` → `jobOpeningName`, `id`; detay URL'sini oluştur `https://{company}.bamboohr.com/careers/{id}/detail`; tam İş Tanımını (JD) okumak için detay URL'sine GET isteği yap ve `result.jobOpening` kullan (`jobOpeningName`, `description`, `datePosted`, `minimumExperience`, `compensation`, `jobOpeningShareUrl`)
- `lever`: kök dizi (root array) `[]` → `text`, `hostedUrl` (yedek: `applyUrl`)
- `teamtailor`: RSS öğeleri (items) → `title`, `link`
- `workday`: `jobPostings[]`/`jobPostings` (kiracıya/tenant göre) → `title`, `externalPath` veya sunucudan türetilmiş URL
- `breezy`: en üst düzey dizi (top-level array) `[]` → `name`, `url` (mutlak - absolute), `location.name` (veya şehir/eyalet/ülke + `is_remote`), `published_date`

> **Dikkat — kırpılmış bir okumadan yola çıkarak ilanın bulunmadığı çıkarımını yapma.** Kariyer amaçlı SPA'lar sayfalandırma (pagination) ve tembel yükleme (lazy-load) kullanır; bir sayfanın `browser_snapshot` veya WebFetch çıktısı (ve o HTML'in herhangi bir LLM özeti), satırları sessizce düşürerek yalnızca ilk sayfadaki rolleri gösterebilir. Asla böyle bir okumadan yola çıkarak "X rolü yayında değil" veya "sadece N rol mevcut" sonucuna varma. Şirketin açık bir ATS API'si varsa, herhangi bir varlık/yokluk (presence/absence) iddiasında bulunmadan önce doğrudan bu API'yi vur (sağlayıcının desteklediği yerlerde `?content=true` ekleyerek) — API tüm ilan tahtasını yapılandırılmış tek bir yanıtla döndürür.

### Seviye 3 — WebSearch Sorguları (GENİŞ KEŞİF)

`site:` filtreleriyle donatılmış `search_queries`, portalları çaprazlama (transversally - tüm Ashby, tüm Greenhouse, vb.) kapsar. Henüz `tracked_companies` içinde olmayan YENİ şirketleri keşfetmek için kullanışlıdır, ancak sonuçlar eski (outdated) olabilir. `local_parser_ok` içindeki şirketlere ait sonuçlar filtrelendikten sonra, kalan sonuçlar Seviye 0–2 verileriyle tekilleştirilir (deduplicated).

> **Dikkat — Seviye-3 sonuçları haftalarca eski olabilir.** WebSearch, canlı ilan tahtasını geriden takip eden bir arama dizininden (search index) beslenir, bu nedenle bir sonuç aslında kapanmış bir ilanı tarif ediyor olabilir. Her Seviye-3 bulgusunu doğrulanmamış (unverified) olarak değerlendir: `data/pipeline.md` içine eklemeden veya değerlendirmeden önce gerçek ilan üzerinden aktifliğini onayla (ATS sunuculu sayfalar için `node check-liveness.mjs <url>`, ATS dışı sayfalar için Playwright kullan). Seviye 2'deki gerçek zamanlı ATS yanıtlarının aksine, bir Seviye-3 parçacığı (snippet) asla bir rolün hala açık olduğunun kanıtı değildir.

**Execution Priority:**
1. Seviye 0: Local Parser → `parser:` ayarı ve mevcut bir betiği olan şirketler; `local_parser_ok` listesini oluştur
2. Seviye 1: Playwright → `careers_url` sahibi olan ve `local_parser_ok` içinde **olmayan** `tracked_companies`
3. Seviye 2: API → `api:` sahibi olan ve `local_parser_ok` içinde **olmayan** `tracked_companies`
4. Seviye 3: WebSearch → `enabled: true` olan tüm `search_queries`; `local_parser_ok` içindeki şirketlere ait bulguları reddet

Seviyeler eklenebilirdir (additive) — sırasıyla çalıştırılırlar ve sonuçlar birleştirilerek tekilleştirilir. `local_parser_ok` içindeki şirketler Seviye 1 veya 2'den **geçmez**; Seviye 3'te sadece çapraz keşfe (aynı portaldaki diğer şirketler) katkı sağlarlar.

## İş Akışı (Workflow)

1. **Read Configuration**: `portals.yml`
2. **Read History**: `data/scan-history.tsv` → daha önce görülmüş URL'ler
3. **Read Dedup Sources**: `data/applications.md` + `data/pipeline.md`

3.5. **Level 0 — Local Parser** (`scan.mjs`, sıfır-jeton):
   `local_parser_ok = []` olarak başlat.
   Tüm sıfır-jetonluk yerel ayrıştırıcıları + API'leri kapsamak için `node scan.mjs` komutunu bir kez çalıştırmayı tercih et; eğer manuel olarak çalıştırıyorsan aşağıdaki mantığı tekrar et.
   `enabled: true`, `parser.command` ve mevcut bir betiğe sahip `tracked_companies` içindeki her şirket için:
   a. `parser.command`'i `parser.script` + `parser.args` ile yerel süreç yürütme (local process execution) üzerinden kabuk (shell) kullanmadan yürüt.
   b. Argümanlardaki `{careers_url}` ve `{company}` yer tutucularını (placeholders) doldur.
   c. stdout üzerinden JSON verisini oku (`[]`, `{ jobs: [] }` veya `{ results: [] }`).
   d. Her bir iş ilanını `{title, url, company, location}` olarak normalize et.
   e. Göreceli (relative) URL'leri `careers_url`'ye göre çözümle (resolve).
   f. Ayrıştırıcı başarısız olursa, hatayı günlüğe kaydet (log), eğer varsa ATS API üzerinden yedek yönteme geç ve diğer şirketlerle devam et (`local_parser_ok` listesine **ekleme**).
   g. Ayrıştırıcı başarıyla tamamlanırsa (c-e adımları ölümcül hata olmadan geçerse), `entry.name` değerini `local_parser_ok` listesine ekle ve iş ilanlarını adaylar havuzunda (candidates) biriktir.

4. **Level 1 — Playwright Scan** (3-5'lik gruplar halinde paralel çalıştır):
   `enabled: true`, tanımlanmış bir `careers_url` değerine sahip olan ve **ismi `local_parser_ok` içinde yer almayan** `tracked_companies` içindeki her şirket için:
   a. `careers_url` adresine `browser_navigate` yap.
   b. Tüm iş ilanlarını okumak için `browser_snapshot` al.
   c. Sayfada filtreler/departmanlar varsa ilgili bölümlere git.
   d. Her iş ilanı için `{title, url, company}` verilerini çıkar.
   e. Sayfalandırma varsa sonraki sayfalara git.
   f. Adaylar listesinde biriktir.
   g. `careers_url` hata verirse (404, yönlendirme vb.), yedek yöntem olarak `scan_query` kullan ve daha sonra URL'yi güncellemek için not et.

5. **Level 2 — ATS APIs / Feeds** (paralel çalıştır):
   Tanımlanmış bir `api:` değerine, `enabled: true` durumuna sahip ve **ismi `local_parser_ok` içinde yer almayan** `tracked_companies` içindeki her şirket için:
   a. API/akış (feed) URL'sini WebFetch et.
   b. Eğer `api_provider` tanımlanmışsa ilgili ayrıştırıcıyı kullan; eğer tanımsızsa alan adından (domain) çıkarım yap (`boards-api.greenhouse.io`, `api.ashbyhq.com`, `api.(eu.)?lever.co`, `*.bamboohr.com`, `*.teamtailor.com`, `*.myworkdayjobs.com`, `*.breezy.hr`).
   c. **Ashby** için, `https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true` adresine GET isteği gönder (slug `careers_url` adresinden türetilir). `jobs[]` üzerinden `title`, `jobUrl`, `location` verilerini ayıkla. GraphQL gerekmez.
   d. **BambooHR** için, liste yalnızca temel meta verileri (metadata) döndürür. İlgili her ilan için `id` değerini çek, `https://{company}.bamboohr.com/careers/{id}/detail` adresine GET isteği yap ve tam İş Tanımını (JD) `result.jobOpening` içerisinden çıkar. Varsa halka açık URL olarak `jobOpeningShareUrl` kullan; yoksa detay URL'sini kullan.
   e. **Workday** için, en az `{"appliedFacets":{},"limit":20,"offset":0,"searchText":""}` yükü (payload) içeren bir JSON POST isteği gönder ve sonuçlar tükenene kadar `offset` kullanarak sayfalandırma yap.
   f. Her bir iş ilanı için çıkar ve normalize et: `{title, url, company}`.
   g. Adaylar listesinde biriktir (Seviye 1 ile tekilleştirilmiş).

6. **Level 3 — WebSearch Queries** (mümkünse paralel çalıştır):
   `enabled: true` olarak işaretlenmiş `search_queries` içindeki her sorgu için (aktif bir yerel ayrıştırıcısı olan şirketlere özel sorgular değil, portal/rol odaklı genel sorgular):
   a. Belirtilen `query` ile WebSearch yürüt.
   b. Her bir sonuçtan `{title, url, company}` çıkar.
      - **title**: sonuç başlığından (" @ " veya " | " öncesi)
      - **url**: sonucun URL'si
      - **company**: başlıkta " @ " sonrasından veya alan adı/dizin yolundan (domain/path) çıkar
   c. Normalize edilen `company` ismi `local_parser_ok` listesindeki herhangi bir isimle eşleşiyorsa sonucu **Atla (Skip)**.
   d. Kalanları adaylar listesinde biriktir (Seviye 0+1+2 ile tekilleştirilmiş).

6a. **Filter by Title** `portals.yml` içindeki `title_filter` değerlerini kullanarak:
   - `positive` listesinden en az 1 anahtar kelime başlıkta görünmelidir (büyük/küçük harf duyarsız - case-insensitive).
   - `negative` listesinden hiçbir anahtar kelime geçmemelidir.

6b. **Filter by Location (Optional)** `portals.yml` içindeki `location_filter` değerlerini kullanarak:
   - Eğer `location_filter` bloğu yoksa, tüm lokasyonlar onay alır (varsayılan davranış).
   - İlanda lokasyon belirtilmemişse (empty) → onay alır (eksik veri nedeniyle cezalandırma).
   - `block` listesinden herhangi bir anahtar kelime mevcutsa → reddet (allow listesinden önce gelir).
   - `allow` listesi boşsa → onay alır (zaten block listesini geçmiştir).
   - `allow` listesi doluysa → en az bir kelime ile eşleşmelidir.
   - Tüm eşleşmeler, alt dize bazlı ve büyük/küçük harf duyarsızdır (case-insensitive substring matches).
   - Lokasyon bilgisi daha sonra denetlemek üzere `scan-history.tsv` dosyasındaki 7. sütuna kaydedilir.

7. **Deduplicate** 3 ayrı kaynak üzerinden:
   - `scan-history.tsv` → aynı URL daha önce görülmüş
   - `applications.md` → normalize edilmiş şirket + rol daha önce değerlendirilmiş
   - `pipeline.md` → aynı URL beklemede veya işlenmiş listesinde

7.1. **Cross-listing check (#1597)** — `scan.mjs` içinde otomatiktir, sadece uyarır:
   - Yeni her bir teklifin JD içeriği (sağlayıcının liste API'si bu metni sağlıyorsa, örn. Lever) parmak izine (64-bit SimHash, `scan-history.tsv` 8. sütunu) dönüştürülür.
   - Neredeyse birebir aynı içerik, son 90 gün içinde **farklı bir şirket** altında görüldüyse, tarama özetinde uyarılır — bunun olağan nedeni, işveren ismi gizlenmiş bir ajansın doğrudan ilanı yeniden yayınlamasıdır. URL ve şirket+rol tekilleştirmesi bu durumu yakalayamaz.
   - Otomatik olarak hiçbir veri silinmez. Taraflardan biri ajans ise, başvuruyu yalnızca TEK bir kanal üzerinden yapın (bkz. 'Via' kanal iş akışı, #1596) — çifte başvuru adayın her iki tarafla da arasını bozar.
   - Kullanılabilir bir açıklaması (description) olmayan tekliflere parmak izi verilmez ve asla uyarı atılmaz (gövde metni yok → sinyal yok, hatalı pozitif bildirim yok).

7.5. **Verify Liveness of WebSearch Results (Level 3)** — Ardışık düzene (pipeline) eklemeden ÖNCE:

   WebSearch sonuçları eski olabilir (Google sonuçları haftalar veya aylar boyunca önbellekte tutar). Süresi dolmuş ilanları değerlendirmekten kaçınmak için Seviye 3'ten gelen her YENİ URL'yi Playwright ile doğrula. Seviye 1 ve 2 yapıları gereği gerçek zamanlı olduklarından bu doğrulamayı gerektirmezler.

   Her yeni Seviye 3 URL'si için (sıralı - ASLA Playwright'ı paralel çalıştırma):
   a. URL'ye `browser_navigate` yap.
   b. İçeriği okumak için `browser_snapshot` al.
   c. Sınıflandır:
      - **Aktif (Active)**: görünür iş başlığı + rol açıklaması + ana içerik alanında Apply/Submit/Apply Now butonu mevcut. Standart başlık (header)/gezinme (navbar)/alt bilgi (footer) metinlerini hesaba katma.
      - **Süresi Dolmuş (Expired)** (bu sinyallerden herhangi biri):
        - Son URL `?error=true` içeriyor (Greenhouse, teklif kapandığında buraya yönlendirir).
        - Sayfa şu metinleri içeriyor: "job no longer available" (iş artık mevcut değil) / "no longer open" (artık açık değil) / "position has been filled" (pozisyon dolduruldu) / "this job has expired" (bu ilanın süresi doldu) / "page not found" (sayfa bulunamadı).
        - Hiçbir JD içeriği olmadan yalnızca gezinme (navbar) ve alt bilgi (footer) görünür durumda (içerik < ~300 karakter).
   d. Süresi dolmuşsa (expired): `scan-history.tsv` dosyasına `skipped_expired` durumu ile kaydet ve reddet.
   e. Aktif ise (active): 8. adıma geç.

   **Tek bir URL hata verirse tüm taramayı iptal etme.** Eğer `browser_navigate` hata verirse (zaman aşımı - timeout, 403 vb.), kalıcı `skipped_expired` durumu atamak yerine `skipped_error` (veya unconfirmed) olarak işaretle ve bir sonrakine geç; böylece geçici ağ hataları ilanları kalıcı olarak tamamen yok saymaz.

8. **For each new verified offer that passes filters**:
   a. `pipeline.md` "Pending" (Beklemede) bölümüne ekle: `- [ ] {url} | {company} | {title}`
   b. `scan-history.tsv`'ye kaydet: `{url}\t{date}\t{query_name}\t{title}\t{company}\tadded\t{location}`

9. **Offers filtered by title**: `scan-history.tsv`'ye `skipped_title` durumuyla kaydet.
10. **Duplicate offers**: `skipped_dup` durumuyla kaydet.
11. **Expired offers (Level 3)**: `skipped_expired` durumuyla kaydet.

## WebSearch Sonuçlarından Başlık ve Şirket Çıkarımı

WebSearch sonuçları genellikle şu formatlarda gelir: `"Job Title @ Company"`, `"Job Title | Company"` veya `"Job Title — Company"`.

Portal bazında çıkarım (extraction) kalıpları:
- **Ashby**: `"Senior AI PM (Remote) @ EverAI"` → title: `Senior AI PM`, company: `EverAI`
- **Greenhouse**: `"AI Engineer at Anthropic"` → title: `AI Engineer`, company: `Anthropic`
- **Lever**: `"Product Manager - AI @ Temporal"` → title: `Product Manager - AI`, company: `Temporal`

Jenerik regex: `(.+?)(?:\s*[@|—–-]\s*|\s+at\s+)(.+?)$`

## Özel (Private) URL'ler

Kamuya açık (publicly accessible) olmayan bir URL bulunursa:
1. JD metnini `jds/{company}-{role-slug}.md` içine kaydet.
2. `pipeline.md` içine şu şekilde ekle: `- [ ] local:jds/{company}-{role-slug}.md | {company} | {title}`

## Tarama Geçmişi (Scan History)

`data/scan-history.tsv` görülen TÜM URL'leri takip eder:

```tsv
url	first_seen	portal	title	company	status	location
https://...	2026-02-10	Ashby — AI PM	PM AI	Acme	added	Remote
```

## Çıktı Özeti (Output Summary)

```text
Portal Taraması — {YYYY-MM-DD}
━━━━━━━━━━━━━━━━━━━━━━━━━━
Çalıştırılan sorgular: N
Bulunan ilanlar: N toplam
Başlığa göre filtrelenen: N uygun
Kopyalar: N (zaten değerlendirilmiş veya ardışık düzende)
Süresi dolanlar (atıldı): N (ölü bağlantılar, Seviye 3)
pipeline.md dosyasına yeni eklenenler: N

  + {company} | {title} | {query_name}
  ...

→ Yeni teklifleri değerlendirmek için `pipeline` modunu çalıştır (varsa `/career-ops pipeline` çalıştır veya ajandan `pipeline` çalıştırmasını iste).
```

## careers_url Yönetimi

`tracked_companies` altındaki her şirket mutlaka bir `careers_url`'ye (ilanlar sayfasına giden doğrudan URL) sahip olmalıdır. Bu, adresi her defasında arama zahmetinden kurtarır.

**KURAL: Daima şirketin kurumsal kariyer URL'sini kullan; eğer kurumsal bir kariyer sayfası yoksa yalnızca o zaman doğrudan ATS uç noktasına (endpoint) başvur.**

`careers_url`, mümkün olan her durumda şirketin kendi kariyer sayfasını işaret etmelidir. Birçok şirket arka planda Workday, Greenhouse veya Lever kullansa da boş pozisyon ID'lerini sadece kendi kurumsal alan adları üzerinden açık eder. Kurumsal bir kariyer sayfası varken doğrudan ATS URL'si kullanmak, iş ID'lerinin eşleşmemesi nedeniyle hatalı 410 (Bulunamadı) dönüşlerine neden olabilir.

| ✅ Doğru (kurumsal) | ❌ İlk tercih olarak Yanlış (doğrudan ATS) |
|---|---|
| `https://careers.mastercard.com` | `https://mastercard.wd1.myworkdayjobs.com` |
| `https://openai.com/careers` | `https://job-boards.greenhouse.io/openai` |
| `https://stripe.com/jobs` | `https://jobs.lever.co/stripe` |

Yedek Yöntem: Sadece doğrudan ATS URL'sine sahipseniz, önce şirketin web sitesine gidip kurumsal kariyer sayfasını bulun. Şirketin kendi kurumsal kariyer sayfası yoksa doğrudan ATS URL'sini kullanın.

**Platformlara Göre Bilinen Kalıplar:**
- **Ashby:** `https://jobs.ashbyhq.com/{slug}`
- **Greenhouse:** `https://job-boards.greenhouse.io/{slug}` veya `https://job-boards.eu.greenhouse.io/{slug}`
- **Lever:** `https://jobs.(eu.)?lever.co/{slug}`
- **BambooHR:** liste `https://{company}.bamboohr.com/careers/list`; detay `https://{company}.bamboohr.com/careers/{id}/detail`
- **Teamtailor:** `https://{company}.teamtailor.com/jobs`
- **Workday:** `https://{company}.{shard}.myworkdayjobs.com/{site}`
- **Özel (Custom):** Şirketin kendi URL'si (ör. `https://openai.com/careers`)

**Platformlara Göre API/Akış Kalıpları:**
- **Ashby API:** `https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true`
- **BambooHR API:** liste `https://{company}.bamboohr.com/careers/list`; detay `https://{company}.bamboohr.com/careers/{id}/detail` (`result.jobOpening`)
- **Lever API:** `https://api.(eu.)?lever.co/v0/postings/{company}`
- **Teamtailor RSS:** `https://{company}.teamtailor.com/jobs.rss`
- **Workday API:** `https://{company}.{shard}.myworkdayjobs.com/wday/cxs/{company}/{site}/jobs`

Bir şirket için **`careers_url` bulunmuyorsa**:
1. Bilinen platformuna ait kalıbı dene.
2. Başarısız olursa, hızlı bir WebSearch (web araması) yap: `"{company}" careers jobs`.
3. Çalıştığını doğrulamak için Playwright ile sayfaya git.
4. **Bulunan URL'yi** gelecekteki taramalar için **portals.yml içine kaydet**.

**Eğer `careers_url` 404 veya yönlendirme (redirect) verirse:**
1. Çıktı özetine (output summary) bunu not et.
2. Yedek yöntem olarak `scan_query` kullanmayı dene.
3. Manuel güncelleme yapılması için işaretle.

## portals.yml Bakımı

- Yeni bir şirket eklerken **DAİMA `careers_url`'yi kaydet**.
- İlgi çekici portallar veya roller keşfedildikçe yeni sorgular ekle.
- Çok fazla gereksiz (noisy) sonuç getiren sorguları `enabled: false` ile devreden çıkar.
- Hedef roller evrildikçe filtre anahtar kelimelerini ayarla.
- Yakından takip etmek istediğin şirketleri `tracked_companies` listesine ekle.
- `careers_url` bağlantılarını periyodik olarak doğrula — şirketler ATS platformlarını değiştirebilir.
