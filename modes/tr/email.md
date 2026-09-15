# Mod: email — Başvuru E-posta Taslakları

Adayın (candidate) e-posta istemcisine yapıştırabileceği resmi bir başvuru e-postası gövdesi (body) oluştur. Bu mod; doğrudan başvuru e-postaları, CV eklenmiş işe alım uzmanı (recruiter) takip e-postaları (follow-up), referans talebi e-postaları ve soğuk başvuru e-postaları (cold application emails) içindir.

Şunlar için DEĞİLDİR:
- `contacto`: kısa LinkedIn / BOSS Zhipin / sohbet tarzı (chat-style) erişim (outreach).
- `cover`: tam bir ön yazı PDF'i.
- `apply`: canlı başvuru formu doldurma.

**Asla gönderme (submit/send). Asla gönder butonuna tıklama.** Yalnızca taslak oluştur. Aday incelemeli ve manuel olarak göndermelidir.

---

## Çağrı (Invocation)

Desteklenen girdiler (inputs):

1. `/career-ops email {report-number-or-slug}`
   - Eşleşen `reports/{NNN}-*.md` dosyasını yükle.
   - Rapor başlığını (header), puanını (score), arketipini (archetype), PDF durumunu ve değerlendirme (evaluation) içeriğini kullan.
   - Eğer `data/pdf-index.tsv` içerisinde o rapor için bir PDF varsa, bundan CV eki adayı olarak bahset. Eğer indekslenmiş bir PDF yoksa, öncelikle `/career-ops pdf {slug}` ile CV'nin oluşturulması veya manuel olarak eklenmesi gerektiğini söyle.

2. `/career-ops email {pasted JD}`
   - Yapıştırılan iş tanımını (JD) doğrudan kullan.
   - Rapor, takipçi (tracker) satırı, PDF veya ön yazı oluşturma.
   - Eğer JD'de şirket adı eksikse ve aksi takdirde e-posta çok genel geçer (generic) duracaksa şirket adını sor.

3. `/career-ops email`
   - Eğer en son değerlendirilen (evaluated) bir takipçi satırı varsa, taslağı o satırdan oluşturmayı teklif et.
   - Kullanılabilir bir bağlam yoksa, bir rapor numarası, slug veya JD iste.

---

## Adım 1 — Bağlamı Yükle

Şunları oku:
- `config/profile.yml`
- `cv.md`
- Eğer varsa `article-digest.md`
- Eğer varsa `modes/_profile.md`
- Eğer varsa `modes/_custom.md`
- Eğer varsa `voice-dna.md` (yalnızca yazı stili (writing style) için)
- Rapor numarası veya slug ile çağrıldıysa seçili rapor
- Varsa oluşturulmuş PDF eklerini bulmak için `data/pdf-index.tsv`

`modes/_custom.md` dosyasını yalnızca; iletişim bloğunun eklenip eklenmeyeceği, eklenti kontrol listesinin (attachment checklist) gösterilip gösterilmeyeceği veya e-postanın ne kadar kısa olması gerektiği gibi prosedürel çıktı tercihleri (procedural output preferences) için kullan. Asla iletişim bilgileri, iş deneyimi veya diğer somut iddialar (factual claims) eklememelidir.

`voice-dna.md` dosyasını yalnızca bir yazım bariyeri/kılavuzu (writing guardrail) olarak kullan. Asla somut iddialar eklememelidir.

### Profil alanları

Mevcut olduğunda bu isteğe bağlı (optional) alanları kullan:
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

Eğer `candidate.wechat` yoksa WeChat'i atla (omit). Yeni bir tane uydurma.

---

## Adım 2 — E-posta Türünü Sınıflandır

Kullanıcının ifadelerinden veya bağlamdan üç varyanttan birini seç:

| Varyant (Variant) | Ne Zaman (When) | Üslup (Tone) |
|---|---|---|
| `hr_application` | Varsayılan. İlan edilmiş bir rol için İK'ya/İşe alımcıya CV gönderirken. | Resmi, kısa ve öz, ön elemeye uygun (screening-friendly) |
| `referral_request` | Kullanıcı bir referans, şirket içi kişi, arkadaş, mezun veya eski iş arkadaşından tavsiye (referral) istediğinde. | Sıcak, baskısız, yönlendirmesi/iletmesi kolay (easy to forward) |
| `cold_application` | İlan edilmiş bir rol yok, spekülatif erişim, "soğuk e-posta" (cold email). | Doğrudan, önce değer (value-first) sunan, çaresizlik içermeyen |

Eğer net değilse, `hr_application` varsayılanını kullan.

---

## Adım 3 — Uygunluk Noktalarını (Fit Points) Çıkar

Rapordan/JD'den ve tek-gerçek-kaynak (source-of-truth) dosyalarından 2-3 uygunluk noktası (fit points) seç:

- Bir adet rol-profil eşleşmesi: teknoloji yığını (stack), alan (domain), iş akışı (workflow), ürün tipi veya teslimat tarzı (delivery style).
- Bir adet kanıt noktası (proof point): proje, metrik, açık kaynak katkısı veya canlıya alınmış (shipped) sistem.
- Bir adet farklılaştırıcı (differentiator): iş sahipliği (business ownership), alan bilgisi (domain knowledge), iletişim, açık kaynak ekosistemi veya canlıya devir (production handover).

Yalnızca tek-gerçek-kaynak dosyalarındaki gerçekleri (facts) kullan. JD'deki anahtar kelimeleri yeniden formüle et; asla uydurma (fabricate).

Eğer raporun bir puanı (score) varsa:
- `>= 4.5`: kendine güvenen (confident), öncelikli (priority) başvuru.
- `4.0-4.4`: iyi eşleşme, başvurmaya değer.
- `< 4.0`: ölçülü (restrained); abartarak satmaya (oversell) çalışma. 4.0'ın altındaysa, taslağı hazırlamadan önce career-ops'un normalde başvurmamayı önerdiği konusunda kullanıcıyı uyar.

---

## Adım 4 — Eklenti (Attachment) Kontrol Listesi

Taslaktan önce, şunu çıktı ver:

```text
Eklenecek dosyalar (Attachments to include):
- CV: {PDF yolu veya "uyarlanmış CV'nizi ekleyin"}
- Ön yazı (Cover letter): {biliniyorsa dosya yolu, aksi takdirde "isteğe bağlı / oluşturulmadı"}
```

Kurallar:
- Eğer `application_email.include_attachment_checklist` `false` ise, bu kontrol listesini atla.
- Yalnızca var olan veya indekslenmiş dosyalardan bahset. Gerçekten var olmadığı sürece bir ön yazı olduğunu iddia etme.
- Dosyaları (attachments) ekleme veya herhangi bir şey gönderme.

---

## Adım 5 — Taslak Yapısı

Daima şunu çıktı ver:

```text
Konu (Subject): {subject}

{email body}
```

### İK başvuru yapısı

1. Selamlama (Greeting)
2. Rol niyeti ve eklenti (attachment) cümlesi
3. Tek bir kısa paragrafta veya sıkıştırılmış maddeler (bullets) halinde 2-3 uygunluk noktası
4. JD dilini kullanarak bu rolün neden alakalı olduğu
5. İletişim bloğu ve imza

### Referans talebi yapısı

1. Selamlama (Greeting)
2. Tek satırlık bağlam: rol ve şirket
3. Yönlendirmesi/iletmesi kolay (easy to forward) 2 kısa ve öz (concise) kanıt noktası
4. Düşük baskılı istek (Low-pressure ask): "Eğer bu uygun görünüyorsa, bana referans olmanız veya beni doğru kişiye yönlendirmeniz mümkün olur mu?"
5. İletişim bloğu ve imza

### Soğuk başvuru yapısı

1. Selamlama (Greeting)
2. Önce değer teklifi (Value proposition first), "İş arıyorum" değil
3. Şirkete/alana (domain) bağlı 2 kanıt noktası
4. Belirli bir istek (Specific ask): kısa bir görüşme (short call), doğru kişi (right contact) veya CV göndermek için izin
5. İletişim bloğu ve imza

---

## Dil (Language)

- JD/rapor diliyle eşleştir.
- Eğer JD Çince ise, Basitleştirilmiş Çince (Simplified Chinese) kullan.
- Şirket/işe alımcı dili bilinmiyorsa, varsayılan olarak kullanıcının dilini kullan.
- Kullanıcı aksini istemedikçe konu satırını (subject) e-posta gövdesiyle aynı dilde tut.

---

## İletişim Bloğu (Contact Block)

Varsayılan davranış (Default behavior):
- Doğrudan başvuru e-postaları için iletişim bloğunu dahil et.
- Kısa sosyal erişimlerde (short social outreach) telefonu atla; ancak bu mod kısa sosyal erişim modu değildir.

Şunu kullan:

```text
İletişim (Contact):
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

Eğer `config/profile.yml` dosyasında `application_email.default_sender_note` ayarı "bu mesajı göndermek için kullanılan e-posta" gibi bir ifadeye (phrase) ayarlanmışsa, somut bir e-posta adresi yerine bu ifadeyi kullan.

Eğer `application_email.include_contact_block` `false` ise, yalnızca normal bir imza kullan.

**İletişim kanalı tercihi (Contact channel preference):** Eğer `application_email.include_contact_block` `true` ise (veya yoksa/varsayılansa), `config/profile.yml` içindeki `contact_preferences.preferred_channel` ayarını kontrol et. Eğer yoksa veya `"either"` (farketmez) olarak ayarlanmışsa, iletişim bloğu yukarıdakiyle tamamen aynı kalır — değişiklik yok. Eğer `"email"` veya `"phone"` olarak ayarlanmışsa, doğrudan iletişim bloğunun altına o tercihi (preference) belirten kısa bir satır ekle, örn.:

```text
İletişim:
E-posta: jane@example.com
Telefon: +1-555-0123
(Öncelikle e-posta tercih edilir.)
```

Eğer `contact_preferences.note` ayarlanmışsa, genel geçer bir ifade yerine o satır için oradaki kelimeleri (veya yakın bir yorumlamasını) kullan. Tek satırda tut, kalınlaştırma (bold) veya ekstra vurgu yapma -- bir talep (demand) olarak değil, pratik bir not olarak okunmalıdır.

---

## Stil Kuralları (Style Rules)

- Kurumsal dil (Corporate-speak) yok.
- "Passionate about", "perfect fit", "unique opportunity" veya muğlak övgüler (vague praise) yok.
- Abartılı yazarlık/sahiplik iddiaları (exaggerated authorship claims) yok.
- Kısa paragraflar. İK başvuruları (HR applications) için 150-250 kelimeyi tercih et.
- Kanıtları taranması kolay (easy to scan) tut.
- Kullanıcı istemediği sürece maaşı (salary) dahil etme.
- Özel referanslar, kimlik numaraları (ID numbers) veya desteklenmeyen iddialar (unsupported claims) dahil etme.

---

## Çıktı (Output)

Şu sırayla (order) döndür (Return):

1. Bağlam (Context) satırı:
   - `Source: report {NNN}` veya `Source: pasted JD`
   - Varyant (Variant)
   - Dil (Language)
2. Eklenti kontrol listesi (Attachment checklist), devre dışı bırakılmadıkça
3. Konu (Subject) ve e-posta gövdesi (email body)
4. Varsa eksik girdiler veya varsayımlar içeren tek satırlık bir not

Kullanıcı açıkça taslağı kaydetmeyi istemediği sürece herhangi bir dosya yazma.
