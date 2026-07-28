# career-ops -- Mode Bahasa Indonesia (`modes/id/`)

Folder ini berisi terjemahan Bahasa Indonesia dari mode-mode utama career-ops untuk kandidat yang membidik pasar kerja Indonesia (startup tech, perusahaan, dan portal seperti Glints, Jobstreet, Kalibrr, LinkedIn ID).

## Kapan memakai mode ini?

Gunakan `modes/id/` jika minimal salah satu kondisi ini terpenuhi:

- Kamu melamar terutama ke **lowongan berbahasa Indonesia** (Glints, Jobstreet, Kalibrr, LinkedIn ID, Indeed ID, situs karier perusahaan)
- **CV-mu berbahasa Indonesia** atau kamu berganti-ganti antara ID dan EN tergantung lowongan
- Kamu butuh jawaban dan cover letter dalam **Bahasa Indonesia teknis yang natural**, bukan terjemahan mesin
- Kamu perlu menangani **kekhususan ketenagakerjaan Indonesia**: THR, BPJS Kesehatan & Ketenagakerjaan, PKWT/PKWTT, masa percobaan, pesangon, UMR/UMP/UMK, gaji pokok vs tunjangan, PPh 21, cuti tahunan

Jika sebagian besar lowonganmu berbahasa Inggris, tetap gunakan mode standar di `modes/`. Mode Bahasa Inggris berfungsi untuk lowongan Indonesia, tetapi tidak memahami kekhususan pasar Indonesia secara detail.

## Cara mengaktifkan?

### Opsi 1 -- Per sesi

Katakan kepada Claude di awal sesi:

> "Gunakan mode Bahasa Indonesia di `modes/id/`."

Claude akan membaca file di folder ini alih-alih `modes/`.

### Opsi 2 -- Permanen

Tambahkan di `config/profile.yml`:

```yaml
language:
  primary: id
  modes_dir: modes/id
```

Ingatkan Claude pada sesi pertamamu ("Lihat di `profile.yml`, saya sudah mengatur `language.modes_dir`"). Claude akan otomatis memakai mode Bahasa Indonesia.

## Mode apa saja yang diterjemahkan?

Iterasi pertama ini mencakup empat mode berdampak tertinggi:

| File | Diterjemahkan dari | Peran |
|------|--------------------|-------|
| `_shared.md` | `modes/_shared.md` (EN) | Konteks bersama, arketipe, aturan global, kekhususan pasar Indonesia |
| `lowongan.md` | `modes/oferta.md` (ES) | Evaluasi lengkap sebuah lowongan (Blok A-F) |
| `melamar.md` | `modes/apply.md` (EN) | Asisten live untuk mengisi formulir lamaran |
| `pipeline.md` | `modes/pipeline.md` (ES) | Inbox URL / Second Brain untuk lowongan yang dikumpulkan |

Mode lain (`scan`, `batch`, `pdf`, `tracker`, `auto-pipeline`, `deep`, `contacto`, `ofertas`, `project`, `training`) tetap dalam EN/ES. Isinya sebagian besar tooling, path, dan perintah -- harus tetap independen dari bahasa.

## Yang tetap berbahasa Inggris

Sengaja tidak diterjemahkan karena merupakan kosakata teknis standar:

- `cv.md`, `pipeline`, `tracker`, `report`, `score`, `archetype`, `proof point`
- Nama perkakas (`Playwright`, `WebSearch`, `WebFetch`, `Read`, `Write`, `Edit`, `Bash`)
- Nilai status di tracker (`Evaluated`, `Applied`, `Interview`, `Offer`, `Rejected`)
- Cuplikan kode, path, perintah

Mode-mode ini memakai Bahasa Indonesia teknis yang natural, seperti yang dipakai tim engineering di Jakarta, Bandung, atau Surabaya: teks umum dalam Bahasa Indonesia, istilah teknis dalam Bahasa Inggris di tempat yang lazim. Tidak ada penerjemahan paksa "Pipeline" menjadi "Saluran" atau "Deploy" menjadi "Penggelaran aplikasi".

## Leksikon rujukan

Agar nada tetap konsisten jika kamu mengubah atau memperluas mode:

| Inggris | Bahasa Indonesia (dalam codebase ini) |
|---------|----------------------------------------|
| Job posting | Lowongan / Lowongan kerja |
| Application | Lamaran |
| Cover letter | Cover letter / Surat lamaran |
| Resume / CV | CV |
| Salary | Gaji |
| Compensation | Kompensasi / Paket |
| Skills | Keahlian / Kompetensi |
| Interview | Wawancara |
| Hiring manager | Hiring manager / Manajer perekrut |
| Recruiter | Recruiter / Rekruter |
| AI | AI (Kecerdasan Buatan) |
| Requirements | Syarat / Persyaratan |
| Career history | Riwayat karier |
| Notice period | Notice period / Masa pemberitahuan |
| Probation | Masa percobaan |
| Vacation | Cuti tahunan |
| Religious holiday bonus | THR (Tunjangan Hari Raya) |
| Permanent employment | PKWTT (Perjanjian Kerja Waktu Tidak Tertentu) |
| Fixed-term contract | PKWT (Perjanjian Kerja Waktu Tertentu) |
| Freelance | Freelance / Pekerja lepas / Kontraktor |
| Severance | Pesangon |
| Health insurance | BPJS Kesehatan / Asuransi kesehatan |
| Social security | BPJS Ketenagakerjaan |
| Minimum wage | UMR / UMP / UMK |
| Base salary | Gaji pokok |
| Allowances | Tunjangan |
| Income tax | PPh 21 |
| Gross / Net | Gross / Nett |

## Berkontribusi

Untuk memperbaiki terjemahan atau menambahkan mode:

1. Buka Issue dengan usulanmu (lihat `CONTRIBUTING.md`)
2. Patuhi leksikon di atas agar nada tetap konsisten
3. Terjemahkan secara idiomatik -- bukan kata per kata
4. Pertahankan elemen struktural (Blok A-F, tabel, blok kode, instruksi perkakas) persis sama
5. Uji dengan lowongan Indonesia yang nyata (Glints, Jobstreet, Kalibrr) sebelum mengirim PR
