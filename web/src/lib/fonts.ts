import { Inter, Instrument_Serif } from "next/font/google";

// Body / UI — Inter, same as the career-ops-docs home (next/font/google,
// self-hosted: no CLS, GDPR-safe).
export const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Editorial display — Instrument Serif. The home uses it for the hero display
// copy and section headings (the "career-ops" editorial voice). Regular +
// italic (pull-quotes) mirror the docs lib/fonts.ts.
export const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: "normal",
  variable: "--font-instrument-serif",
  display: "swap",
});

export const instrumentSerifItalic = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  variable: "--font-instrument-serif-italic",
  display: "swap",
});
