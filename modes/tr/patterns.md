# Mod: patterns -- Ret Örüntüsü Tespit Edici

## Amaç

Sonuçlardaki örüntüleri (patterns) bulmak ve eyleme dönüştürülebilir içgörüler sunmak için takip edilen tüm başvuruları analiz et. Neyin işe yaradığını (arketipler, uzaktan çalışma politikaları, puan aralıkları) ve neyin zaman kaybettirdiğini (coğrafi kısıtlamalı roller, stack uyumsuzlukları, düşük puanlı başvurular) belirler.

Mülakat oturumları (sessions) mevcut olduğunda, adayın sürekli başvurduğu rolden ziyade en güçlü, en akıcı yanıtlarının işaret ettiği farklı bir rol türünü tespit etmek için (Adım 1b), kazanma/kaybetme durumundan daha yüksek çözünürlüklü ve daha düşük gürültülü bir rol uyumu sinyali olan *adayın odada gerçekte ne söylediğini* okur.

## Girdiler

- `data/applications.md` — Başvuru takipçisi
- `reports/` — Bireysel değerlendirme raporları
- `config/profile.yml` — Kullanıcı profili (öneri bağlamı için)
- `modes/_profile.md` — Kullanıcı arketipleri ve çerçeveleme
- `portals.yml` — Portal yapılandırması (filtre güncelleme önerileri için)
- `interview-prep/sessions/*.md` — Mülakat oturumları (isteğe bağlı; Adım 1b'yi yönlendirir). Gerçek mülakat deşifrelerini (transcripts) ve deneme oturumu dosyalarını buraya bırakın.

## Minimum Eşik

Analizi çalıştırmadan önce kontrol et: `data/applications.md` dosyasında "Evaluated" (Değerlendirildi) aşamasının ötesinde (örneğin Applied, Responded, Interview, Offer, Rejected, Discarded, SKIP) durumu olan en az 5 kayıt var mı?

Eğer yoksa, kullanıcıya şunu söyle:
> "Henüz yeterli veri yok -- 5 başvurudan {N} tanesi değerlendirmenin ötesine geçti. Başvurmaya devam et ve analiz edilecek daha fazla sonucun olduğunda tekrar gel."

Zarifçe çıkış yap.

## Adım 1 — Analiz Komut Dosyasını Çalıştır

Şunu çalıştır:

```bash
node analyze-patterns.mjs
```

JSON çıktısını ayrıştır. Şunları içerir:

| Anahtar | İçerik |
|-----|----------|
| `metadata` | Toplam giriş, tarih aralığı, analiz tarihi, sonuca göre sayılar ve `outcomeRates`: her döküm satırıyla aynı `submitted` / `decided` paydaları üzerinden tüm takipçi |
| `funnel` | Durum aşamasına göre sayı (evaluated, applied, interview, offer, vb.) |
| `scoreComparison` | Sonuç grubuna göre ortalama/min/maks puan (positive, awaiting, negative, discarded, self_filtered, pending) |
| `archetypeBreakdown` | Arketip başına: total, submitted, decided, positive, awaiting, negative, discarded, self_filtered, conversionRate, decidedRate |
| `blockerAnalysis` | En sık görülen kesin engeller (hard blockers): coğrafi kısıtlama, stack uyumsuzluğu, kıdem, ofis (onsite); her `percentage`, `blockerBase` değerinin bir payıdır |
| `blockerBase` | Boş olmayan bir gaps dizisi taşıyan girişler; `blockerAnalysis[].percentage` için payda |
| `remotePolicy` | Politika grubu başına: `archetypeBreakdown` ile aynı sütunlar |
| `companySizeBreakdown` | Şirket boyutu grubu başına: startup, scaleup, enterprise |
| `vendorAnalysis` | ATS kanal analizi: satıcı (vendor) başına ilerleme oranı + kapsama (aşağıya bak) |
| `viaChannelAnalysis` | Via kanal analizi (#1596): ajans başına ilerleme oranı + ajansa karşı doğrudan toplam (aşağıya bak) |
| `scoreThreshold` | `recommended` (`sufficientSample` olana kadar null), `observedMinimum`, `sampleSize`, `sufficientSample`, gerekçe |
| `techStackGaps` | Olumsuz / vazgeçilmiş sonuçlardaki en sık teknoloji eksikleri |
| `discardReasonStats` | Kullanıcının kaydettiği atlama/vazgeçme gerekçeleri; her `percentage`, `discardReasonBase` değerinin bir payıdır |
| `discardReasonBase` | Kendini eleyen, vazgeçilen veya olumsuz girişler; `discardReasonStats[].percentage` ve onun öneri eşiği için payda |
| `recommendations` | Gerekçeleri ve etki düzeyiyle birlikte en iyi 5 eyleme dönüştürülebilir madde |

Eğer komut dosyası `error` döndürürse, hata mesajını göster ve çık.

### `vendorAnalysis` — nasıl sunulmalı (ÖNEMLİ: nedensel çıkarımlarda temkinli olmak)

`vendorAnalysis`, her raporun `**URL:**` alanından tespit edilen ATS satıcısına göre **gönderilmiş (submitted)** başvuruları gruplandırır (sadece temiz parmak izlerine sahip topluluk ATS'leri: Greenhouse, Lever, Ashby, Workday — beyaz etiketli (white-labeled) ATS'ler URL'den tespit edilemez ve raporlanmayan bir `unknown` grubuna düşer). `advanceRate` = `Responded`/`Assessment`/`Interview`/`Offer` aşamasına ulaşanların oranı (tek başına `Applied` sayılmaz).

Motivasyon: *İşe Alımda Algoritmik Monokültürler* (Bommasani vd., FAccT 2026, [arXiv:2605.27371](https://arxiv.org/abs/2605.27371)) — ortak bir eleyici (screener) aracılığıyla yapılan retler bağımsız değil birbiriyle ilişkilidir, bu nedenle yoğunlaşmış ölü bir kanalın getirisi azalır.

Bunu kullanıcıya anlatırken:
- **Kanal verimini (yield) raporla, ayrımcılığı DEĞİL.** Tek bir takipçi "satıcının algoritması beni eliyor" ile "bu satıcı benim zayıf uyduğum bir segmente eğilimli" durumlarını birbirinden ayıramaz. Asla önyargı (bias) iddiasında bulunma. Dürüst, yararlı çerçeveleme şudur: *"Başvurularınızın %X'i {vendor} üzerinden geçiyor ve bu kanal diğer kanallarınıza göre çok daha az ilerliyor — bu şirketlere yönelirken yönlendirme (referral) / doğrudan iletişim (direct contact) yöntemini kullanın."*
- `sufficientSample` değerine saygı duy: eğer false ise, satıcıdan sadece bir gözlem olarak bahset ("sonuç çıkarmak için çok az"), asla bir öneri olarak sunma.
- İstatistiklerin bir alt kümeyi kapsadığını kullanıcının bilmesi için kapsama oranını (`coveragePct`) her zaman belirt.
- `recommendations` dizisi, eğer biri nitelikleri taşıyorsa zaten `high` etkili kanal eylemini içerir — daha güçlü bir iddia uydurmak yerine bunu kelimesi kelimesine sun.

### `viaChannelAnalysis` — ajans başına ilerleme oranı (#1596)

**Gönderilmiş** başvuruları `Via` kanalına (işe alım uzmanı/ajans firması) göre gruplar; isteğe bağlı Via sütununu gerektirir (#1596). Bu sütunu olmayan takipçiler boş gruplar üretir ve hiçbir iddiada bulunulmaz. `—` satırları `direct` sayılır; `breakdown` her ajansı total/advanced/`advanceRate`/`sufficientSample` ile listeler. Via hücresi *boş* olan gönderilmiş satırlar (eski takipçi veya boş hücre; açık `—` doğrudan işaretinden farklı) iki gruba da girmez ve `unknownVia` içinde sayılır. Sıfırdan farklıysa bunu belirt, böylece kullanıcı ajans/doğrudan ayrımının gönderimlerin bir alt kümesini kapsadığını bilir. Ajans aracılı bir aramada en yüksek etkili karar hangi işe alım uzmanı ilişkilerine yatırım yapılacağıdır; bu analiz hangilerinin gerçekten dönüştüğünü gösterir.

`vendorAnalysis` ile aynı nedensel temkin kuralları geçerlidir: kanal verimini raporla, asla nedensel bir iddiada bulunma; `sufficientSample` değerine saygı duy; güçlü bir ajans *"X üzerinden gelen rollere öncelik ver, dönüşüyor"* demektir, zayıf olan ise bir suçlama değil bir gözlemdir.
- `recommendations` dizisi, nitelikleri taşıyan biri varsa en iyi dönüşen ajansla ilgili `medium` etkili eylemi zaten içerir; daha güçlü bir iddia uydurmak yerine onu olduğu gibi sun.

### Maaş merceği (isteğe bağlı)

Ücret gözlemleri varsa (rapor `advertised_comp` anahtarları veya `data/salary-observations.tsv` satırları), ek bir mercek olarak `node salary-gap.mjs --summary` çalıştır: (şirket, rol) ve para birimi başına ilan edilen→gerçek kesinti ve istenene ulaşma. Token harcamaz; bu sayıları asla elle yeniden hesaplama. Veri kalitesi bölümüne `sufficientSample` gibi saygı duy: düşük örneklem büyüklükleri öneri değil gözlemdir.

### Şirket Geçmişi merceği (isteğe bağlı)

Ek bir mercek olarak `node company-history.mjs --summary` çalıştır. Token harcamaz.

**Önce her zaman düzen.** Özet, sessiz görünen eskimiş Applied satırlarıyla başlar; herhangi bir karttan önce o listeyi sun. Aşağıdaki kartlardan herhangi bir sonuç çıkarmadan önce kullanıcıya bunları doğrulamasını veya `node set-status.mjs --row <num> <state> --on <response-date>` ile güncellemesini söyle; eskimiş bir takipçi satırı gerçek sessizlikle aynı sinyali üretir.

Ardından kartları önce sessiz olanlar gelecek şekilde sun (betik onları zaten bu sırayla verir).

**Nedensel temkin (zorunlu, `vendorAnalysis` ile aynı duruş):** bu kartlar *senin kendi dosyaların* hakkındaki bilgilerdir; `silent-on-you` gösteren bir şirket "şirket hiç yanıt vermedi" değil, "takipçinde/takiplerinde kayıtlı bir yanıt yok" demektir. Masum açıklamalar yaygındır: yüksek hacimli gelen kutuları, sürekli açık ilanlar, yeniden açılan aramalar veya adayın aldığı ama hiç kaydetmediği bir yanıt. Bilgileri sun (tarihten bu yana N gün sessiz, M takip gönderildi) ve kararı kullanıcıya bırak; bir kartı asla şirket hakkında bir hüküm gibi ifade etme.

### Huni Kalibrasyonu merceği (isteğe bağlı)

Takipçide Applied veya ötesinde satırlar varsa, ek bir mercek olarak `node funnel-velocity.mjs --summary` çalıştır: adayın huni oranları ile aday tarafı piyasa ölçüt aralıkları, tipik ilk yanıt penceresini aşmış süreçteki başvurular ve (`data/status-log.tsv` geçiş biriktirdikten sonra) aşama geçişi başına medyan gün. Token harcamaz; bu sayıları asla elle yeniden hesaplama. Sunum kuralları (bunlar üslup önerisi değil, kesin ZORUNLULUKLARDIR):

- **Aralığın üstündeki oranlar**: cesaretlendirme istenir (bu mercek sessizlik kaygısına karşı vardır), ama betiğin seçim yanlılığı notu MUTLAKA korunmalıdır (hedefli başvuruların toplu platform ortalamalarını geçmesi beklenir). Bu, piyasanın kolaylığını değil, filtre kalitesini doğrular.
- **Aralığın altındaki oranlar**: kalibrasyon ve tam olarak bir somut eylem (followup moduyla takip uyumu veya patterns Adım 2 ile puan eşiği incelemesi; `config/profile.yml` içinde `follow_ups.enabled` değeri `false` ise takip seçeneğini atla). Aday hakkında asla hüküm verme.
- **Her ölçüt anımı** yılını ve "yön gösterici" ibaresini taşır; gelen taban değerler hakemli istatistikler değil, işe alım sektörü toplamlarıdır.
- **n=20 başvurunun altında karşılaştırmalı çarpan iddiası yok.** Betik bunları zaten bastırır; ham sayılardan elle yeniden kurma.
- **Hız medyanları**: betiğin yazdırdığı sansürlü sayıyı her zaman tekrarla ("n hâlâ bekliyor, hariç tutuldu"); o olmadan yalnızca yanıtlanmış başvurular üzerinden alınan bir medyan hayatta kalan yanlılığı taşır.

## Adım 1b — Oturum-İçerik Hedefleme Sinyali (İsteğe bağlı)

Sonuç verileri (Adım 1) size kazanıp kazanmadığınızı (*whether*) söyler. Mülakat oturumları (sessions) size odada *aslında hangi rolü sattığınızı* söyler — bu, maaş, zamanlama, kadro sayısı (headcount) ve uyumla ilgisi olmayan bir düzine nedenden dolayı birbirine karışan kazanma/kaybetme durumundan daha yüksek çözünürlüklü ve daha düşük gürültülü bir rol uyumu sinyalidir.

**Bu adımı yalnızca oturum verisi (session data) varsa çalıştır.** Şunu kontrol et: `interview-prep/sessions/*.md` (`README.md` ve `.gitkeep` hariç).

Eğer hiç oturum yoksa, **bu adımı sessizce atla** ve yalnızca sonuç-odaklı analizle devam et. Bu adım tamamen eklentidir (additive) — mod bu adım olmadan da tam olarak çalışır ve oturumlar biriktikçe çözünürlük kazanır.

Eğer oturumlar mevcutsa, her biri için:
1. Adayın cevaplarını mülakatçının sorularından ayır. Konuşmacı etiketleri eksikse, onları çıkar (oturum formatına göre `**Interviewer:**` / `**Candidate:**` şeklinde etiketlenmiş sıralar).
2. Her bir doyurucu yanıtın (substantive answer) sergilediği yetkinlik (competency) / rol sinyalini belirle (örn. *instructional-design*, *systems-architecture*, *data-analysis*, *stakeholder-management*, *people-leadership*). **Önce etiketler, yedek olarak çıkarım (inference):** eğer cevap halihazırda açık bir yetkinlik etiketi taşıyorsa — `interview-prep/sessions/README.md` içindeki geleneğe göre `<!-- competency: ... -->`, ister elle yazılmış olsun ister bir değerlendirme aracı (debrief tool) (örn. `interview/debrief`) tarafından üretilmiş olsun — bunu doğrudan kullan. Yetkinliği kendin ancak hiçbir etiket yoksa çıkar.
3. Cevabın **akıcı ve belirgin (fluent and specific)** mi (somut metrikler, adlandırılmış araçlar, gerçek kararlar) yoksa **düz ve genel (flat and generic)** mi (kaçamak, muğlak, ders kitabı gibi) olduğunu işaretle.

Daha sonra tüm oturumlar (sessions) genelinde topla:
- **Akıcı/belirgin (fluent/specific) cevaplar nerede kümeleniyor?** O yetkinlik kümesi, adayın özgeçmişindeki unvan ne olursa olsun, *gerçekte* en güçlü olduğu rol türüdür.
- O kümeyi (a) `modes/_profile.md` içindeki arketipler ve (b) `data/applications.md` dosyasında gerçekte başvurulan rollerin dağılımı ile karşılaştır.
- **Uyumsuzluğu (misfit) ortaya çıkar:** en güçlü küme (X), başvurulan roller (Y) arasında yeterince temsil edilmiyorsa (under-represented), bu bir hedefleme düzeltme (targeting-correction) sinyalidir:
  > "Yanıtlarınız sürekli olarak **X** etrafında parlıyor, ancak siz çoğunlukla **Y**'ye başvuruyorsunuz. X arketipini eklemeyi ve `portals.yml` içindeki `title_filter.positive` ayarını buna göre yeniden ağırlıklandırmayı düşünün."

Bu, *"kaybediyorsunuz"* (Adım 1, sonuçlar) ile *"yanlış hedefe nişan alıyorsunuz"* (Adım 1b, içerik) arasındaki farktır. Sonucu Adım 2 raporuna ve Adım 4 önerilerine besle (feed).

**Gizlilik:** oturumlar gerçek mülakatçı isimleri ve şirketler içerir. Bunları sadece yerel olarak oku; **asla gerçek bir ismi veya şirketi commit edilecek bir rapora alıntılama.** Sinyali özetle (yetkinlik kümeleri), içeriği asla.

## Adım 2 — Rapor Oluştur

Raporu `reports/pattern-analysis-{YYYY-MM-DD}.md` konumuna yaz.

### Rapor Yapısı

```markdown
# Örüntü Analizi (Pattern Analysis) -- {YYYY-MM-DD}

**İncelenen başvuru:** {total}
**Tarih aralığı:** {from} ile {to} arası
**Sonuçlar:** {positive} olumlu, {negative} olumsuz, {self_filtered} Aday Tarafından Elenen (self-filtered), {pending} beklemede

---

## Dönüşüm Hunisi (Conversion Funnel)

Sayım ve toplamın yüzdesi ile birlikte her durumu göster. Basit bir tablo kullan:

| Aşama | Sayı | % |
|-------|-------|---|
| Evaluated | X | X% |
| Applied | X | X% |
| ... | | |

## Puan - Sonuç Karşılaştırması

| Sonuç | Ort. Puan | Min | Maks | Sayı |
|---------|-----------|-----|-----|-------|
| Olumlu (Positive) | X.X/5 | X.X | X.X | X |
| Olumsuz (Negative) | ... | | | |
| Aday Tarafından Elenen (Self-filtered) | ... | | | |
| Beklemede (Pending) | ... | | | |

## Arketip Performansı

Her arketip, toplam başvuru, olumlu sonuç ve Dönüşüm Oranının bulunduğu tablo.
En iyi ve en kötü performans gösteren arketipi vurgula.

## En Büyük Kesin Engeller (Top Blockers)

Sürekli tekrarlayan Kesin Engellerin frekans tablosu (coğrafi kısıtlama, stack uyumsuzluğu, vb.).
Her birinden etkilenen tüm başvuruların yüzdesini not et.

## Uzaktan Çalışma Politikası Örüntüleri

Uzaktan çalışma politikası grubuna (global, bölgesel, coğrafi kısıtlamalı, hibrit/ofis) göre dönüşüm oranını gösteren tablo.

## Teknoloji Yığını Eksikleri (Tech Stack Gaps)

Olumsuz/Aday Tarafından Elenen (self-filtered) sonuçlarda en sık karşılaşılan eksik yeteneklerin sıklıklarıyla birlikte listesi.

## Önerilen Puan Eşiği (Recommended Score Threshold)

Veriye dayalı minimum puanı ve mantığını (reasoning) açıkla.

## Hedefleme Sinyali (Targeting Signal - mülakat oturumları)

*Bu bölümü sadece Adım 1b çalıştıysa ekle.* Sadece yetkinlik terimleriyle (gerçek isim/şirket yok) özetle:
- Adayın yanıtlarının en güçlü olduğu yetkinlik kümesi (X)
- Gerçekte başvurdukları rol türleri (Y)
- Uyumsuzluk farkı (misfit gap) ve önerilen yeniden hizalama (X arketipini ekle / `portals.yml`'yi yeniden ağırlıklandır)

## Öneriler (Recommendations)

En iyi önerileri numaralandır (komut dosyası çıktısından). Her biri için:
1. **[ETKİ]** Yapılacak eylem
   Önerinin arkasındaki mantık (reasoning).
```

## Adım 3 — Özeti Sun

Kullanıcıya aşağıdakileri içeren özet bir versiyon sun:
1. Tek satırlık istatistik özeti (X başvuru, Y% başvuruldu, Z% olumlu sonuç)
2. En iyi 3 bulgu (en yüksek etkiye sahip örüntüler)
3. Tam rapora bağlantı

Örnek:
> **Örüntü Analizi Tamamlandı** (24 başvuru, 7-8 Nisan)
>
> Temel bulgular:
> - Coğrafi kısıtlamalı roller %0 dönüşüm oranına sahip (24'te 7) -- yalnızca ABD/Kanada ilanlarını değerlendirmeyi bırakın
> - Bölgesel/global uzaktan (remote) roller %57-67 oranında dönüşüyor -- sizin için en ideal nokta burası
> - 4.2/5'in altında olumlu sonuç yok -- bunu puan tabanınız olarak kabul edin
>
> Tam rapor: `reports/pattern-analysis-2026-04-08.md`

## Adım 4 — Önerileri Uygulamayı Teklif Et

Kullanıcıya önerilerden herhangi biri üzerinde işlem yapmak isteyip istemediğini sor:

> "Bu önerilerden herhangi birini uygulamamı ister misiniz? Şunları yapabilirim:
> - Coğrafi kısıtlamalı rolleri filtrelemek için `portals.yml` dosyasını güncellemek
> - PDF oluşturma için `_profile.md` dosyasında bir puan eşiği (score threshold) belirlemek
> - Hangi arketiplerin dönüştüğüne bağlı olarak arketip hedeflendirmesini (targeting) ayarlamak
> - Oturum sinyalinden hareketle hedeflemeyi yeniden hizalamak — (eğer Adım 1b çalıştıysa) eksik hedeflenmiş X arketipini `modes/_profile.md` dosyasına eklemek ve `portals.yml` `title_filter.positive` ayarını yeniden ağırlıklandırmak
>
> Hangilerini istediğinizi söyleyin, ya da hepsini uygulamak için 'hepsini' deyin."

Kullanıcı onaylarsa:
- Portal filtre değişiklikleri için: `portals.yml` dosyasını düzenle
- Profil/arketip değişiklikleri için: `modes/_profile.md` dosyasını düzenle (`_shared.md` dosyasını ASLA düzenleme)
- Puan eşiği için: `config/profile.yml` dosyasına `patterns` anahtarı altına ekle

## Sonuç Sınıflandırması

Referans olarak sonuçlar şu şekilde sınıflandırılır:

| Durum (Status) | Sonuç (Outcome) |
|--------|---------|
| Interview, Offer, Responded, Hired | **Olumlu (Positive)** (işveren süreci ilerletti) |
| Applied | **Yanıt Bekleniyor (Awaiting)** (gönderildi, henüz yanıt yok — dönüşüm paydasında sayılır, asla bir başarı olarak sayılmaz) |
| Rejected | **Olumsuz (Negative)** (işveren olumsuz dönüş yaptı) |
| Discarded | **İptal Edildi (Discarded)** (siz geri çektiniz veya ilan kapandı — işveren kararı değildir, kanıtlanmış bir başvuru değildir; ne `submitted` ne de `decided` içinde sayılır) |
| SKIP, NO APLICAR | **Aday Tarafından Elenen (Self-filtered)** (kullanıcı başvurmamaya karar verdi) |
| Evaluated | **Beklemede (Pending)** (henüz herhangi bir işlem yapılmadı) |
