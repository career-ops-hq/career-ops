# Mode: lowongan -- Evaluasi lengkap A-F

Ketika kandidat menempelkan lowongan (teks atau URL), SELALU sampaikan ke-6 blok.

## Langkah 0 -- Deteksi arketipe

Klasifikasikan lowongan ke salah satu dari 6 arketipe (lihat `_shared.md`). Jika hibrida, sebutkan 2 yang paling dekat. Ini menentukan:
- Proof point mana yang diprioritaskan di blok B
- Bagaimana menulis ulang summary di blok E
- Story STAR mana yang disiapkan di blok F

## Blok A -- Ringkasan role

Tabel berisi:
- Arketipe terdeteksi
- Domain (Platform / Agentic / LLMOps / ML / Enterprise)
- Fungsi (Build / Konsultasi / Manajemen / Deploy)
- Senioritas
- Remote (Full remote / Hybrid / On-site)
- Ukuran tim (jika disebutkan)
- TL;DR dalam 1 kalimat

## Blok B -- Kecocokan dengan CV

Baca `cv.md`. Buat tabel di mana setiap syarat lowongan dipetakan ke baris persis dari CV.

**Disesuaikan dengan arketipe:**
- FDE -> prioritaskan proof point delivery cepat dan kedekatan dengan klien
- SA -> prioritaskan perancangan sistem dan integrasi
- PM -> prioritaskan product discovery dan metrik
- LLMOps -> prioritaskan evals, observability, pipeline
- Agentic -> prioritaskan multi-agent, HITL, orkestrasi
- Transformation -> prioritaskan manajemen perubahan, adopsi, penskalaan

Bagian **Kesenjangan (Gaps)** dengan strategi mitigasi untuk masing-masing. Untuk setiap kesenjangan:
1. Apakah ini blocker keras atau nice-to-have?
2. Bisakah kandidat menunjukkan pengalaman yang berdekatan?
3. Adakah proyek portofolio yang menutup kesenjangan ini?
4. Rencana mitigasi konkret (kalimat untuk cover letter, mini-proyek cepat, dll.)

## Blok C -- Level dan strategi

1. **Level terdeteksi** di lowongan vs **level natural kandidat untuk arketipe ini**
2. **Rencana "menjual senior tanpa berbohong"**: rumusan spesifik sesuai arketipe, pencapaian konkret yang ditonjolkan, cara memosisikan pengalaman sebagai founder sebagai nilai tambah
3. **Rencana "jika saya di-downlevel"**: terima jika kompensasi adil, negosiasikan review 6 bulan, kriteria promosi yang jelas

## Blok D -- Kompensasi dan permintaan

Gunakan WebSearch untuk:
- Gaji terkini untuk role tersebut (Glassdoor, Levels.fyi, Glints, Jobstreet, Kalibrr, Indeed)
- Reputasi kompensasi perusahaan (Glassdoor, Jobstreet)
- Tren permintaan role di pasar Indonesia

Tabel berisi data dengan sumber yang dikutip. Jika tidak ada data, katakan dengan jelas -- jangan mengarang.

**Pasar Indonesia -- Pemeriksaan wajib:**
- THR disebutkan? Masukkan ke perhitungan gaji tahunan (min. gaji x 13).
- Komponen variabel (bonus, komisi, ESOP / stock option)?
- Komposisi gaji pokok vs tunjangan diketahui? (Memengaruhi THR & pesangon)
- Gaji gross atau nett? Apakah PPh 21 di-gross-up?
- PKWTT atau PKWT? Jika PKWT: jangka waktu, alasan, kemungkinan diangkat tetap.
- BPJS Kesehatan & Ketenagakerjaan didaftarkan penuh? Ada asuransi swasta tambahan?

## Blok E -- Rencana personalisasi

| # | Bagian | Kondisi saat ini | Perubahan yang diusulkan | Justifikasi |
|---|--------|------------------|--------------------------|-------------|
| 1 | Summary | ... | ... | ... |
| ... | ... | ... | ... | ... |

Top 5 perubahan CV + Top 5 perubahan LinkedIn untuk memaksimalkan match.

## Blok F -- Rencana wawancara

6-10 story STAR+R yang dipetakan ke syarat lowongan (STAR + **Reflection**):

| # | Syarat lowongan | Story STAR+R | S | T | A | R | Reflection |
|---|-----------------|--------------|---|---|---|---|------------|

Kolom **Reflection** menangkap apa yang dipelajari atau apa yang akan dilakukan berbeda. Ini menandakan senioritas -- yang junior menggambarkan apa yang terjadi, yang senior menarik pelajaran darinya.

**Story Bank:** Jika `interview-prep/story-bank.md` ada, cek apakah story ini sudah tercatat. Jika belum, tambahkan yang baru. Seiring waktu, ini membangun bank 5-10 master story yang bisa dipakai ulang dan disesuaikan untuk pertanyaan wawancara apa pun.

**Dipilih dan dibingkai sesuai arketipe:**
- FDE -> tonjolkan kecepatan delivery dan kedekatan dengan klien
- SA -> tonjolkan keputusan arsitektur
- PM -> tonjolkan discovery dan trade-off
- LLMOps -> tonjolkan metrik, evals, hardening di produksi
- Agentic -> tonjolkan orkestrasi, penanganan error, HITL
- Transformation -> tonjolkan adopsi dan perubahan organisasi

Sertakan juga:
- 1 case study yang direkomendasikan (proyek mana yang dipresentasikan dan bagaimana)
- Pertanyaan red-flag dan cara menjawabnya (mis.: "Kenapa Anda menjual perusahaan Anda?", "Apakah Anda punya tim di bawah tanggung jawab Anda?", "Kenapa pindah setelah waktu yang singkat?")

---

## Pasca-evaluasi

**SELALU** jalankan setelah blok A-F:

### 1. Simpan report .md

Simpan evaluasi lengkap ke `reports/{###}-{company-slug}-{YYYY-MM-DD}.md`.

- `{###}` = nomor urut berikutnya (3 digit, zero-padded). Untuk mengalokasikannya secara atomik dan menghindari race condition, kamu harus menjalankan `node reserve-report-num.mjs` untuk memesan nomor (stdout mengembalikan `{###}`), menulis report, lalu menjalankan `node reserve-report-num.mjs --release {###}` untuk melepas sentinel.
- `{company-slug}` = nama perusahaan huruf kecil, tanpa spasi (gunakan tanda hubung)
- `{YYYY-MM-DD}` = tanggal hari ini

**Format report:**

```markdown
# Evaluasi: {Perusahaan} -- {Role}

**Tanggal:** {YYYY-MM-DD}
**Arketipe:** {terdeteksi}
**Score:** {X/5}
**URL:** {URL lowongan}
**PDF:** {path atau menunggu}

---

## A) Ringkasan role
(isi lengkap blok A)

## B) Kecocokan dengan CV
(isi lengkap blok B)

## C) Level dan strategi
(isi lengkap blok C)

## D) Kompensasi dan permintaan
(isi lengkap blok D)

## E) Rencana personalisasi
(isi lengkap blok E)

## F) Rencana wawancara
(isi lengkap blok F)

## G) Draft jawaban untuk lamaran
(hanya jika score >= 4.5 -- draft jawaban untuk formulir lamaran)

---

## Kata kunci terekstraksi
(daftar 15-20 kata kunci dari lowongan untuk optimasi ATS)
```

### 2. Catat ke tracker

**SELALU** catat ke `data/applications.md`:
- Nomor urut berikutnya
- Tanggal hari ini
- Perusahaan
- Role
- Score: rata-rata match (1-5)
- Status: `Evaluated`
- PDF: tidak (atau ya jika auto-pipeline menghasilkan PDF)
- Report: tautan relatif ke file report (mis.: `[001](reports/001-company-2026-01-01.md)`)

**Format tracker:**

```markdown
| # | Tanggal | Perusahaan | Role | Score | Status | PDF | Report |
```
