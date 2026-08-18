# Mode: interview/plan — Interview Prep Planner

Diberikan deskripsi pekerjaan dan tanggal/waktu wawancara, buat rencana persiapan terstruktur dan berbasis blok waktu yang disesuaikan dengan kesenjangan spesifik kandidat.

---

## Inputs

1. **Job description** (wajib) — tempel secara inline atau berikan URL
2. **Interview date and time** (wajib) — untuk menghitung waktu yang tersedia
3. **Interviewer name and role** (jika diketahui) — menentukan kedalaman dan nada persiapan. Putaran berikutnya (panel / onsite loop) sering kali mencantumkan beberapa pewawancara sekaligus — dari pengguna secara langsung, kalender yang ditempel, atau email penjadwalan yang ditempel. Jika lebih dari satu panelis disebutkan, lihat catatan Panel Intel di Step 2.
4. **Round type** (jika diketahui) — screening, technical/domain-specific, design/case study, behavioral panel
5. **CV** di `cv.md` + `article-digest.md` (jika ada) — baca untuk memahami pengalaman, keterampilan, dan proof points
6. **Profile** di `config/profile.yml` + `modes/_profile.md` — baca untuk memahami narasi, archetypes, dan targets
7. **Story bank** di `interview-prep/story-bank.md` — cerita STAR+R yang sudah ada
8. **Question bank** di `interview-prep/question-bank.md` — kesenjangan yang sudah ada (jika file tersedia)
9. **Prior stated compensation** — jika tracker# diketahui, jalankan `node salary-gap.mjs --stated-for <tracker#>` (zero tokens). Setiap observasi `stated` sebelumnya adalah angka yang sudah dikomitmenkan kandidat pada putaran sebelumnya kepada pewawancara tertentu — masukkan ke quick-reference Step 4 agar kandidat tetap konsisten dan tidak secara tidak sengaja melakukan negosiasi ulang.

---

## Step 1 — Fit Assessment

Baca CV dan JD. Buat penilaian dua kolom:

**Strengths to anchor on:** pengalaman, jabatan, domain, dan proof points yang secara langsung sesuai dengan JD.

**Gaps to close:** keterampilan, tools, atau pengalaman yang disebutkan dalam JD tetapi tidak ada atau masih lemah di CV. Urutkan berdasarkan kemungkinan diuji pada round type yang spesifik ini.

Jujurlah. Kesenjangan adalah kesenjangan — tandai dengan jelas agar waktu persiapan digunakan pada bagian yang tepat.

---

## Step 2 — Round Intelligence

Identifikasi apa yang sebenarnya dievaluasi dalam round ini berdasarkan:

* Peran pewawancara (manager = communication + passion + fundamentals; practitioner = depth + judgment)
* Label round (screening, technical/domain, design/case study, final)
* Sinyal dari JD (hal-hal yang mereka tekankan)

**Recruiter screen:**

* Box-checking: kecocokan, keselarasan kompensasi, logistik, komunikasi
* Bukan technical test — pertanyaan mendalam muncul pada HM dan putaran berikutnya
* Kemungkinan: background pitch, "why us/why this role", ekspektasi kompensasi, timeline, satu pertanyaan logistik
* Perlakukan ini sebagai checkpoint yang mudah; gunakan waktu persiapan untuk membangun fondasi bagi tahap berikutnya

**Hiring-manager screen:**

* Communication, passion, fit — ditambah leadership philosophy dan judgment
* Fundamentals dari core skill dalam JD — bukan internal yang mendalam
* 1–2 cerita behavioral
* Kemungkinan: background, "why us", satu core concept dari JD, satu leadership story, pertanyaan situasional yang berorientasi ke masa depan

**Technical / domain deep-dive with a practitioner:**

* Kedalaman dalam core skill dari JD (misalnya, runtime internals untuk engineering, modeling choices untuk data, valuation methods untuk finance)
* Skenario terapan dari aktivitas sehari-hari dalam role
* Live exercise atau worked walkthrough mungkin dilakukan
* Stories digunakan sebagai bukti, bukan sebagai fokus utama

**Design / case study panel:**

* Solusi lengkap — constraints, components, tradeoffs, failure modes
* Dimensi kualitas yang ditekankan JD (misalnya, scalability, compliance, measurability)
* Level senior: tentukan constraints, ajukan clarifying questions, arahkan percakapan

Sesuaikan rencana dengan round. Mempersiapkan depth secara berlebihan untuk screening membuang waktu dan menciptakan mindset yang keliru.

**Panel Intel (when panelists are named).** Jika dua atau lebih pewawancara disebutkan untuk round ini — dari pengguna secara langsung, kalender yang ditempel, atau email penjadwalan yang ditempel — buat tabel Panel Intel sebelum melanjutkan ke Step 3. Lihat `modes/interview-prep.md` § "Panel Intel table" (under Step 4 → `panel-mixed`) untuk format tabel lengkap dan tiga sub-behaviors (decision-maker weighting against the JD's reporting line, career-trajectory signal reading, per-panelist tailored closing question) — terapkan logika yang sama di sini, lalu gunakan audience tags yang dihasilkan untuk menentukan ukuran blok Step 3 bagi setiap panelis, bukan menyiapkan satu paket generik. Satu pewawancara yang disebutkan tidak memerlukan tabel; langsung lanjut ke Step 3 yang disesuaikan dengan round type orang tersebut di atas.

---

## Step 3 — Build the Time-Blocked Plan

Hitung jam yang tersedia dari sekarang hingga waktu wawancara. Bagi menjadi beberapa blok:

Sebelum menentukan ukuran blok, periksa `interview-prep/question-bank.md` (jika tersedia). Setiap pertanyaan yang ditandai 🔴 dari round sebelumnya adalah kesenjangan yang sudah terbukti — berikan blok khusus terlepas dari bagaimana analisis CV-vs-JD menilainya. Data performa nyata lebih penting daripada risiko yang hanya disimpulkan.

**Research check — before drafting Block 4.** Block 4 memetakan stories ke "likely question types", tetapi jangan membiarkan default ini menjadi sekadar pattern-guessing ketika pertanyaan nyata yang telah dilaporkan dapat diperiksa:

1. **Check for existing sourced research first.** Jika `interview-prep/{company-slug}-{role-slug}.md` sudah ada (dari run `interview-prep` sebelumnya), baca pertanyaan bersumber dari Step 1/Step 3 dan gunakan kembali secara langsung — jangan pernah melakukan ulang pencarian yang sudah dilakukan dan memiliki citation.
2. **If no prior research file exists, run** `interview-prep.md`**'s "Step 1 — Research" WebSearch queries directly**, dengan cakupan audience dari round spesifik ini (recruiter/HR, hiring manager, atau peer/technical panel — lihat Step 2 di atas), bukan keseluruhan company-research pass.
3. **Same tagging discipline as** `interview-prep.md`**:** pertanyaan bersumber harus mencantumkan sumbernya; apa pun yang tidak ditemukan menggunakan `[inferred from JD]` — jangan membuat label ketiga atau format citation yang berbeda (lihat `interview-prep.md`'s "Tag conventions").
4. **If the search genuinely yields nothing** (perusahaan yang tidak umum, tidak ada laporan wawancara publik), katakan secara eksplisit dalam output rencana dan lanjutkan dengan inferensi berdasarkan JD/profile-pattern — prinsip partial-but-honest yang sama seperti yang sudah diterapkan `interview-prep.md` pada intel yang terbatas, bukan pendekatan perfect-or-nothing.

Ini adalah counterpart proaktif dari research path reaktif `modes/interview/practice.md` yang berjalan di tengah sesi (lihat "When company-intel is thin mid-session") — tahap riset yang sama, dijalankan di sini sebelum rencana dibuat, bukan ketika kandidat mengalami kesulitan secara langsung.

**Template (adjust block sizes based on total hours available):**

```text
Block 1 — Lock your narrative (first, always)
  - Tuliskan timeline background Anda secara eksplisit
  - Siapkan "why this company" dengan hubungan yang spesifik dengan riwayat Anda
  - Siapkan proof point story terkuat Anda (versi 30 detik)
  - Time: ~15% of available hours

Block 2 — Priority domain topic (highest-risk gap first)
  - Satu topik per blok — jangan mencampurnya
  - Untuk masing-masing: concept → your story hook → likely follow-up questions
  - Time: ~25% of available hours

Block 3 — Secondary domain topic
  - Kesenjangan dengan risiko tertinggi kedua
  - Time: ~20% of available hours

Block 4 — Behavioral stories
  - Petakan stories yang sudah ada ke likely question types — yang bersumber dari Research Check di atas terlebih dahulu, `[inferred from JD]` untuk mengisi kesenjangan yang tersisa
  - Latih versi verbal 2 menit dari masing-masing
  - Siapkan Reflection untuk masing-masing — pembeda kandidat senior
  - Time: ~15% of available hours

Block 5 — Company research
  - Product pages yang relevan dengan role
  - Hubungan antara riwayat Anda dan domain spesifik mereka
  - 3–4 pertanyaan tajam untuk diajukan kepada mereka
  - Time: ~10% of available hours

Block 6 — Practice run (if time permits)
  - Satu pertanyaan untuk setiap likely topic — jawab dengan suara keras, dengan batas waktu
  - Time: ~10% of available hours

Block 7 — Buffer + rest
  - Berhenti belajar 60–90 menit sebelum wawancara
  - Cramming pada satu jam terakhir menambah noise, bukan signal
  - Time: remaining
```

Sesuaikan ukuran blok berdasarkan tingkat kesenjangan dan round type. Jika ini adalah screening, Block 4 (behavioral) dan Block 5 (company research) lebih penting daripada domain blocks yang mendalam.

---

## Step 4 — Priority Quick-Reference

Di akhir rencana, buat quick-reference satu halaman yang dapat dibaca sekilas oleh kandidat 15 menit sebelum wawancara:

```markdown
**## 15-Minute Pre-Interview Review**

**Your anchor sentence:** [satu kalimat yang menjelaskan mengapa Anda tepat untuk role ini]

**Top 3 things to remember:**
1. [pesan terpenting yang harus ditinggalkan kepada pewawancara]
2. [pertanyaan yang paling mungkin muncul dan kalimat pertama dari jawaban Anda]
3. [hubungan antara riwayat Anda dan domain mereka]

**Compensation — already discussed:** [hanya jika `--stated-for` mengembalikan observasi sebelumnya] "You stated {amount} {currency} to {interviewer} on {date} in {round}. Stay consistent unless something material changed." Hilangkan blok ini sepenuhnya jika tidak ada observasi `stated` sebelumnya untuk tracker# ini — jangan mengarang angka yang tidak pernah disebutkan.

**Your questions to ask:**
1. [pertanyaan 1]
2. [pertanyaan 2]
3. [pertanyaan 3]
```

---

## Step 5 — Save Output

Simpan rencana ke `interview-prep/{company-slug}-{role-slug}.md` jika file belum ada, atau tambahkan bagian `## Prep Plan` jika file sudah ada.

---

## Rules

* **Calibrate to the round.** Rencana persiapan screening sangat berbeda dari rencana persiapan design-panel. Jangan selalu menggunakan depth maksimum untuk setiap wawancara.
* **Gaps first.** Waktu terbatas. Strengths kandidat tidak membutuhkan persiapan — gaps mereka yang membutuhkannya.
* **🔴 gaps from the question bank take priority over inferred gaps.** Data performa nyata lebih kuat daripada analisis CV-vs-JD. Jika kandidat sudah tahu bahwa mereka kesulitan pada suatu topik, jangan menguburnya.
* **One topic per block.** Mencampur topik dalam satu blok mengurangi retensi.
* **Always include rest time.** Kandidat yang cukup beristirahat memiliki performa lebih baik daripada kandidat yang terus cramming.
* **Never generate fake company intel.** Jika tidak memiliki research, katakan demikian — jangan mengarang klaim tentang budaya atau detail teknis perusahaan.
* **Check for real reported questions before Block 4.** Gunakan kembali `interview-prep/{company-slug}-{role-slug}.md` jika tersedia; jika tidak, jalankan Step 1 queries dari `interview-prep.md` yang cakupannya disesuaikan dengan round ini. Gunakan tagging discipline yang sama seperti `interview-prep.md` — sourced-with-citation, atau `[inferred from JD]` jika tidak ada hasil nyata. Ini adalah counterpart proaktif dari "Never generate fake company intel" di atas: periksa informasi nyata terlebih dahulu sebelum beralih ke inferensi.
* **Never invent claims for the candidate.** Anchor sentence dan pre-interview talking points dalam quick-reference (Step 4) harus berdasarkan apa yang benar-benar dimiliki kandidat — `cv.md`, `article-digest.md`, atau story bank. Jangan membuat klaim yang bergantung pada pengalaman atau metrik yang tidak dimiliki kandidat. Jika suatu klaim muncul di `interview-prep/retracted-claims.md`, jangan pernah memasukkannya.
