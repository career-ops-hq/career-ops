# Vendored web fonts

The web app vendors only the latin files it uses so `next build` does not make
network requests to Google Fonts.

- Inter variable normal: `@fontsource-variable/inter@5.2.8`
- Instrument Serif 400 normal and italic: `@fontsource/instrument-serif@5.2.8`

Both packages publish the Google Fonts binaries under the SIL Open Font
License 1.1. Each family directory includes the corresponding `OFL.txt` from
that package. Source packages:

- https://www.npmjs.com/package/@fontsource-variable/inter/v/5.2.8
- https://www.npmjs.com/package/@fontsource/instrument-serif/v/5.2.8
