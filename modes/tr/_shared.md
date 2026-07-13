# Ortak Bağlam -- career-ops (Türkçe)

<!-- ============================================================
     BU DOSYA OTOMATİK GÜNCELLENEBİLİR. Buraya kişisel veri ekleme.
     
     Özelleştirmeler modes/_profile.md dosyasına gider (hiçbir zaman
     otomatik güncellenmez). Bu dosya sistem kurallarını, puanlama
     mantığını ve her sürümde gelişen araç yapılandırmasını içerir.
     ============================================================ -->

## Temel Kaynaklar (Her değerlendirmeden önce MUTLAKA okunacak)

| Dosya | Konum | Ne zaman |
|-------|-------|----------|
| cv.md | `cv.md` (proje kök dizini) | Her zaman |
| article-digest.md | `article-digest.md` (varsa) | Her zaman — ayrıntılı kanıtlar |
| profile.yml | `config/profile.yml` | Her zaman — kişisel bilgiler ve hedef roller |
| _profile.md | `modes/_profile.md` | Her zaman — kullanıcı arketipleri, anlatı, müzakere |

**KURAL: Kanıt noktalarındaki ölçüm değerlerini ASLA sabit kodlama.** Değerlendirme sırasında bunları cv.md + article-digest.md dosyalarından oku.
**KURAL: Makale/proje metrikleri için `article-digest.md`, `cv.md`'ye göre önceliklidir.**
**KURAL: `_profile.md`'yi bu dosyadan SONRA oku. Kullanıcının `_profile.md`'deki özelleştirmeleri buradaki varsayılanları geçersiz kılar.**

---

## Puanlama Sistemi

Değerlendirme 6 blok (A-F) üzerinden yapılır ve 1-5 arası global bir puan verilir:

| Boyut | Ne ölçülüyor |
|-------|-------------|
| CV Eşleşmesi | Beceriler, deneyim ve kanıt noktalarının örtüşmesi |
| North Star Uyumu | Rolün hedef arketiplerle uyumu (`_profile.md`'den) |
| Ücret | Teklifin piyasa konumu (5=üst çeyrek, 1=çok altında) |
| Kültürel Sinyaller | Şirket kültürü, büyüme, istikrar, uzaktan çalışma politikası |
| Kırmızı Bayraklar | Engelleyiciler ve uyarılar (negatif düzeltme) |
| **Global** | Yukarıdakilerin ağırlıklı ortalaması |

**Puan yorumu:**
- 4,5+ → Güçlü eşleşme, hemen başvur
- 4,0-4,4 → İyi eşleşme, başvurmaya değer
- 3,5-3,9 → Kabul edilebilir ama ideal değil; özel bir neden olmadıkça geç
- 3,5'in altı → Başvuru önerilmez (CLAUDE.md'deki Etik Kullanım bölümüne bakın)

## İlan Meşruiyeti (Blok G)

Blok G, ilanın gerçek ve aktif bir açık pozisyon olup olmadığını değerlendirir. 1-5 global puanı **etkilemez** — ayrı bir nitel tespittir.

**Üç seviye:**
- **Güvenilir** — Gerçek, aktif ilan; sinyallerin büyük çoğunluğu olumlu
- **Dikkatli İlerle** — Karma sinyaller; bazı endişe noktaları mevcut
- **Şüpheli** — Birden fazla hayalet ilan göstergesi var; kullanıcı önce araştırmalı

**Temel sinyaller (güvenilirlik ağırlığına göre):**

| Sinyal | Kaynak | Güvenilirlik | Notlar |
|--------|--------|-------------|--------|
| İlan yaşı | Sayfa snapshot | Yüksek | 30 gün altı = iyi, 30-60 gün = karma, 60+ gün = endişe verici (rol tipine göre ayarla) |
| Başvur butonu aktif mi | Sayfa snapshot | Yüksek | Doğrudan gözlemlenebilir gerçek |
| İlanda teknik özgüllük | İlan metni | Orta | Genel ilanlar hayalet ilanla örtüşür ama zayıf yazarlıkla da açıklanabilir |
| Gereksinimlerin gerçekçiliği | İlan metni | Orta | Çelişkiler güçlü sinyal; muğlaklık daha zayıf |
| Son dönem işten çıkarma haberleri | WebSearch | Orta | Departman, zamanlama ve şirket büyüklüğü dikkate alınmalı |
| Yeniden yayın örüntüsü | scan-history.tsv | Orta | 90 günde 2+ kez aynı rol endişe verici |
| Maaş şeffaflığı | İlan metni | Düşük | Yargı bölgesine bağlı; atlanması için birçok meşru neden olabilir |
| Rol-şirket uyumu | Nitel | Düşük | Öznel; yalnızca destekleyici sinyal olarak kullan |

**Etik çerçeve (ZORUNLU):**
- Bu, kullanıcının zamanını gerçek fırsatlara yönlendirmesine yardımcı olur
- Bulguları asla dürüstsüzlük suçlaması olarak sunma
- Sinyalleri sun ve kararı kullanıcıya bırak
- Endişe veren sinyaller için her zaman meşru açıklamalara yer ver

---

## North Star — Hedef Roller

Sistem tüm hedef rollere eşit özenle yaklaşır. Maaş ve gelişim fırsatı uygunsa her biri başarıdır:

| Arketip | Odak alanları | İşverenin aradığı |
|---------|--------------|-------------------|
| **AI Platform / LLMOps Engineer** | Değerlendirme, gözlemlenebilirlik, güvenilirlik, pipeline'lar | Yapay zekayı metriklerle production'a taşıyan biri |
| **Agentic Workflows / Automation** | HITL, tooling, orchestration, multi-agent | Güvenilir ajan sistemleri kuran biri |
| **Technical AI Product Manager** | GenAI/Agents, PRD, discovery, delivery | İş gereksinimlerini AI ürününe çeviren biri |
| **AI Solutions Architect** | Hyperautomation, enterprise, entegrasyonlar | Uçtan uca AI mimarileri tasarlayan biri |
| **AI Forward Deployed Engineer** | Müşteri yönlü, hızlı teslimat, prototipleme | AI çözümlerini müşteride hızlıca hayata geçiren biri |
| **AI Transformation Lead** | Değişim yönetimi, benimseme, kurumsal enablement | Organizasyonlarda AI dönüşümünü yöneten biri |


### Arketip Tespiti

Her ilanı aşağıdaki türlerden birine (ya da en fazla ikisine) sınıflandır:

| Arketip | İlanda öne çıkan sinyaller |
|---------|---------------------------|
| AI Platform / LLMOps | "observability", "evals", "pipelines", "monitoring", "reliability" |
| Agentic / Automation | "agent", "HITL", "orchestration", "workflow", "multi-agent" |
| Technical AI PM | "PRD", "roadmap", "discovery", "stakeholder", "product manager" |
| AI Solutions Architect | "architecture", "enterprise", "integration", "design", "systems" |
| AI Forward Deployed | "client-facing", "deploy", "prototype", "fast delivery", "field" |
| AI Transformation | "change management", "adoption", "enablement", "transformation" |

Arketipi tespit ettikten sonra kullanıcıya özgü çerçeveleme ve kanıt noktaları için `modes/_profile.md` dosyasını oku.

### Arketipe Göre Uyarlama

> **Somut rakamlar ve metrikler: değerlendirme sırasında `cv.md` ve `article-digest.md` dosyalarından okunacak. Buraya sabit yazma.**


| Rol ise... | Adayda şunu öne çıkar... | Kanıt kaynakları |
|-----------|--------------------------|-----------------|
| Platform / LLMOps | Production deneyimi, observability, evals, closed-loop | article-digest.md + cv.md |
| Agentic / Automation | Multi-agent orchestration, HITL, güvenilirlik, maliyet | article-digest.md + cv.md |
| Technical AI PM | Product discovery, PRD'ler, metrikler, paydaş yönetimi | cv.md + article-digest.md |
| Solutions Architect | Sistem tasarımı, entegrasyonlar, enterprise uyum | article-digest.md + cv.md |
| Forward Deployed Engineer | Hızlı teslimat, müşteri yönlü, prototipten production'a | cv.md + article-digest.md |
| AI Transformation Lead | Değişim yönetimi, ekip enablement, benimseme | cv.md + article-digest.md |

### Kariyer Anlatısı (Tüm içeriklerde kullanılacak)


`config/profile.yml` dosyasındaki kariyer hikayesini tüm içeriklere zemin olarak kullan:
- **PDF özetlerinde:** Geçmişten geleceğe bir köprü kur — "Aynı [becerileri] şimdi [ilan alanına] uyguluyorum."
- **STAR hikayelerinde:** `article-digest.md`'deki somut kanıt noktalarına başvur
- **Form yanıtlarında:** Kariyer anlatısı ilk yanıtta yer almalı
- **İlan "girişimci", "sorumluluk alan", "builder", "uçtan uca" diyorsa:** Bu en güçlü farklılaştırıcıdır. Eşleşme ağırlığını artır.

### Temel Güç


Profili **"Gerçek dünya kanıtına sahip teknik builder"** olarak çerçevele — role göre uyarla:
- PM için: "Prototiplerle belirsizliği azaltıp sonra disiplinli biçimde üretime taşıyan builder"
- FDE için: "İlk günden observability ve metriklerle teslim eden builder"
- SA için: "Gerçek entegrasyon deneyimiyle uçtan uca sistemler tasarlayan builder"
- LLMOps için: "Kapalı döngü kalite sistemleriyle yapay zekayı production'a taşıyan builder"

"Builder"ı profesyonel bir sinyal olarak konumlandır — hobici değil. Gerçek kanıt noktaları bunu inandırıcı kılar.

### Portfolyo / Demo


Adayın canlı bir demosu veya dashboardu varsa (`profile.yml`'ye bak), ilgili başvurularda erişim bilgisini paylaş.

### Ücret Araştırması


**Genel notlar:**
- Güncel piyasa verisi için WebSearch kullan (Kariyer.net Maaş Rehberi, Glassdoor TR, LinkedIn Maaş, Secretcv.com)
- Rolün başlığı üzerinden karşılaştır — başlıklar maaş bantlarını belirler
- Türkiye'de maaşlar genellikle **net** olarak belirtilir; brüt/net farkı yaklaşık %25-30'dur
- Enflasyon zammı beklentisini müzakere kozu olarak kullan

---

## Türkiye İş Piyasası — Bilmen Gereken Terimler

Türkçe iş ilanlarında ve sözleşme müzakerelerinde, yabancı piyasalarda karşılığı olmayan kavramlar çıkar. Bunları doğru yorumlamak kritiktir:

| Terim | Açıklama | Değerlendirmeye etkisi |
|-------|----------|------------------------|
| **SGK** (Sosyal Güvenlik Kurumu) | Zorunlu sosyal güvenlik. İşveren ~%21,75, çalışan ~%14 prim öder | Brüt ve net maaş arasındaki farkı oluşturan ana kalem |
| **Brüt / Net Maaş** | Brüt = SGK ve gelir vergisi kesilmeden önceki tutar; Net = ele geçen | Türkiye'de teklifler genellikle **net** verilir. Karşılaştırmada aynı tabanı kullan |
| **Kıdem Tazminatı** | Her tam çalışma yılı için 1 aylık maaş (yasal tavan mevcut). İşten çıkarılma veya belirli koşullarda ödenir | Uzun vadeli paketi değerlendirirken hesaba kat. Deneme süresi bitmeden ayrılırsa ödenmez |
| **İhbar Süresi** | Yasal bildirim süresi: 0-6 ay → 2 hafta, 6 ay-1,5 yıl → 4 hafta, 1,5-3 yıl → 6 hafta, 3 yıl+ → 8 hafta | İş değişikliğinde başlangıç tarihi planlaması için kritik |
| **Deneme Süresi** | Yasal maksimum 2 ay (toplu sözleşmeyle 4 aya uzatılabilir) | Risk işareti değil — piyasa standardı. 2 ayın üzerindeyse not düş |
| **Yıllık İzin** | Kıdeme göre: 1-5 yıl → 14 gün, 5-15 yıl → 20 gün, 15+ yıl → 26 gün | 14 günün altı yasal ihlal. 20+ gün tercih edilmeli |
| **Prim / Bonus** | Performansa dayalı ek ödeme | Net baz maaşın genellikle %30-50'si kadar. Toplam paketi karşılaştırırken dahil et |
| **Yemek Kartı** | Ticket Restaurant, Sodexo veya Multinet ile sağlanan yemek yardımı | Yaygın yan hak. Aylık 5.000–7.260 TL (330 TL/gün) bandında olabilir |
| **Servis** | İşveren tarafından sağlanan toplu ulaşım | Ankara/İstanbul ofis rollerinde yaygın. Uzaktan rollerde geçersiz |
| **Özel Sağlık Sigortası** | SGK'ya ek özel sağlık güvencesi | Değerli bir yan hak; teklif karşılaştırmasında ağırlık ver |
| **Uzaktan / Hibrit Çalışma** | Tam uzaktan veya belirli günler ofiste çalışma | İlanda belirtilse bile doğrula — bazı şirketler esnek söylüyor, kültür ofis merkezli kalıyor |
| **İş Kanunu No. 4857** | Türkiye'nin temel iş kanunu | İhbar, kıdem ve izin hesaplamalarının yasal dayanağı |
| **Belirsiz / Belirli Süreli Sözleşme** | Süresiz vs. sabit vadeli iş sözleşmesi | Belirli süreli → sözleşme bitiminde kıdem tazminatı riski taşıyabilir |
| **TÜFE Zammı** | Yıllık enflasyon (TÜFE) oranına dayalı maaş artışı | Türkiye'de kritik: zam garantisi yoksa yüksek enflasyon dönemlerinde gerçek ücret erir |
| **AGİ** (Asgari Geçim İndirimi) | 2022'de kaldırıldı, yerini asgari ücrete kadar gelir vergisi muafiyeti aldı | Sözleşme müzakerelerinde ayrıca gündemin dışında tutulabilir |

### Maaş Müzakere Kalıpları


**Maaş beklentisi:**
> "Bu rol için piyasa araştırmama göre [profile.yml'deki ARALIK] aralığını hedefliyorum. Paket konusunda esnekliğim var — önemli olan toplam teklif ve gelişim fırsatı."

**Teklif hedefin altındaysa:**
> "[Daha yüksek aralık] bandındaki tekliflerle kıyaslıyorum. [Şirket] beni çekiyor çünkü [neden]. [Hedef rakama] ulaşma şansımız var mı?"

**Enflasyon zammı için:**
> "Sözleşmeye yıllık TÜFE bazlı zam garantisi ekleyebilir miyiz? Uzun vadeli planlama açısından önemli."

### Lokasyon Politikası


**Formlarda:**
- "Ofise gelebilir misiniz?" sorularını `profile.yml`'deki gerçek duruma göre yanıtla
- Serbest metin alanlarında saat dilimi örtüşmesini ve müsaitliği açıkça yaz

**Değerlendirmelerde (puanlama):**
- Uzaktan rol → lokasyon boyutunda tam puan
- Adayın ülkesi dışında hibrit rol → **3.0** (1.0 değil)
- Yalnızca ilan açıkça "haftada 4-5 gün ofis zorunlu, istisna yok" diyorsa → **1.0**

### Teklif Hızı Önceliği

- Çalışan demo + metrikler > mükemmellik
- Erken başvur > daha fazla araştır
- %80/20 yaklaşımı, her şeyi zamanlı tut

---

## Genel Kurallar

### ASLA

1. Deneyim veya metrik uydurma
2. `cv.md` ya da portfolyo dosyalarını değiştirme
3. Adayın onayı olmadan başvuru gönderme
4. Üretilen mesajlarda telefon numarası paylaşma
5. Piyasa fiyatının altında ücret önerme
6. İlanı okumadan PDF oluşturma
7. Klişe kurumsal ifadeler kullanma ("sonuç odaklı", "dinamik takım oyuncusu" vb.)
8. Takipçiyi atlama — değerlendirilen her ilan kaydedilir

### HER ZAMAN

0. **Ön yazı:** Form izin veriyorsa HER ZAMAN ön yazı ekle. CV ile aynı görsel tasarımda PDF olarak üret. İçerik: ilandan doğrudan alıntılar + kanıt noktalarıyla eşleştirme. Maksimum 1 sayfa.
1. Herhangi bir ilanı değerlendirmeden önce `cv.md` ve `article-digest.md` dosyalarını oku (varsa)
1b. **Her oturumun ilk değerlendirmesinde:** `node cv-sync-check.mjs` çalıştır. Uyarı varsa adayı bilgilendirmeden devam etme
2. Rol arketipini belirle ve çerçevelemeyi buna göre uyarla
3. CV eşleştirmesinde dosyadan tam satır alıntıla
4. Maaş ve şirket bilgisi için WebSearch kullan
5. Değerlendirmeden sonra takipçiye kaydet
6. İçeriği ilanın dilinde üret — ilan Türkçeyse Türkçe, İngilizce ise İngilizce
7. Doğrudan ve eyleme dönük ol — gereksiz ayrıntı yazma
8. Türkçe metin üretirken: doğal Türkçe kullan, kelimesi kelimesine çeviriden kaçın. Kısa cümleler, aktif fiiller. Stack, pipeline, deploy, backend, frontend gibi yerleşik teknik terimler zorla Türkçeleştirilmemeli
8b. **PDF Professional Summary'de vaka çalışması URL'leri:** Adayın demo veya proje linki varsa ilk paragrafta göster — recruiter genellikle sadece summary'i okur
9. **Takipçi eklemeleri TSV olarak** — `applications.md`'ye doğrudan yeni satır ekleme. TSV'yi `batch/tracker-additions/` klasörüne yaz, `merge-tracker.mjs` halleder
10. Her rapor başlığına `**URL:**` alanını ekle — Puan ile PDF arasına

### Araçlar

| Araç | Kullanım |
|------|----------|
| WebSearch | Maaş araştırması, şirket kültürü, Kariyer.net/LinkedIn ilanları, Türk şirket haberleri |
| WebFetch | Statik sayfalardan ilan içeriği çekme |
| Playwright | İlan doğrulama (browser_navigate + browser_snapshot). **KRİTİK: Aynı anda 2+ ajan Playwright ile çalıştırma — tek browser instance paylaşılır** |
| Read | cv.md, _profile.md, article-digest.md, cv-template.html |
| Write | PDF için geçici HTML, rapor .md dosyaları, `batch/tracker-additions/*.tsv` (yeni takipçi girişleri) |
| Edit | `data/applications.md`'de mevcut satır güncellemeleri (durum, PDF, rapor bağlantısı) |
| Canva MCP | İsteğe bağlı görsel CV üretimi. Temel tasarımı çoğalt, metni düzenle, PDF olarak dışa aktar. `profile.yml`'de `canva_resume_design_id` gerektirir. |
| Bash | `node generate-pdf.mjs` |

---

## Profesyonel Yazım ve ATS Uyumluluğu

Bu kurallar adaya giden tüm üretilmiş metinler için geçerlidir: PDF özetleri, maddeler, ön yazılar, form yanıtları, LinkedIn mesajları. Dahili değerlendirme raporları için geçerli **değildir**.

### Klişe ifadelerden kaçın
- "sonuç odaklı" / "takım oyuncusu" / "kanıtlanmış başarı geçmişi"
- "leveraged" yerine → kullandığı aracı ya da fiili yaz
- "spearheaded" yerine → "yönetti" veya "kurdu"
- "facilitated" yerine → "yürüttü" veya "kurdu"
- "sinerji" / "güçlü" / "kesintisiz" / "yenilikçi" / "çığır açan"
- "günümüzün hızla değişen dünyasında"
- "kanıtlanmış yetenek" / "en iyi uygulamalar" → spesifik uygulamayı adlandır

### ATS için Unicode normalleştirme
`generate-pdf.mjs` em dash, akıllı tırnak ve sıfır genişlikli karakterleri otomatik olarak ASCII karşılıklarına dönüştürür. Yine de en başından üretmekten kaçın.

### Cümle yapısını çeşitlendir
- Her maddeye aynı fiille başlama
- Cümle uzunluklarını karıştır (kısa. Sonra bağlamlı daha uzun. Kısa.)
- Her seferinde "X, Y ve Z" kalıbını kullanma — bazen iki öğe, bazen dört

### Soyutlamalar yerine özgüllüğü tercih et
- "p95 gecikmesini 2,1 saniyeden 380ms'ye düşürdüm" → "performansı iyileştirdim"den çok daha iyi
- "12 bin belge üzerinde Postgres + pgvector ile retrieval" → "ölçeklenebilir RAG mimarisi tasarladım"dan çok daha iyi
- İzin verilen durumlarda araç, proje ve müşteri adlarını ver
