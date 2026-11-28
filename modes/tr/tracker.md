# Mod: tracker — Başvuru Takipçisi

Takipçi dosyasını oku ve görüntüle (veri köküne göre çözümlenir; varsayılan `{DATA_ROOT}/data/applications.md`, `CAREER_OPS_TRACKER` ile geçersiz kılınabilir).

**Dosyanın tamamını değil, indeksi oku.** Arama ortasındaki takipçiler yüzlerce satıra ulaşır ve hepsini okuyup yeniden yazdırmak, birkaç satır gerektiren bir yanıt için on binlerce token harcar. Soruyu yanıtlayan en dar filtrelerle `node tracker.mjs query` kullan: `--status Applied`, `--company acme`, `--role engineer`, `--since 2026-09-01`, `--min-score 4`, `--id 42`, `--limit 20` veya alanlara ihtiyacın olduğunda `--json`. `applications.md` değiştiğinde indeksi kendisi yeniden eşitler, bu yüzden satırları asla eskimiş olmaz. `query` dokuz sütun döndürür (`id`, `date`, `company`, `role`, `score`, `status`, `pdf`, `report`, `notes`). Yanıt `Via`, `Location` veya `URL` gerektirdiğinde (örneğin ajans satırlarını ayırt etmek için), o satırları `data/applications.md` içinde oku. Dosyanın tamamını yalnızca kullanıcı her satırı görmek istediğinde oku. Kullanıcı takipçiyi bir elektronik tabloda istediğinde, istediği filtrelerle `node tracker.mjs query --csv > output/tracker.csv` çalıştır ve dosya yolunu ver. `output/` gitignore kapsamındadır.

**Takipçi biçimi:**

```markdown
| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
```

İsteğe bağlı Via sütunuyla (aracı kanal, #1596), Company'den sonra:

```markdown
| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |
```

- `Via` = başvurunun geçtiği ajans/işe alım firması; doğrudan başvurular için `—`. Sütunu mevcut bir takipçiye `node merge-tracker.mjs --migrate-via` ile ekle (tüm betikler iki düzeni de otomatik algılar).
- **Bilinmeyen son işveren** (işe alım uzmanı müşteriyi henüz adlandırmadı): Company = `?` (yapısal işaret; dile bağlı olan ve gerçek firma adlarıyla çakışan "Confidential" sözcüğü asla değil), Via = ajans ve Notes içinde ayırt edici bir tanım (örn. `fintech, Leeds`). Kullanıcıya "Gizli (via {Via})" olarak göster.
- Satırın kimliği `#` değeridir (rapor numarası); Company bir görüntüleme verisidir ve en fazla bir kez, açıklandığında değişir.
- `Notes` serbest metindir ve tek bir ayrılmış parçası vardır: ilanın yayına girdiği tarih olan `posted: YYYY-MM-DD`. Bunu notun sonunda `;` ile ayrılmış kendi parçası olarak yaz (`fintech, Leeds; posted: 2026-08-07`) ve yalnızca bir pipeline girdisinin `| posted:` parçasından al (`modes/pipeline.md`), asla tahminle değil. Kontrol paneli POSTED sütunu (ilan yaşı) için bunu okur ve okuduktan sonra son temas hesaplamasının dışında tutar: bir ilanın yayına girmesi şirketle bir etkileşim değildir. Yalnızca baştaki bir parça sayılır; bu yüzden "posted" içeren sıradan bir metin ("işe alım uzmanı 2026-07-20'de bir güncelleme paylaştı / posted an update") olduğu gibi bir temas tarihi olarak kalır.

Olası durumlar: `Evaluated` → (`Speculative`) → `Applied` → `Responded` → `Assessment` → `Interview` → `Offer` / `Rejected` / `Discarded` / `SKIP`

Takipçiye her zaman kanonik İngilizce durumu yaz; `set-status.mjs` onu doğrular. Türkçe etiketler (`Değerlendirildi`, `Başvuruldu`, `Mülakat` vb.) okunurken tanınır, ama yeni bir değer olarak yazılmaz.

- `Evaluated` (Değerlendirildi) = ilan raporla değerlendirildi, karar bekleniyor
- `Speculative` (Spekülatif) = `gambit` modundan bir rol oluşturma önerisi gönderildi (ortada bir ilan yok). Öneriye gelen bir yanıt, yanıt Notes içinde olacak şekilde `Speculative` olarak kalır: `Responded` gönderilmiş bir başvuru sayılır ve hiçbir şey gönderilmedi. Aday bir başvuru gönderdiğinde `Applied`, şirket bir süreç açtığında `Interview` durumuna geçir
- `Applied` (Başvuruldu) = aday başvurusunu gönderdi
- `Responded` (Yanıt Verildi) = şirket yanıt verdi (henüz mülakat değil)
- `Assessment` (Değerlendirme Testi) = çevrimiçi değerlendirme veya eşzamansız ön eleme sürüyor
- `Interview` (Mülakat) = aktif mülakat süreci
- `Offer` (Teklif) = iş teklifi alındı
- `Rejected` (Reddedildi) = şirket tarafından reddedildi
- `Discarded` (İptal Edildi) = aday tarafından vazgeçildi veya ilan kapandı
- `SKIP` (Uygun Değil) = uygun değil, başvurma

Kullanıcı bir durumu güncellemek isterse satırı elle düzenlemek yerine kanonik CLI'ı kullan: `node set-status.mjs --report <report#> <state>`. Bu komut durumu doğrular, takipçi kilidini tutar ve geçişi `data/status-log.tsv` dosyasına (`funnel-velocity.mjs`'nin okuduğu defter) ekler. Raporu olmayan bir satırın rapor kimliği yoktur, bu yüzden onu şirketle seç: `node set-status.mjs "<company>" <state>`; birden fazla satır aynı şirketi paylaşıyorsa `--role "..."` ekle. Aynısı aşağıdaki `--note` için de geçerlidir. Kullanıcı olayın gerçek tarihini söylediğinde ("Salı günü yanıt verdiler", "geçen hafta reddettiler"), defter olayın yazıldığı zamanı değil gerçekte olduğu zamanı kaydetsin diye `--on YYYY-MM-DD` ver. Söylediği şey bir günü kesinleştirmiyorsa ("geçen hafta"), bir gün seçmek yerine tarihi sor. Diğer hücrelerin de yazıcıları vardır, bu yüzden tablo asla elle düzenlenmez: bir not `node set-status.mjs --report <report#> <current state> --note "..."` ile girer (satırın mevcut durumunu vermek onu değiştirmez), PDF işareti `node mark-pdf-ready.mjs <report#>` ile, değişen bir şirket, rol, puan veya rapor bağlantısı ise satırın rapor bağlantısını taşıyan ve `node merge-tracker.mjs` ile birleştirilen bir takipçi ekleme TSV'siyle.

**Sessiz başvuruları toplu kapatma:** kullanıcının kimsenin yanıt vermeyeceği çok sayıda `Applied` satırı varsa `set-status.mjs`'yi döngüde çalıştırma. `node close-stale.mjs --summary` çalıştır (deneme çalıştırması, varsayılan eşik 60 gün), sayıları ve örneği göster ve ancak kullanıcı kabul ettikten sonra `node close-stale.mjs --confirm` çalıştır. Aktif mülakatı, daha sonraki bir status-log geçişi veya açık bir takibi olan satırlar atlanır ve gerekçesiyle listelenir; kapatılan satırlar `Discarded` durumuna geçer ve `no response (auto-closed YYYY-MM-DD, Nd)` not etiketini taşır. Bkz. `docs/SCRIPTS.md` → close-stale.

**Başka bir takipçiyi içe aktarma:** kullanıcı başvurularını başka bir araçta (Teal, Huntr, Simplify) veya bir elektronik tabloda tuttuysa, CSV olarak dışa aktarmasını iste ve `node import-tracker.mjs <file.csv>` çalıştır. Bu bir deneme çalıştırmasıdır: sayıları ve ekleyeceği satırları göster, ancak kullanıcı kabul ettikten sonra `--confirm` ile yeniden çalıştır. Takipçide zaten bulunan satırlar atlanır; hiç başvurulmamış satırlar listelenir, böylece kullanıcı o ilanları pipeline'a ekleyebilir. Satırları tek tek elle ekleme.

**Elle rol ekleme:** kullanıcı hiç değerlendirilmemiş bir başvuru için satır istediğinde (kendi başına bir yere başvurdu ya da hiç puanlanmamış bir rol için ret geldi), tabloyu düzenleyerek değil birleştirme üzerinden ekle. `node reserve-report-num.mjs` ile bir numara al, `modes/_tracker-tsv.md` dosyasının verdiği biçimde `{DATA_ROOT}/batch/tracker-additions/{num}-{company-slug}.tsv` yaz (puan olarak `N/A`, rapor olarak `—`, PDF olarak `❌` ve kullanıcının belirttiği durum), `node merge-tracker.mjs` çalıştır, ardından `node reserve-report-num.mjs --release {num}`. Şirketi, rolü ve durumu tahmin etmek yerine sor. Bu `add` modu değildir: `add`, `cv.md`'ye bir proje, makale veya rol ekler.

**Maaş gözlemleri:** kullanıcı bir satır için doğrulanmış bir ücret rakamı bildirdiğinde ("işe alım uzmanı 84k dedi", "teklif mektubunda 92k yazıyor", "90k'dan imzaladım"), `data/salary-observations.tsv` dosyasına bir `actual` gözlem satırı ekle (dosya yoksa oluştur; biçim için `docs/SCRIPTS.md` → salary-gap). Kaynak seviyesini rakamın nasıl geldiğine göre seç: sözlü bir rakam için `recruiter-verbal`, yazılı bir teklif için `offer-letter`, imzalı bir sözleşme için `contract`. Yalnızca üçüncü taraf bir toplayıcıdan veya maaş tahmini sitesinden gelen bir aralık (işverenin ilanından veya bir işe alım uzmanından değil), `third-party` kaynaklı bir `advertised` satırı olarak kaydedilir: doğrulanmamış bir tahmindir, `jd`'nin altında sıralanır ve doğrulanmamış olarak gösterilir. Günlük yalnızca eklemelidir: yeni bir rakam yeni bir satırdır, önceki bir satırın düzenlenmesi asla değildir. Ardından o başvurunun farkını tek satırda yansıt (ilan edilen, gerçek ve istenen); `node salary-gap.mjs --summary` tam tabloyu gösterir.

**Açıklama akışı (#1596):** kullanıcı bir `?` satırının son işverenini öğrendiğinde ("Hays'teki rol Barclays'miş"):

1. Satırı Company hücresini düzenleyerek değil, birleştirme üzerinden yeniden adlandır. Satırın kendi alanlarıyla (numara, tarih, Via, rol, puan, PDF) ve gerçek şirket adıyla, satırın mevcut rapor bağlantısını gösteren bir takipçi ekleme TSV'si yaz, ardından `node merge-tracker.mjs` çalıştır. Birleştirme rapor dosyasıyla eşleşir, bu yüzden `?` değerini gerçek adla değiştirir ve satırın `#` değerini ve durumunu korur. Asla yeniden numaralandırma. Satırı tanımlayan şey rapor bağlantısıdır: bağlantısız bir TSV hangi `?` satırının kastedildiğini söyleyemez ve bunun yerine ikinci bir satır olarak eklenir. Raporu olmayan bir `?` satırı hiçbir yazıcıyla yeniden adlandırılamaz; tabloyu düzenlemek yerine bunu kullanıcıya söyle, o tek hücreyi kendisi değiştirebilir.
2. Raporu güncelle: şirketi H1 başlığına ekle, başlık alanlarını doldur ve Machine Summary YAML'ında `company_confidential: false` (+ gerçek `company:`) ayarla. **Rapor dosyasını asla yeniden adlandırma**; numara kimliktir, bağlantılar sabit kalır.
3. Kanallar arası kontrolü çalıştır: `node verify-pipeline.mjs`. Aynı şirket+rol artık farklı bir Via altında varsa (ajans + doğrudan veya iki ajans), kullanıcıyı açıkça uyar; **asla otomatik birleştirme**. İki başvuru da gerçekten yapıldı ve adaylığın hangi kanala ait olduğuna kullanıcı karar verir.

Zamanlama konusunda dürüst ol: bu kontrol hasarı olaydan sonra yakalar. Önleyici kontrol, bir ajans başvurusuna izin vermeden önce `apply` (`basvuru`) modunda yapılır.

Ayrıca istatistikleri göster:
- Toplam başvuru sayısı
- Duruma göre dağılım
- Ortalama puan
- PDF oluşturulanların yüzdesi
- Rapor oluşturulanların yüzdesi
- `data/salary-observations.tsv` doğrulanmış `actual` gözlemler içeriyorsa, `node salary-gap.mjs --summary` çıktısını ekle (ilan edilen→gerçek farklar, istenene ulaşma)
- Takipçide Applied veya ötesinde satırlar varsa, `node funnel-velocity.mjs --summary` çıktısını ekle (piyasa ölçütlerine göre huni oranları, süreçteki beklemeler, `data/status-log.tsv` veri içerdiğinde aşama hızı). Dürüstlük çerçevesini koru: aralığın üstündeki oranlar için seçim yanlılığı notu, medyanların yanında sansürlü sayılar ve betiğin kendisinin yazdırmadığı hiçbir çarpan iddiası

Tüm zamanların istatistik görünümü için (kümülatif huni, tarayıcı toplamları, portal kapsamı, takip uyumu) `node stats.mjs --summary` çalıştır ve çıktısını sun. Token harcamaz; bu sayıları asla elle yeniden hesaplama.

Takipçideki herhangi bir şirket `silent-on-you` yanıt verme etiketi gösteriyorsa `node company-history.mjs --summary` de öner: şirket başına kanıt kartları (önce düzen hatırlatması, sonra önce sessiz olanlar), kullanıcı nasıl önceliklendireceğine karar vermeden önce ona temel bilgileri verir.

**Adayın kanıtı değiştikten sonra:** `cv.md`, `article-digest.md`, `config/profile.yml` veya `modes/_profile.md` güncellendiğinde (örneğin `expand` veya `add` sonrasında), `node reeval-candidates.mjs --summary` çalıştır. Son değerlendirmesi bu değişiklikten önceye dayanan `Evaluated` satırları, her birinden sonra değişen dosyayla birlikte listeler (`--status Evaluated,Applied` kapsamı genişletir). Salt okunurdur ve yalnızca işaret eder: kullanıcının seçtiği satırları yeniden değerlendirmeyi öner ve bir puanı elle değiştirmek yerine her satırı birleştirmenin güncellemesine izin ver.
