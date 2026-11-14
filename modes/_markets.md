# Market mode sets

AGENTS.md → "Output Language vs Market Modes" sends you here. It defines `language.output` and `language.modes_dir` and when to switch to a market set; this file lists the sets and covers a `modes_dir` list for several markets at once.

## Market sets

Default modes are in `modes/` (English). Market-specific mode sets (each includes `_shared.md`, an evaluation mode, an apply mode, and `pipeline.md`):

| Market | Dir | Evaluation / Apply | Local vocabulary (examples) |
|--------|-----|--------------------|------------------------------|
| German (DACH) | `modes/de/` | `angebot` / `bewerben` | 13. Monatsgehalt, Probezeit, Kündigungsfrist, AGG, Tarifvertrag |
| Austria (English) | `modes/at/` | `offer` / `apply` | KV-Mindestgehalt, 14 Gehälter, Sonderzahlungen, Probemonat, All-in, Abfertigung Neu |
| French (FR/BE/CH/LU) | `modes/fr/` | `offre` / `postuler` | CDI/CDD, SYNTEC, RTT, 13e mois, titres-restaurant, CSE |
| Arabic (Middle East) | `modes/ar/` | `fursah` / `takdeem` | مكافأة نهاية الخدمة, التأمينات الاجتماعية, فترة التجربة |
| Japanese (Japan) | `modes/ja/` | `kyujin` / `oubo` | 正社員, 賞与, みなし残業, 年俸制, 36協定 |
| Turkish (Turkey) | `modes/tr/` | `is-ilani` / `basvuru` | SGK, kıdem tazminatı, brüt/net maaş, BES |
| Hindi (India) | `modes/hi/` | `naukri` / `aavedan` | CTC vs. in-hand, PF/EPF, Notice period/buyout, ESOPs |
| India (English) | `modes/in/` | `offer` / `apply` | CTC vs. in-hand, LPA, batch eligibility, CGPA/backlog cut-offs, notice period/buyout, bonds |
| Spanish (ES/LatAm) | `modes/es/` | `oferta` / `aplicar` | Contrato indefinido, convenio, pagas extra, Seguridad Social |
| Portuguese (BR/PT) | `modes/pt/` | `oferta` / `aplicar` | CLT, PJ, FGTS, 13º, férias, vale-refeição |
| Italian (Italy) | `modes/it/` | `annuncio` / `candidarsi` | CCNL, tempo indeterminato, tredicesima |
| Dutch (NL/BE) | `modes/nl/` | `vacature` / `solliciteren` | vakantiegeld, proeftijd, opzegtermijn, pensioen |
| Polish (Poland) | `modes/pl/` | `oferta` / `aplikuj` | Umowa o pracę, B2B, ZUS, okres wypowiedzenia, urlop |
| Danish (Denmark) | `modes/da/` | `oferta` / `apply` | løn, opsigelsesvarsel, ferie, overenskomst, A-kasse |
| Norwegian, Bokmål (Norway) | `modes/nb/` | `stilling` / `soknad` | fast ansettelse, prøvetid, oppsigelsestid, tariffavtale, feriepenger, OTP |
| Russian | `modes/ru/` | `oferta` / `apply` | ТК РФ, оклад, испытательный срок, самозанятый, ДМС |
| Ukrainian (Ukraine) | `modes/ua/` | `oferta` / `apply` | ФОП, КЗпП, оклад, випробувальний термін |
| Chinese, Simplified | `modes/zh/` | `oferta` / `apply` | 五险一金, 试用期, 年终奖, 劳动合同, 竞业 |
| Chinese, Traditional | `modes/zh-TW/` | `oferta` / `apply` | 勞保, 試用期, 年終獎金, 勞動契約, 特休 |
| Korean (South Korea) | `modes/ko/` | `gonggo` / `jiwon` | 정규직, 계약직, 퇴직금, 연봉 |
| Indonesian (Indonesia) | `modes/id/` | `lowongan` / `melamar` | THR, BPJS, PKWT, pesangon, UMR |
| Singapore (English) | `modes/sg/` | `offer` / `apply` | Employment Pass, COMPASS, S Pass, CPF, AWS, monthly SGD |
| Vietnamese (Vietnam) | `modes/vi/` | `tuyen-dung` / `ung-tuyen` | Gross vs Net, thử việc, BHXH/BHYT/BHTN, lương tháng 13, trợ cấp thôi việc |

## Multiple simultaneous target markets (#3793)

`language.modes_dir` may also be a **list** of declared candidate markets, for a candidate genuinely running parallel campaigns — not switching sequentially — e.g. a candidate applying in both the DACH region and China at once:

```yaml
language:
  output: en
  modes_dir: [modes/de, modes/zh] # DACH and China
```

Declared, not inferred: the user states which markets they are actually running campaigns in. When two or more are declared:
- The FIRST entry is the **primary** market and supplies the evaluation-mode file (`oferta.md`/`angebot.md`/...) — one JD can only be evaluated against one set of A-F rules at a time.
- For modes that load shared context, EVERY declared market's `_shared.md` is loaded into context, not just the primary one (a mode that loads only its mode file, such as `triage`, still loads only its mode file).
- `modes` itself is a valid list entry: it represents the default/global rules for a target market that has no localized directory. It still counts as a declared candidate market; when first, it supplies `modes/oferta.md`, and `modes/_shared.md` is loaded once as the baseline rather than duplicated as an additional market include.
- Per-JD, which declared market's concepts actually apply is determined from the JD's own **MARKET signals** — hiring-entity jurisdiction, currency, benefits/legal vocabulary — the same judgment Block G's posting-legitimacy signals already exercise (`modes/oferta.md`: "benefits/employment terminology country mismatch", "third-party platform location tag mismatch"). **Never infer the market from the JD's language alone.** A French-language Quebec/federal-Canada JD needs Canada's concepts (EI, CPP, ESA) — not `modes/fr`'s France/Belgium/Switzerland/Luxembourg concepts (CDI/CDD, SYNTEC, RTT) — because language and market are different axes.
- When the market signal is genuinely ambiguous between two declared candidates, branch on whether anyone can answer: in an **interactive session**, ask the candidate and stop before writing or merging a report/tracker entry until they choose; in an **unattended run** (`<cli> -p`, `codex exec`, or a batch worker), continue with the first/primary market and state the ambiguity plus the primary-market fallback explicitly in the report header or Block G.

A single-string `modes_dir` (today's default, ~90% of users) layers the market files on the English canon the same way: the English version of every mode-loaded file is read first and English workflow rules prevail on conflicts, so rules a translator did not copy still apply.
