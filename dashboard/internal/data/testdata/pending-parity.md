# Pipeline

<!-- Shared by dashboard/internal/data/pending_test.go and
     tests/dashboard-pending-parity.test.mjs (#5269). Every row is an unchecked
     row of the Pending section with a distinct URL, so the Go reader and the
     web parseInbox must read the same fields from each one. -->

## Pending

- [ ] https://jobs.example.com/acme/101 | Acme | Product Manager | Remote | $120k-$150k | posted: 2026-10-01 | rank: 4.2/5 — strong fit
- [ ] https://jobs.example.com/acme/102 | Acme | Data Analyst | posted: 2026-10-02 | trust: 80 | yrs: 3-5
- [ ] #012 | https://jobs.example.com/acme/103 | Acme | Designer | Berlin, Germany
- [ ] local:jds/acme-writer.md | Acme | Technical Writer
- [ ] https://jobs.example.com/acme/104 | note: Acme Labs | rank: not a label here | Lisbon
- [ ] https://jobs.example.com/acme/105
- [ ] https://jobs.example.com/acme/106 | Acme | Support Lead | Remote | rank: 4.25/5 – en dash reason
- [ ] https://jobs.example.com/acme/107 | Acme | Engineer | Posted: 2026-09-30 | Rank: 3/5 - ok
- [ ] https://jobs.example.com/acme/108 | Acme | Analyst | Madrid | posted: last week
  - [ ] https://jobs.example.com/acme/109 | Acme | Indented | Paris
-[ ]https://jobs.example.com/acme/110 | Acme | No spaces
- [ ] https://jobs.example.com/acme/111 | Acme |  | Toronto
- [ ] https://jobs.example.com/acme/112 | Acme | Lead | Remote | | extra | cells | rank: 2/5 — weak
- [ ] HTTPS://jobs.example.com/acme/113 | Acme | Upper scheme | rank: 4.2/5
- [ ] https://jobs.example.com/acme/114 | Acme | Zero | Remote | rank: 0/5 — no match
- [ ] https://jobs.example.com/acme/115 | Acme | Non-breaking space | posted: 2026-10-03 | rank: 3.5/5 — nbsp reason
 - [ ] https://jobs.example.com/acme/116 |﻿Acme | Indented with NBSP | Oslo　

## Processed
