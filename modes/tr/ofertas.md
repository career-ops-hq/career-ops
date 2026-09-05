# Mod: ofertas — Çoklu İlan Karşılaştırması

10 ağırlıklı boyut içeren puanlama matrisi:

| Boyut | Ağırlık | Kriter 1-5 |
|-----------|------|----------------|
| North Star uyumu | %25 | 5=tam hedef rol, 1=ilgisiz |
| CV eşleşmesi | %15 | 5=%90+ eşleşme, 1=<%40 eşleşme |
| Seviye (senior+) | %15 | 5=staff+, 4=senior, 3=mid-senior, 2=mid, 1=junior |
| Tahmini ücret (Net / Brüt Maaş) | %10 | 5=üst çeyrek, 1=piyasa altı |
| Gelişim yörüngesi | %10 | 5=bir sonraki seviye için net yol, 1=çıkmaz sokak |
| Uzaktan çalışma kalitesi | %5 | 5=tam uzaktan asenkron, 1=sadece ofis |
| Şirket itibarı | %5 | 5=en iyi işveren, 1=kırmızı bayraklar |
| Teknoloji yığını (stack) modernliği | %5 | 5=en son teknoloji AI/ML, 1=eski teknoloji (legacy) |
| Teklife Kadar Geçen Süre | %5 | 5=hızlı süreç, 1=6+ ay |
| Kültürel sinyaller | %5 | 5=builder kültürü, 1=bürokratik |

Her ilan için: boyut başına puan ve toplam ağırlıklı puan.
Teklife Kadar Geçen Süre (time-to-offer) değerlendirmeleriyle birlikte nihai sıralama + öneri.
Tüm raporlar çıktı başlığında **URL:** ve **Meşruiyet:** alanlarını içermelidir.

Kullanıcıdan, bağlamda (context) yoksa iş ilanlarını iste. Bunlar metin, URL'ler veya takipçide halihazırda değerlendirilmiş ilanlara atıflar olabilir.
