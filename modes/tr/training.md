# Mod: training — Eğitim ve Kurs Değerlendirmesi

Adayın sorduğu her kurs/sertifika için 6 boyutu değerlendirin:

| Boyut | Neyi değerlendirir |
|-----------|-------------------|
| Kuzey Yıldızı uyumu | Hedefe yaklaştırıyor mu yoksa uzaklaştırıyor mu? |
| İşe alım uzmanı sinyali | İşe alım yöneticileri (HM) bunu bir CV'de gördüğünde ne düşünür? |
| Zaman ve efor | Hafta × saat/hafta |
| Fırsat maliyeti | Bu süre zarfında başka ne yapılabilirdi? |
| Riskler | İçerik modası geçmiş mi? Zayıf marka mı? Çok mu temel? |
| Portfolyo çıktısı | Gösterilebilir bir eser/çıktı üretiyor mu? |

## Kararlar

- **YAP (DO)** → Haftalık çıktılar ve skor tablosu içeren 4-12 haftalık plan
- **YAPMA (DON'T DO)** → Gerekçesiyle birlikte daha iyi bir alternatif
- **SÜRE SINIRIYLA YAP (DO WITH TIMEBOX)** (maksimum X hafta) → Özetlenmiş plan, sadece temel kısımlar

## Öncelik

Adayın CV'si ile `modes/_profile.md` içindeki hedef rolleri arasındaki boşlukları kapatan eğitimlere öncelik ver. Boşlukları `node upskill.mjs` çıktısından al: bu komut, adayın değerlendirme raporlarında adı geçen boşlukları sıralar ve `cv.md` ya da `config/profile.yml` içinde zaten bulunan becerileri dışarıda bırakır. Boşluk haritası olmadığında bile 0 koduyla çıkar, bu yüzden JSON çıktısını oku: `error` döndürürse (takipçi yok veya puanlanmış rapor sayısı 5'ten az) ya da `gaps` listesi boşsa, bunun yerine `modes/_profile.md` içinde adı geçen boşlukları kullan.

Örneğin üretim ortamındaki yapay zeka platformu rollerini hedefleyen bir aday şu sıralamayı yapar:
1. LLM değerlendirmesi ve testi
2. Gözlemlenebilirlik (Observability) ve izleme
3. Maliyet/güvenilirlik dengeleri
4. Yapay zeka yönetişimi ve güvenliği
5. Kurumsal yapay zeka mimarisi
