# Mod: interview-prep — Şirkete Özel Mülakat İstihbaratı

Kullanıcı belirli bir şirket+rol için mülakata hazırlanmak istediğinde veya bir değerlendirme 4.0+ puan alıp kullanıcı durumu `Interview` olarak güncellediğinde bu modu çalıştır.

## Girdiler

1. **Şirket adı** ve **rol başlığı** (gerekli)
2. `reports/` içindeki **Değerlendirme raporu** (varsa) — arketip, eksikler ve eşleşen kanıt noktaları için oku
3. `interview-prep/story-bank.md` adresindeki **Story bank** — mevcut hazırlanmış hikayeler için oku
4. `cv.md` + `article-digest.md` içindeki **CV** — kanıt noktaları için oku
5. `config/profile.yml` + `modes/_profile.md` içindeki **Profil** — aday bağlamı için oku
6. Varsa değerlendirme/PDF/başvuru akışındaki **İşe alım uzmanı (recruiter) tarafı risk haritası** — mülakat sürecinin çözmesi gereken risk kategorileri için `modes/heuristics/recruiter-side.md` dosyasını kullan

## Adım 1 — Araştırma

Şu WebSearch sorgularını çalıştır. Özetleri değil, yapılandırılmış verileri çıkar. Her iddia için kaynak göster.

Çoğu sürecin ilk turu teknik bir panel değil, bir İK / işe alım uzmanı ön görüşmesidir — bu nedenle araştırma her ikisini de kapsamalıdır. Sorguları bilgilendirdikleri kitleye göre gruplandır:

**İK / İşe Alım Uzmanı Ön Görüşmesi** (erken aşama uyum, maaş, lojistik):

| Sorgu | Çıkarılacaklar |
|-------|-----------------|
| `"{company} {role} salary" site:levels.fyi` ve `"{company} {role} salary" site:glassdoor.com/Salary` (ikisini de çalıştır — alıntı içine alınan ifadelerdeki `OR` çoğu motor tarafından tam metin olarak alınır) | Seviyeye göre ücret aralıkları (Net / Brüt Maaş, Hisse / Çalışan Pay Senedi Opsiyonu, bonus) |
| `"{company} interview process site:glassdoor.com"` ardından getirilen incelemeleri manuel olarak İK / İşe Alım Uzmanı Ön Görüşmesini anlatanlara filtrele | Süreç takvimi, eleme kriterleri, yaygın ön görüşme soruları, işe alım uzmanı davranışı |
| `"{company} site:teamblind.com" comp negotiation OR offer` | Samimi maaş/pazarlık gücü detayları, işe alım uzmanlarının neye itiraz ettiği |
| `"{company} careers"` + `"{company} benefits"` | Resmi maaş/yan haklar çerçevesi, çalışma izni/vize politikası, lokasyon politikası |

**İşe Alım Yöneticisi Görüşmesi / Liderlik** (motivasyon, kapsam uyumu, takım uyumu):

| Sorgu | Çıkarılacaklar |
|-------|-----------------|
| `"{company} engineering blog"` ve `"{company} {team} blog"` | Takımın son çalışmaları, teknik öncelikleri, adlandırılmış zorlukları |
| `"{company}" news OR launch OR roadmap` (son 12 ay) | Son dönem dönüm noktaları, halka açık iddiaları, işe alım itici güçleri |
| `"{company} {role} interview process"` (genel) | İşe Alım Yöneticisi Görüşmesi turu yapısı, neyi değerlendirdikleri, aday değerlendirme notları |

**Teknik Değerlendirme / Ekip Görüşmesi** (derinlik, iş birliği, iş üzerindeki gerçekçilik):

| Sorgu | Çıkarılacaklar |
|-------|-----------------|
| `"{company} {role} interview questions site:glassdoor.com"` | Sorulan gerçek sorular, zorluk derecesi, deneyim değerlendirmesi, tur sayısı, teklif/ret oranı |
| `"{company} {role} interview site:leetcode.com/discuss"` | Belirli kodlama/teknik problemler, sistem tasarımı konuları, tur yapısı |
| `"{company} interview process site:teamblind.com"` ardından getirilen konuları manuel olarak teknik turları anlatanlara filtrele | İşe alım çıtası, son teknik mülakat veri noktaları |

Eğer şirket küçük veya az biliniyorsa ve çok az sonuç veriyorsa, genişlet: benzer aşamadaki şirketlerde rol arketipini ara ve istihbaratın seyrek olduğunu not et. İstihbarat seyrek olsa bile İK / İşe Alım Uzmanı Ön Görüşmesi sorgularını yap — hemen her şirket için maaş/lojistik verisi bulunur.

**ASLA Soru Uydurma.** Eğer bir kaynak "dağıtık sistemler hakkında sordular" diyorsa, bunu raporla. Özel bir dağıtık sistemler sorusu icat etme. İş tanımı (JD) analizinden olası sorular çıkarırken, bunları adaylardan alınmış gibi değil, `[inferred from JD]` olarak açıkça etiketle.

**Etiket kuralları** (bunları karıştırma):

- `[inferred from JD]` — aday raporundan ziyade iş tanımından çıkarılan sorular.
- `[inferred]` — `Conducted by` bilinmediğinde süre / pozisyona göre yapılan kitle sınıflandırmaları (Adım 2.5).

## Adım 2 — Süreç Özeti

```markdown
## Süreç Özeti
- **Aşamalar:** {N} aşama, uçtan uca ~{X} gün
- **Format:** {örn. İK / işe alım uzmanı ön görüşmesi → teknik telefon → ev ödevi / vaka çalışması (case study) → yerinde görüşme / çoklu görüşme bloğu (4 görüşme) → işe alım yöneticisi}
- **Zorluk:** {X}/5 (Glassdoor ortalaması, N değerlendirme)
- **Olumlu deneyim oranı:** {X}%
- **Bilinen tuhaflıklar:** {örn. "beyaz tahta yerine eşli programlama (pair programming)", "LeetCode yok, hepsi pratik", "vaka çalışması (take-home) 4 saat"}
- **Kaynaklar:** {links}
```

Herhangi bir alan için veri yetersizse, tahmin etmek yerine "bilinmiyor — yeterli veri yok" yaz.

## Adım 2.5 — Kitle Haritası

Adım 2'deki her turu tam olarak bir kitle (audience) altında sınıflandır. Kitle, Adım 4 ve 7'de neyin önceliklendirileceğini belirler.

| Kitle               | Tipik tur                                     | Birincil değerlendirme                                          |
|---------------------|----------------------------------------------|-----------------------------------------------------------------|
| `recruiter-screen`  | İlk görüşme (15–30 dk, İK / İşe alım uzmanı / TA) | Uyum geçidi: motivasyon, maaş, lokasyon/vize, zaman çizelgesi |
| `hiring-manager`    | İşe Alım Yöneticisi Görüşmesi / bir üst düzey (30–45 dk) | Neden bu rol, kapsam uyumu, liderlik sinyalleri                 |
| `peer-tech`         | IC teknik (canlı kodlama, sistem tasarımı, Ev Ödevi / Vaka Çalışması (Case Study)) | Gerçek stack üzerinde derinlik + iş birliği                    |
| `panel-mixed`       | Yerinde Görüşme / Çoklu Görüşme Bloğu (birden çok görüşmecinin olduğu karma blok) | Yukarıdakileri çapraz keser                                      |

Eğer bir turun `Conducted by` (Görüşmeyi Yapan) kısmı bilinmiyorsa, süre, konum ve JD'den veya iş ilanından gelen herhangi bir sinyale dayanarak dikkatlice çıkarım yap. Yaygın örüntüler:

- 1. Tur, kısa (15–30 dk) → neredeyse her zaman `recruiter-screen`.
- 2. Tur — **varsayılan belirleme**. Birçok şirket buraya iş arkadaşı liderliğinde (peer-led) bir teknik telefon mülakatı koyar, diğerleri ise işe alım yöneticisini koyar. Tur "teknik ön görüşme (technical screen)" olarak tanımlanıyorsa veya kodlama/sistem tasarımı bileşeni varsa `peer-tech`i tercih et; bir İşe Alım Yöneticisi Görüşmesi / üst düzey / liderlik sohbeti olarak tanımlanıyorsa `hiring-manager`i tercih et; aksi takdirde `panel-mixed [inferred]` olarak işaretle ve iki paketi de hazırla.
- Derin teknik blok (canlı kodlama, sistem tasarımı, Ev Ödevi / Vaka Çalışması (Case Study) incelemesi) → `peer-tech`.
- Peş peşe çoklu turlarla Yerinde Görüşme / Çoklu Görüşme Bloğu (loop) → `panel-mixed`.

Çıkarılan kitleleri `[inferred]` ile işaretle ve devam et — araştırmanın erken aşamalarında seyrek istihbarat normaldir.

```markdown
## Kitle Haritası
- **1. Tur** (İK ön görüşmesi, 30 dk) → `recruiter-screen`
- **2. Tur** (teknik telefon görüşmesi, 60 dk) → `peer-tech`
- **3. Tur** (işe alım yöneticisi görüşmesi, 45 dk) → `hiring-manager`
- **4. Tur** (yerinde çoklu görüşme, 4× 45 dk) → `panel-mixed`
- ...
```

Yukarıdaki örnek yaygın bir örüntüyü gösterir ancak bir varsayılan değildir. Her turu yukarıdaki gerçek araştırmadan sınıflandır — özellikle 2. tur genellikle `hiring-manager` değil, `peer-tech`tir.

## Adım 3 — Tur Tur Dağılım

Araştırmada keşfedilen her tur için:

```markdown
### Tur {N}: {Type} — kitle: `{audience}`
- **Süre:** {X} dk
- **Görüşmeyi Yapan:** {iş arkadaşı (peer) / yönetici / bir üst düzey (skip-level) / işe alım uzmanı — eğer biliniyorsa}
- **Neyi değerlendiriyorlar:** {belirli beceriler veya özellikler}
- **Raporlanan sorular:**
  - {question} — [kaynak: Glassdoor (URL/date)]
  - {question} — [kaynak: Blind (URL/date)]
- **Nasıl hazırlanılmalı:** {Kitleye uygun, 1-2 somut eylem — kitle başına tam paket için Adım 4'e bak}
```

Eğer tur yapısı bilinmiyorsa, bunu belirt ve şirket büyüklüğü, aşaması ve rol seviyesine dayanarak hangi tür turların bekleneceğine dair mevcut en iyi istihbaratı sağla.

## Adım 4 — Olası Sorular (kitleye göre)

Keşfedilen ve çıkarılan tüm soruları soru türüne göre değil, soruyu soran kitleye göre gruplandır. Her kitle içinde, `cv.md`, `article-digest.md`, `config/profile.yml` ve `modes/_profile.md` kullanarak adaya özel yanıtlar hazırla. **Asla soru uydurma** — kaynaklı sorular kaynak belirtmeli, çıkarılan sorular `[inferred from JD]` olarak etiketlenmelidir.

Eğer o profil dosyalarından herhangi biri eksik, tamamlanmamış veya güncel değilse, boşluğu satır içinde (inline) belirt (örn. "maaş hedefi bilinmiyor — İK'nın bandına bırak (defer to recruiter band)") ve hazırlığı engellemek yerine elde olanlarla devam et. Modun değeri kısmi ama dürüst bir çıktı sağlamaktır, mükemmel-veya-hiçbir-şey değil.

Her yanıt için, sonuç öncelikli bir çerçeveleme kullan:

1. **Başlık (Headline)** — sonuç, karar veya ana fikir.
2. **Etki (Effect)** — işletme, kullanıcılar, sistem veya takım için neden önemliydi.
3. **Gerekçe (Rationale)** — hangi ödünleşme (trade-off) veya kısıtlama bu seçimi şekillendirdi.
4. **Operasyonlar (Operations)** — adayın aslında ne yaptığı, inandırıcı olacak kadar uygulama detayıyla birlikte.

Bu durum özellikle kıdemli (senior), teknik ve liderlik cevapları için önemlidir. Basit İK cevapları daha kısa olabilir, ancak yine de ana fikirle başlamalıdır.

### Kitle: `recruiter-screen`

İşe alım uzmanı beceriyi test etmez, uyumu süzer. Ters köşeye düşüren cevaplar (belirsiz maaş beklentisi, muğlak motivasyon, eksik lojistik) herhangi bir teknik sinyal alınmadan önce süreci sonlandırır. En azından şunları kapsa:

- **"CV'niz üzerinden geçebilir miyiz / Neden iş arıyorsunuz?"** — `modes/_profile.md` anlatısına + rolün arketipine sabitlenmiş 60–90 saniyelik bir anlatı.
- **Maaş beklentisi** — Adım 1'deki Levels.fyi/Glassdoor verilerinden çekilmiş ve `config/profile.yml` dosyasındaki `compensation.target`'a (hedef maaşa) sabitlenmiş somut aralık. Pazarlık gücüne (leverage) dikkat çek: eğer maaş verisi kısıtlıysa veya adayın rakip teklifi yoksa, net bir senaryo ile konuyu devretmeyi öner ("{level} seviyesi için piyasaya göre ayarlama yapıyorum, bu rolün bandını paylaşabilir misiniz?").
- **Neden bu şirket** — Adım 1'den halka açık sinyallere (yeni lansman, belirtilen değerler, takım çalışması) atıfta bulunan 2–3 cümle. Genel övgülerden kaçın.
- **Lokasyon / uzaktan / vize** — `config/profile.yml` içindeki lokasyon politikası ve ilan edilen rolün politikasından türetilen cevap. İşe alım uzmanının doğru yönlendirebilmesi için `modes/_profile.md` dosyasındaki kırmızı çizgileri (deal-breakers) işaretle.
- **Zaman çizelgesi / müsaitlik / ihbar süresi** — hisler değil, rakamlar.
- **Devam eden diğer süreçler** — sadece önerilen çerçeveleme; adayı asla yalan söylemeye itme.
- **Geçmişte olası uyarı işaretleri (red flags)** — boşluklar, geçişler, `cv.md` + `_profile.md`'den gelen olağandışı unsurlar. Dürüst, belirgin, ileriye dönük çerçeveleme — asla savunmacı olma.

### Kitle: `hiring-manager`

İşe alım yöneticisi motivasyon + kapsam uyumunu tarıyor. Onlar çoktan işe alım uzmanının lojistik geçidine güvendiler; senin o işi sahiplenip sahiplenmeyeceğine bakıyorlar. En azından şunları kapsa:

- **"Neden bu rol, neden şimdi?"** — adayın son 1–2 rolünü + `_profile.md` anlatısını Adım 1'de takımın isimlendirilmiş zorluğuna bağla.
- **"Buradaki ilk 90 gününüz nasıl geçerdi?"** — JD kapsamından + takımın son çalışmalarından (mühendislik blogu, halka açık yol haritası) türetilmiştir.
- **Risk haritası kapanışı** — değerlendirmeden kaynaklanan en güçlü olası şüphelerin coşkuyla değil, somut kanıtlarla cevaplandığından emin ol.
- **Liderlik / iş birliği soruları** — `interview-prep/story-bank.md`'ye eşle.
- **Geri sorulacak keskin sorular** — "takım nasıl" gibi genel şeylere değil, takımın yakın zamanda piyasaya sürdüğü veya hakkında yazdığı belirli bir şeye bağlı 2–3 soru.

### Kitle: `peer-tech`

Burası asıl Teknik / Role Özel kovaların yaşadığı yerdir. İş arkadaşları (peers) gerçek stack üzerinde derinlik ve işbirliğini değerlendiriyor.

- **Teknik sorular** (sistem tasarımı, kodlama, mimari, alan) — her biri için: soru, kaynak ve spesifik olarak bu aday için güçlü bir cevabın neye benzediği (CV kanıt noktalarına atıfta bulun).
- **JD arketipine bağlı role özel sorular** — her biri için: soru, bunu neden büyük olasılıkla sordukları (hangi JD gereksinimine eşlendiği) ve adayın en iyi açısı.
- **Ters sorular (Reverse questions)** — nöbet (on-call) rotasyonu, kod inceleme kültürü, deployment ritmi, katıldıklarında onları nelerin şaşırttığı hakkında.

### Kitle: `panel-mixed`

Yerinde Görüşme / Çoklu Görüşme Bloğu (onsite loops) ve karma paneller nadiren adaya bağlam değiştirme zamanı verir — hazırlık önceden yönlendirilmelidir.

**Panel İstihbarat (Panel Intel) tablosu (panelistler adlandırıldığında zorunludur).** Panel başı hazırlığı tasarlamadan önce, bu tabloyu kullanıcının sağladığı herhangi bir profil metninden veya ekran görüntüsü açıklamasından oluştur — scraping veya otomasyon yok, modun diğer yerlerde güvendiği yapıştırılmış girdinin aynısı:

```markdown
## Panel İstihbaratı (Panel Intel)
| İsim | Rol | Çıkarım (Read) |
|------|------|------|
| {Panelist A} | {unvan, kıdem, görünüyorsa raporlama çizgisi} | {geçmişlerinin ne tür sorular soracaklarını ima ettiği ve sorularının ne kadar ağırlık taşıdığı} |
| {Panelist B} | {unvan, kıdem, görünüyorsa raporlama çizgisi} | {...} |
```

Bu tabloyu şu buluşsal yöntemlerle doldur:

- **Karar verici ağırlığı**: iş tanımındaki (JD) raporlama çizgisini (örn. "Şuna raporlar: Yönetici X") adlandırılmış panelistlere çapraz referansla kontrol et. Kimi işaret ediyorsa, o kişi muhtemelen bu tur için birincil karar vericidir — onları `Çıkarım (Read)` sütununda açıkça işaretle (örn. "büyük olasılıkla İşe Alım Yöneticisi eşdeğeri — teklif kararı bunun üzerinden geçer") ve hazırlık eforunu onların paketine doğru ağırlıklandır.
- **Kariyer yörüngesi sinyali**: her panelistin yolunun soracağı soru türü hakkında ne ima ettiğine dair sağlanan deneyim metnini veya ekran görüntüsü açıklamasını oku. Yönetici olarak terfi edilmeden önce birkaç yıl boyunca *işe alınan tam rolü* elinde tutan biri, (örneğin İK/işe alım gibi) teknik bir derinlikten çok süreç, kültür veya uyum çerçevesi için orada olma olasılığı daha yüksek olan komşu bir işlevdeki birine göre daha keskin, daha somut, senaryo tabanlı sorular soracaktır. Bu açıyı sadece iş unvanında değil, `Çıkarım (Read)` sütununda not et.
- **Kitle etiketleme (Audience tagging)**: profilleme sonrasında, her panelisti yine mevcut üç kitleden (işe alım uzmanı / işe alım yöneticisi / peer-tech) birine etiketle ve o kitlenin paketinden çek — tablo bu adımın yerini almaz, ona tanımlı bir girdi verir.

**Paneliste özel kapanış sorusu.** Bir panelistin kendi kariyer çizgisinin açık bir açı sunduğu durumlarda, o kişiye özel bir kapanış sorusu tasarla — bu modun zaten şirket düzeyinde kullandığı kalıbın aynısı (Adım 1'den adlandırılmış bir ekip zorluğuna bağlı olarak "hiring-manager" ve karma panel paketlerinde "Geri sorulacak keskin sorular"), sadece şirkete değil bireye yönelik. Örneğin, rolden yöneticiliğe terfi etmiş biri, "bu role başlarken iş ilanında olmayan neyi bilmeyi isterdiniz" sorusu için doğal bir uyumdur — bir işe alım uzmanının veya komşu bir görevde yer alan bir panelistin bu kadar anlamlı yanıt veremeyeceği bir sorudur. Bunları, adayın hangi bölümde kullanacağını bilmesi için panelistin adıyla etiketleyerek kitle paketinin kendi "geri sorulacak keskin soruları"nın yanında listele.

Her panel görüşmesi/bölümü için:

- **Eğer mülakatçı programda ismen geçiyorsa**, onu yukarıdaki Panel İstihbaratı (Panel Intel) tablosunu kullanarak üç kitleden (işe alım uzmanı / işe alım yöneticisi / peer-tech) birine etiketle. Ardından o kitlenin hazırlık paketinden al.
- **Eğer bölüm etiketsizse**, üç paketi de hazırla ama adayın notlar içinde boğulmaması için her birini en yüksek öncelikli 3-5 madde ile sınırla.
- **Aktarım (Hand-off) disiplini**: Adaya görüşmeler arası bölümlerde neleri kelimesi kelimesine tekrarlamaması GEREKTİĞİNİ açıkça söyle (örn. art arda iki defa aynı şekilde anlatılan bir kanıt noktası senaryolaştırılmış ezber yanıtlar sinyali verir; bakış açısını değiştir).
- **Enerji yönetimi**: 4 saatlik yerinde görüşmeler (onsites) daha az deneyimli adayları daha çabuk tüketir. Derinliği test etmesi en muhtemel olan bölümü (genellikle peer-tech) işaretle ve adayın en taze materyallerini o bölüm için ayır.

## Adım 5 — Story Bank (Hikaye Bankası) Eşleştirmesi

Bu eşleştirmeyi Adım 4'teki **her kitle paketi (audience pack) başına** çalıştır — aynı hikaye bir işe alım uzmanı sorusuna karşı bir peer-tech davranışsal sorusuna farklı şekilde eşleşebilir ve bölümlere ayrılmamış tek bir tablo kitleler arası sapma riski taşır.

| # | Kitle | Olası soru/konu | story-bank.md içindeki en iyi hikaye | Uyum | Boşluk/Eksik? |
|---|----------|----------------------|-------------------------------|-----|------|
| 1 | recruiter-screen | ... | [Hikaye Başlığı] | güçlü/kısmi/yok | |
| 2 | hiring-manager | ... | [Hikaye Başlığı] | güçlü/kısmi/yok | |
| 3 | peer-tech | ... | [Hikaye Başlığı] | güçlü/kısmi/yok | |

- **güçlü (strong)**: hikaye soruyu doğrudan yanıtlar
- **kısmi (partial)**: hikaye komşudur, yeniden çerçevelenmesi gerekir
- **yok (none)**: mevcut hikaye yok — kullanıcı için işaretle

Her eksik için şunları öner: "{konu} hakkında bir hikayeye ihtiyacınız var. Şunu düşünün: {cv.md'den STAR+R hikayesi olabilecek belirli bir deneyim}."

Kullanıcı eksik hikayeleri taslağa dökmek isterse, STAR+R formatını oluşturmalarına yardımcı ol ve bunları `interview-prep/story-bank.md` dosyasına ekle.

## Adım 6 — Teknik Hazırlık Kontrol Listesi

Genel tavsiyelere değil, şirketin gerçekte neyi test ettiğine bağlı olarak:

```markdown
- [ ] {konu} — neden: "{araştırmadan gelen kanıt}"
- [ ] {konu} — neden: "{blogları/ürünleri bunun önemli olduğunu gösteriyor}"
- [ ] {konu} — neden: "{Glassdoor incelemelerinin N/M tanesinde sorulmuş}"
```

Sıklığa ve rolle ilgisine göre önceliklendir. En fazla 10 öğe.

## Adım 7 — Şirket Sinyalleri (kitleye göre)

Söylenecek, yapılacak ve kaçınılacak şeyler — kimin dinlediğine göre bölümlere ayrılır. Aynı gerçek, bir mühendis iş arkadaşı için güç, bir işe alım uzmanı için ise sarı bayrak (uyarı) olabilir; çerçeveleme önemlidir.

### İK / İşe Alım Uzmanı Ön Görüşmesine (recruiter / HR screen)

- **Kendi isteğiyle (gönüllü) söylenecekler**: motivasyon, lokasyon/vize uyumu, zaman çizelgesi, neden bu şirket.
- **Kendi isteğiyle SÖYLENMEYECEKLER**: pazarlık gücü belirsizken net maaş rakamı (kendi bandını söylemesi için konuyu devret); devam eden süreç detayları; şirketin son işten çıkarmaları / basındaki haberleri hakkındaki düşünceler.
- **Kelime Dağarcığı**: yan haklar ve politikalar için resmi şirket dili (kariyer sayfasından).
- **Eleme nedeni olan (screened for) kırmızı bayraklar**: vize sürprizleri, maaş uyumsuzluğu, "her yere başvuruyor" enerjisi.

### İşe Alım Yöneticisine (hiring manager)

- **Giriş yapılacak konu (lead with)**: aday anlatısı (`_profile.md`) ile Adım 1'deki adlandırılmış takım zorluğu arasındaki bağlantı.
- **Kullanılacak kelime dağarcığı**: şirketin kendi içinde kullandığı terimler — ev ödevi yapıldığını gösterir (örn. Stripe "internetin GSYİH'sını artırmak" der, Anthropic "hizalanma (alignment)" değil "güvenlik (safety)" der).
- **Geri sorulacak keskin sorular**: Adım 1'deki son haberlere / blog yazılarına bağlı 2–3 soru.

### Teknik Değerlendirme / Ekip Görüşmesine (peer / technical panel)

- **Giriş yapılacak konu (lead with)**: `cv.md` / `article-digest.md` içindeki stack ile alakalı kanıt noktaları.
- **Kaçınılması gerekenler**: bu şirkete özel Glassdoor / Blind incelemelerinde işaretlenen anti-pattern'ler.
- **Ters sorular (Reverse questions)**: nöbet rotasyonu, kod inceleme normları, deployment ritmi, katıldıklarında onları nelerin şaşırttığı.

### Karma panele (mixed panel)

- **Giriş yapılacak konu (lead with)**: her üç kitlede de (genellikle anlatı + adlandırılmış takım zorluğu) geçerli olan tek bir 2 cümlelik çerçeveleme — sonra her bir görüşmecinin yönlendirmesine izin ver.
- **Tekrarlanmaması GEREKENLER**: aynı kanıt noktasının bölümler arası aynı şekilde anlatılması; bunun yerine açıyı değiştir (işe alım uzmanı ana fikir sayısını duyar, HM takım etkisi (team-impact) çerçevesini duyar, peer-tech teknik detayı duyar).
- **Kelime Dağarcığı**: odada liderlik varken İK (recruiter) dostu dili (etki, kapsam) koru; sadece IC'ler varken iş arkadaşı (peer) diline (mimari, ödünleşmeler (trade-offs), nöbet (on-call)) geç.
- **Kaçınılması gerekenler**: maaş, zaman çizelgesi veya sizi neyin heyecanlandırdığı konusunda bölümler boyunca kendinizle çelişmek. Görüşmeciler notları karşılaştırırlar.

## Çıktı

Tüm raporu `interview-prep/{company-slug}-{role-slug}.md` konumuna şu başlıkla kaydet:

```markdown
# Mülakat İstihbaratı: {Şirket} — {Rol}

**URL:** {iş ilanı URL'si veya şirket kariyer URL'si, ya da recruiter-sourced ise "N/A"}
**Meşruiyet:** {Değerlendirme raporunun G Bloğundan kopyalanan seviye, rapor yoksa "unknown"}
**Rapor:** {Varsa değerlendirme raporunun bağlantısı, yoksa "N/A"}
**Araştırılma Tarihi:** {YYYY-MM-DD}
**Kaynaklar:** {N} Glassdoor incelemesi, {N} Blind gönderisi, {N} diğer
**Kapsanan Kitleler:** {recruiter-screen, hiring-manager, peer-tech, panel-mixed}
```

## Araştırma Sonrası

Raporu teslim ettikten sonra:

1. Kullanıcıya, Adım 5'te bulunan eksikler için hikaye taslağı hazırlamak isteyip istemediğini sor.
2. Planlanmış bir mülakat tarihleri varsa, not et: "Mülakatınıza {X} gün kaldı. Bu hazırlığı gözden geçirmeniz için bir hatırlatıcı ayarlamamı ister misiniz?"
3. Adım 1'deki şirket araştırması yüzeysel (thin) kaldıysa `deep` modunu çalıştırmasını öner — deep modu strateji, kültür ve rekabet manzarasını daha derinlemesine inceler.

## Kurallar

- **ASLA mülakat sorusu icat etme ve bunları kaynaklara atfetme.** Çıkarılan sorular `[inferred from JD]` olarak etiketlenmelidir.
- **ASLA Glassdoor derecelendirmeleri veya istatistikleri uydurma.** Veri yoksa, olmadığını söyle.
- **Her Şeyi Alıntıla.** Her soru, her istatistik, her iddia bir kaynak veya bir `[inferred]` etiketi alır.
- İş tanımının (JD) dilinde üret (Varsayılan olarak EN).
- Doğrudan ol. Bu bir moral konuşması değil, çalışan bir hazırlık belgesidir.
