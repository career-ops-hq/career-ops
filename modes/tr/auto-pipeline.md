# Mod: auto-pipeline — Tam Otomatik Süreç

Kullanıcı açık bir alt komut (sub-command) olmadan bir İş Tanımı (JD) (metin veya URL) yapıştırdığında, TÜM süreci sırasıyla yürütün:

## Adım 0 — JD'yi Çıkar

Girdi bir **URL** ise (yapıştırılmış JD metni değilse), içeriği çıkarmak için şu stratejiyi izleyin:

**Öncelik sırası:**

1. **Playwright (tercih edilen):** Çoğu iş portalı (Lever, Ashby, Greenhouse, Workday) SPA'dır (Tek Sayfalık Uygulama). JD'yi oluşturmak ve okumak için `browser_navigate` + `browser_snapshot` kullanın.
2. **WebFetch (yedek):** Statik sayfalar için (ZipRecruiter, WeLoveProduct, şirket kariyer sayfaları).
3. **WebSearch (son çare):** JD'yi statik HTML'de dizine ekleyen ikincil portallarda rol başlığı + şirket araması yapın.

**Hiçbir yöntem işe yaramazsa:** Adaydan JD'yi manuel olarak yapıştırmasını veya bir ekran görüntüsü paylaşmasını isteyin.

**Girdi JD metni ise** (URL değilse): getirmeye gerek kalmadan doğrudan kullanın.

## Adım 0.5 — Geçerlilik (Liveness) Kontrolü

Herhangi bir değerlendirme yapmadan önce ilanın hala yayında olduğunu onaylayın. Adım 0'daki Playwright anlık görüntüsü kanıtı barındırır — bunu şimdi, A-G değerlendirmesine, rapora veya PDF'ye token harcamadan önce yargılayın. Aksi halde statik bir yedek olarak sessizce sunulan ("pozisyon dolduruldu", boş sayfa) 404/süresi dolmuş bir sayfa, hayalet içeriğe karşı tam bir değerlendirme puanı alır.

1. Adım 0'daki anlık görüntü/getirilen içerikten ilanı sınıflandırın:
   - **Aktif ilan kanıtı:** başlık/rol + gerçek bir iş tanımı veya başvuru/uygulama yolu
   - **Kapanmış ilan kanıtı:** süresi dolmuş/kapanmış/"artık başvuru kabul edilmiyor", sadece gezinme menüsü/alt bilgi (nav/footer) içeren eksik JD, genel kariyer/arama sayfasına zorunlu yönlendirme veya 404/410
2. İlan kapanmış görünüyorsa veya sayfa ölü/yedek bir kabuksa, **burada durun**: Adım 1–Adım 4'ü çalıştırmayın. Adaya bağlantının ölü olduğunu söyleyin ve giriş `data/pipeline.md` konumundan geliyorsa, `- [x] ~~Şirket | Rol~~ — ilan aktif değil` (aktif olmayan ilan) olarak işaretleyin.
3. Sadece JD metni yapıştırıldıysa (URL yoksa), doğrulanacak bir bağlantı yoktur — bu kontrolü atlayıp devam edin.

Bu kontrol çözülene kadar Adım 1'e geçmeyin.

## Adım 1 — A-G Değerlendirmesi

`is-ilani` modundaki gibi yürütün (tüm A-F blokları + Blok G İlan Meşruiyeti için `modes/tr/is-ilani.md` dosyasını okuyun).

## Adım 2 — Raporu Kaydet .md

Tam değerlendirmeyi `reports/{###}-{sirket-kisa-adi}-{YYYY-AA-GG}.md` konumuna kaydedin (format için `modes/tr/is-ilani.md` dosyasına bakın).
Kaydedilen rapora G Blok'u ekleyin. Rapor başlığına **URL:** {url} ve **Meşruiyet:** {tier} ekleyin.

## Adım 3 — PDF Oluştur

`config/profile.yml` dosyasını okuyun. `cv.output_format` alanını kontrol edin:

- `"latex"` ise, tam süreci `modes/latex.md` üzerinden yürütün
- Değilse (varsayılan), tam süreci `modes/pdf.md` üzerinden yürütün

## Adım 4 — Başvuru Yanıtları Taslağı (yalnızca puan >= 4.5 ise)

Eğer final puanı >= 4.5 ise, başvuru formu için yanıt taslakları oluşturun:

1. **Form sorularını çıkarın**: Playwright kullanarak forma gidin ve anlık görüntü alın. Çıkarılamazlarsa, genel soruları kullanın.
2. **Yanıtları oluşturun**, ses tonunu (tone) takip ederek (aşağıya bakın).
3. **Rapora kaydedin**, `## H) Taslak Başvuru Yanıtları` bölümü olarak.

### Genel Sorular (formdan çıkarılamazsa kullanın)

- Bu rolle neden ilgileniyorsunuz?
- Neden [Şirket] bünyesinde çalışmak istiyorsunuz?
- İlgili bir proje veya başarıdan bahsedin
- Sizi bu pozisyon için iyi bir aday yapan nedir?
- Bu rolü nasıl duydunuz?

### Form Yanıtları İçin Ses Tonu

**Konum: "Sizi ben seçiyorum."** Adayın seçenekleri var ve bu şirketi belirli nedenlerle seçiyor.

**Ses tonu kuralları:**
- **Kibirli olmadan kendinden emin**: "Geçen yılı üretim (production) yapay zeka ajan sistemleri inşa ederek geçirdim — rolünüz bu deneyimi uygulamak istediğim sonraki yer"
- **Kibirli olmadan seçici**: "İlk günden itibaren anlamlı katkı sağlayabileceğim bir takım bulma konusunda bilinçli davrandım"
- **Spesifik ve somut**: Daima JD'den veya şirketten GERÇEK bir şeye ve adayın deneyiminden GERÇEK bir şeye atıfta bulunun
- **Laf salatası yapmadan, doğrudan**: Her yanıt için 2-4 cümle. "X konusunda tutkuluyum..." veya "Fırsat bulmayı çok isterim..." gibi ifadeler YOK
- **Kanca ifadedir, kanıt değil**: "X konusunda harikayım" demek yerine "Y'yi yapan X'i inşa ettim" deyin

**Soru başına çerçeve:**
- **Neden bu rol?** → "Sizin [belirli bir şeyiniz] doğrudan [benim inşa ettiğim belirli bir şeye] karşılık geliyor."
- **Neden bu şirket?** → Şirketle ilgili spesifik bir şeyden bahsedin. "[Ürünü] [süre/amaç] için kullanıyorum."
- **İlgili deneyim?** → Nicel bir kanıt noktası. "[Metrik] sağlayan [X]'i inşa ettim. Şirketi 2025'te sattım."
- **Neden iyi uyum?** → "[A] ve [B]'nin kesişim noktasındayım, ki bu rol tam da burada yer alıyor."
- **Nasıl duydunuz?** → Dürüstçe: "[Portal/tarama] aracılığıyla buldum, kriterlerime göre değerlendirdim ve en yüksek puanı aldı."

**Dil**: Daima JD'nin dilinde (EN varsayılan). `/tech-translate` uygulayın.

## Adım 5 — Takipçiyi Güncelle

Takipçiyi güncellemek için doğrudan `data/applications.md` dosyasına yazmayın. Değişiklikleri bir TSV satırı olarak `batch/tracker-additions/` içine ekleyin ve `node merge-tracker.mjs` komutunu kullanarak takipçiyi güncelleyin.

**Herhangi bir adım başarısız olursa**, sonrakilerle devam edin ve başarısız olan adımı takipçide beklemede (pending) olarak işaretleyin. <!-- resolve-cr-87 -->
