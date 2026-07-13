# career-ops — Türkçe Modlar (`modes/tr/`)

Bu klasör, Türkiye iş piyasasında iş arayanlar veya Türkçe ilanlarla çalışanlar için career-ops modlarının Türkçe çevirilerini içerir.

## Ne Zaman Kullanılır?

Aşağıdaki koşullardan en az biri geçerliyse `modes/tr/` kullan:

- Ağırlıklı olarak **Türkçe iş ilanlarına** başvuruyorsun (Kariyer.net, Yenibiris.com, Secretcv.com, LinkedIn TR)
- **CV dilinin** Türkçe olmasını veya ilana göre TR/EN arasında geçiş yapmayı istiyorsun
- **Doğal Türkçe** yanıtlar ve ön yazılar gerekiyor — makine çevirisi değil
- **Türkiye'ye özgü sözleşme maddeleriyle** uğraşman gerekiyor: kıdem tazminatı, ihbar süresi, SGK, net/brüt maaş farkı, yemek kartı, TÜFE zammı

İlanların çoğu İngilizce ise standart `modes/` klasörünü kullanmaya devam et.

## Nasıl Etkinleştirilir?

### Yol 1 — Oturum bazında, komutla

Oturumun başında Claude'a açıkça söyle:

> "Bundan sonra `modes/tr/` altındaki Türkçe modları kullan."

veya

> "Değerlendirme ve başvuruları Türkçe yap — `modes/tr/_shared.md` ve `modes/tr/is-ilani.md` kullan."

### Yol 2 — Kalıcı olarak, profil üzerinden

`config/profile.yml` dosyasına dil tercihini ekle:

```yaml
language:
  primary: tr
  modes_dir: modes/tr
```

Ardından ilk oturumda Claude'a bu ayarı hatırlat ("profile.yml'e baktım, `language.modes_dir` ayarlanmış"). Bundan sonra Claude otomatik olarak Türkçe modları kullanır.

## Mevcut Modlar

| Dosya | Kaynak | Amaç |
|-------|--------|------|
| `_shared.md` | `modes/_shared.md` (EN) | Paylaşılan bağlam, arketipler, global kurallar, Türkiye piyasa özelinde terimler |
| `is-ilani.md` | `modes/oferta.md` (ES) | Tek bir ilanın tam değerlendirmesi (Bloklar A-G) |
| `basvuru.md` | `modes/apply.md` (EN) | Başvuru formu için canlı asistan |
| `pipeline.md` | `modes/pipeline.md` (ES) | URL gelen kutusu / biriktirilmiş ilanlar için ikinci beyin |

Diğer modlar (`scan`, `batch`, `pdf`, `tracker`, `auto-pipeline`, `deep`, `contacto`, `ofertas`, `project`, `training`) İngilizce/İspanyolca orijinalleriyle çalışmaya devam eder — içerikleri büyük ölçüde araç komutları, dosya yolları ve yapılandırma talimatlarından oluştuğundan dilden bağımsız kalmaları tercih edilmiştir.

## Türkiye'ye Özgü Piyasa Kapsamı

`_shared.md` dosyası aşağıdaki Türkiye'ye özgü kavramları kapsar:

- **SGK** — Sosyal güvenlik primleri ve brüt/net maaş hesabı
- **Kıdem tazminatı** — Her hizmet yılı için yasal tazminat
- **İhbar süresi** — Kanuni bildirim süreleri (2-8 hafta, kıdeme göre)
- **Deneme süresi** — Yasal maksimum 2 ay
- **Yıllık izin** — Kıdeme göre 14-26 gün yasal minimum
- **Prim/Bonus** — Performans primleri
- **Yemek kartı** — Ticket Restaurant, Sodexo, Multinet gibi kartlar
- **Özel sağlık sigortası** — SGK'ya ek sigorta (premium yan hak)
- **Servis** — İşveren ulaşımı
- **TÜFE zammı** — Enflasyona endeksli yıllık zam
- **İş Kanunu No. 4857** — Temel iş kanunu referansı

## Türkçe Olmayan Terimler

Kasıtlı olarak çevrilmedi — standart teknik kelime dağarcığı:

- `cv.md`, `pipeline`, `tracker`, `report`, `score`, `archetype`, `proof point`
- Araç adları (`Playwright`, `WebSearch`, `WebFetch`, `Read`, `Write`, `Edit`, `Bash`)
- Takipçideki durum değerleri (`Evaluated`, `Applied`, `Interview`, `Offer`, `Rejected`)
- Kod parçacıkları, dosya yolları, komutlar

Modlar, İstanbul ve Ankara'daki gerçek mühendislik ekiplerinde konuşulduğu gibi Türkçe teknik dil kullanır: Türkçe akıcı metin, yaygın kullanımda yerleşmiş İngilizce teknik terimler. "Pipeline" kelimesinin zorla "boru hattı"na çevrilmesi gibi uygulamalardan kaçınılmıştır.

## Kelime Kılavuzu

Modları özelleştirirken veya genişletirken bu kelime dağarcığına uy — tutarlı bir ton sağlar:

| İngilizce | Türkçe (bu kod tabanında) |
|-----------|--------------------------|
| Job posting | İş ilanı |
| Application | Başvuru |
| Cover letter | Ön yazı |
| Resume / CV | Özgeçmiş |
| Salary | Maaş / Ücret |
| Compensation | Tazminat |
| Skills | Beceriler |
| Interview | Mülakat |
| Hiring manager | İşe alım yöneticisi / Hiring Manager |
| Recruiter | İK uzmanı / Recruiter |
| Requirements | Gereksinimler |
| Career history | İş deneyimi |
| Notice period | İhbar süresi |
| Probation | Deneme süresi |
| Annual leave | Yıllık izin |
| Severance pay | Kıdem tazminatı |
| Gross / Net salary | Brüt / Net maaş |
| Social security | SGK |
| Permanent employment | Belirsiz süreli sözleşme |
| Fixed-term employment | Belirli süreli sözleşme |
| Remote / Hybrid | Uzaktan / Hibrit |
| Meal card | Yemek kartı |
| Private health insurance | Özel sağlık sigortası |
| Company shuttle | Servis |
| Inflation adjustment | TÜFE zammı / Enflasyon zammı |

## Katkı

Bir çeviriyi iyileştirmek veya başka bir modu Türkçeleştirmek istersen:

1. `CONTRIBUTING.md`'ye göre bir Issue aç
2. Yukarıdaki kelime kılavuzuna uy — tutarlı ton için
3. Kelimesi kelimesine çeviri değil, anlam ve deyim bakımından doğal çeviri yap
4. Yapısal öğeleri (Blok A-G, tablolar, kod blokları, araç talimatları) aynen koru
5. PR açmadan önce gerçek bir Türkçe ilan (Kariyer.net veya Yenibiris.com) üzerinde test et
