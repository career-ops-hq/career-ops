# Bundled CV fonts

`templates/resume-template.html` embeds these files via `@font-face`, and
`generate-pdf.mjs` inlines them as `data:` URLs so PDF rendering makes no
network requests. Only the latin and latin-ext subsets are bundled.

- DM Sans 4.004 (variable): `dm-sans-latin.woff2`, `dm-sans-latin-ext.woff2`.
  Upstream: https://github.com/googlefonts/dm-fonts.
  License: `dm-sans-OFL.txt`.
- Space Grotesk 2.000 (variable): `space-grotesk-latin.woff2`,
  `space-grotesk-latin-ext.woff2`.
  Upstream: https://github.com/floriankarsten/space-grotesk.
  License: `space-grotesk-OFL.txt`.

Both families are distributed by Google Fonts under the SIL Open Font
License 1.1, which requires the license to accompany any redistribution. Each
`*-OFL.txt` carries the copyright line from that family's font `name` table.
The directory is flat because the template references `./fonts/{file}.woff2`
directly.
