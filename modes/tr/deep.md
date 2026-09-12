# Mod: deep — Derin Araştırma İstemi

Perplexity/Claude/ChatGPT için 6 eksenli yapılandırılmış bir istem (prompt) oluştur:

```text
## Derin Araştırma (Deep Research): [company] — [role]

Bağlam: [company] şirketindeki [role] rolü için bir adaylığı değerlendiriyorum. Mülakat için eyleme dönüştürülebilir bilgilere ihtiyacım var.

### 1. Yapay Zeka Stratejisi
- Hangi ürünler/özellikler AI/ML kullanıyor?
- AI yığınları (stack) nedir? (modeller, altyapı, araçlar)
- Mühendislik blogları var mı? Ne yayınlıyorlar?
- Yapay zeka üzerine hangi makaleleri veya sunumları yayınladılar/sundular?

### 2. Son dönem hamleleri (son 6 ay)
- AI/ML/ürün alanında ilgili işe alımlar?
- Satın almalar veya ortaklıklar?
- Ürün lansmanları veya pivotlar?
- Yatırım turları veya liderlik değişiklikleri?

### 3. Mühendislik kültürü
- Ürünleri nasıl canlıya alıyorlar? (dağıtım/deployment ritmi, CI/CD)
- Monorepo / Multirepo?
- Hangi dilleri/framework'leri kullanıyorlar?
- Uzaktan-Öncelikli (Remote-first) mi yoksa ofis-öncelikli mi?
- Mühendislik kültürü hakkında Glassdoor/Blind incelemeleri var mı?

### 4. Olası zorluklar
- Hangi ölçeklenme (scaling) problemlerini yaşıyorlar?
- Güvenilirlik, maliyet, gecikme zorlukları var mı?
- Herhangi bir şeyi taşıyor/göç ettiriyor (migrate) mu? (altyapı, modeller, platformlar)
- İncelemelerde insanlar hangi sıkıntılı noktalardan (pain points) bahsediyor?

### 5. Rakipler ve farklılaşma
- Ana rakipleri kimler?
- Hendekleri (moat) / farklılaştırıcıları nedir?
- Rakiplere kıyasla nasıl konumlanıyorlar?

### 6. Adayın bakış açısı
Profilim göz önüne alındığında (belirli deneyimler için cv.md ve profile.yml dosyalarından oku):
- Bu ekibe kattığım özgün değer nedir?
- Hangi projelerim en çok ilgili?
- Mülakatta hangi hikayeyi anlatmalıyım?
```

Her bölümü değerlendirilen işin özel bağlamıyla kişiselleştir.
