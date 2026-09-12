# Mod: contacto -- İletişim mesajları

> Oluşturulan her mesaja `voice-dna.md` dosyasını (varsa) uygula — tam koruma (guardrail), sohbet tarzı üslup (conversational voice) dahil (Tier 1 + Tier 2). Bkz. `_writing.md` → Voice DNA.

Bu modun aynı persona motorunu (İK / İşe alım uzmanı → kesin gereksinimler; İşe Alım Yöneticisi → etki/vizyon) paylaşan iki varyantı vardır:

- **LinkedIn güç hamlesi (varsayılan)** — kişileri bul ve belirli bir başvuru/mülakatla bağlantılı ≤300 karakterlik bir mesaj taslağı hazırla. Aşağıdaki akış budur.
- **Selamlama (Greeting)** — kesin bir karakter bütçesi olan platformlar (BOSS Zhipin 打招呼, iş ilanı panosu sohbeti, Soğuk E-posta / Direkt Mesaj açılışı) için ultra kısa tek bir ilk temas mesajı. Kişi keşfi (contact discovery) yok. Bu dosyanın sonundaki **Selamlama (Greeting) varyantına** bak.

**Varyantı seç:** Kullanıcı "greeting" / "打招呼" / "cold opener" dediğinde, sohbet tarzı bir platformdan (örn. BOSS Zhipin) bahsettiğinde veya çok kısa bir mesaj istediğinde **Selamlama (Greeting)** varyantını kullan; aksi takdirde aşağıdaki LinkedIn güç hamlesini çalıştır.

## LinkedIn güç hamlesi (varsayılan)

1. **Hedefleri WebSearch ile belirle**:
   - Takımın İşe Alım Yöneticisi (Hiring manager)
   - Atanan İK / İşe alım uzmanı
   - 2-3 takım iş arkadaşı (benzer rollere sahip kişiler)
   - Görüşmeci (eğer adayın halihazırda planlanmış bir mülakatı varsa)

2. **Kişi türünü sınıflandır** -- adaya sor veya bağlamdan çıkar:
   - **İK / İşe alım uzmanı (Recruiter)** -- rolü yetenek kazanımı, kaynak sağlama veya işe alım olan kişi
   - **İşe Alım Yöneticisi (Hiring Manager)** -- işe alım ekibine liderlik eden kişi
   - **İş Arkadaşı (Peer)** -- ekipte benzer bir role sahip biri (dolaylı referans)
   - **Görüşmeci (Interviewer)** -- adayla mülakat yapacak kişi (tarihi bilinen)

3. **Birincil hedefi seç**: adayın orada olmasından en çok fayda sağlayacak kişi

4. **Mesaj oluştur** — kişi türüne uyarlanmış 3 cümlelik bir çerçeve ile:

   ### İK / İşe alım uzmanı (Recruiter)
   - **1. Cümle (Uyum)**: Doğrudan eşleşme kriterleri -- rol, ilgili deneyim, müsaitlik veya lokasyon
   - **2. Cümle (Kanıt)**: Eleme sorularını onlar sormadan cevaplayan veriler (örn. "ML pipeline'ları kurduğum 5 yıl, şu an Berlin'deyim, hemen başlayabilirim")
   - **3. Cümle (Eylem Çağrısı / CTA)**: "Aradığınız profile uygunsa CV'mi paylaşmaktan memnuniyet duyarım"

   ### İşe Alım Yöneticisi (Hiring Manager)
   - **1. Cümle (Kanca/Hook)**: Ekiplerinin karşılaştığı spesifik zorluk (iş tanımından (JD), şirket blogundan veya haberlerden çıkarılmış)
   - **2. Cümle (Kanıt)**: Adayın benzer sorunları çözdüğünü gösteren en büyük ölçülebilir başarısı
   - **3. Cümle (Eylem Çağrısı / CTA)**: "Ekibinizin [belirli zorluğa] nasıl yaklaştığını duymayı çok isterim"

   ### İş Arkadaşı (Peer - referans)
   - **1. Cümle (İlgi)**: Çalışmalarına içten bir atıf -- blog yazısı, sunum, açık kaynak projesi veya yayın
   - **2. Cümle (Bağlantı)**: Adayın aynı alanda yaptığı bir şey (iş talebi DEĞİL)
   - **3. Cümle (Eylem Çağrısı / CTA)**: "Ben de [şirket] bünyesinde benzer sorunlar üzerinde çalışıyorum, [konu] hakkındaki düşüncelerinizi duymayı çok isterim"
   - **Not**: İş İSTEME. Referans, sohbet akıcı bir şekilde ilerlerse doğal olarak gerçekleşir.

   ### Görüşmeci (Mülakat öncesi)
   - **1. Cümle (Araştırma)**: Yaptıkları iş veya kariyer yörüngesinden spesifik bir şeye atıf
   - **2. Cümle (Bağlam)**: Adayın o alandaki deneyimiyle hafif bir bağlantı
   - **3. Cümle (Eylem Çağrısı / CTA)**: "[Tarih] günkü görüşmemizi sabırsızlıkla bekliyorum"
   - **Not**: Çaresiz değil, hafif bir ton. Amaç hazırlandığını göstermektir.

5. **Sürümler**:
   - EN (varsayılan)
   - TR (eğer şirket dili Türkçe ise)
   - ES (eğer İspanyol bir şirketse)

6. **Alternatif hedefler** — neden iyi birer ikinci seçenek olduklarına dair gerekçelendirmelerle birlikte

**İletişim kanalı tercihi:** `config/profile.yml` içindeki `contact_preferences.preferred_channel` değerini oku. Eğer bu yoksa veya `"either"` olarak ayarlanmışsa, CTA (eylem çağrısı) cümlesini tam olarak yukarıda belirtildiği gibi yaz — değişiklik yok. Eğer `"email"` veya `"phone"` olarak ayarlanmışsa, CTA'yı jenerik varsayılan yerine o kanala yönlendir (örn. İK'nın CTA'sı varsayılan bir aramaktansa "Aradığınız profile uygunsa CV'mi e-posta üzerinden paylaşmaktan memnuniyet duyarım" şekline dönüşür; İşe Alım Yöneticisinin CTA'sı bir arama önermektense "Buna e-posta üzerinden devam etmekten memnuniyet duyarım" şekline yaslanır). Aynı 3 cümlelik yapıyı ve personaya özgü vurguyu koru -- sadece CTA'da adı geçen kanal değişir. Eğer `contact_preferences.note` ayarlanmışsa, niyetini CTA ifadesine yedirebilirsin (örn. "bilinmeyen numaraları açmaz" → e-posta ifadesini tercih et) ancak notu dışa dönük bir mesajda kelimesi kelimesine alıntılama.

**Mesaj kuralları:**
- Maksimum 300 karakter (LinkedIn bağlantı isteği sınırı)
- Kurumsal dil (corporate-speak) YOK
- "... konusunda tutkuluyum" YOK
- Cevap verme isteği uyandıran bir şey
- ASLA telefon numarası paylaşma
- Kişi türü yapıyı değil, VURGUYU (EMPHASIS) değiştirir

---

## Selamlama (Greeting) varyantı

Açılış mesajının kesin bir karakter bütçesine sahip olduğu platformlar — BOSS Zhipin'in 打招呼, iş ilanı panosu sohbet kutuları veya bir Soğuk E-posta / Direkt Mesajın ilk satırı için tek, vurucu bir ilk temas mesajı. Yukarıdaki persona motorunu yeniden kullanır; farkı kısalığı ve **kişi keşfi olmamasıdır**.

1. **Hedef belirlemeyi atla.** WebSearch/kişi bulma adımı yok — mesaj platformun sizi bağladığı kişiye gider (genellikle ilanı veren veya işe alım uzmanı). İsimli bir alıcı uydurma.

2. **Alıcının personasını bağlamdan sınıflandır** (bilinmiyorsa varsayılan olarak **İK / İşe alım uzmanı** kabul et) ve vurguyu tam olarak yukarıdaki gibi ayarla:
   - **İK / İşe alım uzmanı** → karşılanan kesin gereksinimler (rol, yıl, stack, lokasyon, müsaitlik)
   - **İşe Alım Yöneticisi / Kurucu** → etki ve vizyon (hedefleriyle eşleşen bir sonuç)

3. **İş tanımı (JD) ile `cv.md` arasındaki en iyi 3 eşleşme noktasını sentezle** (LinkedIn akışının kullandığı aynı JD↔profil uyumu mantığı). Bunlar ham maddedir — yalnızca bütçeye uyan en güçlü bir veya ikisini öne çıkaracaksın.

4. **Karakter bütçesi dahilinde TEK BİR mesaj oluştur.**
   - **Bütçe:** `config/profile.yml` dosyasından `outreach.greeting_max_chars` değerini oku. Anahtar yoksa **Varsayılan 150**'dir. Mesaj MUTLAKA sığmalıdır — say ve kırp.
   - **Belirli bir değer önerisi ile giriş yap** (en güçlü tek eşleşme noktası), bir tanıtımla değil. Paragraflar değil, vurucu cümleler kullan.
   - **Dil:** JD / platform diline eşle (örn. BOSS Zhipin için Basitleştirilmiş Çince). Karakter sayısı çıktı diline uygulanır.

5. **Laf salatasına yer yok politikası (katı):** Dolgu (filler) kelimeleri çıkar ve yerine somut bir değer önerisi koy. "İş arıyorum", "tutkuluyum", "fırsat bulmayı umuyorum", jenerik kendini tanımlama gibi kalıpları yasakla. Her cümlenin/yan cümlenin o karakterleri hak etmesi gerekir.

6. **Çıktı:** Selamlama metni, bütçeye kıyasla karakter sayısı ve hangi eşleşme noktalarının kullanıldığına dair tek satırlık bir not. Sınıra yakınsa daha kısa bir alternatif de sun.

**Selamlama kuralları:**
- Platformdan bağımsızdır — asla LinkedIn olduğunu varsayma; herhangi bir sohbet/açılış yüzeyinde çalışır.
- `outreach.greeting_max_chars` dahilinde (varsayılan 150). Asla aşma.
- career-ops'un geri kalanıyla aynı "uydurmama" kuralı geçerlidir: `cv.md`'deki gerçek deneyimi yeniden formüle et, asla beceri, metrik veya iddia uydurma.
- Kurumsal dil YOK, "... konusunda tutkuluyum" YOK, ASLA telefon numarası paylaşma.
- Persona yapıyı değil, VURGUYU değiştirir.
