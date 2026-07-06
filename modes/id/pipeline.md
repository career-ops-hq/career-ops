# Mode: pipeline -- Inbox URL (Second Brain)

Memproses URL lowongan yang menumpuk di `data/pipeline.md`. Kandidat menambahkan URL kapan pun ia mau lalu menjalankan `/career-ops pipeline` untuk memproses semuanya sekaligus.

## Alur kerja

1. **Baca** `data/pipeline.md` -> temukan item `- [ ]` di bagian "Menunggu" / "Pending" / "Pendientes"
2. **Untuk setiap URL yang menunggu**:
   a. Pesan `REPORT_NUM` urut berikutnya secara atomik dengan menjalankan `node reserve-report-num.mjs` (dan lepas sentinel dengan menjalankan `node reserve-report-num.mjs --release <num>` setelah report ditulis)
   b. **Ekstrak lowongan** dengan Playwright (`browser_navigate` + `browser_snapshot`) -> WebFetch -> WebSearch
   c. Jika URL tidak bisa diakses -> tandai sebagai `- [!]` dengan catatan dan lanjutkan
   d. **Jalankan auto-pipeline lengkap**: Evaluasi A-F -> Report .md -> PDF (jika score >= 3.0) -> Tracker
   e. **Pindahkan dari "Menunggu" ke "Diproses"**: `- [x] #NNN | URL | Perusahaan | Role | Score/5 | PDF ya/tidak`
3. **Jika ada 3+ URL menunggu**, jalankan agen paralel (Agent tool dengan `run_in_background`) untuk memaksimalkan kecepatan.
4. **Di akhir**, tampilkan tabel ringkasan:

```text
| # | Perusahaan | Role | Score | PDF | Tindakan yang disarankan |
```

## Format pipeline.md

```markdown
## Menunggu
- [ ] https://jobs.example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | Company PT | Senior PM
- [!] https://private.url/job -- Error: perlu login

## Diproses
- [x] #143 | https://jobs.example.com/posting/789 | Acme PT | AI PM | 4.2/5 | PDF ya
- [x] #144 | https://boards.greenhouse.io/xyz/jobs/012 | BigCo | SA | 2.1/5 | PDF tidak
```

> Catatan: Header bagian bisa dalam EN ("Pending"/"Processed"), ES ("Pendientes"/"Procesadas"), DE ("Offen"/"Verarbeitet"), atau ID ("Menunggu"/"Diproses"). Bersikaplah fleksibel saat membaca, konsisten dengan gaya yang ada saat menulis.

## Deteksi cerdas lowongan dari URL

1. **Playwright (diutamakan):** `browser_navigate` + `browser_snapshot`. Berfungsi dengan semua SPA.
2. **WebFetch (fallback):** Untuk halaman statis atau ketika Playwright tidak tersedia.
3. **WebSearch (upaya terakhir):** Cari di portal sekunder yang mengindeks lowongan.

**Kasus khusus:**
- **LinkedIn**: Bisa memerlukan login -> tandai `[!]` dan minta kandidat menempelkan teksnya
- **PDF**: Jika URL menunjuk ke PDF, baca langsung dengan Read tool
- **Prefiks `local:`**: Baca file lokal. Contoh: `local:jds/linkedin-pm-ai.md` -> baca `jds/linkedin-pm-ai.md`
- **Glints / Jobstreet / Kalibrr**: Portal Indonesia yang umum. Playwright menangani cookie banner dengan baik
- **LinkedIn ID / Indeed ID**: Lowongan terstruktur, mudah dibaca mesin. WebFetch biasanya cukup

## Penomoran otomatis

1. Jalankan `node reserve-report-num.mjs` untuk memesan nomor urut berikutnya secara atomik (stdout mengembalikan `{###}`).
2. Tulis report dengan nomor tersebut.
3. Lepas sentinel dengan menjalankan `node reserve-report-num.mjs --release {###}` setelah report ditulis.

## Sinkronisasi sumber

Sebelum memproses URL, verifikasi sinkronisasi:

```bash
node cv-sync-check.mjs
```

Jika terjadi desinkronisasi, beri peringatan kepada kandidat sebelum melanjutkan.
