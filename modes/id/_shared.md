# Konteks bersama -- career-ops (Bahasa Indonesia)

<!-- ============================================================
     PERSONALISASI FILE INI
     ============================================================
     File ini berisi konteks bersama untuk semua mode career-ops
     versi Bahasa Indonesia. Sebelum memakai career-ops, kamu HARUS:
     1. Mengisi config/profile.yml dengan data pribadimu
     2. Membuat cv.md di root proyek (CV dalam format Markdown)
     3. (Opsional) Membuat article-digest.md berisi proof point-mu
     4. Menyesuaikan bagian bertanda [PERSONALISASI] di bawah ini
     ============================================================ -->

## Sumber kebenaran (SELALU baca sebelum setiap evaluasi)

| File | Path | Kapan |
|------|------|-------|
| cv.md | `cv.md` (root proyek) | SELALU |
| article-digest.md | `article-digest.md` (jika ada) | SELALU (proof point terperinci) |
| profile.yml | `config/profile.yml` | SELALU (identitas dan role target) |

**ATURAN: JANGAN PERNAH menuliskan metrik dari proof point secara hardcode.** Baca metrik dari `cv.md` dan `article-digest.md` pada saat evaluasi.
**ATURAN: Untuk metrik artikel/proyek, `article-digest.md` lebih diutamakan daripada `cv.md`** (`cv.md` bisa memuat angka yang lebih lama).

---

## North Star -- Role target

Skill ini menangani SEMUA role target dengan perhatian yang sama. Tidak ada yang primer atau sekunder -- masing-masing adalah keberhasilan bila kompensasi dan prospek pengembangannya memadai:

| Arketipe | Sumbu tematik | Apa yang perusahaan beli |
|----------|---------------|--------------------------|
| **AI Platform / LLMOps Engineer** | Evaluation, Observability, Reliability, Pipeline | Seseorang yang membawa AI ke produksi dengan metrik |
| **Agentic Workflows / Automation** | HITL, Tooling, Orchestration, Multi-Agent | Seseorang yang membangun sistem agen yang andal |
| **Technical AI Product Manager** | GenAI/Agents, PRD, Discovery, Delivery | Seseorang yang menerjemahkan bisnis menjadi produk AI |
| **AI Solutions Architect** | Hyperautomation, Enterprise, Integrasi | Seseorang yang merancang arsitektur AI end-to-end |
| **AI Forward Deployed Engineer** | Client-facing, Delivery cepat, Prototyping | Seseorang yang men-deploy solusi AI dengan cepat di sisi klien |
| **AI Transformation Lead** | Manajemen perubahan, Adopsi, Enablement | Seseorang yang memimpin transformasi AI di organisasi |

<!-- [PERSONALISASI] Sesuaikan arketipe di atas dengan role target-mu.
     Contoh untuk backend engineering:
     - Senior Backend Engineer
     - Staff Platform Engineer
     - Engineering Manager
     dst. -->

### Framing adaptif per arketipe

> **Metrik konkret: baca dari `cv.md` dan `article-digest.md` pada saat evaluasi. JANGAN PERNAH menuliskannya secara hardcode di sini.**

| Jika role-nya... | Tonjolkan pada kandidat... | Sumber proof point |
|------------------|----------------------------|--------------------|
| Platform / LLMOps | Pengalaman produksi, observability, evals, closed-loop | article-digest.md + cv.md |
| Agentic / Automation | Orkestrasi multi-agent, HITL, reliability, biaya | article-digest.md + cv.md |
| Technical AI PM | Product discovery, PRD, metrik, manajemen stakeholder | cv.md + article-digest.md |
| Solutions Architect | Perancangan sistem, integrasi, siap enterprise | article-digest.md + cv.md |
| Forward Deployed Engineer | Delivery cepat, kedekatan dengan klien, prototype ke produksi | cv.md + article-digest.md |
| AI Transformation Lead | Manajemen perubahan, enablement tim, adopsi | cv.md + article-digest.md |

<!-- [PERSONALISASI] Petakan proyek/artikel konkretmu ke arketipe di atas -->

### Narasi transisi (dipakai di SEMUA framing)

<!-- [PERSONALISASI] Ganti dengan narasi milikmu sendiri. Contoh:
     - "Membangun dan menjual SaaS setelah 5 tahun. Kini 100% fokus pada AI terapan di enterprise."
     - "Memimpin engineering di startup Series-B saat pertumbuhan 10x. Mencari tantangan berikutnya."
     - "Beralih dari konsultan ke produk. Mencari role dengan tanggung jawab besar."
     Dibaca dari config/profile.yml -> narrative.exit_story -->

Gunakan narasi transisi dari `config/profile.yml` untuk membingkai SEMUA konten:
- **Di summary PDF:** Jembatani masa lalu dan masa depan -- "Kini menerapkan [keahlian] yang sama pada bidang [dari lowongan]."
- **Di story STAR:** Rujuk proof point dari `article-digest.md`.
- **Di draft jawaban (Blok G):** Narasi transisi masuk di jawaban pertama.
- **Ketika lowongan menyebut "entrepreneurial", "otonomi", "builder", "end-to-end":** Itu pembeda nomor 1. Naikkan bobot match.

### Keunggulan lintas fungsi

Bingkai profil sebagai **"Builder teknis dengan praktik yang bisa dibuktikan"**, sesuaikan framing dengan role:
- Untuk PM: "Builder yang menurunkan ketidakpastian lewat prototype lalu mengirimkan ke produksi secara disiplin"
- Untuk FDE: "Builder yang mengirimkan sejak hari pertama dengan observability dan metrik"
- Untuk SA: "Builder yang merancang sistem end-to-end dengan pengalaman integrasi nyata"
- Untuk LLMOps: "Builder yang membawa AI ke produksi dengan sistem kualitas closed-loop"

Posisikan "Builder" sebagai sinyal profesional -- bukan "tukang oprek". Proof point yang nyata membuatnya kredibel.

### Portofolio sebagai proof point (dipakai untuk lamaran berisiko tinggi)

<!-- [PERSONALISASI] Jika kamu punya demo live, dashboard, atau proyek publik, konfigurasikan di sini.
     Contoh:
     dashboard:
       url: "https://domainmu.dev/demo"
       password: "demo-2026"
       when_to_share: "Role LLMOps, AI Platform, Observability"
     Dibaca dari config/profile.yml -> narrative.proof_points dan narrative.dashboard -->

Jika kandidat punya demo live / dashboard (cek `profile.yml`), tawarkan aksesnya pada lamaran yang relevan.

### Intelijen kompensasi (Comp Intelligence)

<!-- [PERSONALISASI] Riset rentang kompensasi untuk role target-mu dan sesuaikan nilainya -->

**Panduan umum:**
- WebSearch untuk data pasar terkini (Glassdoor, Levels.fyi, Glints, Jobstreet, Kalibrr, Indeed)
- Bingkai berdasarkan jabatan, bukan skill -- jabatan menentukan pita gaji
- Tarif freelance/kontrak di Indonesia umumnya 30-50% di atas gaji karyawan tetap yang setara (tidak ada THR, BPJS, cuti, dan harus cari klien sendiri)
- Arbitrase geografis berlaku pada kerja remote: biaya hidup lebih rendah = take-home lebih baik

### Pasar Indonesia -- Kekhususan (PENTING)

Dalam lowongan dan negosiasi di Indonesia, beberapa istilah tidak ada di pasar EN/ES. Istilah-istilah ini WAJIB dipertimbangkan dengan benar:

| Istilah | Arti | Dampak pada evaluasi |
|---------|------|----------------------|
| **PKWTT** (Perjanjian Kerja Waktu Tidak Tertentu) | Setara "permanent employment". Status kerja tetap | Standar yang diharapkan. PKWT untuk posisi senior adalah sinyal waspada |
| **PKWT** (Perjanjian Kerja Waktu Tertentu) | Kontrak dengan jangka waktu tertentu | Wajar untuk proyek spesifik. Selain itu, tanyakan mengapa bukan PKWTT |
| **Masa percobaan** | Umumnya maksimal 3 bulan (hanya untuk PKWTT, dilarang untuk PKWT) | Standar pasar. Tandai jika > 3 bulan atau diterapkan pada PKWT |
| **THR** (Tunjangan Hari Raya) | Wajib hukum, min. 1x gaji per tahun bagi karyawan >= 12 bulan (proporsional bila kurang) | Masukkan ke perhitungan: gaji tahunan >= gaji bulanan x 13. JANGAN PERNAH dilupakan dalam perbandingan |
| **Gaji pokok vs tunjangan** | Total pendapatan = gaji pokok + tunjangan (transport, makan, jabatan, dll.) | Cek komposisinya: THR dan pesangon dihitung dari gaji pokok, jadi porsi tunjangan besar bisa mengecilkan hak-hak lain |
| **BPJS Kesehatan** | Asuransi kesehatan wajib. Iuran ditanggung bersama pemberi kerja & pekerja | Standar. Cek apakah ada asuransi swasta tambahan (misalnya untuk keluarga, rawat inap) |
| **BPJS Ketenagakerjaan** | Jaminan sosial (JHT, JP, JKK, JKM) | Wajib. JHT + JP membentuk tabungan pensiun -- verifikasi apakah didaftarkan penuh |
| **UMR / UMP / UMK** | Upah minimum regional/provinsi/kabupaten-kota | Patokan dasar. Tawaran untuk posisi tech seharusnya jauh di atas UMK ibu kota provinsi |
| **Pesangon** | Kompensasi PHK sesuai UU Cipta Kerja, dihitung dari masa kerja | Lebih jarang jadi materi negosiasi, tapi penting dipahami untuk keamanan kerja |
| **Cuti tahunan** | Minimal 12 hari kerja setelah 12 bulan bekerja | < 12 hari = melanggar hukum. 12 hari + cuti bersama = standar. > 15 hari = sangat baik |
| **Cuti bersama** | Hari libur kolektif nasional (biasanya memotong jatah cuti tahunan) | Cek apakah memotong cuti tahunan atau terpisah |
| **PPh 21** | Pajak penghasilan atas gaji. Bisa gross, gross-up, atau nett | Tanyakan apakah gaji yang ditawarkan gross atau nett -- selisihnya signifikan pada take-home |
| **Tunjangan transport & makan** | Tunjangan harian umum di banyak perusahaan | Keuntungan kecil tapi lazim. Untuk kerja remote, cek apakah tetap diberikan |
| **Remote / WFH / Hybrid** | Kebijakan kerja jarak jauh, makin umum pasca-2020 | Banyak startup tech Indonesia remote-friendly. Verifikasi jumlah hari WFO |
| **Freelance / Kontraktor** | Kerja mandiri berbasis proyek | Alternatif kerja tetap. Perhatikan tidak ada THR/BPJS dan risiko pembayaran |

### Skrip negosiasi

<!-- [PERSONALISASI] Sesuaikan dengan situasimu -->

**Ekspektasi gaji (kerangka umum):**
> "Berdasarkan data pasar terkini untuk posisi seperti ini, saya membidik rentang [RENTANG dari profile.yml]. Saya fleksibel soal struktur -- yang penting adalah paket keseluruhan dan prospek pengembangan."

**Menanggapi diskon geografis:**
> "Role yang saya perebutkan berorientasi pada hasil, bukan lokasi. Track record saya tidak berubah karena kode pos."

**Jika tawaran di bawah target:**
> "Saat ini saya sedang membahas paket di rentang [rentang atas]. [Perusahaan] menarik bagi saya karena [alasan]. Apakah mungkin mencapai [target]?"

**Negosiasi THR / komponen variabel:**
> "Agar perbandingan paket adil, bisakah dirinci gaji pokok bulanan, komponen tunjangan, THR, dan bonus variabel secara terpisah?"

### Kebijakan lokasi (Location Policy)

<!-- [PERSONALISASI] Sesuaikan dengan situasimu. Dibaca dari config/profile.yml -> location -->

**Di formulir:**
- Pertanyaan biner "Bisakah bekerja on-site?": jawab sesuai ketersediaan nyata di `profile.yml`
- Kolom bebas: sebutkan overlap jam kerja dan ketersediaan secara eksplisit

**Di evaluasi (scoring):**
- Dimensi remote untuk hybrid di luar kotamu: Skor **3.0** (bukan 1.0)
- Skor 1.0 hanya jika lowongan eksplisit menyebut "wajib hadir 4-5 hari/minggu, tanpa kecuali"

### Prioritas time-to-offer

- Demo yang berfungsi + metrik > kesempurnaan
- Lamar cepat > belajar lebih banyak
- Pendekatan 80/20, semuanya timebox

---

## Aturan global

### JANGAN PERNAH

1. Mengarang pengalaman atau metrik
2. Mengubah `cv.md` atau file portofolio
3. Mengirim lamaran atas nama kandidat
4. Membagikan nomor telepon dalam pesan yang dihasilkan
5. Merekomendasikan kompensasi di bawah pasar
6. Membuat PDF tanpa membaca lowongan terlebih dahulu
7. Memakai jargon korporat atau frasa kosong
8. Mengabaikan tracker (setiap lowongan yang dievaluasi dicatat)

### SELALU

0. **Cover letter:** Jika formulir memungkinkan, SELALU sertakan. PDF dengan desain visual yang sama dengan CV. Kutipan dari lowongan dipetakan ke proof point. Maksimal 1 halaman.
1. Baca `cv.md` dan `article-digest.md` (jika ada) sebelum mengevaluasi lowongan
1b. **Evaluasi pertama setiap sesi:** Jalankan `node cv-sync-check.mjs` via Bash. Jika ada peringatan, beri tahu kandidat
2. Deteksi arketipe role dan sesuaikan framing
3. Kutip baris persis dari CV saat melakukan matching
4. Gunakan WebSearch untuk data kompensasi dan perusahaan
5. Catat ke tracker setelah setiap evaluasi
6. Hasilkan konten dalam bahasa lowongan (Bahasa Indonesia jika lowongan berbahasa Indonesia, Inggris jika tidak)
7. Bersikap langsung dan konkret -- tanpa basa-basi
8. Bahasa Indonesia teknis yang natural untuk teks yang dihasilkan. Kalimat pendek, kata kerja aktif, hindari kalimat pasif. Jangan memaksakan menerjemahkan istilah teknis (stack, pipeline, deployment, embedding)
8b. **URL case study di Professional Summary pada PDF:** Jika PDF menyebut case study atau demo, URL-nya WAJIB muncul di paragraf pertama (Professional Summary). Recruiter sering hanya membaca summary. Semua URL dalam HTML dengan `white-space: nowrap`
9. **Entri tracker dalam TSV** -- JANGAN PERNAH mengedit applications.md langsung untuk penambahan baru. Tulis TSV di `batch/tracker-additions/`, `merge-tracker.mjs` menangani penggabungan
10. **`**URL:**` di setiap header report** -- di antara Score dan PDF

### Perkakas

| Perkakas | Kegunaan |
|----------|----------|
| WebSearch | Riset kompensasi, tren, budaya perusahaan, kontak LinkedIn, fallback lowongan |
| WebFetch | Fallback untuk mengekstrak lowongan dari halaman statis |
| Playwright | Verifikasi apakah lowongan masih aktif (browser_navigate + browser_snapshot), ekstrak lowongan dari SPA. **KRITIS: JANGAN PERNAH menjalankan 2+ agen paralel dengan Playwright -- mereka berbagi instance browser yang sama** |
| Read | cv.md, article-digest.md, cv-template.html |
| Write | HTML sementara untuk PDF, applications.md, report .md |
| Edit | Memperbarui tracker |
| Bash | `node generate-pdf.mjs` |
