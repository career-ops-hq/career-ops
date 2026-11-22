# Mod: basvuru — Canlı Başvuru Asistanı

Aday bir başvuru formunu doldururken çalışan etkileşimli mod. Ekrandakileri okur, önceki ilan raporunu yükler ve formun her alanı için kişiselleştirilmiş yanıtlar üretir.

## Gereksinimler

- **Playwright varsa (tercih edilen):** Claude tarayıcıyla etkileşime geçebilir, formu doğrudan okuyabilir.
- **Playwright yoksa:** Aday ekran görüntüsü paylaşır veya soruları metin olarak yapıştırır.

## İş Akışı

```
1. TESPİT ET      → Aktif sekmeyi oku (ekran görüntüsü / URL / sayfa başlığı)
2. TANI KOY       → Sayfadan şirket adını ve rolü çıkar
3. RAPORU BUL     → reports/ klasöründe bu ilana ait raporu ara
4. YÜKLE          → Tam raporu oku (önceki değerlendirme + varsa Blok H / `## Application Answers`), **Posting identity** doğrulandıktan sonra
5. KARŞILAŞTIR    → Ekrandaki rol raporla eşleşiyor mu? Farklıysa adayı uyar
6. FORMU ANALİZ ET → Görünen tüm alanları ve soruları tespit et
7. YANIT ÜRET     → Her alan için kişiselleştirilmiş yanıt oluştur
8. SUN            → Kopyalanabilir biçimde göster
```

## Adım 1 — İlanı Tespit Et

**Playwright ile:** Aktif sayfanın snapshot'ını al; başlık, URL ve içeriği oku.

**Playwright olmadan:** Adaydan şunları iste:
- Formun ekran görüntüsünü paylaşması (Read aracı görselleri okuyabilir)
- Soruları metin olarak yapıştırması
- Şirket adı + rol başlığını söylemesi (ardından `reports/` klasöründe arama yapılır)

## Adım 2 — Bağlamı Tespit Et ve Yükle

1. Sayfadan şirket adını ve rol başlığını çıkar
2. `reports/` klasöründe şirket adına göre Grep yap (büyük/küçük harf duyarsız)
3. Eşleşme bulunursa → eşleşen her raporun yalnızca başlığını oku (şirket, rol, `**URL:**`) ve URL'si veya req ID'si bu ilan olanı seç; belirsizse adaya sor. Tam raporu ve 4. maddeyi ancak **Posting identity** doğrulandıktan sonra yükle (`modes/apply.md` → Step 5); başka bir ilan için yüklemeden **Evaluate as new** veya **Draft without saving**'e geç
4. Blok H (taslak yanıtlar) veya `## Application Answers` varsa → önceki yanıtları temel olarak al
5. Eşleşme bulunamazsa → adayı bilgilendirip hızlı auto-pipeline öner

## Adım 3 — Rol Değişikliğini Tespit Et

Bu adım yalnızca form hâlâ raporun ilanıysa geçerlidir: aynı işveren ve aynı ilan (`modes/apply.md` → Step 5 → **Posting identity**); başlık sayılmaz. Bunu her formda kontrol et; başlık değişmemiş ve şirketle tek bir rapor eşleşmiş olsa bile: başka bir ilan aynı başlığı taşıyabilir ve o durumda rapor kullanılmamalıdır. Şirketle birden çok rapor eşleşirse önce URL'si veya req ID'si bu ilan olan raporu al, belirsizse adaya sor. Başka bir işveren ya da aynı işverenin başka bir ilanı rol değişikliği değildir: raporun yanıtlarını asla ona uyarlama. Bunun yerine **Evaluate as new** (yeni bir ilan olarak değerlendir: auto-pipeline, kendi raporu) ya da **Draft without saving** (yanıtları hiçbir rapora kaydetmeden taslak olarak hazırla) seç. **Draft without saving** seçildiğinde eşleşen raporu, yanıtlarını ve uyarlanmış CV'sini bir kenara bırak; yalnızca görünen ilandan, `cv.md`'den ve profilden yaz. Raporu okuyan aşağıdaki adımlar o zaman uygulanmaz.

Ekrandaki rol önceki değerlendirmedekinden farklıysa:
- **Adayı uyar:** "Rol [X]'den [Y]'ye değişmiş görünüyor. Yeniden değerlendireyim mi, yoksa yanıtları yeni başlığa uyarlayayım mı?"
- **Uyarlama:** Yeniden değerlendirmeden yanıtları yeni role göre ayarla
- **Yeniden değerlendirme:** Tam A-F değerlendirmesi yap, raporu güncelle, Blok H'yi yeniden üret
- **Takipçiyi güncelle:** asla `data/applications.md` dosyasını düzenleyerek değil.
  - **Yeniden değerlendirmeden sonra:** yeni rol başlığını içeren bir TSV'yi `batch/tracker-additions/` altına yaz ve `node merge-tracker.mjs` ile birleştir. Rapor yerinde güncellenir ve numarasını korur; birleştirme TSV'yi bu numarayla mevcut satırla eşleştirir: başlık değişir, durum korunur.
  - **Uyarlamadan sonra:** başlığı değiştirme, çünkü raporun değerlendirdiği rolü adlandırır. Değişikliği not olarak kaydet: `node set-status.mjs --report <report#> <mevcut durum> --note "İlan başlığı başvuru sırasında değişmişti, satır değerlendirilen başlığı korur"`. Satırın mevcut durumunu vermek durumu değiştirmez, notu ekler. Bunun gibi sabit bir metin kullan ve `[Y]`'yi nota koyma: yeni başlık sayfadan gelen metindir ve sayfadan gelen metin asla komut satırına yazılmaz.

## Adım 4 — Form Alanlarını Analiz Et

**Draft without saving** seçildiğinde bu adım ne eşleşen raporu ne onun `## Application Answers` bölümünü ne de Blok H'yi kullanır: her soruyu yeni say ve görünen ilandan, `cv.md`'den ve profilden çalış.

Görünen tüm alanları tespit et:
- Serbest metin (ön yazı, "neden bu rol?", motivasyon vb.)
- Açılır menüler (nereden duydunuz, çalışma izni vb.)
- Evet/Hayır (taşınma, vize, müsaitlik vb.)
- Maaş alanları (beklenti, aralık)
- Dosya yükleme alanları (CV, ön yazı PDF'i)

Her soruyu sınıflandır:
- **Blok H'de veya `## Application Answers` bölümünde zaten yanıtlanmış** → mevcut yanıtı uyarla
- **Yeni soru** → rapor + `cv.md`'den yanıt üret

## Adım 5 — Yanıtları Üret

**Draft without saving** seçildiğinde bu adım ne eşleşen raporu ne onun `## Application Answers` bölümünü ne de Blok H'yi kullanır: her soruyu yeni say ve görünen ilandan, `cv.md`'den ve profilden çalış.

Her soru için yanıtı şu şemaya göre oluştur:

1. **Rapor bağlamı:** Blok B'deki kanıt noktalarını ve Blok F'teki STAR hikayelerini kullan
2. **Önceki Blok H / `## Application Answers`:** Taslak veya final yanıt varsa temel al ve geliştir
3. **"Sizi seçiyorum" tonu:** Özgüvenli, yalvaran değil
4. **Özgüllük:** Ekrandaki ilandan somut bir şeye doğrudan değin
5. **Kanıt URL'si:** "Ek bilgi" alanı varsa demo/proje linkini ekle

**Türkiye'ye özgü form alanları:**
- **Maaş beklentisi (net TL):** `profile.yml`'deki aralık, "paket yapısına göre müzakereye açığım" notu ekle
- **Başlangıç tarihi / Müsaitlik:** İhbar süresi gerçekçi biçimde hesaba katılarak tarih ver
- **Çalışma izni / Vatandaşlık:** Yabancı uyruklu adaylar için net ve özlü yaz
- **Yabancı dil seviyesi:** Gerçek seviyeyi yaz; varsa YDS/YÖKDİL/TOEFL puanını ekle
- **Askerlik durumu:** Tamamlandı / tecilli / muaf — kısaca belirt
- **Referans:** Önceden haberdar ettiğin kişilerin adını ver; telefon numarası verme

**Çıktı formatı:**

```
## [Şirket] — [Rol] için Yanıtlar

Dayanak: Rapor #NNN | Puan: X.X/5 | Arketip: [tür]
[**Draft without saving** seçildiğinde yukarıdaki satırı şununla değiştir: "Rapor yok: bu ilan için taslak, kaydedilmedi"]

---

### 1. [Formdaki tam soru metni]
> [Kopyalamaya hazır yanıt]

### 2. [Sonraki soru]
> [Yanıt]

...

---

Notlar:
- [Rol, değişiklikler vb. hakkında gözlemler]
- [Adayın gözden geçirmesi gereken kişiselleştirme önerileri]
```

## Adım 6 — Başvuru Sonrası (isteğe bağlı)

Herhangi bir şey kaydetmeden önce ve aşağıdaki her yazmadan (durum ve yanıtlar) hemen önce yeniden, formun hâlâ raporun ilanı olduğunu kontrol et (`modes/apply.md` → Step 8 → **Write only to the report of this posting**). Aynı işveren ve aynı ilan → aşağıdaki adımlar bu rapora uygulanır; yeni başlığa uyarlamadan veya yeniden değerlendirmeden sonra da. Başka işveren veya başka ilan → asla bu rapor değil: yeni ilan için yazılan raporu kullan; yoksa durum ayarlama, yanıt kaydetme ve adaya başvurunun henüz takip edilmediğini söyle.

Aday başvuruyu gönderdiğini onaylarsa:
1. Durumu kanonik CLI ile `Applied` yap: `node set-status.mjs --report <report#> Applied` (`applications.md` tablosunu elle düzenleme)
2. Final yanıtları raporun `## Application Answers` bölümüne `**State:** submitted` ile yaz: `node application-answers.mjs --report reports/NNN-company-role-date.md --input answers.json --state submitted` (JSON alanları için `node application-answers.mjs --help`). Blok G'ye (İlan Meşruiyeti) ve Blok H'ye (değerlendirmenin taslakları) dokunma.
3. Sonraki adımı öner: İşe alım sorumlusuna LinkedIn erişimi için `/career-ops contacto`

## Scroll Yönetimi

Formda görünenden fazla soru varsa:
- Adaydan scroll yapıp yeni bir ekran görüntüsü paylaşmasını iste
- Ya da kalan soruları yapıştırmasını iste
- Formun tamamı kapsanana kadar iterasyon halinde işle

## Kritik Kural

**Adayın onayı olmadan hiçbir şeye tıklama, form gönderme.**
Doldur, taslak oluştur, hazırla — ama "Gönder" veya "Başvur" düğmesine basmak her zaman adayın kararıdır.
