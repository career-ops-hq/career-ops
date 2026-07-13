# Mode: melamar -- Asisten live untuk formulir lamaran

Mode interaktif untuk saat kandidat mengisi formulir lamaran di Chrome. Membaca apa yang ada di layar, memuat konteks evaluasi lowongan sebelumnya, dan menghasilkan jawaban yang dipersonalisasi untuk setiap pertanyaan formulir.

## Prasyarat

- **Ideal dengan Playwright terlihat**: Dalam mode terlihat, kandidat melihat browser dan Claude bisa berinteraksi dengan halaman.
- **Tanpa Playwright**: kandidat membagikan tangkapan layar atau menempelkan pertanyaan secara manual.

## Alur kerja

```text
1. DETEKSI      -> Baca tab Chrome yang aktif (tangkapan layar/URL/judul)
2. IDENTIFIKASI -> Ekstrak perusahaan + role dari halaman
3. CARI         -> Cocokkan dengan report yang ada di reports/
4. MUAT         -> Baca report lengkap + Blok G (jika ada)
5. BANDINGKAN   -> Apakah role di layar cocok dengan yang dievaluasi? Jika berubah -> beri peringatan
6. ANALISIS     -> Identifikasi SEMUA pertanyaan yang terlihat di formulir
7. HASILKAN     -> Untuk tiap pertanyaan, hasilkan jawaban yang dipersonalisasi
8. SAJIKAN      -> Tampilkan jawaban terformat untuk copy-paste
```

## Langkah 1 -- Deteksi lowongan

**Dengan Playwright:** Snapshot halaman aktif. Baca judul, URL, dan konten yang terlihat.

**Tanpa Playwright:** Minta kandidat untuk:
- Membagikan tangkapan layar formulir (Read tool bisa membaca gambar)
- Atau menempelkan pertanyaan formulir sebagai teks
- Atau menyebutkan perusahaan + role agar konteksnya dicari

## Langkah 2 -- Identifikasi dan muat konteks

1. Ekstrak nama perusahaan dan jabatan dari halaman
2. Cari di `reports/` berdasarkan nama perusahaan (Grep case-insensitive)
3. Jika cocok -> muat report lengkap
4. Jika ada Blok G -> muat draft jawaban sebelumnya sebagai dasar
5. Jika TIDAK cocok -> beri peringatan kepada kandidat dan tawarkan auto-pipeline cepat

## Langkah 3 -- Deteksi perubahan role

Jika role di layar berbeda dari yang dievaluasi:
- **Beri peringatan kepada kandidat**: "Role berubah dari [X] menjadi [Y]. Mau saya evaluasi ulang atau menyesuaikan jawaban dengan jabatan baru?"
- **Jika menyesuaikan**: Sesuaikan jawaban dengan role baru tanpa evaluasi ulang
- **Jika evaluasi ulang**: Jalankan evaluasi lengkap A-F, perbarui report, buat ulang Blok G
- **Perbarui tracker**: Ubah jabatan role di applications.md jika perlu

## Langkah 4 -- Analisis pertanyaan formulir

Identifikasi SEMUA pertanyaan yang terlihat:
- Kolom teks bebas (cover letter, "kenapa posisi ini", motivasi, dll.)
- Dropdown (dari mana tahu perusahaan, izin kerja, dll.)
- Ya/Tidak (mobilitas, visa, ketersediaan, dll.)
- Kolom gaji (rentang, ekspektasi gaji -- dalam gaji bulanan/tahunan untuk Indonesia)
- Kolom unggah (CV, cover letter PDF, referensi)

Klasifikasikan tiap pertanyaan:
- **Sudah dijawab di Blok G** -> pakai kembali jawaban yang ada
- **Pertanyaan baru** -> hasilkan jawaban dari report + `cv.md`

## Langkah 5 -- Hasilkan jawaban

Untuk tiap pertanyaan, susun jawaban mengikuti skema ini:

1. **Konteks report**: Gunakan proof point dari blok B, story STAR dari blok F
2. **Blok G sebelumnya**: Jika ada draft, jadikan dasar lalu perhalus
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

Jika kandidat mengonfirmasi lamaran sudah dikirim:
1. Perbarui status di `applications.md` dari "Evaluated" menjadi "Applied"
2. Perbarui Blok G report dengan jawaban final
3. Sarankan langkah berikutnya: `/career-ops contacto` untuk outreach LinkedIn ke hiring manager

## Penanganan scroll

Jika formulir punya lebih banyak pertanyaan daripada yang terlihat:
- Minta kandidat menggulir dan membagikan tangkapan layar lain
- Atau menempelkan pertanyaan yang tersisa
- Proses secara iteratif hingga seluruh formulir tercakup
