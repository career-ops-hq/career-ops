# Mod: batch — İşlerin Toplu İşlenmesi

İki kullanım modu vardır: **conductor --chrome** (portallarda gerçek zamanlı gezinir) veya **standalone** (önceden toplanmış URL'ler için betik).

## Mimari

```text
Conductor (headed browser mode)
  │
  │  Chrome: portallarda gezinir (oturum açılmış oturumlar)
  │  Doğrudan DOM'u okur — kullanıcı her şeyi gerçek zamanlı görür
  │
  ├─ Job 1: JD'yi (İş Tanımını) DOM + URL'den okur
  │    └─► headless worker → rapor .md + PDF + tracker-line (takip satırı)
  │
  ├─ Job 2: ileri (next) tıklar, JD + URL okur
  │    └─► headless worker → rapor .md + PDF + tracker-line
  │
  └─ End: tracker-additions dizinini → applications.md + özet (summary) ile birleştir
```

Her bir çalışan (worker), temiz bir 200K jetonluk (token) bağlama sahip olan başsız (headless) bir alt süreçtir (child process). Yönlendirici (conductor) sadece orkestrasyon yapar. İlgili CLI komutları için `AGENTS.md` içerisindeki **Headless / Batch Mode** tablosunu incele.

## Dosyalar

```text
batch/
  batch-input.tsv               # URL'ler (conductor'dan veya manuel)
  batch-state.tsv               # İlerleme durumu (otomatik oluşturulur, git'ten yoksayılır)
  batch-runner.sh               # Bağımsız (standalone) orkestratör betiği
  batch-prompt.md               # Çalışanlar (workers) için istem şablonu
  logs/                         # Her iş (job) için bir log (git'ten yoksayılır)
  tracker-additions/            # Takipçi satırları (git'ten yoksayılır)
```

## Mod A: Conductor --chrome

1. **Read state**: `batch/batch-state.tsv` → neyin halihazırda işlendiğini tespit et.
2. **Navigate portal**: Chrome → arama URL'sine git.
3. **Extract URLs**: Sonuçlar DOM'unu oku → URL listesini çıkar → `batch-input.tsv` dosyasına ekle.
4. **Beklemede olan her URL için**:
   a. Chrome: işin üzerine tıkla → DOM üzerinden JD metnini oku.
   b. JD'yi `/tmp/batch-jd-{id}.txt` konumuna kaydet.
   c. Sonraki REPORT_NUM değerini atomik olarak rezerve et: `node reserve-report-num.mjs` (çalışan raporu yazdıktan sonra `--release {num}` ile serbest bırak; eski, kullanılmayan işaretçiler / sentinels otomatik olarak toplanır - GC).
   d. Bash üzerinden çalıştır:

      ```bash
      # Kendi CLI başsız (headless) komutunu kullan (bkz. AGENTS.md — Headless / Batch Mode)
      <headless-cmd> "Process this job. URL: {url}. JD: /tmp/batch-jd-{id}.txt. Report: {num}. ID: {id}"
      ```

   e. `batch-state.tsv` dosyasını güncelle (completed/failed + score + report_num).
   f. `logs/{report_num}-{id}.log` konumuna günlüğe kaydet (log).
   g. Chrome: geri git → sıradaki iş.
5. **Pagination**: Eğer başka iş yoksa → "Next" (İleri) tıkla → tekrar et.
6. **End**: `tracker-additions/` klasörünü → `applications.md` + özet ile birleştir.

### Bir çalışma sırasında neleri izlemeli

Bir conductor çalışması (run) esnasında, operatörün izlemesi gereken iki temel canlı arayüz vardır:
1. **Başlıklı (headed) Chrome penceresi:** Tarayıcının portallarda gezinmesini, oturumlara giriş yapmasını ve iş tanımı sayfalarıyla gerçek zamanlı etkileşime girmesini izle.
2. **Ajan CLI sohbeti:** Ajanın kabuk (shell) içindeki adım adım anlatımını (narration) takip et.

Bireysel çalışan görevleri (worker tasks) arka planda başsız olarak oluşturulur ve stdout/stderr günlüklerini istendiğinde incelenebilecek şekilde `batch/logs/{report_num}-{id}.log` içine yazar.

### Manuel çoklu-ajan dağılımı

N adet paralel değerlendiriciyi (evaluators) el ile mi yönetiyorsunuz (birden fazla ajan penceresi / alt ajanlar, `batch-runner.sh` dışında)? ÖNCE tüm aralığı (range) rezerve et, ardından her çalışana kendi numarasını ver — çalışanların (workers) `max+1` işlemini kendilerinin hesaplamasına asla izin verme:

```bash
node reserve-report-num.mjs --count 8
# stdout: 042-049  → çalışan 1 042'yi alır, çalışan 2 043'ü alır, ...
```

Her bir numara `reports/` içerisindeki bir işaretçi dosyayla (sentinel file) desteklenir, böylece diğer pencerelerden gelen eşzamanlı (concurrent) rezervasyonlar birbiriyle çakışamaz. Tüm raporlar yazıldıktan sonra, kalan numaraları tek bir çağrıyla (call) serbest bırak:

```bash
node reserve-report-num.mjs --release 042-049
```

**Bilinmesi gereken iki şey:**

- **4-saatlik koruma penceresi.** 4 saatten daha eski işaretçiler (sentinels) çöp toplayıcı tarafından temizlenir (`verify-pipeline.mjs` bunu tetikler). Aralığı (range), uzun bir oturumun başında değil, hemen çalışanları (workers) oluşturmadan önce rezerve et. Bir çalışan gerçek raporunu yazdığında o slot kalıcı olarak güvendedir — 4 saat sonra sadece yavaş kalmış veya hiç başlatılmamış slotlar risk altındadır.
- **Boşluklar normaldir.** Bir rezervasyon çarpışır ve yeniden başlarsa, atlanan numaralar (örn. `006`) bir daha asla kullanılmaz. Rapor numaraları şeffaf olmayan (opaque) kimliklerdir (ID'lerdir); numara atlanması bir veri bozulması (corruption) anlamına gelmez.

## Mod B: Bağımsız (Standalone) betik

```bash
batch/batch-runner.sh [OPTIONS]
```

Seçenekler (Options):
- `--dry-run` — bekleyen işleri çalıştırmadan listele
- `--retry-failed` — sadece başarısız olan işleri yeniden dene
- `--resume-paused` — Claude oturumu/kullanım sınırı aşıldığı için duraklatılan işlere devam et
- `--start-from N` — N numaralı ID'den başla
- `--limit N` — bu çalışmada işlenecek maksimum iş (job) sayısı
- `--parallel N` — N adet paralel çalışan (worker)
- `--max-retries N` — iş başına deneme sayısı (varsayılan: 2)
- `--rate-limit-sleep N` — anlık rate-limit engeline takılan bir çalışanı yeniden denemeden önce beklenecek saniye (varsayılan: 300; yığını hemen duraklatmak için 0 kullanın)

## batch-state.tsv Formatı

```text
id	url	status	started_at	completed_at	report_num	score	error	retries
1	https://...	completed	2026-...	2026-...	002	4.2	-	0
2	https://...	failed	2026-...	2026-...	-	-	Error msg	1
3	https://...	pending	-	-	-	-	-	0
4	https://...	rate_limited	2026-...	2026-...	004	-	rate-limit; retrying after 300s	1
5	https://...	paused_rate_limit	2026-...	2026-...	005	-	session limit; paused	1
```

Geçerli durumlar (statuses) şunlardır: `pending`, `processing`, `completed`, `failed`, `skipped`, `rate_limited` ve `paused_rate_limit`. `rate_limited`, orkestratör yeniden denemeden önce beklerken yayılan geçici (tamamlanmamış) bir durumdur; eğer işlem orada kesilirse, daha sonraki `--retry-failed` içermeyen bir çalıştırma, bunu bekleyen bir iş (pending work) olarak kabul eder.

`paused_rate_limit`, bir çalışanın Claude oturumu/kullanım sınırına ulaştığı anlamına gelir. Çalıştırıcı (runner) yeni teklifler planlamayı durdurur, yeniden deneme (retry) sayısını korur ve yalnızca açıkça `--resume-paused` ile çağrıldığında devam eder.

## Devam Edilebilirlik

- Eğer çökerse → yeniden çalıştır (re-run) → `batch-state.tsv` okunur → tamamlanan işleri atlar (skip).
- Kilit dosyası (`batch-runner.pid`) çifte çalıştırmayı (double execution) önler.
- Her bir çalışan (worker) bağımsızdır: 47 numaralı işte yaşanan bir hata, diğerlerini etkilemez.

## Çalışanlar (başsız mod)

Her çalışan `batch-prompt.md` dosyasını sistem istemi (system prompt) olarak alır. Kendi içinde tutarlıdır (self-contained). CLI'nıza ait başsız (headless) komutu kullanın — `AGENTS.md` içindeki **Headless / Batch Mode** tablosunu incele.

Çalışan (worker) şunları üretir:
1. `reports/` içinde `.md` raporu.
2. `output/` içinde PDF.
3. `batch/tracker-additions/{id}.tsv` içinde takipçi satırı (tracker line).
4. stdout üzerinden Sonuç JSON'u (Result JSON).

## Hata yönetimi

| Hata (Error) | Kurtarma (Recovery) |
|-------|----------|
| URL ulaşılamıyor (inaccessible) | Çalışan hata verir (fails) → conductor `failed` olarak işaretler, devam eder |
| JD giriş (login) arkasında kaldı | Conductor DOM'u okumaya çalışır. Başarısız olursa → `failed` |
| Portal görünümü (layout) değiştirir | Conductor HTML üzerinde akıl yürütür, adapte olur |
| Çalışan (Worker) çöker | Conductor `failed` olarak işaretler, devam eder. `--retry-failed` ile tekrar dene |
| Claude oturum/kullanım sınırı (limit) | Runner mevcut teklifi `paused_rate_limit` olarak işaretler, yeni teklifleri planlamayı durdurur, yeniden denemeleri korur. Sıfırlamadan sonra `--resume-paused` ile devam et. |
| Yönlendirici (Conductor) çöker | Yeniden çalıştır (Re-run) → durumu oku → tamamlanan işleri atla (skip) |
| PDF hata verir | .md raporu kaydedilir. PDF oluşturulması beklemede (pending) kalır |
