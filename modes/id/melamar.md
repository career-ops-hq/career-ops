# Mode: melamar -- Asisten live untuk formulir lamaran

Mode interaktif untuk saat kandidat mengisi formulir lamaran di browser Playwright yang diluncurkan proyek ini. Membaca apa yang ada di layar, memuat konteks evaluasi lowongan sebelumnya, dan menghasilkan jawaban yang dipersonalisasi untuk setiap pertanyaan formulir.

## Prasyarat

- **Ideal dengan Playwright terlihat**: Dalam mode terlihat, kandidat melihat browser dan Claude bisa berinteraksi dengan halaman.
- **Tanpa Playwright**: kandidat membagikan tangkapan layar atau menempelkan pertanyaan secara manual.

## Alur kerja

```text
1. DETEKSI      -> Buka lowongan di browser Playwright proyek ini
2. IDENTIFIKASI -> Ekstrak perusahaan + role dari halaman
3. CARI         -> Cocokkan dengan report yang ada di reports/
4. MUAT         -> Baca report lengkap + `## Application Answers` dan Blok H (jika ada), setelah **Posting identity** terpenuhi
5. BANDINGKAN   -> Apakah role di layar cocok dengan yang dievaluasi? Jika berubah -> beri peringatan
6. ANALISIS     -> Identifikasi SEMUA pertanyaan yang terlihat di formulir
7. HASILKAN     -> Untuk tiap pertanyaan, hasilkan jawaban yang dipersonalisasi
8. SAJIKAN      -> Tampilkan jawaban terformat untuk copy-paste
```

## Scope

Follow the Scope section in `modes/apply.md`. Run `node apply-scope.mjs root` and stay inside the directories it prints. Launch with `node apply-scope.mjs launch-options`. Do not read `DevToolsActivePort` or attach to an existing browser. Do not submit the form.


## Langkah 1 -- Deteksi lowongan

**Dengan Playwright:** Jalankan `node apply-scope.mjs launch-options`, buka lowongan di jendela itu, lalu baca judul, URL, dan konten yang terlihat.

**Tanpa Playwright:** Minta kandidat untuk:
- Membagikan tangkapan layar formulir (Read tool bisa membaca gambar)
- Atau menempelkan pertanyaan formulir sebagai teks
- Atau menyebutkan perusahaan + role agar konteksnya dicari

## Langkah 2 -- Identifikasi dan muat konteks

1. Ekstrak nama perusahaan dan jabatan dari halaman
2. Cari di `reports/` berdasarkan nama perusahaan (Grep case-insensitive)
3. Jika cocok -> baca hanya kepala setiap report yang cocok (perusahaan, role, `**URL:**`) dan pilih yang URL atau req ID-nya adalah lowongan ini; tanyakan kandidat jika belum jelas. Muat report lengkap dan butir 4 hanya setelah **Posting identity** terpenuhi (`modes/apply.md` → Step 5); untuk lowongan lain, lanjut ke **Evaluate as new** atau **Draft without saving** tanpa memuatnya
4. Jika ada `## Application Answers` -> muat jawaban yang sudah dikirim sebagai dasar; jika tidak, dan ada Blok H, draft jawaban sebelumnya. Jika keduanya ada, `## Application Answers` didahulukan
5. Jika TIDAK cocok -> beri peringatan kepada kandidat dan tawarkan auto-pipeline cepat

## Langkah 3 -- Deteksi perubahan role

Langkah ini hanya berlaku selama formulir masih lowongan dari report: pemberi kerja yang sama dan lowongan yang sama (`modes/apply.md` → Step 5 → **Posting identity**); judul tidak dihitung. Periksa ini untuk setiap formulir, juga saat judul tidak berubah dan hanya satu report yang cocok dengan perusahaan: lowongan lain bisa memakai judul yang sama, dan report itu tidak boleh dipakai. Jika beberapa report cocok dengan perusahaan, ambil dulu report yang URL atau req ID-nya adalah lowongan ini, dan tanyakan kandidat jika belum jelas. Pemberi kerja lain, atau lowongan lain di pemberi kerja yang sama, bukan perubahan role: jangan pernah menyesuaikan jawaban report ke sana. Sebagai gantinya pilih **Evaluate as new** (evaluasi sebagai lowongan baru: auto-pipeline, report sendiri) atau **Draft without saving** (susun jawaban tanpa menyimpannya ke report mana pun). Untuk **Draft without saving**, sisihkan report yang cocok, jawabannya, dan CV yang disesuaikan, lalu susun jawaban hanya dari lowongan yang terlihat, `cv.md`, dan profil; langkah di bawah yang membaca report tidak berlaku.

Jika role di layar berbeda dari yang dievaluasi:
- **Beri peringatan kepada kandidat**: "Role berubah dari [X] menjadi [Y]. Mau saya evaluasi ulang atau menyesuaikan jawaban dengan jabatan baru?"
- **Jika menyesuaikan**: Sesuaikan jawaban dengan role baru tanpa evaluasi ulang
- **Jika evaluasi ulang**: Jalankan evaluasi lengkap A-F, perbarui report, buat ulang Blok H
- **Perbarui tracker**: jangan pernah dengan mengedit `data/applications.md`.
  - **Setelah evaluasi ulang**: tulis TSV dengan jabatan role yang baru (aturan 9 di `_shared.md`) dan gabungkan dengan `node merge-tracker.mjs`. Report diperbarui di tempat dan nomornya tetap, sehingga penggabungan mencocokkan TSV dengan baris yang ada lewat nomor itu: jabatan diganti dan status dipertahankan.
  - **Setelah menyesuaikan**: biarkan jabatannya, karena itu menamai role yang dievaluasi report. Catat perubahannya sebagai catatan dengan `node set-status.mjs --report <report#> <status saat ini> --note "Lowongan berganti nama saat melamar, baris tetap memakai jabatan yang dievaluasi"`. Memberikan status baris saat ini membuatnya tidak berubah dan menambahkan catatannya. Pakai teks tetap seperti ini dan jangan sertakan `[Y]`: jabatan baru adalah teks dari halaman, dan teks dari halaman tidak pernah masuk ke baris perintah.

## Langkah 4 -- Analisis pertanyaan formulir

Untuk **Draft without saving**, langkah ini tidak memakai report yang cocok, `## Application Answers`-nya, maupun Blok H: perlakukan setiap pertanyaan sebagai baru dan bekerja dari lowongan yang terlihat, `cv.md`, dan profil.

Identifikasi SEMUA pertanyaan yang terlihat:
- Kolom teks bebas (cover letter, "kenapa posisi ini", motivasi, dll.)
- Dropdown (dari mana tahu perusahaan, izin kerja, dll.)
- Ya/Tidak (mobilitas, visa, ketersediaan, dll.)
- Kolom gaji (rentang, ekspektasi gaji -- dalam gaji bulanan/tahunan untuk Indonesia)
- Kolom unggah (CV, cover letter PDF, referensi)

Klasifikasikan tiap pertanyaan:
- **Sudah dijawab di `## Application Answers` atau Blok H** -> pakai kembali jawaban yang ada
- **Pertanyaan baru** -> hasilkan jawaban dari report + `cv.md`

## Langkah 5 -- Hasilkan jawaban

Untuk **Draft without saving**, langkah ini tidak memakai report yang cocok, `## Application Answers`-nya, maupun Blok H: perlakukan setiap pertanyaan sebagai baru dan bekerja dari lowongan yang terlihat, `cv.md`, dan profil.

Untuk tiap pertanyaan, susun jawaban mengikuti skema ini:

1. **Konteks report**: Gunakan proof point dari blok B, story STAR dari blok F
2. **`## Application Answers` / Blok H sebelumnya**: Jika ada jawaban terkirim atau draft (jawaban terkirim lebih dulu), jadikan dasar lalu perhalus
3. **Nada "Saya memilih Anda"**: kerangka yang sama seperti di auto-pipeline -- percaya diri, tidak memohon
4. **Spesifisitas**: kutip sesuatu yang konkret dari lowongan yang terlihat di layar
5. **Proof point career-ops**: sertakan di "Informasi tambahan" jika ada kolom semacam itu

**Kolom khas formulir Indonesia yang umum:**
- **Ekspektasi gaji (bulanan/tahunan)** -> Rentang dari `profile.yml`, dalam IDR, dengan catatan "dapat dinegosiasikan sesuai paket keseluruhan"; perjelas apakah angkanya gross atau nett
- **Tanggal ketersediaan mulai** -> Tanggal realistis yang memperhitungkan notice period (sering 1 bulan / one month notice)
- **Izin kerja / Kewarganegaraan** -> Jujur dan ringkas; untuk WNI: "Tidak memerlukan sponsor visa (WNI)"
- **Bahasa** -> Level Bahasa Indonesia dan Inggris (mis.: profesional, lancar, TOEFL/IELTS jika relevan)
- **Mobilitas** -> Sebutkan area geografis yang bisa diterima dan frekuensi perjalanan

**Format keluaran:**

```text
## Jawaban untuk [Perusahaan] -- [Role]

Dasar: Report #NNN | Score: X.X/5 | Arketipe: [tipe]
[Untuk **Draft without saving**, ganti baris di atas dengan: "Tanpa report: draft untuk lowongan ini, tidak disimpan"]

---

### 1. [Pertanyaan persis dari formulir]
> [Jawaban siap copy-paste]

### 2. [Pertanyaan berikutnya]
> [Jawaban]

...

---

Catatan:
- [Observasi tentang role, perubahan, dll.]
- [Saran personalisasi yang perlu diperiksa kandidat]
```

## Langkah 6 -- Setelah melamar (opsional)

Sebelum menyimpan apa pun, dan sekali lagi tepat sebelum setiap penulisan di bawah (status dan jawaban), pastikan formulir masih lowongan dari report (`modes/apply.md` → Step 8 → **Write only to the report of this posting**). Pemberi kerja dan lowongan sama → langkah di bawah berlaku untuk report ini, juga setelah penyesuaian ke judul baru atau evaluasi ulang. Pemberi kerja lain atau lowongan lain → jangan pernah report ini: gunakan report yang ditulis untuk lowongan baru; jika tidak ada, jangan set status, jangan simpan jawaban, dan beri tahu kandidat bahwa lamaran ini belum tercatat.

Jika kandidat mengonfirmasi lamaran sudah dikirim:
1. Perbarui status dari "Evaluated" menjadi "Applied" dengan `node set-status.mjs --report <report#> Applied` (jangan mengedit tabel `applications.md` secara manual)
2. Perbarui bagian `## Application Answers` di report dengan jawaban final dan `**State:** submitted` (format di `modes/apply.md` -> Step 8). Blok H tetap draft dari evaluasi dan tidak diubah
3. Sarankan langkah berikutnya: `/career-ops contacto` untuk outreach LinkedIn ke hiring manager

## Penanganan scroll

Jika formulir punya lebih banyak pertanyaan daripada yang terlihat:
- Minta kandidat menggulir dan membagikan tangkapan layar lain
- Atau menempelkan pertanyaan yang tersisa
- Proses secara iteratif hingga seluruh formulir tercakup
