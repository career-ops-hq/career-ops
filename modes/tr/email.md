# Mod: email — Başvuru E-posta Taslakları

Adayın e-posta istemcisine yapıştırabileceği resmi bir başvuru e-postası gövdesi oluştur. Bu mod; doğrudan başvuru e-postaları, CV eklenmiş işe alım uzmanı takip e-postaları, referans talebi e-postaları, soğuk başvuru e-postaları ve başvuru mekanizmasının kendisi bozulduğunda (gönderilmeyen bir form, çalışmayan bir planlama sayfası, ölü bir değerlendirme bağlantısı) e-postanın yedek kanal olduğu süreç takılması kurtarma e-postaları içindir.

Şunlar için DEĞİLDİR:
- `contacto`: kısa LinkedIn / BOSS Zhipin / sohbet tarzı erişim.
- `cover`: tam bir ön yazı PDF'i.
- `apply`: canlı başvuru formu doldurma.

**Asla gönderme. Asla e-posta yollama. Asla gönder butonuna tıklama.** Yalnızca taslak oluştur. Aday incelemeli ve elle göndermelidir.

---

## Çağrı (Invocation)

Desteklenen girdiler:

1. `/career-ops email {report-number-or-slug}`
   - Eşleşen `reports/{NNN}-*.md` dosyasını yükle.
   - Rapor başlığını, puanını, arketipini, PDF durumunu ve değerlendirme içeriğini kullan.
   - `data/pdf-index.tsv` o rapor için bir satır içeriyorsa, uygunluk noktalarını uyarlanmış CV ile hizalamak için aynı satırın HTML eşini kullan ve onun PDF'inden ek adayı olarak bahset. Kullanılabilir uyarlanmış bir HTML indekslenmemişse uygunluk noktalarını `cv.md`'den seç. İndekslenmiş bir PDF yoksa, CV'nin önce `/career-ops pdf {slug}` ile oluşturulması veya elle eklenmesi gerektiğini söyle.

2. `/career-ops email {pasted JD}`
   - Yapıştırılan JD'yi doğrudan kullan.
   - Rapor, takipçi satırı, PDF veya ön yazı oluşturma.
   - JD'de şirket adı yoksa ve e-posta aksi halde genel geçer duracaksa şirket adını sor.

3. `/career-ops email`
   - En son değerlendirilen bir takipçi satırı varsa, taslağı o satırdan oluşturmayı öner.
   - Kullanılabilir bir bağlam yoksa bir rapor numarası, slug veya JD iste.

4. `/career-ops email stuck {report-number-or-slug}`
   - Şirket ve rol bağlamı için eşleşen `reports/{NNN}-*.md` dosyasını yükle.
   - Bir süreç takılması kurtarma e-postası hazırla (aşağıdaki ayrı bölüme bak).
   - Kullanıcı bozuk bir başvuru adımını anlattığında bu varyantı sohbetten de tetikle; örn. "ATS planlama sayfası bozuk", "formu gönderemiyorum", "değerlendirme bağlantısı ölü", "giriş döngüsü tekrar girmeme izin vermiyor". Belirsizse taslaktan önce varyantı onaylat.

5. `/career-ops email noshow {report-number-or-slug}`
   - Şirket ve rol bağlamı için eşleşen `reports/{NNN}-*.md` dosyasını yükle.
   - Onaylanmış saatte gerçekleşmeyen görüşme için bir takip e-postası hazırla (aşağıdaki ayrı bölüme bak).
   - Kullanıcı iki taraflı bir planlama onayından sonra kaçırılan bir aramayı anlattığında bu varyantı sohbetten de tetikle; örn. "{interviewer} ile {time} görüşmem olmadı", "14:00'te anlaşmıştık, kimse aramadı", "işe alım uzmanı hiç bağlanmadı". Belirsizse taslaktan önce varyantı onaylat; bu, `modes/followup.md` içindeki takvime dayalı takiplerden farklıdır (aşağıdaki kapsam notuna bak).

---

## Adım 1 — Bağlamı Yükle

Şunları oku:
- `config/profile.yml`
- `cv.md`
- Varsa `article-digest.md`
- `modes/_writing.md`: paylaşılan yazım kılavuzu (Voice DNA koruması, Writing Style kalibrasyonu, Professional Writing kuralları). Bir başvuru e-postası adaya yönelik metindir, yani o modülün yönettiği kategoriye girer (#2006)
- Varsa `modes/_profile.md`
- `modes/_profile.md` içinde `## Writing Style` bölümü yoksa ve `writing-samples/` klasöründe `README.md` dışında bir dosya varsa, taslaktan önce `modes/_writing.md` içindeki Writing Style kalibrasyonunu çalıştır ve sonucu `modes/_profile.md` dosyasına yaz
- Varsa `modes/_custom.md`
- Varsa `voice-dna.md` (yalnızca yazım üslubu için)
- Rapor numarası veya slug ile çağrıldıysa seçili rapor
- Varsa, oluşturulmuş PDF eklerini bulmak için `data/pdf-index.tsv`

`modes/_custom.md` dosyasını yalnızca iletişim bloğunun eklenip eklenmeyeceği, ek kontrol listesinin gösterilip gösterilmeyeceği veya e-postanın ne kadar kısa olacağı gibi usule ilişkin çıktı tercihleri için kullan. Asla iletişim bilgisi, iş deneyimi veya başka bir bilgi iddiası getirmemelidir.

`voice-dna.md` dosyasını yalnızca bir yazım koruması olarak kullan. Asla bilgi iddiası getirmemelidir. Üslup önceliği değişmez: `modes/_profile.md`, `voice-dna.md` dosyasının önüne geçer; o da `_writing.md` içindeki genel varsayılanların önüne geçer. Modülü yüklemek, bu modun hiç standardı olmayan yerlere bir standart ekler; kullanıcının kendi kurallarını asla geçersiz kılmaz.

`_writing.md` yalnızca ifadeyi yönetir. Bu modun çıktı sözleşmesi (varyantlar, ek kontrol listesi, konu/gövde yapısı, yalnızca taslak kuralı) burada belirlenir ve ondan etkilenmez.

### Uyarlanmış CV hizalama kaynağı

Bir rapora çözümlenen bir çağrıda, `data/pdf-index.tsv` ile eşleştirirken rapor numarasını normalleştir (`008` ve `8` aynı rapordur). Boş ve yorum satırlarını yok say. Manifest yazıcısı rapor başına tek bir güncel satır tutar; elle düzenlenmiş bir manifestte yinelenen satırlar varsa son eşleşen satırı kullan.

Satırın çalışma alanına göreli `pdf` ve `html` sütunlarını, manifest yazıcısının kullandığı tabana uygun olarak çalışma alanı köküne (`data/` klasörünü içeren dizin) göre çözümle. Eklenen CV'nin okunabilir temsili olarak PDF'i değil, her zaman HTML eşini kullan. HTML eşi yalnızca çözümlenen HTML yolu varsa ve bir dosyaysa kullanılabilir. Benzer adlı bir dosya tahmin etme veya aynı şirkete ama farklı bir rapora ait bir çıktıyı sessizce kullanma.

Uyarlanmış HTML bir **hizalama kılavuzudur, yeni bir gerçek kaynağı değildir**. Desteklenen hangi maddelerin seçileceğini ve nasıl sıralanıp çerçeveleneceğini belirleyebilir, ama e-postadaki her bilgi yine yukarıdaki birincil gerçek kaynağı dosyalarına göre doğrulanmalıdır. Satır yoksa, bozuksa veya HTML dosyası kullanılamıyorsa, uygunluk noktası seçimi için açıkça `cv.md`'ye dön. PDF dosyası varsa yolu ek kontrol listesinde yine gösterilebilir, ama okunabilir bir HTML eşi olmadan gövdenin ona göre hizalandığını asla iddia etme.

### Profil alanları

Mevcut olduğunda bu isteğe bağlı alanları kullan:
- `candidate.full_name`
- `candidate.chinese_name`
- `candidate.email`
- `candidate.phone`
- `candidate.wechat`
- `candidate.location`
- `candidate.linkedin`
- `candidate.github`
- `candidate.portfolio_url`
- `application_email.default_sender_note`
- `application_email.include_contact_block`
- `application_email.include_attachment_checklist`
- `application_email.signature_name`
- `contact_preferences.preferred_channel`
- `contact_preferences.note`

`candidate.wechat` yoksa WeChat'i çıkar. Bir tane uydurma.

---

## Adım 2 — E-posta Türünü Sınıflandır

Kullanıcının ifadelerinden veya bağlamdan beş varyanttan birini seç:

| Varyant | Ne zaman | Üslup |
|---|---|---|
| `hr_application` | Varsayılan. İlan edilmiş bir rol için İK'ya/işe alımcıya CV gönderirken. | Resmi, kısa, ön elemeye uygun |
| `referral_request` | Kullanıcı bir referans, şirket içi kişi, arkadaş, mezun veya eski iş arkadaşı istediğinde. | Sıcak, baskısız, iletmesi kolay |
| `cold_application` | İlan edilmiş bir rol yok, spekülatif erişim, "soğuk e-posta". | Doğrudan, önce değer sunan, çaresizlik içermeyen |
| `process_stuck` | ATS veya başvuru akışı süreç ortasında bozuldu ve e-posta yedek kanal. | Olgusal, iletilebilir, tek ve net bir istek |
| `confirmed_time_noshow` | Bir işe alım uzmanı veya görüşmeci iki taraflı bir yazışmada belirli bir arama saatini onayladı ve aramadı. | Profesyonel, sinirli değil; saate dayalı, özür dilemeyen |

Net değilse `hr_application` varsayılanını kullan.

**Öncelik:** herhangi bir süreç hatası sinyali (bozuk bir adım, bir hata mesajı, ölü bir bağlantı, başarısız planlama) diğer varyantların yerine `process_stuck` seçer. Açık bir iki taraflı saat onayından sonra kaçırılan bir arama ise `confirmed_time_noshow` seçer; bu bir süreç hatası değildir (hiçbir şey bozulmadı, biri sadece aramadı), bu yüzden onu `process_stuck` üzerinden yönlendirme. Bir hata veya kaçırılan arama sinyali seziliyor ama niyet belirsizse onay iste; `hr_application` varsayılanına düşme. `hr_application` varsayılanı yalnızca hiçbir hata veya gelmeme belirtisi yokken geçerlidir.

`process_stuck` ve `confirmed_time_noshow` için 3. adımı (uygunluk noktaları) ve 4. adımı (ek kontrol listesi) atla; okuyucuda başvuru zaten var, bu e-postalar satış yapmak için değil bir süreci açmak veya bir planlama boşluğunu yeniden açmak için vardır. 5. adımdaki yapılar yerine aşağıdaki ayrı bölümleri izle.

---

## Adım 3 — Uygunluk Noktalarını (Fit Points) Çıkar

Rapordan/JD'den ve gerçek kaynağı dosyalarından 2-3 uygunluk noktası seç. Uyarlanmış CV hizalama kaynağı kullanılabilir bir HTML eşi çözümlediyse, gövde eklenen CV'yi anlatsın diye o çıktıdaki kanıt noktalarını ve vurguyu tercih et. Aksi halde seçim kaynağı olarak `cv.md` kullan ve taslağı sunmadan önce HTML hizalamasının kullanılamadığını ve `cv.md`'nin kullanıldığını söyle. HTML hizalama kaynağının olmaması tek başına uyarlanmış PDF'in olmadığı anlamına gelmez.

- Bir rol-profil eşleşmesi: teknoloji yığını, alan, iş akışı, ürün tipi veya teslimat tarzı.
- Bir kanıt noktası: proje, metrik, açık kaynak katkısı veya canlıya alınmış sistem.
- Bir farklılaştırıcı: iş sahipliği, alan bilgisi, iletişim, açık kaynak ekosistemi veya canlıya devir.

Yalnızca gerçek kaynağı dosyalarındaki bilgileri kullan. JD'deki anahtar kelimeleri yeniden ifade et; asla uydurma.

Raporun bir puanı varsa:
- `>= 4.5`: kendinden emin, öncelikli başvuru.
- `4.0-4.4`: iyi eşleşme, başvurmaya değer.
- `< 4.0`: ölçülü; abartarak satma. 4.0'ın altındaysa, taslaktan önce career-ops'un normalde başvurmamayı önerdiği konusunda kullanıcıyı uyar.

---

## Adım 4 — Ek (Attachment) Kontrol Listesi

Taslaktan önce şunu yaz:

```text
Eklenecek dosyalar:
- CV: {PDF yolu veya "uyarlanmış CV'nizi ekleyin"}
- Ön yazı: {biliniyorsa dosya yolu, aksi halde "isteğe bağlı / oluşturulmadı"}
```

Kurallar:
- `application_email.include_attachment_checklist` değeri `false` ise bu listeyi çıkar.
- Rapora dayalı bir çağrıda, PDF adayını seçilen manifest satırından al. O satırın kullanılabilir bir HTML eşi varsa 3. adımı o yönlendirsin. Yoksa yukarıda anlatıldığı gibi 3. adım için `cv.md` kullan, ama çözümlenen PDF yolu varsa o satırın PDF'ini yine göster. Metin kaynağını ve eki farklı satırlardan seçme.
- Yalnızca var olan veya indekslenmiş dosyalardan bahset. Gerçekten yoksa bir ön yazı olduğunu iddia etme.
- Dosya ekleme veya herhangi bir şey gönderme.

---

## Adım 5 — Taslak Yapısı

Her zaman şunu yaz:

```text
Konu: {subject}

{email body}
```

### İK başvuru yapısı

1. Selamlama
2. Rol niyeti ve ek cümlesi
3. Tek bir kısa paragrafta veya sıkı maddeler halinde 2-3 uygunluk noktası
4. JD dilini kullanarak bu rolün neden ilgili olduğu
5. İletişim bloğu ve imza

### Referans talebi yapısı

1. Selamlama
2. Tek satırlık bağlam: rol ve şirket
3. İletmesi kolay 2 kısa kanıt noktası
4. Baskısız istek: "Uygun görünüyorsa, bana referans olmanız veya beni doğru kişiye yönlendirmeniz mümkün olur mu?"
5. İletişim bloğu ve imza

### Soğuk başvuru yapısı

1. Selamlama
2. Önce değer önerisi, "İş arıyorum" değil
3. Şirkete/alana bağlı 2 kanıt noktası
4. Belirli bir istek: kısa bir görüşme, doğru kişi veya CV göndermek için izin
5. İletişim bloğu ve imza

---

## Süreç Takılması Kurtarma E-postası (`process_stuck`)

Normal kanal ATS'dir; bu e-posta, kanal bozulduğu için vardır. Okuyucu çoğu zaman adayı daha sonra değerlendirecek aynı işe alım uzmanıdır, bu yüzden taslak bir şikâyet gibi değil, yetkin bir olay raporu gibi okunmalıdır.

### Bilgi toplama

Taslaktan önce eksik olanları sor:

1. **Hangi adım bozuldu:** form gönderimi, mülakat/ön eleme planlaması, değerlendirme bağlantısı, hesap girişi veya başka bir şey.
2. **Hata nasıl görünüyor:** varsa hata metni birebir, ya da "hata yok, sayfa yeniden yükleniyor / dönüp duruyor / boş saat göstermiyor".
3. **Neler denendi:** başka tarayıcı, başka cihaz, başka saat aralıkları, oturum temizleme, bekleyip yeniden deneme.
4. **Süre baskısı:** değerlendirme penceresi, planlama son tarihi, ilanın kapanış tarihi.
5. **Adayın görebildiği iletişim adresleri:** önceki e-posta yazışmaları, ATS bildirimlerinin göndericisi, ilandaki veya kariyer sayfasındaki adresler.

### Taslak yapısı

1. Selamlama
2. Tek satırlık kimlik: rol, biliniyorsa başvuru/talep kimliği, aday adı
3. Bir işe alım uzmanının ATS yöneticisine olduğu gibi iletebileceği, tekrarlanabilir ve zaman damgalı bir hata açıklaması: adım, tam davranış, zaman damgası + saat dilimi, neler denendiği
4. Tek ve net bir istek, yalnızca bir tane: elle planlama, alındı onayı, değerlendirme penceresinin uzatılması veya çalışan bir bağlantının yeniden gönderilmesi
5. Role ilginin tek satırla yeniden teyidi
6. İmza

Kısa tut: 100-180 kelime. Suçlama yok, özür sarmalı yok, onların tarafında neyin bozuk olduğuna dair tahmin yok, yöneticinin ihtiyacından fazla ayrıntı yok.

### Kanıt kontrol listesi

Hata açıklamasına şunları ekle:

- Denemelerin zaman damgası + saat dilimi
- Adım ve tam hata davranışı (varsa hata metni birebir)
- Neler denendiği
- "İstenirse ekran görüntüsü paylaşabilirim": bundan bahset, istenmeden asla ekleme

### İletişim önceliklendirmesi: en az yanlış adresi seçmek

Bozuk ATS akışları nadiren bir insan iletişim bilgisi gösterir. Görünen seçenekleri sırala:

1. **Bu başvuruyla ilgili önceki herhangi bir e-posta yazışmasındaki işe alım uzmanı veya koordinatör.** Açık ara en iyi seçenek: mevcut bağlam, bir insan, sorunu çözmek için bir neden.
2. **ATS bildirim e-postalarının (onay, davet, değerlendirme e-postaları) yanıt adresi**, yalnızca bir insan veya ekip posta kutusuysa. Açıkça izlenmeyen her şeyi atla (`no-reply@`, `notifications@`, `donotreply@`).
3. **İlandaki veya kariyer sayfasındaki genel işe alım posta kutusu:** `careers@`, `recruiting@`, `talent@`, `jobs@`, `hr@`.
4. Son çare olarak **işe alım uzmanına veya işe alım yöneticisine LinkedIn mesajı**; aynı içeriğin kısa biçimi için `contacto` moduna devret.

**Süreç desteği talebini asla özel amaçlı bir posta kutusuna gönderme.** Bunlar korunan veya ilgisiz bir amaç için vardır; onları kötüye kullanmak en iyi ihtimalle e-postanın sessizce düşmesine, en kötü ihtimalle talimatları okumayan bir aday izlenimine yol açar:

- Erişilebilirlik / makul düzenleme posta kutuları
- Yan haklar posta kutuları
- Etik / ihbar / uyum hatları
- Mezun posta kutuları
- Basın / medya posta kutuları

Görünen tek adres özel amaçlı bir posta kutusuysa bunu açıkça söyle, o adres için taslak hazırlama ve bunun yerine LinkedIn yolunu (4. seçenek) öner.

### Korumalar

E-posta modunun kalıcı korumaları değişmeden geçerlidir: yalnızca taslak, asla gönderme, asla tıklama, asla iletme. Ayrıca takılma e-postası taslağı:

- Asla tehdit etmemeli veya konuyu tırmandırmamalı ve asla hukuki ya da şikâyet dili kullanmamalı.
- Hatanın nedeni hakkında asla tahmin yürütmemeli veya şirketin araçlarını eleştirmemeli; yalnızca adayın gözlemlediğini anlatmalı. Olgusal ve iletilebilir, başka bir şey değil.
- Hata mesajlarını, zaman damgalarını veya yeniden deneme adımlarını asla uydurmamalı. Kullanıcı bir ayrıntıyı hatırlamıyorsa onu çıkar.

### Örnek (genel)

Aşağıdaki tüm değerler yer tutucudur; onları yalnızca kullanıcının gerçekten verdiği ayrıntılarla doldur. Hata metni, zaman damgası veya yeniden deneme adımı asla uydurma.

```text
Subject: Application to {Role} ({REQ-ID}) — {broken step} issue

Hi {Company} Recruiting team,

I'm partway through the application process for {Role} ({REQ-ID}) and hit a
technical issue I can't get past: {broken step} fails on every attempt.
{Exact observed behavior — quote error text verbatim only if one exists;
otherwise describe what happens: the page reloads, keeps spinning, shows no
slots} (tried {date + time + timezone}, {what was retried}). A screenshot is
available if useful.

Could someone schedule the interview manually? Happy to take any slot that
works for the team.

I remain very interested in the role and don't want a technical glitch to
stall the process.

Best regards,
{Candidate Name}
{email}
```

---

## Onaylanmış Saatte Gerçekleşmeyen Görüşme Takibi (`confirmed_time_noshow`)

**Kapsam notu:** bu varyantın `modes/followup.md` / `followup-cadence.mjs` içindeki geçen süreye dayalı takvimle (applied: 7 gün, responded: 3 gün, interview: 1 gün) ilgisi yoktur. Onlar "durum değişeli N gün oldu" bilgisini izler. Bu varyant aynı gün içindedir ve belirli bir taahhüde bağlıdır: bir işe alım uzmanı veya görüşmeci iki taraflı bir yazışmada (e-posta, ATS planlayıcı, mesaj) bir arama saatini açıkça onayladı ve arama gerçekleşmedi. Burada geçen güne dayalı puanlama ve okunacak bir `followup-cadence.mjs` çıktısı yoktur; tetikleyici, kullanıcının onaylanan saatin arama olmadan geçtiğini söylemesidir.

### Bilgi toplama

Zorunlu; eksik olanı her zaman sor (bunların hiçbirini uydurma):

1. **Onaylanan tarih/saat**, yazışmada anlaşıldığı haliyle (biliniyorsa saat dilimiyle).
   Taslaktan önce bu saatin geçtiğini ve ilgili saat diliminde bugün olduğunu doğrula; değilse senaryoyu netleştir veya başka bir varyant kullan.
2. **Görüşmecinin veya işe alım uzmanının adı**, kullanıcının verdiği haliyle; bir rapordan kazıma veya tahmin etme.
3. Kullanıcının sunmak istediği **aynı gün içindeki kalan müsaitlik** (bir aralık, örn. "bugün 16:00'dan önce" veya "14:30'dan sonra herhangi bir saat").
4. Konu satırı için şirket ve rol (bir rapor verildiyse bağlı rapordan, değilse sor).

### Taslak yapısı

1. Adı geçen görüşmeciye/işe alım uzmanına adıyla hitap eden selamlama.
2. Onaylanan saati ve aramanın gerçekleşmediğini belirten tek, sade bir cümle. Bunu bir suçlama olarak değil, bir olgu olarak söyle; "çok hayal kırıklığına uğradım" yok, bunu belirttiğin için aşırı özür yok.
3. Kullanıcının verdiği aynı gün içindeki kalan müsaitliği sunan tek bir cümle.
4. İlginin tek satırla yeniden teyidi; kısa olsun, uygunluk noktalarının yeniden satışı değil (bu varyantta 3. adım atlanır).
5. İmza.

Kısa tut: 120 kelimenin altında. Onaylanan saate gövdede bir kez, sade biçimde atıf yap (konu satırı da ona atıf yapabilir); gövdede bir kereden fazla tekrarlama veya genel "sadece bir bakmak istedim" çerçevesiyle doldurma (`modes/followup.md` ile aynı yasaklı ifade kuralı).

### Korumalar

- **Üslup profesyonel, sinirli değil.** Pasif-agresif ifade yok ("Bekledim...", "Bazen işler çıkar, ama..."), suçluluk çerçevesi yok, ünlem işareti yok.
- Onaylanan saati, görüşmecinin adını veya müsaitlik aralığını asla uydurma; üçü de kullanıcının verdiği girdilerdir, asla bir rapordan çıkarılmaz veya kazınmaz.
- Aramanın neden kaçırıldığı hakkında asla tahmin yürütme (trafik, unutma, çakışan randevu). Olguyu söyle ve isteğe geç.
- Bu, kaçırılan tek bir taahhüt için tek bir takiptir, çok temaslı bir takvim değildir; ikinci bir gelmeme takibi önerme. İkinci bir kaçırma olursa onu bu aynı senaryonun yeni bir örneği olarak ele al.
- E-posta modunun kalıcı korumaları değişmeden geçerlidir: yalnızca taslak, asla gönderme, asla tıklama, asla iletme.

### Örnek (genel)

Tüm değerler yer tutucudur. Onları yalnızca kullanıcının gerçekten verdiği ayrıntılarla doldur.

```text
Subject: {Role} — following up on our {time} call

Hi {Interviewer Name},

We'd confirmed a call today at {confirmed time, timezone} for the {Role}
role, and I didn't receive it. I'm available {remaining availability window}
if there's still time to connect today.

Still very interested in the role and happy to work around your schedule.

Best,
{Candidate Name}
```

---

## Dil (Language)

- JD/rapor diliyle eşleştir.
- JD Çince ise Basitleştirilmiş Çince kullan.
- Şirketin/işe alımcının dili bilinmiyorsa varsayılan olarak kullanıcının dilini kullan.
- Kullanıcı aksini istemedikçe konu satırını gövdeyle aynı dilde tut.

---

## İletişim Bloğu (Contact Block)

Varsayılan davranış:
- Doğrudan başvuru e-postalarına iletişim bloğunu ekle.
- Kısa sosyal erişimlerde telefonu çıkar; ama bu mod kısa sosyal erişim modu değildir.

Şunu kullan:

```text
İletişim:
{if candidate.wechat}WeChat: {candidate.wechat}{/if}
{if candidate.phone}Telefon: {candidate.phone}{/if}
{if candidate.email or application_email.default_sender_note}E-posta: {candidate.email or application_email.default_sender_note}{/if}
```

İngilizce için:

```text
Contact:
{if candidate.wechat}WeChat: {candidate.wechat}{/if}
{if candidate.phone}Phone: {candidate.phone}{/if}
{if candidate.email or application_email.default_sender_note}Email: {candidate.email or application_email.default_sender_note}{/if}
```

Çince için:

```text
联系方式：
{if candidate.wechat}微信：{candidate.wechat}{/if}
{if candidate.phone}手机号：{candidate.phone}{/if}
{if candidate.email or application_email.default_sender_note}邮箱：{candidate.email or application_email.default_sender_note}{/if}
```

`config/profile.yml` içinde `application_email.default_sender_note` değeri "bu mesajı göndermek için kullanılan e-posta" gibi bir ifadeye ayarlanmışsa, somut bir e-posta adresi yerine bu ifadeyi kullan.

`application_email.include_contact_block` değeri `false` ise yalnızca normal bir imza kullan.

**İletişim kanalı tercihi:** `application_email.include_contact_block` değeri `true` ise (veya yoksa/varsayılansa), `config/profile.yml` içindeki `contact_preferences.preferred_channel` değerini kontrol et. Yoksa veya `"either"` ise iletişim bloğu yukarıdakiyle aynı kalır, değişiklik yok. `"email"` veya `"phone"` ise iletişim bloğunun hemen altına o tercihi belirten kısa bir satır ekle, örn.:

```text
İletişim:
E-posta: jane@example.com
Telefon: +1-555-0123
(Öncelikle e-posta tercih edilir.)
```

`contact_preferences.note` ayarlıysa, genel bir ifade yerine o satır için onun sözcüklerini (veya yakın bir yeniden ifadesini) kullan. Tek satırda tut, kalın yazı veya ekstra vurgu yok; bir talep değil, pratik bir not gibi okunmalıdır.

---

## Stil Kuralları (Style Rules)

`_writing.md` → Professional Writing & ATS Compatibility, paylaşılan klişe listesini ve soyutlama yerine somutluk kuralını taşır. Aşağıdakiler e-postaya özgü eklerdir.

- Kurumsal dil yok.
- "Perfect fit", "unique opportunity" veya muğlak övgü yok (paylaşılan liste "passionate about" ve benzerlerini kapsar).
- Abartılı yazarlık iddiaları yok.
- Kısa paragraflar. İK başvuruları için 150-250 kelimeyi tercih et.
- Kanıtları taranması kolay tut.
- Kullanıcı istemedikçe maaş ekleme.
- Özel referanslar, kimlik numaraları veya desteklenmeyen iddialar ekleme.

---

## Çıktı (Output)

Şu sırayla döndür:

1. Bağlam satırı:
   - `Source: report {NNN}` veya `Source: pasted JD`
   - Varyant
   - Dil
2. Devre dışı bırakılmadıkça ek kontrol listesi
3. Konu ve e-posta gövdesi
4. Eksik girdileri veya varsayımları belirten tek satırlık bir not

Kullanıcı taslağı kaydetmeyi açıkça istemedikçe hiçbir dosya yazma.
