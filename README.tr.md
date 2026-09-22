<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/wordmark-dark.svg"><img src="docs/wordmark-light.svg" alt="career-ops" width="250" height="56"></picture></p>

<p align="center">
  <em>Aylarca zor yoldan iş başvurusu yaptım. Bu yüzden keşke olsun dediğim sistemi kendim inşa ettim.</em><br>
  Şirketler adayları elemek için yapay zekâ kullanıyor. <strong>Ben de adaylara şirket <em>seçmek</em> için yapay zekâ verdim.</strong><br>
  Değerlendirir, sıralar ve taslak yazar. <strong>Asla göndermez: gönderen sensin.</strong> Açık kaynak, yerel, senin.
</p>

<p align="center">
  <a href="https://x.com/santifer/status/2041403685696053741"><img src="docs/demo.gif" alt="career-ops hattı: puanlanmış ilanlar, 219'u başvurma olarak işaretli, sonra bir tam değerlendirme" width="800"></a>
</p>

<p align="center"><sub>Arayışın ortasından bir kare: hat, sonra bir ilan açılıp baştan sona değerlendiriliyor.</sub></p>

<p align="center"><strong>740 ilandan 68'i başvurmaya değerdi. 12 mülakat. 1 teklif.</strong></p>
<p align="center"><sub>Tek bir arayış, yazarınki, 2026. Önemli olan sayı eleme, toplam değil. Tüm rakamlar <a href="https://santifer.io/career-ops-system">vaka çalışmasında</a>.</sub></p>

<p align="center"><sub>Asla göndermez, asla e-posta atmaz, asla eve rapor vermez: <a href="#career-opsun-yapmadıkları">yapmadıkları</a> · zaten kullandığın AI CLI içinde çalışır, <a href="docs/RUNNING_ON_A_BUDGET.md">ücretsiz ve yerel modeller dahil</a>.</sub></p>

<details>
<summary>17 dilde oku</summary>
<div align="center">

[English](README.md) | [Español](README.es.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md) | [한국어](README.ko-KR.md) | [日本語](README.ja.md) | [简体中文](README.cn.md) | [繁體中文](README.zh-TW.md) | [Українська](README.ua.md) | [Русский](README.ru.md) | [Polski](README.pl.md) | [Dansk](README.da.md) | [தமிழ்](README.ta.md) | [العربية](README.ar.md) | [हिन्दी](README.hi.md) | [Türkçe](README.tr.md)

</div>
</details>

<hr>

<p align="center">
  <a href="HIRED.md"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fsantifer%2Fcareer-ops%2Fmain%2Fdocs%2Fhired-count.json&query=%24.count&label=%F0%9F%8E%89%20HIRED%20WITH%20CAREER-OPS&suffix=%20verified&color=2ea44f&style=for-the-badge&labelColor=2b3137" alt="career-ops ile işe alınanlar: doğrulanmış sayı"></a>
</p>

<p align="center"><sub>Seninkini buldun mu? <a href="https://github.com/career-ops-hq/career-ops/issues/new?template=i-got-hired.yml">Paylaş →</a> · kartın, arayışın ortasındaki birine çıkış yolunun var olduğunu gösterir.</sub></p>

<p align="center">
  <a href="HIRED.md"><img src="docs/hired-wall.svg" alt="En yeni üç işe alım hikâyesi" width="800"></a>
</p>

<p align="center"><sub>Her sayı <a href="HIRED.md">denetleyebileceğin →</a> herkese açık bir hikâye · her biri şu an bulunduğun yerden başladı.</sub></p>

<p align="center"><sub>BASINDA</sub></p>

<p align="center">
  <a href="https://wired.com.gr/article/to-ai-ergaleio-pou-fernei-epanastasi-ston-tropo-pou-psachnoume-douleia/" rel="noopener noreferrer nofollow"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/press/wired-dark.svg"><img src="docs/press/wired.svg" alt="WIRED" height="32"></picture></a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://www.businessinsider.com/how-i-built-tool-filter-job-listings-landed-head-ai-2026-4" rel="noopener noreferrer nofollow"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/press/business-insider-dark.svg"><img src="docs/press/business-insider.svg" alt="Business Insider" height="32"></picture></a>
</p>

<p align="center">
  <a href="https://www.producthunt.com/products/santifer-io?utm_source=badge-featured&utm_medium=badge" target="_blank" rel="noopener noreferrer"><img src="docs/press/producthunt.svg" alt="career-ops on Claude | Product Hunt" style="width: 206px; height: 54px; vertical-align: middle;" width="206" height="54"/></a>
  &nbsp;&nbsp;
  <a href="https://trendshift.io/repositories/25195" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/25195" alt="santifer%2Fcareer-ops | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center"><sub><a href="https://santifer.io">Santiago Fernández de Valderrama Aparicio</a> (<a href="https://github.com/santifer">@santifer</a>) tarafından oluşturuldu ve sürdürülüyor</sub></p>

## Bu Nedir

career-ops ([career-ops.org](https://career-ops.org), **careerops** olarak da bilinir), herhangi bir yapay zekâ kodlama CLI'ının içinde yerel olarak çalışan açık kaynaklı bir yapay zekâ iş arama aracıdır: ilanları değerlendirir, CV'ni uyarlar ve her başvuruyu takip eder; son söz her zaman sende. Başvuruları bir tabloda elle takip etmek yerine, şunları yapan yapay zekâ destekli bir hat elde edersin:

- **İlanları değerlendirir** ve yapılandırılmış bir rapora dönüştürür: A'dan H'ye bloklar ve 1-5 arası genel puan. Bu puan aritmetik bir formülle değil, beş boyut üzerinden bütüncül bir yargıyla belirlenir. B bloğundaki gereksinim başına önem sütunu ile G bloğundaki ilan meşruiyeti değerlendirmesi, puanı asla etkilemeyen ayrı ve puan-nötr sinyallerdir; H bloğu yalnızca 4,5 ve üzerinde yazılır
- **Özel PDF'ler üretir**: her iş tanımına göre uyarlanmış, ATS için optimize edilmiş CV'ler
- **Portalları otomatik tarar** (Greenhouse, Ashby, Lever, şirket sayfaları)
- **Toplu işler**: alt ajanlarla 10+ ilanı paralel değerlendirir
- **Her şeyi takip eder**: bütünlük kontrolleriyle tek bir doğruluk kaynağında
- **Şirketleri araştırır ve iletişime geçilecek doğru kişiyi bulur**: başvuru seni kuyruğa sokar; araştırma sana bir sohbet kazandırır

> **Önemli: Bu, rastgele başvuru yağdıran bir araç DEĞİLDİR.** career-ops bir filtredir: yüzlerce ilan arasından zamanına değecek birkaçını bulmana yardımcı olur. Sistem 4,0/5'in altında puan alan hiçbir şeye başvurmamanı kesinlikle önerir. Senin zamanın değerli, işe alım uzmanınınki de. Göndermeden önce her zaman gözden geçir.

career-ops ajan tabanlıdır: seçtiğin yapay zekâ kodlama CLI'ı Playwright ile kariyer sayfalarında gezinir, CV'ni iş tanımıyla karşılaştırarak (anahtar kelime eşleştirmesi değil, akıl yürüterek) uyumu değerlendirir ve özgeçmişini her ilana göre uyarlar.

> **Uyarı: İlk değerlendirmeler pek iyi olmayacak.** Sistem seni henüz tanımıyor. Ona bağlam ver: CV'n, kariyer hikâyen, kanıtlanmış başarıların, tercihlerin, iyi olduğun şeyler, kaçınmak istediklerin. Ne kadar beslersen o kadar iyi olur. Bunu yeni bir işe alım uzmanını işe alıştırmak gibi düşün: ilk hafta seni tanıması gerekir, sonra vazgeçilmez hale gelir.

740 iş ilanını değerlendirip 68'ine başvuran ve Head of Applied AI pozisyonunu alan biri tarafından yapıldı. [Vaka çalışmasının tamamını oku](https://santifer.io/career-ops-system).

## career-ops'un yapmadıkları

- **Başvuru göndermek.** Cevapları hazırlar; formu sen açar, Gönder'e sen basarsın. Betik asla POST yapmaz (`prepare-application.mjs`).
- **E-posta göndermek.** Yalnızca taslak. Bu kod tabanının hiçbir yerinde posta gönderimi yok.
- **Eve rapor vermek.** Telemetri yok, bize ait bir arka uç yok. CV'n senin makinenden seçtiğin yapay zekâ sağlayıcısına gider, başka hiçbir yere gitmez. Tek kamuya açık kayıt bu depo: `HIRED.md` ve issue'ları.
- **Seni 4,0/5 altına başvurmaya itmek.** Başvurma der. Yok sayabilirsin, o da bunu söyler.

CV'ni yeniden ifade eder; asla uydurmamalıdır. Bugün bu kural prompt'larda yaşıyor, henüz kodda zorlayıcı bir denetimde değil. Göndermeden önce her CV'yi oku. Ayrıntılar [SSS](#sss) bölümünde.

## CareerOps Manifestosu

career-ops, [CareerOps Manifestosu](https://career-ops.org/manifesto?utm_source=readme)'nun ilk referans uygulamasıdır. oku. inandığın şeyi söylüyorsa imzala. imzan bir commit olur.

## Özellikler

| Özellik                  | Açıklama                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Otomatik Hat**         | Bir URL yapıştır; tam değerlendirme + PDF + takipçi kaydı al                                                                             |
| **A-H Değerlendirmesi**  | Rol özeti, CV uyumu (her gereksinimin bu ilan için ne kadar önemli olduğu ve bu ağırlığın iş tanımının kendi ifadesinden mi, yapısından mı yoksa bir tahminden mi geldiği gereksinim başına etiketlenir; bir tahmin asla en üst banda çıkamaz), seviye stratejisi, maaş araştırması, kişiselleştirme, mülakat hazırlığı (STAR+R), ayrıca dolandırıcılık ve hayalet ilanları işaretleyen G bloğu meşruiyet kontrolü ve vize sponsorluğu olmadığını açıkça belirten bir iş tanımını kesin engel olarak işaretleyen çalışma izni sinyali |
| **Mülakat Hikâye Bankası** | Değerlendirmeler boyunca STAR+Refleksiyon hikâyeleri biriktirir: her davranışsal soruya cevap veren 5-10 ana hikâye                    |
| **Pazarlık Senaryoları** | Maaş pazarlığı çerçeveleri, coğrafi indirime karşı duruş, rakip tekliflerden kaldıraç                                                    |
| **ATS PDF Üretimi**      | Space Grotesk + DM Sans tasarımıyla anahtar kelime enjekte edilmiş CV'ler                                                                |
| **Ön Yazı Üretici**      | Araştırmaya dayalı ön yazılar: anahtar kelime yansıtma, dört etkileşimli açı sorusu (neden/sorunlar/yaklaşım/ton), sohbette taslak onayı ve CV'lerle aynı HTML + Playwright hattı üzerinden A4 PDF. Her değerlendirmede otomatik taslak yazar; istediğinde `/career-ops cover` ile tamamla ve üret |
| **Başvuru E-postası Taslakları** | Bir rapordan veya yapıştırılan iş tanımından işe alım uzmanına, referansla ya da soğuk başvuru için resmî e-postalar: konu satırı, ek listesi, kaynaklı uyum noktaları ve profilden gelen iletişim bloğu ile. Yalnızca taslak: career-ops asla göndermez, iletmez veya hiçbir şeye tıklamaz. |
| **Portal Tarayıcı**      | 100+ önceden yapılandırılmış şirket (Anthropic, OpenAI, ElevenLabs, Retool, n8n...) + Ashby, Greenhouse, Lever, Wellfound üzerinde özel sorgular |
| **Yatırım Almış Şirket Keşfi** | Önce incele yaklaşımlı `company:funded` komutu, yapılandırılmış açık akışlardan yakın zamanda yatırım almış şirketleri ve kaynak tanılamalarını verilerini düzenlemeden ortaya çıkarır |
| **Toplu İşleme**         | Başsız CLI işçileriyle paralel değerlendirme (`claude -p` / `opencode run`)                                                              |
| **Dashboard TUI**        | Hattını gezmek, filtrelemek ve sıralamak için terminal arayüzü                                                                           |
| **Human-in-the-Loop**    | Yapay zekâ değerlendirir ve önerir, sen karar verir ve harekete geçersin. Sistem asla başvuru göndermez: son söz her zaman sende <!-- hitl: absolute guarantee. Do not add "automatically", "by itself", "without your permission" or any other hedge when translating this row. -->               |
| **Hat Bütünlüğü**        | Otomatik birleştirme, tekilleştirme, durum normalleştirme, sağlık kontrolleri                                                            |
| **Mülakat Paketi**       | Zaman bloklu hazırlık planları, geri bildirimli pratik oturumları, mülakat sonrası değerlendirmeler ([`interview/`](modes/interview/README.md)) ve şirket kırmızı bayrak dedektörü ([`interview-redflag`](modes/interview-redflag.md)) |
| **Teklif Aşaması**       | Sözleşme okuma yoldaşı: madde madde geçiş artı avukata soru listesi ([`offer-prep`](modes/offer-prep.md)) ve istenen/ilan edilen/gerçek maaş farkı analizörü (`salary-gap.mjs`) |
| **Takip ve Yanıtlar**    | Takip ritmi hesaplayıcı ve önceden ekilmiş hatırlatıcılar (`followup-cadence.mjs`, `followup-seed.mjs`); işveren yanıtlarının takipçi güncellemelerine sınıflandırılması ([`reply-watch`](modes/reply-watch.md)) |
| **Örüntü Analizi**       | Ret örüntüleri ve ATS kanalı başına ilerleme oranları (`analyze-patterns.mjs`), tüm arayışın huni istatistikleri (`stats.mjs`), yeniden yayın ve hayalet ilan tespiti (`detect-reposts.mjs`) |
| **Eklenti Sistemi**      | İsteğe bağlı entegrasyonlar (Gmail, Notion, Apify + topluluk kaydı), varsayılan olarak kapalı; bkz. [docs/PLUGINS.md](docs/PLUGINS.md)   |
| **CV'nin Ötesi**         | Şirket araştırması ([`deep`](modes/deep.md)) yapay zekâ stratejisini, son hamleleri, mühendislik kültürünü ve profilinin alması gereken açıyı ortaya çıkarır. Kişi keşfi ([`contacto`](modes/contacto.md)) ulaşmaya değer işe alım yöneticisini, işe alım uzmanını veya ekip arkadaşını belirler ve her kişi tipine göre ayarlanmış ≤300 karakterlik bir LinkedIn mesajı taslağı yazar. Resmî başvuru e-postası taslakları ([`email`](modes/email.md)) değerlendirilmiş bir raporu veya yapıştırılan iş tanımını hiçbir şey göndermeden, iletmeden veya tıklamadan konu satırına, gövdeye ve ek listesine dönüştürür. Başvuru seni kuyruğa sokar; araştırma sana bir sohbet kazandırır. |

## Hızlı Başlangıç

**En hızlı yol: tek komut:**

```bash
npx @santifer/career-ops init
```

> 💡 `npx`, [Node.js](https://nodejs.org) ile birlikte gelir: yükleyiciyi bir kez çalıştırır,
> global olarak hiçbir şey kurmaz. Node henüz yok mu? Önce onu kur.
> (Zaten bir Claude Code / Gemini / Codex CLI kullanıyor musun? O zaman zaten var.)

Bu, en son sürümü `./career-ops` içine klonlar ve bağımlılıkları kurar. Sonra:

```bash
cd career-ops
claude   # or codex / qwen / opencode / agy / grok — open your AI CLI here
```

**İlk açılışta career-ops kurulumda sana yol gösterir (CV'n, profilin ve hedef rollerin), sadece sohbet ederek. Elle düzenlenecek hiçbir şey yok.**

<details>
<summary><b>Elle kurmayı mı tercih edersin? (git clone)</b></summary>

```bash
git clone https://github.com/career-ops-hq/career-ops.git
cd career-ops && npm install
npx playwright install chromium   # only needed for PDF generation

# 2. Check setup
npm run doctor                     # Validates all prerequisites

# 3. Configure
cp config/profile.example.yml config/profile.yml  # Edit with your details
cp templates/portals.example.yml portals.yml       # Customize companies

# 4. Add your CV
# Create cv.md in the project root with your CV in markdown

# 5. Open your AI CLI in this directory
claude   # or codex / opencode / qwen / agy / grok

# Then ask your CLI to adapt the system to you:
# "Change the archetypes to backend engineering roles"
# "Translate the modes to English"
# "Add these 5 companies to portals.yml"
# "Update my profile with this CV I'm pasting"

# 6. Start using
# Paste a job URL or JD text to trigger auto-pipeline
# If your CLI supports slash commands, use /career-ops (or its CLI-specific alias)
# In Codex, ask for the same mode in plain language, e.g.:
# "Run the career-ops scan mode"
# "Run the career-ops pipeline mode for data/pipeline.md"
# "Run the career-ops pdf mode for the latest evaluated role"
# "Run the career-ops tracker mode and summarize the current statuses"
```

</details>

### Global kurulum

```bash
npm i -g @santifer/career-ops
```

Bu, `career-ops` ikilisini global olarak kurar; böylece `npx` yerine doğrudan çalıştırabilirsin. Bir proje dizini oluşturan `npx @santifer/career-ops init`'ten farklı olarak, global kurulum terminalinin her yerinde kullanılabilen kalıcı bir `career-ops` komutu verir.

**Hangisini kullanmalısın?**
- `npx @santifer/career-ops init`: ilk kullanım için en iyisi; özel bir proje klasörü oluşturur.
- `npm i -g @santifer/career-ops`: bir proje klasörün olduğunda ve career-ops komutlarını doğrudan çalıştırmak istediğinde en iyisi.

> **Sistem, bizzat yapay zekâ kodlama CLI'ın tarafından özelleştirilmek üzere tasarlandı.** Modlar, arketipler, puanlama ağırlıkları, pazarlık senaryoları: değiştirmesini istemen yeterli. Kullandığı dosyaların aynısını okur, bu yüzden neyi düzenleyeceğini tam olarak bilir.

Tam kurulum kılavuzu için [docs/SETUP.md](docs/SETUP.md), career-ops'u özel veya yerel modellerle ucuza çalıştırmak için [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md) (Antigravity CLI'ın ücretsiz katmanında sıfır maliyetle çalıştırmak için [docs/FREE_TIER.md](docs/FREE_TIER.md)), tekrarlayan taramaları zamanlamak ve token harcamayan bir eleme-kısa liste tarifi için [docs/AUTOMATION.md](docs/AUTOMATION.md), ATS otomatik doldurma akışının ayrıntıları için [docs/APPLY_AUTOFILL.md](docs/APPLY_AUTOFILL.md), LinkedIn bağlantı dışa aktarımını hunindeki şirketlerle çapraz kontrol etmek için [docs/LINKEDIN_JOIN.md](docs/LINKEDIN_JOIN.md) ve yaygın kurulum sorularının cevapları için [docs/FAQ.md](docs/FAQ.md) sayfasına bak; buna [hikâye kaynağının uydurma sayıları nasıl engellediği](docs/FAQ.md#why-does-career-ops-refuse-to-use-a-number-from-my-story-bank) de dahil. Tasarım ilkeleri [ARCHITECTURE.md](ARCHITECTURE.md) içinde; çalışma zamanı akışları [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) içinde.

## Antigravity CLI Entegrasyonu

career-ops, Claude Code ve OpenCode'u desteklediği gibi Antigravity CLI'ı da yerel olarak destekler. Tüm eğik çizgi komutları, aynı `modes/*.md` değerlendirme mantığını kullanan ortak beceri giriş noktası üzerinden kullanılabilir.

Google, tüketici Gemini CLI erişimini Antigravity CLI'a taşıdı. `GEMINI.md` artık hiçbir şey yapmayan bir uyumluluk korumasıdır; böylece Antigravity hem `AGENTS.md` hem `GEMINI.md` dosyasını okuduğunda tam proje talimatlarını iki kez yüklemez.

### Yerel Antigravity CLI

```bash
# 1. Run in the career-ops directory
cd career-ops
agy

# 2. Use the unified /career-ops command with subcommands:
/career-ops "Senior AI Engineer at Anthropic..."
/career-ops pipeline
/career-ops scan
/career-ops pdf
/career-ops tracker
```

Beceri, açık standarda göre `.agents/skills/career-ops/SKILL.md` içinde tanımlanır ve desteklenen her CLI için (ör. `.claude/`, `.cursor/`, `.qwen/`, `.antigravitycli/`, `.grok/`) sembolik bağ ile bağlanır veya referans verilir.

## Codex Entegrasyonu

career-ops, Codex'i aynı ortak yönlendirici üzerinden destekler; ancak çağırma modeli, eğik çizgi komutlarını otomatik kaydeden CLI'lardan farklıdır. Tam kılavuz için bkz. [docs/CODEX.md](docs/CODEX.md).

### Etkileşimli Codex

```bash
cd career-ops
codex
```

Codex'te eğik çizgi komutları garanti değildir. `/career-ops` kullanılamıyorsa, Codex'ten modu doğrudan düz dille çalıştırmasını iste:

```text
Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123
Run the career-ops scan mode and summarize new matches.
Run the career-ops pipeline mode for data/pipeline.md.
Run the career-ops pdf mode for the latest evaluated role.
Run the career-ops tracker mode and summarize the current statuses.
```

### Tek seferlik Codex (`codex exec`)

```bash
codex exec "Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123"
codex exec "Run career-ops scan mode in this repo and summarize new matches."
codex exec "Run career-ops pipeline mode for data/pipeline.md."
codex exec "Run career-ops pdf mode for the latest evaluated role."
codex exec "Run career-ops tracker mode and summarize the current statuses."
```

## Grok Build CLI Entegrasyonu

career-ops, Claude Code ve OpenCode'u desteklediği gibi Grok Build CLI'ı da yerel olarak destekler. `AGENTS.md` proje kuralları olarak otomatik yüklenir ve tüm eğik çizgi komutları ortak beceri giriş noktası üzerinden kullanılabilir.

### Yerel Grok Build CLI

```bash
# 1. Run in the career-ops directory
cd career-ops
grok

# 2. Use the unified /career-ops command with subcommands:
/career-ops "Senior AI Engineer at Anthropic..."
/career-ops pipeline
/career-ops scan
/career-ops pdf
/career-ops tracker
```

Başsız toplu işçiler için `grok -p "prompt"` kullan (araç yürütmelerini otomatik onaylamak için `--yolo` ekle).

### Bağımsız Gemini API Betiği (CLI kurulumu gerekmez)

```bash
# 1. Get a free API key at https://aistudio.google.com/apikey
cp .env.example .env
# Edit .env, set GEMINI_API_KEY=your_key_here

# 2. Install dependencies
npm install

# 3. Evaluate a job description
node gemini-eval.mjs "We are looking for a Senior AI Engineer..."
node gemini-eval.mjs --file ./jds/my-job.txt
node agent-inbox.mjs add "..."   # queue a request for the next session
npm run gemini:eval -- "JD text here"
```

> **Ücretsiz katman:** İki seçenek de faturalandırma olmadan çalışır. Yerel CLI Google OAuth kullanır; API betiği `gemini-3.6-flash` kullanır (hız limitleri modele ve katmana bağlıdır; güncel kotalar için Google AI belgelerine bak).

## Kullanım

career-ops ortak bir komut yönlendiricisi kullanır. Eğik çizgi komutlarını kaydeden CLI'larda şöyle görünür:

```
/career-ops           → Tüm kullanılabilir komutları göster
/career-ops {JD}      → OTOMATİK HAT: değerlendirme + rapor + PDF + takipçi (metin veya URL yapıştır)
/career-ops pipeline  → Gelen kutusundaki bekleyen URL'leri işle (data/pipeline.md)
/career-ops oferta    → Yalnızca değerlendirme, A'dan G'ye bloklar (otomatik PDF yok)
/career-ops ofertas   → Birden çok ilanı karşılaştır ve sırala
/career-ops contacto  → LinkedIn hamlesi: kişileri bul + mesaj taslağı yaz
/career-ops deep      → Şirket hakkında derin araştırma prompt'u
/career-ops interview-prep → Şirkete özel mülakat hazırlık belgesi üret
/career-ops interview    → Etkileşimli profil/CV tanışma mülakatı
/career-ops eu-swe    → CV/başvuru/mülakat öncesinde bir Avrupa SWE başvurusunu kalibre et
/career-ops eu-fintech → 21 AB fintech portalını Product Manager rolleri için tara (token harcamaz)
/career-ops interview/plan → Yaklaşan bir mülakat için zaman bloklu hazırlık planı
/career-ops interview/practice → Pratik mülakat, geri bildirimle her seferinde bir soru
/career-ops interview/debrief → Mülakat sonrası değerlendirme: açıkları kapat, sonraki turu öngör
/career-ops interview-redflag → Bir şirkete katılmadan önce işverenin uyarı işaretlerini analiz et
/career-ops pdf       → Yalnızca PDF, ATS için optimize edilmiş CV
/career-ops text      → Uyarlanmış markdown CV (cv.md'yi yansıtır, PDF yok)
/career-ops latex     → CV'yi LaTeX/Overleaf .tex olarak dışa aktar
/career-ops latex-tex → Kendi resume.tex dosyanı yerinde uyarla (isteğe bağlı; cv.md varsayılan kalır)
/career-ops cover     → Ön yazı: tek başına yapıştırılan iş tanımı veya /career-ops cover {slug}
/career-ops email     → Resmî başvuru e-postası taslağı (yalnızca taslak; asla göndermez, iletmez veya tıklamaz)
/career-ops add       → CV'ne proje/makale/rol ekle (getir + önizle + onayla)
/career-ops expand    → Profil bağlantılarından eksik yetkinlikleri otomatik keşfet ve ekle
/career-ops training  → Kurs/sertifikayı North Star'a göre değerlendir
/career-ops project   → Portföy projesi fikrini değerlendir
/career-ops tracker   → Başvuru durumu özeti
/career-ops agent-inbox → Sonraki oturum için istekleri kuyruğa al/boşalt (data/agent-inbox.md)
/career-ops apply     → Canlı başvuru asistanı (formu okur + cevapları üretir)
/career-ops scan      → Portalları tara ve yeni ilanları keşfet
/career-ops discover  → Bir şirket listesini taranabilir ATS panolarına çevir + portals.yml'e ekle (token harcamaz)
/career-ops batch     → Paralel işçilerle toplu işleme
/career-ops patterns  → Ret örüntülerini analiz et ve hedeflemeyi iyileştir
/career-ops offer-prep → Alınan teklifi/sözleşmeyi adayla birlikte oku: madde madde geçiş + avukata sorular (hukuki tavsiye değildir)
/career-ops titles    → Aramayı genişletmek için CV'nden komşu iş unvanları öner
/career-ops upskill   → Değerlendirilmiş raporlarından toplu beceri açığı analizi
/career-ops followup  → Takip ritmi takipçisi: gecikenleri işaretle, taslaklar üret
/career-ops reply-watch → İşveren yanıtlarını sınıflandır ve takipçi güncellemeleri öner
/career-ops outcome   → Başvuru sonucunu kaydet ve çıktıları arşivle
/career-ops calibrate → Danışma raporu: değerlendirme puanların gerçek sonuçlarını öngörüyor mu? /outcome verilerini okur; puanlamayı asla değiştirmez
/career-ops update    → career-ops sistem dosyalarını diff önizlemesi + uyumluluk kontrolüyle güncelle
```

Ya da sadece bir iş URL'si veya tanımı yapıştır: career-ops bunu otomatik algılar ve tam hattı çalıştırır.

Codex'te eğik çizgi komutları garanti değildir. Bunun yerine aynı mod adlarını bir prompt'ta kullan veya `codex exec` ile çağır.

## Nasıl Çalışır

```
You paste a job URL or description
        │
        ▼
┌──────────────────┐
│  Archetype       │  Classifies: LLMOps / Agentic / PM / SA / FDE / Transformation
│  Detection       │
└────────┬─────────┘
         │
┌────────▼─────────┐
│  A-H Evaluation  │  Match, gaps, comp research, STAR stories, legitimacy
│  (reads cv.md)   │
└────────┬─────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
 Report  PDF  Tracker
  .md   .pdf  entry
```

## Önceden Yapılandırılmış Portallar

Tarayıcı, taramaya hazır **100+ şirket** ve başlıca iş panolarında **45+ arama sorgusu** ile gelir. `templates/portals.example.yml` dosyasını `portals.yml` olarak kopyala ve kendininkileri ekle:

**Yapay Zekâ Laboratuvarları:** Anthropic, OpenAI, Mistral, Cohere, LangChain, Pinecone
**Sesli Yapay Zekâ:** ElevenLabs, PolyAI, Parloa, Hume AI, Deepgram, Vapi, Bland AI
**Yapay Zekâ Platformları:** Retool, Airtable, Vercel, Temporal, Glean, Arize AI
**İletişim Merkezi:** Ada, LivePerson, Sierra, Decagon, Talkdesk, Genesys
**Kurumsal:** Salesforce, Twilio, Gong, Dialpad
**LLMOps:** Langfuse, Weights & Biases, Lindy, Cognigy, Speechmatics
**Otomasyon:** n8n, Zapier, Make.com
**Avrupa:** Factorial, Attio, Tinybird, Clarity AI, Travelperk

**Aranan iş panoları:** 55+ sağlayıcı modülü ATS API'lerini, pano genelindeki akışları, XML/RSS akışlarını, markdown akışlarını ve yerel ayrıştırıcıları kapsar. Tam tablo için bkz. [Desteklenen iş panoları](docs/SUPPORTED_JOB_BOARDS.md).

Varsayılan olarak `node scan.mjs` (nam-ı diğer `npm run scan`) her ATS akışının döndürdüğüne güvenir. Bazı şirketler pozisyon kapandıktan sonra bile herkese açık API'lerinde eski ilanları bırakır; bu süresi dolmuş kayıtlar `pipeline.md` içine sızabilir. API geçişinden sonra Playwright'ı başlatıp süresi dolmuş ilanları hatta girmeden elemek için `--verify` ver:

```bash
node scan.mjs --verify          # zero-token discovery + Playwright liveness check
```

Doğrulama sıralıdır ve yalnızca yeni ilanlar üzerinde çalışır (tekilleştirmeden sonra), bu yüzden maliyet sınırlı kalır.

## Dashboard TUI

Yerleşik terminal panosu hattını görsel olarak gezmene izin verir:

```bash
npm run serve:dashboard   # launch the TUI
npm run build:dashboard   # optional: build the standalone binary
```

Özellikler: 6 filtre sekmesi, 4 sıralama modu, gruplu/düz görünüm, tembel yüklenen önizlemeler, satır içi durum değişiklikleri.

Ayrıca **deneysel bir web arayüzü** de var (alfa, isteğe bağlı: sen başlatmadıkça hiçbir şey çalışmaz): bkz. [`web/README.md`](web/README.md).

## Proje Yapısı

```
career-ops/
├── AGENTS.md                    # Canonical agent instructions (all CLIs)
├── CLAUDE.md                    # Claude Code wrapper (imports AGENTS.md)
├── CODEX.md                     # Codex wrapper (imports AGENTS.md)
├── OPENCODE.md                  # OpenCode wrapper (imports AGENTS.md)
├── GEMINI.md                    # Legacy no-op guard to avoid Antigravity duplicate context
├── cv.md                        # Your CV (create this)
├── article-digest.md            # Your proof points (optional)
├── config/
│   └── profile.example.yml      # Template for your profile
├── modes/                       # Skill modes
│   ├── _shared.md               # Shared context (customize this)
│   ├── oferta.md                # Single evaluation
│   ├── pdf.md                   # PDF generation
│   ├── cover.md                 # Cover letter generation
│   ├── email.md                 # Formal application email drafts
│   ├── scan.md                  # Portal scanner
│   ├── batch.md                 # Batch processing
│   └── ...
├── templates/
│   ├── cv-template.html         # ATS-optimized CV template
│   ├── portals.example.yml      # Scanner config template
│   └── states.yml               # Canonical statuses
├── batch/
│   ├── batch-prompt.md          # Self-contained worker prompt
│   └── batch-runner.sh          # Orchestrator script
├── dashboard/                   # Go TUI pipeline viewer
├── data/                        # Your tracking data (gitignored)
├── reports/                     # Evaluation reports (gitignored)
├── output/                      # Generated PDFs (gitignored)
├── fonts/                       # Space Grotesk + DM Sans
├── docs/                        # Setup, customization, budget guide, architecture
└── examples/                    # Sample CV, report, proof points
```

## Harici Veri Dizini (İsteğe Bağlı)

Varsayılan olarak kullanıcı katmanı verileri (`cv.md`, `portals.yml` ve `data/`, `reports/`, `output/` klasörleri gibi) proje kök klasöründe bulunur.

Kişisel verilerini koddan ayırmak için (dal değiştirmeyi, güncelleme çekmeyi veya birden çok profili test etmeyi kolaylaştırır), aşağıdaki öncelik sırasıyla harici bir veri dizini yapılandırabilirsin:

1. **Ortam Değişkenleri:** `CAREER_OPS_ROOT` veya `CAREER_OPS_DATA_DIR` ortam değişkenini ayarla:
   ```bash
   export CAREER_OPS_ROOT=~/my-career-data
   ```
2. **İşaretçi Dosya:** Depo kökünde, veri dizininin yolunu içeren bir `.career-ops-data` dosyası oluştur.
3. **Varsayılan:** Depo kökü kullanılır.

Çözümlendikten sonra tüm kullanıcı dosyaları o klasöre göre çözümlenir ve yazılır; prompt dosyaları ve betikler depoya göre çözümlenmeye devam eder.

- **Takipçiyi Geçersiz Kılma:** Başvuru takipçisi dosya yolunu doğrudan geçersiz kılmak için `CAREER_OPS_TRACKER` da ayarlayabilirsin.
- **Yazmalar:** Tüm yazma işlemleri (birleştirmeler gibi) kanonik olarak `{DATA_ROOT}/data/applications.md` hedefine gider.

Go dashboard TUI, Node.js betikleri ve yapay zekâ ajan modlarının tümü bu çözümleme hiyerarşisine otomatik olarak uyar.


## Teknoloji Yığını

![Claude Code](https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white)
![Bubble Tea](https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white)

- **Ajan**: Ortak beceriler ve modlarla yapay zekâ kodlama CLI'ı (`AGENTS.md` + CLI sarmalayıcısı)
- **PDF**: Playwright + HTML şablonu
- **Ön yazılar**: HTML şablonu + Playwright (A4 PDF, CV'lerle aynı hat)
- **Tarayıcı**: Playwright + Greenhouse API + WebSearch
- **Dashboard**: Go + Bubble Tea + Lipgloss (Catppuccin Mocha teması)
- **Veri**: Markdown tabloları + YAML yapılandırması + TSV toplu dosyaları

## Ayrıca Açık Kaynak

- **[cv-santiago](https://github.com/santifer/cv-santiago)**: Yapay zekâ sohbet botu, LLMOps panosu ve vaka çalışmalarıyla portföy sitesi (santifer.io). İş arayışının yanında sergileyecek bir portföye ihtiyacın varsa, çatalla ve kendine ait yap.

## SSS

**career-ops nedir?**
career-ops, yapay zekâ kodlama CLI'ında (Claude Code, Codex, OpenCode ve diğerleri) yerel olarak çalışan ve her kararı sana bırakan açık kaynaklı bir yapay zekâ iş arama aracıdır. İş ilanlarını CV'ne göre değerlendirir, ATS'ye uyarlanmış PDF'ler üretir, iletişime geçilecek doğru kişiyi bulur ve her şeyi tek yerde takip eder: son söz her zaman sende. CareerOps Manifestosu'nun ilk referans uygulamasıdır. Daha fazlası [career-ops.org](https://career-ops.org) adresinde.

**Uyarlanmış CV bir şeyler uydurabilir mi?**
Uydurmamalı, prompt'lar da böyle diyor: yeniden ifade et, asla uydurma. Bu kural henüz kodda bir denetimle zorlanmıyor. İki açık issue bunu takip ediyor: [#2677](https://github.com/career-ops-hq/career-ops/issues/2677) (iş unvanları cv.md ile eşleşmeli) ve [#1411](https://github.com/career-ops-hq/career-ops/issues/1411) (uyuşmazlıkta engelleyen sadakat denetimi). Bunlar birleştirilene kadar, göndermeden önce her CV'yi oku. [Yasal uyarı](LEGAL_DISCLAIMER.md) aynı şeyi daha uzun söylüyor.

**career-ops'u ücretsiz veya daha ucuz / yerel bir modelde çalıştırabilir miyim?**
Evet. career-ops CLI'dan bağımsızdır ve ücretsiz ve yerel modellerde çalışır (OpenRouter ücretsiz modelleri, Ollama veya herhangi bir OpenAI uyumlu uç nokta), bu yüzden ücretli bir aboneliğe bağlı değilsin. Tam kurulum için bkz. [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md).

**Claude Pro/Max için ödeme yapıyorum ama career-ops API kredisi harcıyor. Neden?**
Çünkü ortamındaki `ANTHROPIC_API_KEY`, oturum açtığın aboneliğe göre önceliklidir: CLI anahtarı kullanır ve token başına faturalandırır. `echo $ANTHROPIC_API_KEY` çalıştır; bir şey yazdırıyorsa kabuk profilinden kaldır, terminali yeniden başlat ve `/login` çalıştır. Toplu mod istisnadır, çünkü `claude -p` işçileri etkileşimli oturum açmayı kullanmaz: bir kez `claude setup-token` çalıştır ve sonucu `CLAUDE_CODE_OAUTH_TOKEN` olarak dışa aktar. Tam anlatım [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md#2b-already-paying-for-a-subscription-make-sure-you-are-using-it) içinde.

**career-ops hangi yapay zekâ CLI'larıyla çalışır?**
career-ops, açık Agent Skill Standard üzerinden başlıca tüm yapay zekâ kodlama CLI'larında (Claude Code, Codex, Gemini / Antigravity, OpenCode, Grok, Qwen ve daha fazlası) çalışır; bu yüzden asla tek bir tedarikçiye kilitlenmez. Zaten sahip olduğun CLI'ı kullan.

**career-ops'u Windows'a nasıl kurarım?**
career-ops Windows'ta çalışır. Platforma özel kurulum ve bilinen pürüzler (Git Bash keşfi, satır sonları, Görev Zamanlayıcı) [docs/WINDOWS.md](docs/WINDOWS.md) içinde. Kurulum sırasında beceriler sembolik bağ hatasıyla yüklenmezse çözüm [docs/FAQ.md](docs/FAQ.md) içinde. Tam adımlar [docs/SETUP.md](docs/SETUP.md) içinde.

**career-ops benim yerime otomatik başvuru yapar mı?**
Hayır. career-ops bir filtredir, rastgele başvuru yağdıran bir otomatik başvurucu değil. Yapay zekâ değerlendirir, sıralar ve taslak yazar; sen gözden geçirir ve karar verirsin. Asla göndermez, iletmez veya hiçbir şeye tıklamaz: son söz her zaman sende. Bu insan-döngüde tasarımı meselenin özüdür.

**career-ops ücretsiz ve açık kaynak mı?**
Evet. career-ops ücretsiz ve açık kaynaktır ve aday için her zaman öyle kalacaktır: [CareerOps Manifestosu](https://career-ops.org/manifesto)'nun ilk referans uygulamasıdır. Oku ve inandığın şeyi söylüyorsa imzala.

## Yazar Hakkında

Ben [Santiago Fernández de Valderrama Aparicio](https://santifer.io/about) (santifer): Head of Applied AI, eski kurucu (hâlâ adımla çalışan bir işletme kurdum ve sattım). career-ops'u kendi iş arayışımı yönetmek için yaptım. İşe yaradı: şu anki pozisyonumu onunla aldım.

Bu deponun haftada yaklaşık 4 saatle nasıl sürdürüldüğünü merak ediyor musun? [Agentic maintenance: how career-ops is run by a fleet of AI agents](https://santifer.io/ai-agent-fleet) yazısını oku.

Portföyüm ve diğer açık kaynak projelerim → [santifer.io](https://santifer.io)

Wikidata: [Santiago Fernández de Valderrama Aparicio](https://www.wikidata.org/wiki/Q138710224) · [career-ops](https://www.wikidata.org/wiki/Q139007988).

## Sorumluluk Reddi

**career-ops yerel, açık kaynaklı bir araçtır, barındırılan bir hizmet DEĞİLDİR.** Bu yazılımı kullanarak şunları kabul edersin:

1. **Verilerini sen kontrol edersin.** CV'n, iletişim bilgilerin ve kişisel verilerin makinende kalır ve doğrudan seçtiğin yapay zekâ sağlayıcısına (Anthropic, OpenAI vb.) gönderilir. Verilerinin hiçbirini toplamayız, saklamayız ve bunlara erişimimiz yoktur.
2. **Yapay zekâyı sen kontrol edersin.** Varsayılan prompt'lar yapay zekâya başvuruları otomatik göndermemesini söyler, ancak yapay zekâ modelleri öngörülemez davranabilir. Prompt'ları değiştirir veya farklı modeller kullanırsan bunu kendi riskinle yaparsın. **Göndermeden önce yapay zekâ tarafından üretilen içeriğin doğruluğunu her zaman kontrol et.**
3. **Üçüncü taraf hizmet şartlarına sen uyarsın.** Bu aracı etkileşimde bulunduğun kariyer portallarının (Greenhouse, Lever, Workday, LinkedIn vb.) Hizmet Şartlarına uygun kullanmalısın. Bu aracı işverenlere spam göndermek veya ATS sistemlerini boğmak için kullanma.
4. **Garanti yoktur.** Değerlendirmeler öneridir, gerçek değil. Yapay zekâ modelleri beceri veya deneyim uydurabilir. Yazarlar istihdam sonuçlarından, reddedilen başvurulardan, hesap kısıtlamalarından veya başka herhangi bir sonuçtan sorumlu değildir.

Tüm ayrıntılar için bkz. [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md). Bu yazılım [MIT Lisansı](LICENSE) altında "olduğu gibi", hiçbir garanti olmaksızın sağlanır.

## Katkıda Bulunanlar

<a href="https://github.com/career-ops-hq/career-ops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=career-ops-hq/career-ops" />
</a>

Kod, belge, çeviri veya test katkısı yapan herkes
[CONTRIBUTORS.md](CONTRIBUTORS.md) dosyasında listelenir; yukarıdaki grafiğin
gösteremediği kod dışı katkılar da dahil.

career-ops ile işe mi alındın? [Hikâyeni paylaş!](https://github.com/career-ops-hq/career-ops/issues/new?template=i-got-hired.yml)

## Lisans ve Ticari Marka

Kod [MIT](LICENSE) ile lisanslanmıştır. "career-ops" adı ve
markası [Ticari Marka Politikası](TRADEMARK.md) ile yönetilir: topluluk
kullanımı için izin verici, ticari ürün adlandırması ve onayı için
saklıdır.

## Tanınırlık

<p align="center">
  <a href="https://warpchart.dev/hq">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://warpchart.dev/api/chart?theme=dark&v=3">
      <img alt="Live star telemetry of career-ops-hq/career-ops" src="https://warpchart.dev/api/chart?theme=light&v=3" loading="lazy">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/Join_the_community-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
</p>

<p align="center">
  <a href="https://github.com/career-ops-hq/career-ops/releases/latest"><img src="https://img.shields.io/npm/v/%40santifer%2Fcareer-ops?style=for-the-badge&labelColor=2b3137&color=2ea44f&label=release" alt="Latest release"></a>
</p>

<p align="center">
  <a href="https://claude.com/claude-code"><img src="https://img.shields.io/badge/Built_with-Claude_Code-000?style=for-the-badge&logo=anthropic&logoColor=white" alt="Built with Claude Code"></a>
</p>

<p align="center">
  <sub>Agent-skill standardına uyan her CLI'da da çalışır. Bkz. <a href="docs/SUPPORTED_CLIS.md">Desteklenen CLI'lar</a>.</sub><br>
  <img src="https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/OpenCode-111827?style=flat&logo=terminal&logoColor=white" alt="OpenCode">
  <img src="https://img.shields.io/badge/Antigravity_CLI-4285F4?style=flat&logo=google&logoColor=white" alt="Antigravity CLI">
  <img src="https://img.shields.io/badge/Codex-412991?style=flat&logo=openai&logoColor=white" alt="Codex">
  <img src="https://img.shields.io/badge/Qwen-615CED?style=flat" alt="Qwen">
  <img src="https://img.shields.io/badge/Kimi-FF4B4B?style=flat" alt="Kimi">
  <img src="https://img.shields.io/badge/GitHub_Copilot-000?style=flat&logo=githubcopilot&logoColor=white" alt="GitHub Copilot">
  <img src="https://img.shields.io/badge/Grok_Build_CLI-000?style=flat&logo=x&logoColor=white" alt="Grok Build CLI">
  <br>
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white" alt="Playwright">
  <img src="https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white" alt="Bubble Tea">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT">
  <a href="TRADEMARK.md"><img src="https://img.shields.io/badge/Trademark-Policy-blue.svg" alt="Trademark Policy"></a>
</p>

## Bize Ulaşın

[![Website](https://img.shields.io/badge/santifer.io-000?style=for-the-badge&logo=safari&logoColor=white)](https://santifer.io)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/santifer)
[![X](https://img.shields.io/badge/X-000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/santifer)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/8pRpHETxa4)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:hi@santifer.io)
