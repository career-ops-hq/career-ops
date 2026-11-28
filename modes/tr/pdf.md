# Mod: pdf — ATS Optimize Edilmiş PDF Üretimi

İsteğe bağlı ek işlemler:
- **`--hm-audit`:** `/career-ops pdf --hm-audit`, 20. adıma işe alım yöneticisi denetimini ekler: uyarlanmış CV PDF'e dönüşmeden önce, araştırmaya dayanan ayrı bir değerlendiricinin onu eleştirel gözle okuması (`modes/pdf/hm-audit.md`). Varsayılan olarak kapalıdır, çünkü bir alt ajan (subagent) çağrısı ve web araştırması gerektirir. Tek bir çalıştırma için bayrakla, her çalıştırma için kendi `modes/_custom.md` dosyanda aç.
- **`--ats`:** `/career-ops pdf --ats`, 21a adımını ekler: aynı uyarlanmış CV'nin ATS tarafından ayrıştırılabilen ikinci bir çıktısı. Biçimlendirilmiş PDF'i eke koyarken metni yapıştırdığın başvuru formu içindir. Varsayılan olarak kapalıdır: yalnızca ATS metin formlarıyla başvuran adayların buna ihtiyacı var, diğer herkes boş yere ikinci bir çıktı için bedel öderdi. Tek bir çalıştırma için bayrakla, her çalıştırma için kendi `modes/_custom.md` dosyanda aç.

## Kontrol paneli (Dashboard)

Kontrol panelindeki bir PDF çalıştırması, modelden `<<cv-json>>` zarfı içinde **JSON Girdi Şeması**'nı ister. Sunucu HTML'i `build-cv-html.mjs` ile oluşturur, ardından başlık kontrolünü, yapı kontrolünü ve anahtar kelime kontrolünü çalıştırır. Roller en yeniden eskiye sıralı kalır, böylece kronoloji koruması açık kalır. Apply, biçimlendirilmiş PDF'i yükler. Sunucu yalnızca o çalıştırma `ats` değerini true yaptığında bir ATS PDF'i yazar; bu, CLI'daki `--ats` ile aynı isteğe bağlı seçimdir. O ATS çıktısı `--report` kullanmaz, böylece indeks hâlâ biçimlendirilmiş PDF'i gösterir. Raporun anahtar kelime paneli, o rapor için uyarlanmış HTML dosyası varsa onu puanlar.

## Tam ardışık düzen (Full pipeline)

**Kilitli Bölümler (Locked Sections):** `profile.yml` içinde `cv.locked_sections` tanımlıysa, CV üretimi veya uyarlaması sırasında bu bölümleri ASLA kaldırma, kısaltma veya başka sözcüklerle yeniden yazma. Birebir yer almalıdırlar.

## Başvuruya bağlı çıktılar (Application-scoped artifacts)

Bir CV mevcut bir başvuru için yeniden kullanılıyor veya hafifçe uyarlanıyorsa, `npm run application:init -- --report {report-number} --company "{company}" --role "{role}" --version 1` ile bir paket (bundle) başlat. Yazdırılan paket kökü altında güncel JD'yi `jd/current.md`, karşılaştırma JD'sini `jd/previous.md`, kaynak CV'yi `cv/source/original.html`, uyarlanmış CV'yi `cv/tailored/v001/cv.html`, PDF'i `cv/tailored/v001/cv.pdf`, değişiklik notlarını `cv/tailored/v001/changes.md` ve yeniden kullanım kararını `decision/reuse.json` konumunda tut. Paketin belirsiz bir takipçi satırını değil rapor numarasını kullanması için önce başvuruyu/raporu `node find.mjs {report-or-tracker-number}` ile çözümle.

Her iki karşılaştırma kaynağı da varsa `npm run jd:similarity -- {bundle-root}/jd/current.md {bundle-root}/jd/previous.md` çalıştır. Görünür kararı (`reuse`, `reuse-with-edits` veya `regenerate`), puanı, kaynak CV/JD yollarını ve değişen bölümleri `decision/reuse.json` içine kaydet. 4.0/5'in altında puan alan başvuruları güçlü biçimde caydır ve yalnızca kullanıcı bu öneriyi açıkça geçersiz kılarsa devam et. Yeniden kullanımı yalnızca görünür bir `reuse` sonucundan veya açık bir kullanıcı onayından sonra yap; bir kaynak eksikken asla sessizce yeniden kullanma. PDF manifesti bu iç içe yolları destekler ve onları rapora bağlamaya devam eder. Düz `output/` yolları tek seferlik PDF'ler için geçerliliğini korur.

1. `cv.md` dosyasını tek gerçek kaynak (source of truth) olarak oku.
2. JD (İş Tanımı) bağlamda yoksa (metin veya URL olarak) kullanıcıdan iste.
   Yeni bir ilan için (henüz takipçi satırı yoksa), taslağa başlamadan önce bir kez `node precheck-duplicate.mjs --company "$COMPANY" --title "$TITLE" [--url "$URL"] [--req "$REQ"]` çalıştır (salt okunur, yalnızca tavsiye niteliğinde; JD URL olarak geldiyse `--url`, ilanda bir talep (requisition) kimliği görünüyorsa `--req` ver; her değişkeni ilandan tek tırnakla ata veya bir argüman dizisi geçir, ilan metnini asla komut dizesine yapıştırma) ve bulunan her eşleşmeyi kullanıcıya göster.
3. JD içinden 15-20 anahtar kelime çıkar.
4. Herhangi bir taslak yazmadan önce LLM kullanmayan beceri boşluğu (skill-gap) kontrolünü çalıştır: JD'yi **her zaman** önce `jds/{slug}.md` dosyasına yaz (bu başvuru için zaten bir rapor olsa bile koşullu değil, zorunludur), ardından `node jd-skill-gap.mjs jds/{slug}.md --summary` çalıştır. Bu komut JD'nin açık gereksinimlerini `cv.md`'ye göre üç gruba ayırır; `result.gap` öğelerini asla adayda varmış gibi sunma:
   - **JD arşivi (zorunlu, #2789):** bu yazma işlemi aynı zamanda bu başvurunun JD arşividir. Tek başına bir `**URL:**` başlığı arşiv değil, canlı bir işaretçidir; ilan kapandığında bozulur. Bu çalıştırma tam bir `is-ilani` (`oferta`) değerlendirmesinin parçasıysa, raporun kendi `## Job Description (archived verbatim)` bölümü birincil arşivdir ve bu `jds/{slug}.md` yazması ikincil bir kopyadır; `pdf` tek başına (rapor olmadan) çalıştırıldığında bu dosya arşivin TA KENDİSİDİR, bu yüzden bir rapor numarası varsa dosyayı `archive-posting.mjs --report={num}` ile rapora göre adlandırmayı/anahtarlamayı tercih et. `check-jd-archive.mjs` her raporun bu iki biçimden birine sahip olduğunu doğrular. Birebir başlığın altına ilanı asla başka sözcüklerle yazma: tamamını alıntılayamıyorsan aşağıdaki komutla `archive-posting.mjs` üzerinden yakala ve onun yerine ortaya çıkan arşiv referansını kullan. URL'yi, slug'ı veya rapor numarasını tırnak içinde bile olsa asla bir komut satırına yazma (`modes/oferta.md`, **Command arguments**): bağımsız bir çalıştırma için dosya aracınla bir JSON dosyasına `{"url": "…"}`, bir rapor numarası varsa `{"url": "…", "company": "{company-slug}", "report": "{num}"}` yaz (slug rapor dosya adından gelir), ardından her değeri kontrol edip her birini kabuk (shell) olmadan ayrı bir argüman olarak geçiren komutu çalıştır. Kaynakta herhangi bir yerde bir ilan tarihi görünüyorsa (URL'den alınan sayfa metni, yapıştırılan JD metni veya metne dökülen bir ekran görüntüsü), bunu dosyanın ilk satırı olarak ekle: `Posted: {date or relative string as shown}`; tarih yoksa `Posted: not visible in source`. Bunun yerine raporun dosya sistemindeki değiştirilme/oluşturulma zamanını asla kullanma: o, adayın JD'yi işlediği zamanı kaydeder, işverenin ilanı yayımladığı zamanı değil.

     ```bash
     node --input-type=module -e '
     import { readFileSync } from "node:fs";
     import { spawnSync } from "node:child_process";
     const p = JSON.parse(readFileSync(process.argv[1] ?? 0, "utf8"));
     const fail = msg => { console.error("archive-posting: " + msg); process.exit(1); };
     if (p === null || typeof p !== "object" || Array.isArray(p)) fail("the JSON file must hold one object");
     if (typeof p.url !== "string" || !/^https?:\/\//i.test(p.url)) fail("url must be an http(s) URL");
     const args = ["archive-posting.mjs", p.url];
     if (p.company != null) { if (typeof p.company !== "string" || !/^[a-z0-9-]+$/.test(p.company)) fail("company must match ^[a-z0-9-]+$"); args.push("--company=" + p.company); }
     if (p.report != null) { if (!/^[0-9]+$/.test(String(p.report))) fail("report must be a report number"); args.push("--report=" + p.report); }
     process.exit(spawnSync(process.execPath, args, { stdio: "inherit" }).status ?? 1);
     ' {json-file}
     ```
   - `existing`: cv.md'nin Skills bölümünde zaten adı geçen bir beceri; öne çıkarmak güvenlidir
   - `supportedByResume`: henüz adı geçen bir beceri değil, ama cv.md'nin metni bunu zaten gösteriyor; kullanıcının kendi sözcükleriyle Skills bölümüne eklenebilecek meşru adaylardır (13. adımdaki yetkinlik ızgarası önce buradan beslenir)
   - `gap`: cv.md'de hiçbir izi yok. **CV'yi üretmeden önce hangi becerilerin boşluk olduğunu kullanıcıya açıkça söyle.** Bir boşluğu uydurma bir iddiayla asla örtme ve konuşmadan sessizce çıkarma; devam edip etmeyeceğine, konuyu ön yazıda/mülakatta ele alıp almayacağına veya rolü atlayıp atlamayacağına kullanıcı karar verir

   Çıktı bir `🚨 LOW CONFIDENCE` bloğu yazdırırsa hiçbir beceri sınıflandırılmamıştır; üç boş grup "boşluk bulunamadı" değil "hiçbir şey sınıflandırılmadı" demektir. **Gerekçe ne olursa olsun bunu asla geçti sayma.** Taslağa başlamadan önce gerekli becerileri belirlemek için JD'yi kendin oku ve kullanıcıya otomatik kontrolün sonuç üretmediğini söyle. Gerekçe kodu üç durumdan hangisi olduğunu belirtir:
   - `no-requirements-section`: hiçbir gereksinim bölümü tanınmadı, yani hiç metin taranmadı
   - `no-skill-candidates`: bir gereksinim bölümü tarandı ama içinden beceri adayı çıkmadı. Bu, becerilerin sözlükte olmadığı anlamına gelmez; çıkarıcı yalnızca büyük harfle başlayan sözcükleri alır, bu yüzden küçük harfli bir madde hiçbir şey vermez
   - `empty-jd`: JD dosyası boş, okunacak bir şey yoktu. Devam etmeden önce dosyanın doğru yazıldığını kontrol et

   > ⚠️ **Beceri boşluğu kontrolü sonuçsuz:** [{language.output} dilinde yaz: otomatik beceri boşluğu kontrolünün bu JD için sınıflandırılmış hiçbir beceri döndürmediğini ve bu yüzden "boşluk yok" olarak okunamayacağını belirt; gerekçe kodundan üç durumdan hangisinin oluştuğunu söyle (gereksinim bölümü hiç bulunamadı, bulundu ama aday çıkarılamadı ya da JD dosyası boştu); boş dosya durumunda JD'nin doğru kaydedilmemiş olabileceğini ve kontrol edilmesi gerektiğini söyle; diğer durumlarda taslağa başlamadan önce gerekli becerileri belirlemek için JD'yi doğrudan okuyacağını söyle. CLI'ın İngilizce tanı mesajını kullanıcıya yönelik mesajın dışında tut.]
5. CV dili için `language.output` kullan. JD dili ve `language.modes_dir` pazar terminolojisi ve değerlendirme bağlamı sağlar, ancak yapılandırılmış çıktı dilini asla geçersiz kılmaz.
6. Şirket konumunu tespit et → kağıt boyutu. `config/profile.yml` dosyası `page_format` değerini `letter` veya `a4` olarak ayarlıyorsa (büyük/küçük harf ve çevresindeki boşluklar fark etmez) bu adımı atla; bu, kullanıcının kalıcı yanıtıdır ve zaten her oluşturucuya ulaşır. Oradaki başka herhangi bir değer, `auto` hariç (aşağıda), yok sayılır; bu yüzden tespit etmeye devam et.
   - ABD/Kanada → `letter`
   - Dünyanın geri kalanı → `a4`
   - `page_format` değeri `auto` olduğunda kağıdı kendin seçme. İşe alan tüzel kişinin ülkesini değerlendirmenin pazar sinyallerinden oku (yargı yetkisi, para birimi, yan haklar ve hukuki terimler; uzaktan bir rol için belgeyi alan tüzel kişi) ve yükteki `country` değerini ISO 3166-1 alpha-2 koduna ayarla, örn. `"DE"`. AYNI kodu `generate-pdf.mjs --country=DE` seçeneğine (veya toplu iş girdisinin `country` alanına) ver ve `--format` seçeneğini kullanma, çünkü açık bir `--format`, `auto`'nun önüne geçer. Böylece gövde ile kağıt eşleşir. Oluşturucular eşlemeyi yapar: Unicode CLDR'nin birincil boyut olarak US Letter listelediği ülkeler için Letter (`lib/page-format.mjs` içindeki `LETTER_COUNTRIES`), diğer tüm ülkeler için A4. Ülkeyi belirleyemiyorsan `country` alanını çıkar; proje varsayılanı uygulanır.
7. Rol arketipini tespit et → çerçevelemeyi uyarla.
8. Uyarlamadan önce isteğe bağlı olarak yeni JD'yi en son uyarlanmış CV veya JD ile karşılaştır. Önce başvuruyu/raporu `node find.mjs {report-or-tracker-number}` ile çözümle. Çözümlenen rapor/JD anlık görüntüsünü `{new-jd.txt}`, referans verilen önceki CV'yi veya JD'yi `{previous-jd-or-cv.txt}` olarak kullan; kaynaklardan biri bulunamazsa bir CV'yi sessizce yeniden kullanma. `npm run jd:similarity -- {new-jd.txt} {previous-jd-or-cv.txt}` çalıştır ve `decision` ile `score` değerlerini göster. Yeniden kullanım yalnızca öneri `reuse` olduğunda veya kullanıcı bunu açıkça geçersiz kıldığında yapılabilir; `reuse-with-edits` yine listelenen düzenlemeleri gerektirir, `regenerate` ise normal uyarlama akışını gerektirir.
9. `modes/heuristics/recruiter-side.md` dosyasını kullanarak JD'den işe alımcı tarafına yönelik şirket içi bir risk haritası oluştur: olası şüpheler, eşleşen kanıtlar ve her şüpheyi hangi belge bölümünün gidereceği.
10. Profesyonel Özeti (Professional Summary), JD anahtar kelimelerini ve adayın `config/profile.yml` → `narrative.exit_story` ile `modes/_profile.md` içindeki "Your Exit Narrative" bölümünde yer alan çıkış anlatısını ekleyerek yeniden yaz; dolu olan kullanıcı kaynaklarını hedef rolün alanına uyarlayarak kullan ve asla bir çıkış veya kurucu hikayesi uydurma.
11. İş için en alakalı ilk 3-4 projeyi seç. `cv.md` bir Awards / Honors bölümü içeriyorsa, `awards[]` alanını bu rolü destekleyen girdilerle doldur; kariyerinin başındaki bir aday için bir yarışma madalyası veya onur listesi çoğu zaman zayıf bir projeden daha değerlidir. Listelenecek bir şey yoksa anahtarı çıkar, bölüm tamamen kaybolur; boşluğu doldurmak için asla bir ödül uydurma.
12. Deneyim maddelerini JD ilgisine ve risk haritasına göre yeniden sırala: en güçlü eşleşen kanıt en başa.
13. JD gereksinimlerinden yetkinlik ızgarasını oluştur (6-8 anahtar kelime öbeği); 4. adımdaki `existing` ve `supportedByResume` becerilerine öncelik ver, asla bir `gap` becerisi koyma.
14. Anahtar kelimeleri mevcut başarılara doğal biçimde yerleştir (ASLA uydurma).
15. `modes/heuristics/recruiter-side.md` içindeki altı saniyelik netlik kapısını uygula: üstteki üçte birlik kısım hedef rolü, en güçlü uyumu ve kanıtı apaçık göstermelidir.
16. `config/profile.yml` dosyasından `name` değerini oku → küçük harfli kebab-case'e dönüştür (örn. "John Doe" → "john-doe") → `{candidate}`
17. Uyarlanmış içerikten oluşturma yükünü (render payload) kur (aşağıdaki **JSON Girdi Şeması**'na bak): tam HTML biçimlendirmesi **değil**, sıkı yapılandırılmış JSON üret ve `/tmp/cv-{candidate}-{company}.json` dosyasına yaz. Bu çalıştırma için zaten bir rapor numarası atanmışsa (auto-pipeline, batch veya AGENTS.md "Parallel fan-outs" kapsamındaki herhangi bir paralel dağıtım), onu ekle: `/tmp/cv-{candidate}-{report}-{company}.json`. Aksi halde aynı gün aynı şirketle ilgilenen iki paralel ajan (aynı işverende iki ilan) *aynı* geçici yola yazar ve birbirlerinin JSON'unu sessizce okuyabilir. Sonraki bir adım `/tmp/cv-{candidate}-{company}.json` (veya `-ats` varyantını) andığı her yerde, varsa `-{report}` parçası dahil bu aynı yolu kullan.
17a. Herhangi bir şey oluşturmadan önce LLM kullanmayan başlık tutarlılığı kontrolünü çalıştır: `node cv-title-check.mjs /tmp/cv-{candidate}[-{report}]-{company}.json --summary`. Bu komut yükteki her `experience[]` girdisini `cv.md`'nin aynı `{company, dates}` için tuttuğu girdiyle eşleştirir ve cv.md'deki kanonik başlık dizesiyle artık birebir eşleşmeyen her `role` değerini işaretler (yalnızca büyük/küçük harf ve boşluk normalleştirilir; asla bulanık veya "yeterince yakın" bir eşleşme yapılmaz). Bu kontrol 4. adımdaki beceri boşluğu kontrolünden daha dardır ve onun yerini tutmaz: maddeleri yeniden sıralamak, özeti yeniden çerçevelemek ve başarılara JD anahtar kelimeleri yerleştirmek meşru yeniden ifade etmedir; aynı işin **unvanının** sessizce daha kıdemli görünen birine kayması ise meşru değildir ve bu kontrolün yakalamak için var olduğu tek şey de budur.
    - `⚠️` çıktısı en az bir başlık uyuşmazlığı bulunduğu anlamına gelir. Her biri için devam etmeden önce şunu göster:

      > ⚠️ **Başlık uyuşmazlığı:** [{language.output} dilinde yaz: uyarlanmış CV'de "{company} ({dates})" için yazan başlığın, cv.md'nin aynı iş için tuttuğu kanonik başlıktan farklı olduğunu belirt; iki başlık dizesini de birebir, değişmez veri olarak alıntıla (asla çevirme veya başka sözcüklerle yazma): cv.md'deki başlık "{cvTitle}" ve uyarlanmış CV'deki başlık "{tailoredTitle}"; ardından bunun korunacak bilinçli bir çerçeveleme mi, yoksa cv.md'deki başlığa geri döndürülecek istenmeyen bir kayma mı olduğunu sor. Asla sessizce bir tarafı seçme.]

      CLI'ın belirsiz olarak bildirdiği bir anahtar (aynı `{company, dates}` değerini paylaşan birden fazla cv.md veya uyarlanmış CV girdisi) temiz bir uyuşmazlık değildir ve öyle sunulmamalıdır; aynı şekilde göster, ama "{company} ({dates})" için bir veya iki tarafta birden fazla başlık bulunduğunu ve otomatik kontrolün hangi çifti karşılaştıracağını belirleyemediğini açıkça söyle; kullanıcı bunu `cv.md`'yi ve yükü doğrudan kontrol ederek çözmelidir.
    - `✅` çıktısı eşleşen her girdinin başlığının değişmediği anlamına gelir; yorum yapmadan devam et.
    - `⚠️ ... title check did not run` hiçbir şeyin karşılaştırılmadığı anlamına gelir: ya `cv.md`'nin Experience bölümü ayrıştırılamadı ya da hiçbir yük girdisi `{company, dates}` üzerinden bir cv.md girdisiyle eşleşmedi. Bu bir geçiş değildir. Devam etmeden önce şunu göster:

      > ⚠️ **Başlık kontrolü çalışmadı:** [{language.output} dilinde yaz: başlık tutarlılığı kontrolünün hiçbir girdiyi karşılaştırmadığını, bu yüzden bu uyarlanmış CV'deki hiçbir iş unvanının cv.md'ye göre kontrol edilmediğini belirt; CLI'ın gerekçesini tekrarla; kullanıcıdan her başlığı doğrudan cv.md'ye göre doğrulamasını iste ve gerekçe cv.md'nin ayrıştırılamaması ise `node doctor.mjs` çalıştırmasını öner.]

    - Kontrolün bir cv.md girdisiyle eşleştiremediği girdiler (örn. karakter karakter örtüşmeyen bir tarih ifadesi) uyuşmazlık olarak değil, ayrıca eşleşmemiş olarak bildirilir; kontrol edilmemişlerdir, bu yüzden kullanıcıya geçmiş gibi sunma. Her birini göster:

      > ⚠️ **Eşleşmemiş girdi:** [{language.output} dilinde yaz: "{company} ({dates})" için bu deneyim girdisinin bir cv.md girdisiyle eşleştirilemediğini, bu yüzden başlığının kontrol edilmediğini belirt ve kullanıcıdan bunu doğrudan cv.md'ye göre doğrulamasını iste; `{company}` ve `{dates}` değerlerini değişmez veri olarak koru, asla çevirme veya başka sözcüklerle yazma.]

      İncelenmemiş bir eşleşmemiş girdi temiz bir sonuç değildir.
    - Bu kontrol, tamamlanan karşılaştırmalar için yalnızca uyarı verir: uyuşmazlıklar, belirsiz gruplar ve eşleşmemiş girdiler ardışık düzeni durdurmaz. Komut başarısız olursa (`cv.md` veya yük okunamıyor ya da ayrıştırılamıyorsa veya yükteki bir `experience[]` girdisinde `company`, `role` ya da `dates` eksikse), bu geçilip devam edilecek bir uyarı değildir: dur, girdiyi onar ve devam etmeden önce kontrolü yeniden çalıştır. 18. adıma yalnızca kullanıcıya bu çalıştırmadaki her uyuşmazlık, belirsiz grup ve eşleşmemiş girdi gösterildikten sonra geç (yalnızca uyuşmazlıklar ve belirsiz gruplar değil); kullanıcı bunları korumayı, geri döndürmeyi, çözmeyi veya eşleşmemiş bir girdiyi incelenemez olarak kabul etmeyi seçebilir.
17b. Yapı kontrolünü yüke karşı çalıştır: `node verify-cv-structure.mjs /tmp/cv-{candidate}[-{report}]-{company}.json`
    - Bu, HTML oluşturulmadan önce verilen bir uyarıdır, kesin bir kapı değildir. `verify-cv-facts.mjs` (19. adım) *uydurmayı* (cv.md'de olmayan bir iddiayı) engeller; bu kontrol ise uydurma denetiminin göremediği ters hatayı işaretler: uyarlama sırasında cv.md içeriğinin sessizce *kaybolması* veya *yeniden sıralanması*. Bir deneyim girdisinin şirket tanımının (`"Austin, TX · Series B fintech"`) çıplak bir şehir/eyalete indirilmesini ve bir deneyim girdisinin (çoğunlukla Career Break) cv.md'nin kendi kronolojik sırasının dışında oluşturulmasını yakalar.
    - `## Experience`, `## Work Experience`, `## Professional Experience`, `## Employment History` ve `## Work History` bölümlerini tanır; bu bölümlerdeki `### Company {—|–|--|-} Location[ · descriptor]` başlıkları uzun tire, orta tire, çift kısa çizgi veya tek kısa çizgi kullanabilir ve düz ya da Pandoc Markdown olarak yazılabilir (`## **[Experience]{.smallcaps}**`, `### **Co** --- City`); başka biçimde yazılmış bir `cv.md` ihlal değil `UNVERIFIED` bildirir. Gerçek bir bulgu için uyarı verirse muhakemeni kullan: kayıp istenmeden olduysa yükü cv.md'deki tanım metni ve girdi sırasıyla eşleşecek şekilde düzelt, bilinçli bir uyarlama tercihiyse devam et (örn. tanım bu JD'ye gerçekten uymuyorsa). Yapısal geçiş, uyarı veya `UNVERIFIED` sonucu her zaman 0 koduyla çıkar ve 18. adımı asla engellemez; ama bir CLI/girdi hatası (eksik veya okunamayan yük/kaynak dosyası, geçersiz JSON veya bozuk yük biçimi) 1 koduyla çıkar, yani kontrolün kendisi çalışamamıştır; bunu sıradan bir uyarı gibi geçme, çağrıyı düzelt.
    - Bu yalnızca yapıyı (sıra, tanımın varlığı) kontrol eder; cv.md'nin taşıdığı her alanı kontrol etmez (örn. beceri kategorisi seçimi veya eğitim açıklamaları role göre bir muhakeme konusudur, kesin bir kapı değildir). Yine de HTML'i oluşturmadan önce tüm yükü bir kez cv.md'nin gerçek içeriğiyle karşılaştır: rol için belirli bir neden olmadıkça her beceri kategorisini taşı ve girdileri çıplak başlık/kurum/yıl'a sıkıştırmak yerine eğitimin `description` metnini koru.
18. `node build-cv-html.mjs /tmp/cv-{candidate}[-{report}]-{company}.json {html-path} {template}` çalıştır. Burada `{html-path}` etkin paketin `cv/tailored/vNNN/cv.html` yolu veya tek seferlik bir CV için `output/{cv-stem}.html`, `{template}` ise aşağıdaki **Şablonu seçme** adımının yazdırdığı yoldur (temel şablonu kullanmak için çıkar). Betik her etiketin, CSS sınıfının ve HTML kaçışının (escaping) sahibidir. HTML'i geçici depolamanın dışında tut, çünkü kontrol panelinin `D` kısayol tuşu yeniden oluşturmayı ondan yapar.

    **Adlandırma standardı (#6667).** `{cv-stem}` şudur: `{report}-{company}-cv-{candidate}-{YYYY-MM-DD}`. `{report}` 3 haneye sıfırla doldurulmuş rapor numarası; `{company}` takipçideki şirket adının slug'ı (kebab-case, `web/src/lib/company-slug.mjs` içindeki `companySlug` nasıl kuruyorsa öyle), asla tam rapor slug'ı değil; o slug rolü taşıyabilir (`024-zep-head-of-fde`) ve Apply ile kontrol panelinin kullandığı tam şirket eşleşmesini bozar; `{candidate}` `config/profile.yml` dosyasındaki kebab-case ad; tarih bugünün tarihidir. Bir CV'nin tüm dosyaları aynı gövdeyi (stem) paylaşır ve yalnızca varyant sonekiyle (`-ats`, `-canva`) ve uzantıyla ayrılır, böylece `output/` rapor numarasına göre sıralanır. Gövdeyi `lib/output-names.mjs` içindeki `buildOutputName()` ile kur; şirket veya aday adı bir `cv` ya da `cover` sözcüğü taşıdığında `Ambiguous name` hatası fırlatır. O durumda (ve hiç rapor numarası olmadığında; toplu veya paralel bir çalıştırmada asla) eski `cv-{candidate}-{company}-{YYYY-MM-DD}` gövdesini kullan. `node check-output-names.mjs`, `output/` klasörünü bu standarda göre denetler.
19. Oluşturulan HTML'e karşı bilgi doğrulama kapısını (fact gate) çalıştır: `node verify-cv-facts.mjs {html-path}`
    - Bu, PDF oluşturmadan önceki kesin bir kapıdır.
    - Başarısız olursa dur ve oluşturulan HTML'i, uydurulmuş metrikleri kaldırarak veya doğrulanmış kanıtı `cv.md`, `article-digest.md` ya da `config/cv-facts.json` dosyasına ekleyerek düzelt.
    - Bir `drift` bulgusu, bir maddenin kaynak maddesinin anahtar kelimelerini koruduğu ama bir cümleciğe o kaynak maddenin kullanmadığı bir fiille başladığı anlamına gelir ("Used Kafka …" ifadesinin "Led a Kafka migration …" olarak yazılması). Kaynak maddenin fiilini geri getir. Bir fiil değişimini yalnızca kullanıcı beyan eder: `config/cv-facts.json` içindeki `allow_swaps` alanına bir `"source verb -> CV verb"` girdisi eklemeden önce sor ve kapıyı geçmek için asla böyle bir girdi ekleme.
20. **İşe alım yöneticisi denetimi: varsayılan olarak kapalı, yalnızca isteğe bağlı.** `modes/pdf/hm-audit.md` dosyasını yalnızca ve yalnızca şunlardan biri doğruysa çalıştır; aksi halde sormadan doğrudan 21. adıma geç.
    - Çağrı `--hm-audit` içeriyordu (`/career-ops pdf --hm-audit` veya doğal dildeki bir istekte aynı bayrak).
    - `modes/_custom.md` bunu bir kural olarak açıyor.

    Bilgi doğrulama kapısı hiçbir şeyin uydurulmadığını kanıtlar; bunların rol için *doğru* maddeler olup olmadığını söyleyemez. Denetim olası değerlendiriciyi araştırır, onu canlandıran ayrı bir alt ajan çalıştırır ve madde madde koru/kes/yeniden yaz kararı ile açık sözlü bir "bunu bir ön görüşmeye geçirir miydim?" yanıtı döndürür. Uyarlamanın üstüne bir alt ajan çağrısı ve web araştırması ekler; bu yüzden her PDF'te çalışmaz, isteğe bağlı olarak açılır.

    Denetim önerir; kullanıcı karar verir. Kullanıcı herhangi bir yeniden yazımı kabul ederse 17. adıma dön, yükü ve HTML'i yeniden oluştur ve oluşturmadan önce bilgi doğrulama kapısını yeniden çalıştır. Denetim yalnızca bu karar belli olduktan sonra kaydedilir ve hangi yeniden yazımların uygulandığını belirtir; böylece `## HM Audit` bölümü oluşturulan PDF'in artık uymadığı bir CV'yi asla anlatmaz. Denetimi yeniden oluşturulan CV'ye karşı tekrar çalıştırma: ikinci bir çağrı, kullanıcının zaten üzerine karar verdiği bir sonuç için maliyeti ikiye katlar.
21. Yürüt: `node generate-pdf.mjs {html-path} {pdf-path} --format={letter|a4} --report={report number}`. `page_format` değeri `auto` olduğunda `--format` seçeneğini kaldır ve yükün taşıdığı aynı kodla `--country={code}` ver, çünkü açık bir `--format`, `auto`'nun önüne geçer. Burada `{pdf-path}` etkin paketin `cv/tailored/vNNN/cv.pdf` yolu veya tek seferlik bir CV için `output/{cv-stem}.pdf` yoludur. `{report number}`, takipçideki `#` sütunu DEĞİL, rapor dosya adındaki/bağlantısındaki NNN'dir (örn. `reports/008-acme-….md` için `008`). Başvurunun bir raporu varsa (veya olacaksa) bunu her zaman ver; kontrol panelinin iç içe veya düz HTML/PDF çiftini birebir açıp yeniden oluşturabilmesi için PDF↔rapor bağlantısını `data/pdf-index.tsv` içine kaydeder. Yalnızca takipçi girdisi olmayan tek seferlik CV'lerde çıkar.
    - Oluşturulan PDF için varsayılan uyarı eşiği iki sayfadır. `--max-pages=N` pozitif bir tam sayı kabul eder; kullanıcı veya pazar tek sayfalık bir CV tercih ettiğinde `--max-pages=1` ver.
    - Bayrak verilmediğinde sayfa bütçesi, ayarlıysa `config/profile.yml` → `cv.max_pages` ve `cv.strict_pages` değerlerinden gelir (#6325) ve `📐 Page budget` satırı `from config/profile.yml` ile biter. Bu değerleri bayrak olarak tekrarlama. Tek bir oluşturma için verilen bayrak yine önceliklidir. Ayarlanmış ama kullanılamayan bir değer CV oluşturmayı `Invalid page budget in config/profile.yml: …` ile durdurur: bir bayrakla yeniden denemek yerine kullanıcıya hangi anahtarı düzeltmesi gerektiğini söyle. Kullanıcı her zaman tek sayfa istediğini söylediğinde, toplu iş çalışanları ve web arayüzü dahil her CV oluşturma yolunun bunu alması için `cv.max_pages: 1` değerini orada ayarla. Ön yazılar (`--kind=cover`) bayrak veya varsayılan bütçelerini korur, çünkü `cv.*` anahtarları onlar için geçerli değildir.
    - Oluşturulan PDF eşiğini aşarsa ve bütçe yalnızca uyarı düzeyindeyse (`--strict-pages` yok, `cv.strict_pages: true` yok), üretim gerçek ve izin verilen sayfa sayılarını kırpma önerileriyle birlikte uyarı olarak verir ve 0 koduyla çıkar, ama **`{pdf-path}` konumuna hiçbir şey yazılmaz** (#6377): çıktı inceleme için kardeş bir `{pdf-path minus .pdf}.overflow.pdf` taslağına gider (bu ad alınmışsa `.overflow-2.pdf` ve devamı), `{pdf-path}` konumunda zaten bulunan bir PDF olduğu gibi kalır, hiçbir `✅ PDF generated` satırı yazdırılmaz ve hiçbir şey indekslenmez. `⚠️  Overflow draft:` satırı taslağın adını verir. Bunu "henüz oluşturulmadı" olarak ele al: daha düşük öncelikli içeriği kırp, HTML'i yeniden oluştur, bilgi doğrulama kapısını yeniden çalıştır ve tekrar oluştur; yalnızca `{pdf-path}` konumuna düşen PDF'i bildir. Taslağı kullanıcıya asla teslim edilecek dosya olarak verme ve asla yeniden adlandırıp yerine koyma: o, bütçenin reddettiği sürümdür.
    - `--strict-pages` seçeneğini ver veya `cv.strict_pages: true` değerine güven; ama bunu yalnızca kullanıcı veya pazar kesin bir sınır istediğinde yap. Katı bir taşma, reddedilen çıktıyı inceleme için kardeş bir `{pdf-path minus .pdf}.overflow.pdf` taslağına yazar (bu ad alınmışsa `.overflow-2.pdf` ve devamı, böylece mevcut hiçbir dosyanın yerine geçilmez; hata mesajı kullandığı yolu belirtir), `{pdf-path}` konumunda zaten bulunan bir PDF'i değiştirmez ve onu başarılı olarak bildirmez ya da indekslemez; daha düşük öncelikli içeriği kırp ve yeniden çalıştır.
    - **Elle başvurular için yükleme kopyası.** Kullanıcı CV'yi web Apply akışıyla değil elle ekleyecekse (LinkedIn Easy Apply, Welcome to the Jungle, bir e-posta), `--upload-copy` ekle veya `config/profile.yml` içindeki `cv.upload_copy: true` değerine güven. Bu durumda bir CV oluşturma ayrıca `{pdf-path dir}/upload/{pdf-path stem}/First-Last-Role-CV.pdf` dosyasını yazar; bu, web Apply akışının yüklediği aynı işe alımcıya dönük addır (#6399): ad `candidate.full_name` değerinden, rol `--report` ile bağlı takipçi satırından (yoksa CV başlığından) gelir, ilk niteleyicide kesilir ve ad 64 karakteri aşacaksa rol çıkarılır. `--upload-role="Analytics Engineer"` rolü doğrudan ayarlar (ve `--upload-copy` anlamına gelir). `📎 Upload copy:` satırı dosyanın adını verir. Bu düz bir kopyadır: `{pdf-path}` kanonik dosya olarak kalır, kopyayla ilgili hiçbir şey `data/pdf-index.tsv` içinde indekslenmez ve yeniden oluşturma aynı kopyayı yeniler. Taşma taslağı, ön yazı veya `--batch` çalıştırması için kopya yazılmaz.
    - Work Experience en yeniden eskiye sıralı değilse üretim başarısız olur ve kendisinden yukarıdakinden daha geç başlayan rolün tarihlerini alıntılar. Rolleri ters kronolojik sırayla koyarak 17. adıma dön, HTML'i yeniden oluştur ve oluşturmadan önce bilgi doğrulama kapısını yeniden çalıştır; uyarlamayı rolleri taşıyarak değil, özet, yetkinlikler ve madde seçimiyle yap. Hatayı uyarıya çeviren `--allow-nonchronological` seçeneğini yalnızca kullanıcı açıkça kronolojik olmayan bir CV istediğinde ver.
21a. **ATS varyantı: varsayılan olarak kapalı, yalnızca isteğe bağlı.** Bu adımı yalnızca ve yalnızca çağrı `--ats` içeriyorsa (`/career-ops pdf --ats` veya doğal dildeki bir istekte aynı bayrak) ya da `modes/_custom.md` bunu bir kural olarak açıyorsa çalıştır; aksi halde sormadan doğrudan 22. adıma geç. 21. adımdan sonra çalışır, böylece yük son halindedir (20. adımdaki yeniden yazımlar zaten içindedir) ve biçimlendirilmiş CV tamamlanmıştır: varyant bir ektir ve buradaki bir hata biçimlendirilmiş HTML/PDF'e asla dokunmaz.
    - **Bu bir şablon değişimi değildir.** `ats` şablonu yükün değil, DOM'un sahibidir. `competencies[]`, ayrıştırıcıların tanımadığı bir başlık altında yalnızca CSS boşluğuyla ayrılmış etiketler olarak oluşturulur, bu yüzden şablon nasıl görünürse görünsün tamamen düşer. Önce yükü katla ve yalnızca bu kopyayı katla; biçimlendirilmiş yük yetkinlik ızgarasını korur:
      `node ats-payload.mjs /tmp/cv-{candidate}[-{report}]-{company}.json --summary > /tmp/cv-{candidate}[-{report}]-{company}-ats.json`
      Katlama, yetkinlikleri bir `skills[]` girdisine taşır (aynı bilgiler, virgülle ayrılmış, `Skills` altında) ve hiçbir şey uydurmaz. Üç lint kontrolü (`employer-in-role`, `parenthetical-in-company`, `multiple-date-ranges`) stderr'e yazdırılır ve betik tarafından **asla** uygulanmaz. Her bulguyu kullanıcıya göster ve kararı, 17a adımındaki gibi, ona bırak. Kullanıcının seçtiği bir düzeltme 17. adımdaki yüke gider ve her iki çıktı yeniden oluşturulur; ATS yükünü asla elle yamalama. 1 çıkış kodu, girdinin okunamadığı veya bozuk olduğu anlamına gelir. Dur ve bildir; yarım bir dosyadan oluşturma.
    - Şablonu `node cv-templates.mjs resolve cv ats` ile çözümle ve oluştur: `node build-cv-html.mjs /tmp/cv-{candidate}[-{report}]-{company}-ats.json output/{cv-stem}-ats.html {ats-template}`. Biçimlendirilmiş CV bir başvuru paketinde olsa bile çıktı yolu `output/` klasörüdür. Bu sürümde ATS varyantı eklenen değil yapıştırılan bir şeydir; bu yüzden ne bir paket çıktısıdır ne de takipçinin `PDF` sütunudur. O sütun hâlâ yalnızca biçimlendirilmiş PDF'ten okur.
    - Kapıdan geçir: `node verify-cv-facts.mjs output/{cv-stem}-ats.html`. Katlama bir iddia ekleyemez, ama 19. adım bir kapı hatasının biçimlendirilmiş **HTML** içinde düzeltilmesine izin verir ve orada yapılan bir düzeltme bu varyantın oluşturulduğu JSON'a hiçbir zaman ulaşmaz. Varyantı kapıdan geçirmek bu kaymayı yakalar. Başarısız olursa 17. adımdaki yükü düzelt (HTML dosyalarından herhangi birini değil), ikisini de yeniden oluştur ve iki kapıyı da yeniden çalıştır.
    - Varsayılan olarak PDF yok: kullanıcı metni HTML'den kopyalar. Yüklenebilir bir dosya da isterse `node generate-pdf.mjs output/{cv-stem}-ats.html output/{cv-stem}.ats.pdf --format={letter|a4}` komutunu `--report` **olmadan** çalıştır. `.ats.pdf` soneki ATS dosyasını belirtir, böylece Apply onu biçimlendirilmiş CV olarak yüklemez. `page_format: auto` altında `--format` yerine `--country={code}` kullan. `--report` ile ATS PDF'i rapora göre indekslenir ve kontrol panelinin açıp yeniden oluşturduğu biçimlendirilmiş çiftin yerini alırdı.
21b. **Başarılı bir oluşturmadan sonra temizlik yap.** PDF oluştuğunda ve kapılar geçildiğinde, 17. adımda yazılan oluşturma yükü JSON dosyalarını (21a adımındaki `-ats` yükü dahil) ve tuttuğun her oluşturma günlüğünü sil. Bunlar geçicidir ve asla `output/` içine ait değildir. Oluşturma başarısız olduysa, yeniden deneme onları kullansın diye sakla. Saklamak istediğin diğer çalışma dosyaları (company-history veya role-clarity JSON'u, bir CV değişiklik önerisi) `DATA_CONTRACT.md` içindeki kurala göre `output/diagnostics/` altına gider, asla dağınık biçimde `output/` içine değil.
22. **Uyarlanmış** CV'nin ATS anahtar kelime kapsamını, (varsa) rolün değerlendirme raporuna göre doğrula. Dosya aracınla bir JSON dosyasına `{"report": "reports/{###}-{company-slug}-{YYYY-MM-DD}.md", "cv": "{html-path}"}` yaz ve aşağıdaki komutu çalıştır; iki yoldan hiçbirini tırnak içinde bile olsa asla bir komut satırına yazma (`modes/oferta.md`, **Command arguments**). `report`, raporun tam dosya adıdır (örn. `reports/008-acme-2026-09-28.md`), 21. adımdaki `--report` seçeneğinin aldığı çıplak NNN değil. Bu, az önce oluşturduğun HTML'den metni çıkarır ve kapsam yüzdesini, bulunan ve eksik anahtar kelimeleri bildirir: gönderilecek belgenin tanısı. Eksik anahtar kelimeleri kullanıcıya göster (gerçek deneyimden yeniden ifade et, asla uydurma). Raporda anahtar kelime bölümü yoksa komut stderr'e bir `⚠️` satırı yazdırır ve bunun yerine raporun arşivlenmiş JD'sinde bulduğu becerileri puanlar. Bu bir geçiş değil, rapordaki bir kusurdur: kullanıcıya söyle ve rapora anahtar kelime bölümünü ekle. 1 koduyla çıkarsa kapsam kontrolü çalışmamıştır. Sayıyı atlamak yerine bunu 23. adımda söyle.

    ```bash
    node --input-type=module -e '
    import { readFileSync } from "node:fs";
    import { spawnSync } from "node:child_process";
    const p = JSON.parse(readFileSync(process.argv[1] ?? 0, "utf8"));
    const fail = msg => { console.error("keyword-match: " + msg); process.exit(1); };
    if (p === null || typeof p !== "object" || Array.isArray(p)) fail("the JSON file must hold one object");
    if (typeof p.report !== "string" || !/^reports\/[0-9]{3,}-[a-z0-9-]+-[0-9]{4}-[0-9]{2}-[0-9]{2}\.md$/.test(p.report)) fail("report must be reports/{###}-{company-slug}-{YYYY-MM-DD}.md");
    const args = ["keyword-match.mjs", p.report];
    if (p.cv != null) { if (typeof p.cv !== "string" || p.cv === "" || p.cv.startsWith("-")) fail("cv must be a file path"); args.push("--cv", p.cv); }
    process.exit(spawnSync(process.execPath, args, { stdio: "inherit" }).status ?? 1);
    ' {json-file}
    ```
23. Bildir: PDF yolu (ve `📎 Upload copy:` satırı bir kopya yolu yazdırdıysa, elle eklenecek dosya olarak o kopyanın yolu), sayfa sayısı, anahtar kelime kapsama yüzdesi ve anahtar kelimelerin rapordan mı yoksa arşivlenmiş JD'den mi geldiği (22. adım çalıştıysa), ATS varyantının HTML yolu ve kullanıcının açık bıraktığı lint bulguları (21a adımı çalıştıysa) ve 4. adımdan kalan, hâlâ ele alınmamış beceri boşlukları.

## ATS Kuralları (temiz ayrıştırma)

- Tek sütunlu düzen (kenar çubuğu yok, paralel sütun yok)
- Standart başlıklar: "Professional Summary", "Work Experience", "Education", "Skills", "Certifications", "Projects"
- İsteğe bağlı bölümler (Professional Summary, Core Competencies, Work Experience, Projects, Education, Certifications, Awards & Honors, Skills), dizileri boş veya yoksa, Professional Summary için de metni boş veya yalnızca boşluksa, başlıklarıyla birlikte tamamen düşürülür
- Resim/SVG içinde metin yok
- PDF üst bilgi/alt bilgi kısımlarında kritik bilgi yok (ATS bunları yok sayar)
- UTF-8, seçilebilir metin (rasterleştirilmiş değil)
- İç içe tablo yok
- JD anahtar kelimeleri dağıtılmış olmalı: Özet (ilk 5), her rolün ilk maddesi, Skills bölümü
- Gizli metin, anahtar kelime doldurma veya beyaz yazı hileleri yok. Ayrıştırılabilirlik artı insan incelemesi için optimize et.

Yukarıdaki maddeler kurallardır. `templates/ats-rules.yml` aynı kuralları veri olarak tutar: her birinin önem derecesini ve her biri için **"must not flag"** sözleşmesini, yani o kural için bir kontrolün hakkında sessiz kalması gereken şeyi taşır. Bir kuralı değiştirmeden veya bir lint bulgusunu okumadan önce onu oku; bir kural o dosya değişmeden eklenemez, kaldırılamaz veya susturulamaz ve her girdi uyguladığı İngilizce `modes/pdf.md` maddesini alıntılar, böylece ikisi birbirinden kopamaz.

**İsteğe bağlı şablon lint'i:** `node cv-templates.mjs lint cv [template-name]`, bir CV veya ön yazı şablonunu bu kurallara göre kontrol eder ve bulguları JSON olarak yazdırır. Tavsiye niteliğindedir, asla engel değildir: ne bulursa bulsun 0 koduyla çıkar ve bir oluşturmayı asla kapıdan geçirmez. Bugün üç kural uygulanmıştır: iç içe tablolar, gizli metin ve standart başlık listesi. Geri kalanlar YAML'da algılayıcısız durur, `skipped` altında gerekçesiyle bildirilir ve geçiş değil açık konulardır.

**Lint'in yakalayamadıkları** (YAML'da `cannot_catch` altında da var): lint bir şablonun HTML'ini okur, bu yüzden *oluşturulmuş metin katmanıyla* ilgili hiçbir şey kapsamında değildir. Ölçülmüş iki sınıf tamamen dışında kalır ve ikisi de yukarıdaki her maddeyi karşılar: `position:absolute` ile birleşen CSS `::before` üretilmiş içeriği (işaret glifi metin akışına hiç girmez) ve bir başlığı ayrı glif dizilerine bölen `letter-spacing` / `font-variant: small-caps` (`PROFESSIONAL SUMMARY`, `P R O F E S S I O N A L S U M M A RY` olarak çıkar). Bunları yakalamak oluşturulmuş bir PDF ve bir metin çıkarıcı gerektirir; bu proje `pdftotext -layout` ile çıkarır. Temiz bir lint, ATS geçişi değildir.

**İsteğe bağlı ayrıştırılabilirlik kontrolü:** HTML'i oluşturduktan sonra `node verify-ats.mjs {html-path}` ile ATS uygunluğunu puanlayabilirsin (bkz. `modes/ats.md`; `{html-path}`, 18. adımın yazdığı dosyadır, bir başvuru paketi için `cv/tailored/vNNN/cv.html`). Bu belirlenimci, salt okunur ve tavsiye niteliğindedir: 0-100 arası bir puan ve somut sorunlar bildirir ama üretimi asla engellemez (19. adımdaki `verify-cv-facts.mjs` bilgi doğrulama kapısının aksine).

`ats` modunun ayrıca daha önceki, **yük** düzeyinde bir aşaması vardır (`ats-payload.mjs`); bu aşama zorunlu olarak HTML oluşmadan, dolayısıyla yukarıdaki adımdan önce çalışır. Bu ardışık düzenin bir adımı **değildir** (`pdf`'in aynı geçişte bir ATS varyantı üretip üretmemesi #3202'de hâlâ açık), ama kullanıcı `ats` modunu isterse yalnızca puanı değil, iki aşama için de `modes/ats.md` dosyasını oku.

## İşe Alım Uzmanı İnceleme Kapıları (Recruiter Review Gates)

- Özet şu soruyu yanıtlamalıdır: "Bu kişi hangi rolü hedefliyor ve neden bu rolü?"
- İlk ekran, JD'nin en yüksek riskli gereksinimleriyle eşleşen 1-2 kanıt noktasını göstermelidir.
- Maddeler görev geçmişinden çok sonuçları, sistemleri, kullanıcıları veya iş etkilerini vurgulamalıdır.
- Konum, çalışma izni, maaş ve uygunluk gibi lojistik konular CV'de yalnızca pazar ve profil için uygunsa yer almalıdır; aksi halde bunları form yanıtlarında veya işe alımcı konuşma metinlerinde ele al.

## PDF Tasarımı

- **Fonts**: Yapay kelime boşlukları olmadan temiz PDF metin çıkarımı için ATS'ye uygun sistem sans yığını (`"Liberation Sans", 'Helvetica Neue', Arial, 'DejaVu Sans', sans-serif`); `config/profile.yml` içindeki `style:` ile değiştirilebilir
- **Header**: 28px kalın isim + gradient çizgi `linear-gradient(to right, hsl(187,74%,32%), hsl(270,70%,45%))` 2px + iletişim satırı
- **Section headers**: 12px, büyük harf, letter-spacing 0.06em, birincil camgöbeği renk (`hsl(187, 74%, 32%)`)
- **Body**: 11px, line-height 1.5
- **Company names**: vurgu moru `hsl(270,70%,45%)`
- **Margins**: 0.6in
- **Background**: saf beyaz

## Bölüm sırası (optimize edilmiş "6 saniyelik İK taraması")

1. Header (büyük isim, gradient, iletişim, portfolyo bağlantısı)
2. Professional Summary (3-4 satır, anahtar kelime yoğun)
3. Core Competencies (esnek ızgarada 6-8 anahtar kelime öbeği)
4. Work Experience (ters kronolojik)
5. Projects (en alakalı ilk 3-4 proje)
6. Education & Certifications
7. Skills (diller + teknik)

## Anahtar kelime yerleştirme stratejisi (etik, gerçeğe dayalı)

Meşru yeniden ifade örnekleri:
- JD "RAG pipelines" diyor ve CV "LLM workflows with retrieval" diyorsa → "RAG pipeline design and LLM orchestration workflows" olarak değiştir.
- JD "reusable UI components" diyor ve CV "reusable React components" diyorsa → "reusable UI components with React" olarak değiştir.

**ASLA adayın sahip olmadığı becerileri ekleme. Gerçek deneyimi yalnızca JD'nin birebir sözcükleriyle yeniden ifade et; değiştirilen veya eşlenen bir terim aynı anlama gelmeli ve aynı rolle desteklenmeli, adayın gerçek kapsamını asla genişletmemelidir.**

## Şablon HTML (Template HTML)

**Üretmeden önce: `modes/_custom.md` dosyasını (varsa) oku ve biçim/içerik kurallarını bu oturumdaki her CV'ye, bir toplu işin her öğesi dahil, uygula.** Orada kayıtlı kurallar (tarih biçimleri, bölüm sırası tercihleri, her zaman eklenecek/asla eklenmeyecek içerik) öneri değil, kalıcı kullanıcı talimatlarıdır. Etkileşimli bir oturumda kullanıcı aynı şeyi konuşmada iki kez düzeltirse, bunu `retro` modu (`modes/retro.md`) üzerinden öner; bu mod `modes/_custom.md` dosyasına yalnızca kullanıcının kabul ettiği kuralları yazar. Toplu veya devredilmiş bir çalışan `modes/_custom.md`, `modes/_profile.md` veya `config/profile.yml` dosyasına asla yazmaz. Bunun yerine tercihi üst sürecine bildirir.

### Şablonu seçme

Hangi şablonun doldurulacağını paylaşılan çözümleyiciyle belirle (`cv-template.html` değerini sabit kodlama):

- Kullanıcı bu turda bir şablonun adını verdiyse (örn. "*modern* şablonu kullan"), şunu çalıştır:
  `node cv-templates.mjs resolve cv "<name>"`
- Aksi halde şunu çalıştır: `node cv-templates.mjs resolve cv`
  (bu, `config/profile.yml` içindeki `cv.template` varsayılanını, ayarlı değilse temel `cv-template.html` şablonunu döndürür).

Komut, doldurulacak şablonun mutlak yolunu yazdırır; sıfırdan farklı bir çıkış kodu, adı verilen şablonun eksik veya geçersiz olduğu anlamına gelir. Sessizce başka bir şablona geçmek yerine bu mesajı kullanıcıya göster.

Kullanıcıya seçeneklerini göstermek için (örn. "hangi CV şablonlarım var?"), `node cv-templates.mjs list cv` çalıştır ve her `displayName` değerini sun.

`build-cv-html.mjs`, çözümlenen o şablonu senin kurduğun JSON yüküyle doldurur. Her etiketin, CSS sınıfının ve HTML kaçışının sahibi odur, bu yüzden **asla tam HTML biçimlendirmesi üretme** ve `&`/`<`/`>`/tırnakları kendin kaçışlama. Çözümlenen yolu üçüncü argüman olarak ver (`node build-cv-html.mjs <input.json> <output.html> <template.html>`); temel `cv-template.html` şablonunu kullanmak için çıkar. Bu, `build-cv-latex.mjs` betiğinin HTML ikizidir (bkz. `modes/latex.md`) ve PDF adımının çıktı token'larını tam biçimlendirmeden aşağıdaki sıkı yüke indirir (#557).

### JSON Girdi Şeması

Bu yapıda bir JSON dosyası yaz, ardından `node build-cv-html.mjs <input.json> <output.html> [template.html]` çalıştır (isteğe bağlı üçüncü argüman **Şablonu seçme** adımından gelen şablon yoludur; temel `cv-template.html` için çıkar).

```json
{
  "lang": "en",
  "page_format": "letter",
  "candidate": {
    "name": "Jane Smith",
    "title": "Senior Backend Engineer",
    "phone": "+1 415 555 0100",
    "email": "jane@example.com",
    "linkedin": { "url": "https://linkedin.com/in/janesmith", "display": "linkedin.com/in/janesmith" },
    "github": { "url": "https://github.com/janesmith", "display": "github.com/janesmith" },
    "portfolio": { "url": "https://janesmith.dev", "display": "janesmith.dev" },
    "location": "San Francisco, CA",
    "photo": "",
    "photo_style": "rounded"
  },
  "sections": {
    "summary": "Professional Summary",
    "competencies": "Core Competencies",
    "experience": "Work Experience",
    "projects": "Projects",
    "education": "Education",
    "certifications": "Certifications",
    "awards": "Awards & Honors",
    "skills": "Skills"
  },
  "summary": "Personalized summary with JD keywords injected (honest vs cv.md).",
  "competencies": ["RAG Pipelines", "LLMOps", "Kubernetes & Docker"],
  "experience": [
    {
      "company": "Company Name",
      "role": "Job Title",
      "location": "Remote",
      "context": "Early-stage startup, ~40 people; acquired by BigCo in 2023.",
      "dates": "June 2022 - Present",
      "bullets": ["Achievement bullet with JD keywords injected", "Another quantified-impact bullet"]
    }
  ],
  "projects": [
    { "name": "Project Name", "url": "https://github.com/...", "badge": "Open Source", "tech": "Python, FastAPI", "description": "What it does." }
  ],
  "education": [
    { "title": "B.S. Computer Science", "org": "University Name", "location": "City, ST", "year": "2022", "description": "Optional line." }
  ],
  "certifications": [
    { "title": "Certified Kubernetes Administrator", "org": "CNCF", "year": "2024" }
  ],
  "awards": [
    { "title": "Gold Medal, International Olympiad in Informatics", "org": "IOI", "year": "2021" }
  ],
  "skills": [
    { "category": "Languages", "items": "Python, JavaScript, C++" },
    { "category": "Frameworks", "items": ["FastAPI", "React", "PyTorch"] }
  ]
}
```

### Alan başvurusu

| Alan | Tür | Notlar |
|-------|------|-------|
| `lang` | string | CV dil kodu (`en`, `es`, `zh-CN`, `ja`, `ar`). Dile özgü CSS'i belirler: `zh-CN` Basitleştirilmiş Çince yazı tiplerini ve katı CJK satır kırmayı, `ja` bir Japonca CJK yazı tipi yedeğini, `ar` RTL ve Arapça yazı tiplerini etkinleştirir. Varsayılan `en`. |
| `page_format` | string | `letter` → `8.5in` sayfa genişliği, `a4` → `210mm`. Çıkarırsan hem gövde genişliği hem kağıt `config/profile.yml` içindeki `page_format` değerine, o da yoksa `letter` değerine düşer. Ayarlarsan AYNI değeri `generate-pdf.mjs --format=<value>` seçeneğine ver ki gövde ile kağıt eşleşsin. |
| `country` | string | İsteğe bağlı. İşverenin ISO 3166-1 alpha-2 kodu (örn. `DE`). Yalnızca geçerli `page_format` değeri `auto` olduğunda okunur; aksi halde yok sayılır. |
| `candidate.name` | string | `profile.yml` dosyasından. |
| `candidate.title` | string | İsteğe bağlı, adın hemen altında gösterilen mesleki başlık (örn. "Senior Backend Engineer"). `config/profile.yml` içindeki `candidate.title` değerinden oku. Bir ATS adayı konumlandırmak için önce bunu okur; başlıksız bir CV okuyucuyu rolü tahmin etmeye zorlar. Çıkarırsan veya boş bırakırsan başlık öğesi olmaz, çıktı öncekiyle bayt bayt aynıdır. Adayın gerçek seviyesi destekliyorsa JD'nin kendi unvan ifadesine göre uyarla (asla şişirme). Yaklaşık 60 karakter veya daha kısa tut: bir cümle değil, bir iş unvanı ve iki üç anahtar kelime. Bazı başvuru portalları daha uzun değerleri reddeder ve `generate-pdf.mjs` 64 karakterin üstünde engellemeyen bir uyarı yazdırır. Çıktı PDF dosya adını da benzer şekilde kısa tut (64 karakter veya daha az). |
| `candidate.phone` | string | İsteğe bağlı: `tel:` bağlantısını ve ayırıcısını kaldırmak için **çıkar veya boş bırak** (boş hücre kalmaz). |
| `candidate.email` | string | `profile.yml` dosyasından. |
| `candidate.linkedin` | `{url, display}` | İsteğe bağlı: öğeyi ve ayırıcısını kaldırmak için çıkar. |
| `candidate.github` | `{url, display}` | İsteğe bağlı: öğeyi ve ayırıcısını kaldırmak için çıkar. |
| `candidate.portfolio` | `{url, display}` | İsteğe bağlı: öğeyi ve ayırıcısını kaldırmak için çıkar. |
| `candidate.location` | string | `profile.yml` dosyasından. |
| `candidate.photo` | string | İsteğe bağlı profil fotoğrafı (#264): yerel bir yol veya `data:` URL'si. Boşsa veya yoksa **hiçbir `<img>` üretilmez** ve çıktı fotoğrafsız düzenle piksel piksel aynıdır (ABD/İngiltere ve birçok pazardaki ATS fotoğrafları cezalandırır; DACH/Avrupa pazarları için aç). |
| `candidate.photo_style` | string | İsteğe bağlı fotoğraf çerçevesi: `rounded` (varsayılan), `circle` veya `square`. `config/profile.yml` içindeki `candidate.photo_style` değerinden oku; geçersiz değerler HTML yazılmadan önce hata verir. |
| `sections` | object | İsteğe bağlı yerelleştirilmiş bölüm başlıkları; çıkarılan her anahtar yukarıda gösterilen İngilizce varsayılana düşer. |
| `summary` | string | Anahtar kelimeli kişiselleştirilmiş özet. `**…**` vurgusunu destekler (aşağıdaki **Markdown kalın** bölümüne bak). |
| `competencies` | string[] | 6-8 anahtar kelime öbeği → yetkinlik etiketleri. |
| `experience[]` | object | `company`, `role`, `location` (isteğe bağlı), `context` (isteğe bağlı), `dates`, `bullets` (yeniden sıralanmış, anahtar kelime yerleştirilmiş; `**…**` vurgusu desteklenir). `context`, rolün hemen altında oluşturulan madde işaretsiz italik bir satırdır; bir başarı değil, şirket hakkında tek satırlık bir arka plan içindir (aşama, büyüklük, bir satın alma). Yalnızca `cv.md`'de zaten bulunan bilgileri kullan: o rol için hiçbir bilgi yoksa bir tane yazmak yerine `context` alanını çıkar. Kısa tut; başarıları `bullets` içinde tut. İsteğe bağlı bölüm: anahtarı çıkar veya `[]` ver, blok başlığıyla birlikte tamamen düşer. Yalnızca listelenecek mesleki geçmişi olmayan adaylar için (öğrenciler, yeni mezunlar, kariyer değiştirenler); bir boşluğu gizlemek için asla düşürme. |
| `projects[]` | object | `name`, `url` (isteğe bağlı proje/depo bağlantısı), `badge` (isteğe bağlı), `tech` (isteğe bağlı), `description` (bir `bullets` dizisi de kabul edilir ve açıklama satırında birleştirilir). |
| `education[]` | object | `title` (derece), `org` (kurum), `location` (isteğe bağlı, şehir/eyalet), `year`, `description` (isteğe bağlı). |
| `certifications[]` | object | `title`, `org`, `year`. |
| `awards[]` | object | `title` (ödül adı), `org` (veren kurum, isteğe bağlı), `year` (isteğe bağlı). İsteğe bağlı bölüm: anahtarı çıkar veya `[]` ver, blok başlığıyla birlikte tamamen düşer. Zayıf bir deneyim bölümünden daha fazla sinyal taşıyan yarışma veya akademik ödüller için kullan (olimpiyat madalyaları, hackathon birincilikleri, onur listesi). |
| `skills[]` | object | `items` (**zorunlu**): boş olmayan, virgülle ayrılmış bir dize veya boş olmayan dizelerden oluşan boş olmayan bir dizi; oluşturucu tüm diziyi birleştirdiği için her öğe metin olmalıdır. `category` (isteğe bağlı): çıkarılırsa satır ön eki olmadan oluşturulur. |
| `consent` | string | İsteğe bağlı GDPR/RODO onay alt bilgisi metni. Boşsa veya yoksa **görünür bir alt bilgi üretilmez** (`.cv-consent:empty { display: none }` CSS kuralı boş div'i ve üst kenarlığını gizler), böylece mevcut CV'ler değişmez. İsteğe bağlı `{{PHOTO}}` yuvası kalıbını izler (#264). |

`build-cv-html.mjs`, herhangi bir şablon yer tutucusu çözümlenmemiş kalırsa hata verir (sıfırdan farklı çıkış kodu); böylece bozuk bir yük, bozuk bir CV göndermek yerine yüksek sesle başarısız olur. Deneme oluşturması için `node build-cv-html.mjs --test` çalıştır.

**Yukarıdaki anahtar adları öneri değil, zorunludur (#3523).** Her liste bölümü (`experience`, `projects`, `education`, `certifications`, `awards`, `skills`) bu tabloda listelenen anahtarlardan oluşturulur. Yükün kökü bir nesne olmalıdır. Oluşturmadan önce `build-cv-html.mjs` her girdiyi doğrular:

- **Eksik veya boş zorunlu alan → kesin hata, sıfırdan farklı çıkış kodu, HTML yazılmaz.** Zorunlu alanlar: experience için `company` + `role`, projects için `name`, education, certifications ve awards için `title`, skills için `items` (boş olmayan bir dize veya bunlardan oluşan boş olmayan bir dizi; `category` isteğe bağlı kalır).
- **Hiçbir oluşturucunun okumadığı bir anahtar → stderr'de ve raporun `warnings[]` alanında uyarı;** oluşturma devam eder ve anahtar yok sayılır.
- **Oluşturucunun okumadığı üst düzey bir bölüm adı → en yakın bilinen anahtarı belirten uyarı.** `education` yerine `educations` içeren bir yük eskiden temiz doğrulanır ve bölümü sessizce düşürürdü; artık bunu söylüyor.
- **Seçilen şablonun yuvası olmadığı dolu bir bölüm → şablonun adını veren uyarı.** Gelen şablonlardan yalnızca `cv-template.html` `interests` bölümünü oluşturur, ATS ve `zh-minimal` şablonlarında `consent` alt bilgisi yoktur; bölümü içeren bir şablon seç veya bölümü çıkar.

LaTeX oluşturucusunun sözlüğünü **kullanma**: `institution`/`degree`/`dates`/`coursework`, bu şemanın değil `modes/latex.md` eğitim şemasının alanlarıdır; şirket için `employer` veya sertifika için `name` de kullanma. Böyle bir girdi eskiden rapor hâlâ `"valid": true` derken boş bir blok olarak oluşturulurdu ve CV'ler hiç eğitim bölümü olmadan gönderilirdi. Artık adıyla reddediliyor. Emin değilsen JSON raporundaki `counts.educationEntries` (ve kardeşleri) değerini kontrol et: orada sıfır, bölümün PDF'te boş olduğu anlamına gelir.

### Markdown kalın

Bir kısmı vurgulamak için `**…**` içine al; genellikle bir işe alımcının altı saniyelik taramada yakalaması gereken sayısal sonuç:

```json
"bullets": ["Cut p99 latency from 840 ms to **120 ms** across 14 services"]
```

`generate-pdf.mjs` bunu ATS normalleştirmesi sırasında `<strong>` etiketine dönüştürür (#1728) ve şablon hem özette hem iş maddelerinde biçimlendirir. HTML yolunda dönüşüm her metin düğümünü dolaşır, bu yüzden **her** alan `**…**` taşıyabilir.

**LaTeX ikizi daha dardır; bir yükü iki biçimde de kullanmadan önce `modes/latex.md` dosyasını kontrol et.** `build-cv-latex.mjs`, `**…**` ifadesini yalnızca bir `\resumeItem` içinde ürettiği yerlerde `\textbf{…}` olarak oluşturur (#3351): `experience[].bullets`, `projects[].bullets` ve `education[].coursework` satırı. Hiç `summary` alanı yoktur; `projects[].name`, `awards[].title` ve `skills[]` alanları `**` işaretlerini olduğu gibi yazdırır. Maddeler iki biçimde de aynı şekilde vurgulanır; başka hiçbir şey garanti değildir.

**Kaçışlama önce çalışır ve güvenlik özelliği bu sıralamadır.** HTML kaçışlamasının sahibi `build-cv-html.mjs`'dir ve yalnızca dokunmadan bıraktığı `**` işaretleri sonradan yeniden yorumlanır; bir maddeye yazılmış düz bir `<script>` kalın kısmın içinde de kaçışlanmış kalır. Yalnızca `**` ile sınırlanmış kısımlar etkilenir; tek yıldızlar ve eşleşmeyen işaretler olduğu gibi kalır.

**Kalın bir kısım `*` içeremez.** `**tripled *3x* throughput**` hiçbir şeyle eşleşmez ve yıldızları olduğu gibi gönderir; hata da uyarı da yoktur. Vurguyu iç içe koymak yerine `**tripled 3x throughput**` olarak yeniden yaz.

Vurgu kanıtın yerini tutmaz: kalın yazı dikkati yeniden sıralar, iddia eklemez. Uydurmama kuralı kalın metne de maddenin geri kalanına uygulandığı gibi uygulanır ve her iki ifadeden birini kalın yapmak hiçbir şeyi vurgulamaz.

### Profil fotoğrafı (isteğe bağlı, pazara özel)

`{{PHOTO}}` yuvası **varsayılan olarak kapalıdır** ve bilinçli olarak pazara özeldir:

- **DACH / Avrupa kıtasının büyük bölümü** (Almanya, Avusturya, İsviçre): Profesyonel bir fotoğraf standarttır ve çoğu zaman beklenir. `config/profile.yml` içindeki `candidate.photo` değerini ayarlayarak aç (yerel bir dosya yolu veya `data:` URL'si).
- **ABD / İngiltere / Kanada / Avustralya ve birçok ATS odaklı pazar**: Fotoğraf önerilmez ve ön yargı önleme filtrelerine takılabilir. `candidate.photo` değerini boş bırak; `{{PHOTO}}` satırı tamamen düşer, hiçbir `<img>` üretilmez ve CV bugünkü fotoğrafsız düzenle **piksel piksel aynı** oluşturulur.

Ayarlandığında fotoğraf üst köşeye yerleşir (RTL/Arapça için yansıtılır) ve başlık/özet metni onun yanında akar; boyutunu ve çerçevesini `cv-template.html` içindeki `.cv-photo` belirler.

Yerel fotoğraf yolları mutlak veya veri köküne (data root) göre göreli olabilir; kullanıcı katmanı dosyalarının bulunduğu yer, `CAREER_OPS_ROOT`, `CAREER_OPS_DATA_DIR` veya bir `.career-ops-data` işaretçisi onları taşımadıkça career-ops proje köküdür. Orada bulunamayan göreli bir yol, depo kopyasına (checkout) göre de denenir. Oluşturucu yerel bir yolu yalnızca yükteki `candidate.photo` değeri `config/profile.yml` içindeki değere eşitse okur; başka her yerel yol reddedilir, çünkü yük güvenilmeyen bir ilandan yazılır. `data:` ve `http(s)` değerleri bundan etkilenmez.
Oluşturucu PNG, JPEG, WebP ve GIF girdilerini doğrular ve kaydedilen HTML taşınabilir kalsın diye onları data URL olarak satır içine alır. PDF üretiminden önce sonucu incelemek için şunu çalıştır:

```bash
node build-cv-html.mjs --preview /tmp/cv-{candidate}[-{report}]-{company}.json {template}
```

Önizleme `output/cv-preview.html` dosyasına yazılır. Eksik, okunamayan, boş veya desteklenmeyen bir fotoğraf, herhangi bir çıktı yazılmadan önce işe yarar bir hatayla başarısız olur.

Oluşturulmuş bir CV'yi tarayıcı olmadan düz metin olarak okumak için (gözetimsiz çalıştırmalar veya `cv.md` ile karşılaştırma), aynı yükü markdown olarak oluştur. Token harcamaz, hiçbir uyarlamayı yeniden çalıştırmaz ve HTML ile aynı çözümlenmiş bölüm başlıklarını ve girdi filtrelemesini kullanır:

```bash
node build-cv-html.mjs /tmp/cv-{candidate}[-{report}]-{company}.json --markdown {output.md} {template}
```

HTML oluşturmanın kullandığı aynı `{template}` değerini ver (varsayılan şablon için çıkar), böylece markdown o şablonun bölüm sırasını izler.

## Canva CV Üretimi (isteğe bağlı)

`config/profile.yml` içinde `cv.canva_resume_design_id` ayarlıysa, üretmeden önce kullanıcıya şu seçenekleri sun:
- **"HTML/PDF (fast, ATS-optimized)"**: yukarıdaki mevcut akış
- **"Canva CV (visual, design-preserving)"**: aşağıdaki yeni akış

Kullanıcının bir `cv.canva_resume_design_id` değeri yoksa bu soruyu atla ve HTML/PDF akışını kullan.

### Canva iş akışı

#### Adım 1 — Temel tasarımı çoğalt

a. Temel tasarımı (`cv.canva_resume_design_id` kullanarak) PDF olarak `export-design` et → indirme URL'sini al
b. O indirme URL'sini kullanarak `import-design-from-url` yap → düzenlenebilir yeni bir tasarım (kopya) oluşturur
c. Kopya için yeni `design_id` değerini not et

#### Adım 2 — Tasarım yapısını oku

a. Yeni tasarım üzerinde `get-design-content` çalıştır → tüm metin öğelerini (richtexts) içerikleriyle birlikte döndürür
b. İçerik eşleştirmesiyle metin öğelerini CV bölümlerine eşle:
   - Adayın adını ara → başlık bölümü
   - "Summary" veya "Professional Summary" ara → özet bölümü
   - cv.md'deki şirket adlarını ara → deneyim bölümleri
   - Derece/okul adlarını ara → eğitim bölümü
   - Beceri anahtar kelimelerini ara → beceriler bölümü
c. Eşleştirme başarısız olursa kullanıcıya ne bulunduğunu göster ve yönlendirme iste

#### Adım 3 — Uyarlanmış içerik üret

HTML akışıyla aynı içerik üretimi (yukarıdaki 1-11. adımlar):
- Profesyonel Özeti JD anahtar kelimeleri + çıkış anlatısıyla yeniden yaz
- Deneyim maddelerini JD ilgisine göre yeniden sırala
- JD gereksinimlerinden en iyi yetkinlikleri seç
- Anahtar kelimeleri doğal biçimde yerleştir (ASLA uydurma)

**ÖNEMLİ — Karakter bütçesi kuralı:** Her yeni metin, yerine geçtiği özgün metinle YAKLAŞIK aynı uzunlukta OLMALIDIR (karakter sayısında ±%15). Uyarlanmış içerik daha uzunsa kısalt. Canva tasarımında metin kutularının boyutu sabittir; daha uzun metin komşu öğelerle üst üste biner. 2. adımdaki her özgün öğenin karakterlerini say ve yeni metinleri üretirken bu bütçeyi uygula.

#### Adım 4 — Düzenlemeleri uygula

a. Kopya tasarım üzerinde `start-editing-transaction` başlat
b. Her bölüm için `find_and_replace_text` ile `perform-editing-operations` çalıştır:
   - Özet metnini uyarlanmış özetle değiştir
   - Her deneyim maddesini yeniden sıralanmış/yeniden yazılmış maddelerle değiştir
   - Yetkinlik/beceri metnini JD ile eşleşen terimlerle değiştir
   - Proje açıklamalarını en alakalı projelerle değiştir
c. **Metin değişiminden sonra düzeni yeniden akıt:**
   Tüm metin değişiklikleri uygulandıktan sonra metin kutuları otomatik olarak yeniden boyutlanır, ama komşu öğeler yerinde kalır. Bu, iş deneyimi bölümleri arasında eşit olmayan boşluklara yol açar. Bunu düzelt:
   1. Güncellenmiş öğe konumlarını ve boyutlarını `perform-editing-operations` yanıtından oku
   2. Her iş deneyimi bölümü için (yukarıdan aşağıya) madde metin kutusunun nerede bittiğini hesapla: `end_y = top + height`
   3. Bir sonraki bölümün başlığı `end_y + consistent_gap` noktasından başlamalıdır (şablondaki özgün boşluğu kullan, genellikle ~30px)
   4. Eşit boşluğu korumak için sonraki bölümün tarih, şirket adı, rol başlığı ve madde öğelerini `position_element` ile taşı
   5. Tüm iş deneyimi bölümleri için tekrarla
d. **Kaydetmeden önce düzeni doğrula:**
   - transaction_id ve page_index=1 ile `get-design-thumbnail` al
   - Küçük resmi şunlar için gözle incele: üst üste binen metin, eşit olmayan boşluk, kesilmiş metin, çok küçük metin
   - Sorun kalırsa `position_element`, `resize_element` veya `format_text` ile ayarla
   - Düzen temiz olana kadar tekrarla
e. Kullanıcıya son önizlemeyi göster ve onay iste
f. Kaydetmek için `commit-editing-transaction` yap (YALNIZCA kullanıcı onayından sonra)

#### Adım 5 — Dışa aktar ve PDF'i indir

`{cv-stem}` değerini 18. adımdaki adlandırma standardıyla kur (`lib/output-names.mjs` içindeki `buildOutputName()`, hata fırlatırsa eski `cv-{candidate}-{company}-{YYYY-MM-DD}` gövdesi). Canva dalı 18. adımı çalıştırmaz.

a. Kopya tasarımı PDF olarak `export-design` et (biçim: JD konumuna göre a4 veya letter)
b. PDF'i Bash ile **HEMEN** indir:
   ```bash
   curl -sL -o "output/{cv-stem}-canva.pdf" "{download_url}"
   ```
   Dışa aktarma URL'si yaklaşık 2 saatte süresi dolan, önceden imzalanmış bir S3 bağlantısıdır. Hemen indir.
c. İndirmeyi doğrula:
   ```bash
   file output/{cv-stem}-canva.pdf
   ```
   "PDF document" göstermelidir. XML veya HTML gösteriyorsa URL'nin süresi dolmuştur; yeniden dışa aktar ve tekrar dene.
d. Bildir: PDF yolu, dosya boyutu, Canva tasarım URL'si (elle ince ayar için)

#### Hata yönetimi

- `import-design-from-url` başarısız olursa → bir mesajla HTML/PDF ardışık düzenine geri dön
- Metin öğeleri eşleştirilemezse → kullanıcıyı uyar, ne bulunduğunu göster, elle eşleştirme iste
- `find_and_replace_text` eşleşme bulamazsa → daha geniş alt dize eşleştirmesi dene
- Otomatik düzenleme başarısız olursa kullanıcı elle düzenleyebilsin diye Canva tasarım URL'sini her zaman ver

## Ön Yazı Alt Akışı (Cover Letter Sub-flow)

CV PDF'ini ürettikten sonra bir ön yazı üretmeyi öner:

```text
CV PDF oluşturuldu: output/{path}

Bu rol için bir ön yazı da ister misiniz?
- Hemen oluşturmak için "evet" veya "ön yazı" deyin
- Ya da daha sonra `/career-ops cover {slug}` çalıştırın
```

Ön yazıya `voice-dna.md` dosyasını (varsa) uygula: sohbet üslubu dahil tam koruma (Seviye 1 + Seviye 2). CV PDF'inin kendisi yalnızca Seviye 1'de (resmi ATS üslubu) kalır. Bkz. `_writing.md` → Voice DNA.

Kullanıcı evet derse, slug modunda `modes/cover.md` dosyasındaki tam ön yazı akışını çalıştır:
1. Başlangıç noktası olarak değerlendirme raporundaki mevcut `## Cover Letter Draft` bölümünü yükle
2. Şirket araştırmasını çalıştır (cover.md 3. adım)
3. Onay için anahtar kelime listesini sun (4. adım)
4. Boşlukları göster (5. adım)
5. Dört soruyu sor: neden / sorunlar / yaklaşım / üslup (6. adım)
6. Taslağı sohbette yaz, onay bekle (7-8. adımlar)
7. Ön yazı PDF'ini `node generate-cover-letter.mjs` ile üret (9. adım)
8. İki PDF yolunu da bildir

Yukarıdaki etkileşimli adımlardan geçmeden ön yazı PDF'ini otomatik olarak üretme.

## Üretim Sonrası (Post-generation)

İş zaten takipçideyse PDF hücresini `node mark-pdf-ready.mjs {report number}` ile ❌ değerinden ✅ değerine çevir (yukarıda `--report` seçeneğine verilen aynı rapor numarası). `data/applications.md` dosyasını elle düzenleme.
