import localFont from "next/font/local";

// Body / UI — Inter, same as the career-ops-docs home. The latin variable
// subset is vendored so an offline production build never contacts Google.
export const inter = localFont({
  src: [{
    path: "../assets/fonts/inter/Inter-Latin-Variable.woff2",
    weight: "100 900",
    style: "normal",
  }],
  variable: "--font-inter",
  display: "swap",
});

// Editorial display — Instrument Serif. Regular and italic mirror the docs
// typography while remaining fully local at build and runtime.
export const instrumentSerif = localFont({
  src: [{
    path: "../assets/fonts/instrument-serif/InstrumentSerif-Latin-Regular.woff2",
    weight: "400",
    style: "normal",
  }],
  variable: "--font-instrument-serif",
  display: "swap",
});

export const instrumentSerifItalic = localFont({
  src: [{
    path: "../assets/fonts/instrument-serif/InstrumentSerif-Latin-Italic.woff2",
    weight: "400",
    style: "italic",
  }],
  variable: "--font-instrument-serif-italic",
  display: "swap",
});
