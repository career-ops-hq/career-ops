# ATS Normalization Test Fixture

This file is a regression fixture for the text normalization pass in `generate-pdf.mjs` (`normalizeTextForATS`). It lists the Unicode artifacts and markdown leftovers that cause parsing errors or display issues in ATS systems and legacy parsers, with the replacement the normalizer makes for each.

`tests/ats-normalization-fixture.test.mjs` reads the table below and runs every row through `normalizeTextForATS`. Each row must:
- contain the codepoint it names
- convert to exactly what the "Converts to" column says
- report its replacement key

The table must also hold one row for every replacement key the normalizer can report. Adding a rule to `generate-pdf.mjs` without a row here fails that test.

Some characters in the sample lines are invisible: the zero-width space sits between "Hello" and "world", and the non-breaking space between "5" and "years". Edit this file in an editor that keeps them. An editor or formatter that turns them into plain ASCII leaves the row testing nothing, and the test fails.

## What the normalizer converts

| Name | Codepoint | Sample line | Converts to | Replacement key |
|------|-----------|-------------|-------------|-----------------|
| Em-dash | U+2014 | Built and sold a SaaS — now shipping AI in production. | Built and sold a SaaS - now shipping AI in production. | `em-dash` |
| En-dash | U+2013 | Shipped 3 releases – all on time. | Shipped 3 releases - all on time. | `en-dash` |
| Curly double quote | U+201C / U+201D (also U+201E, U+201F) | “Led the migration” was a real bullet. | "Led the migration" was a real bullet. | `smart-double-quote` |
| Curly single quote | U+2018 / U+2019 (also U+201A, U+201B) | The team’s velocity tripled. | The team's velocity tripled. | `smart-single-quote` |
| Ellipsis | U+2026 | And so on… | And so on... | `ellipsis` |
| Zero-width space | U+200B (also U+200C, U+200D, U+2060, U+FEFF) | Hello​world | Helloworld | `zero-width` |
| Non-breaking space | U+00A0 | 5 years experience | 5 years experience | `nbsp` |
| Right arrow | U+2192 | Kafka → feature store | Kafka to feature store | `right-arrow` |
| Left arrow | U+2190 | Revenue ← retention | Revenue from retention | `left-arrow` |
| Up / down arrow | U+2191 / U+2193 | Churn ↓ 18% | Churn 18% | `vert-arrow` |
| Middle dot | U+00B7 | Python · Go | Python \| Go | `middot` |
| Bullet | U+2022 | Python • Go | Python \| Go | `bullet` |
| Euro sign | U+20AC | €90k base | EUR 90k base | `euro` |
| Pound sign | U+00A3 | £70k base | GBP 70k base | `pound` |
| Markdown bold | `**...**` | **Led** the team | <strong>Led</strong> the team | `markdown-bold` |
| Markdown italic | `_..._` | Shipped _Game Title_ on time | Shipped <em>Game Title</em> on time | `markdown-italic` |
| Hyphenated word | `-` inside a word | Owned end-to-end delivery | Owned <span style="white-space:nowrap">end-to-end</span> delivery | `hyphen-nowrap` |

A `\|` in the "Converts to" column is a literal `|`, escaped for the table. The normalizer leaves a Catalan `l·l` inside a word alone (`intel·ligència`), and it doesn't convert `¥`, since that sign means both the Japanese yen and the Chinese yuan.

## Writing quality guidelines (the writer must follow these)

The normalizer does NOT fix writing style. These are enforced by the rules in `modes/_shared.md` and should never appear in generated CV text in the first place.

- "passionate about machine learning"
- "results-oriented professional with a proven track record"
- "leveraged cutting-edge LLM technology"
- "spearheaded a strategic initiative"
- "facilitated cross-functional synergies"
- "crafted robust, scalable solutions"
- "in today's fast-paced digital world"
- "5+ years of experience in artificial intelligence"
- "demonstrated ability to drive innovative outcomes"

## How to verify the normalizer

Run the fixture test:

```bash
node test-all.mjs --only ats-normalization-fixture
```

For an end-to-end test, generate a CV PDF from a known dirty HTML file and inspect the output:

```bash
node generate-pdf.mjs /tmp/dirty-cv.html /tmp/clean-cv.pdf --format=a4
# Expected log line:
# 🧹 ATS normalization: N replacements (em-dash=X, smart-double-quote=Y, ...)
```
