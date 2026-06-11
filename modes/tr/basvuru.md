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
4. YÜKLE          → Tam raporu oku (önceki değerlendirme + Blok G varsa)
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
3. Eşleşme bulunursa → tam raporu yükle
4. Blok G varsa → önceki taslak yanıtları temel olarak al
5. Eşleşme bulunamazsa → adayı bilgilendirip hızlı auto-pipeline öner

## Adım 3 — Rol Değişikliğini Tespit Et

Ekrandaki rol önceki değerlendirmedekinden farklıysa:
- **Adayı uyar:** "Rol [X]'den [Y]'ye değişmiş görünüyor. Yeniden değerlendireyim mi, yoksa yanıtları yeni başlığa uyarlayayım mı?"
- **Uyarlama:** Yeniden değerlendirmeden yanıtları yeni role göre ayarla
- **Yeniden değerlendirme:** Tam A-F değerlendirmesi yap, raporu güncelle, Blok G'yi yeniden üret
- **Takipçiyi güncelle:** Gerekirse `applications.md`'deki rol başlığını düzelt

## Adım 4 — Form Alanlarını Analiz Et

Görünen tüm alanları tespit et:
- Serbest metin (ön yazı, "neden bu rol?", motivasyon vb.)
- Açılır menüler (nereden duydunuz, çalışma izni vb.)
- Evet/Hayır (taşınma, vize, müsaitlik vb.)
- Maaş alanları (beklenti, aralık)
- Dosya yükleme alanları (CV, ön yazı PDF'i)

Her soruyu sınıflandır:
- **Blok G'de zaten yanıtlanmış** → mevcut yanıtı uyarla
- **Yeni soru** → rapor + `cv.md`'den yanıt üret

## Adım 5 — Yanıtları Üret

Her soru için yanıtı şu şemaya göre oluştur:

1. **Rapor bağlamı:** Blok B'deki kanıt noktalarını ve Blok F'teki STAR hikayelerini kullan
2. **Önceki Blok G:** Taslak yanıt varsa temel al ve geliştir
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

Aday başvuruyu gönderdiğini onaylarsa:
1. `applications.md`'de durumu `Evaluated`'dan `Applied`'a güncelle
2. Blok G'yi final yanıtlarla güncelle
3. Sonraki adımı öner: İşe alım sorumlusuna LinkedIn erişimi için `/career-ops contacto`

## Scroll Yönetimi

Formda görünenden fazla soru varsa:
- Adaydan scroll yapıp yeni bir ekran görüntüsü paylaşmasını iste
- Ya da kalan soruları yapıştırmasını iste
- Formun tamamı kapsanana kadar iterasyon halinde işle

## Kritik Kural

**Adayın onayı olmadan hiçbir şeye tıklama, form gönderme.**
Doldur, taslak oluştur, hazırla — ama "Gönder" veya "Başvur" düğmesine basmak her zaman adayın kararıdır.
