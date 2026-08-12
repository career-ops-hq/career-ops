// pdf-text.mjs — Minimal, dependency-free PDF text extraction for job ads.
//
// Handles the two formats produced by the vast majority of applicant-tracking
// systems and exported job ads:
//   1. uncompressed content streams
//   2. FlateDecode-compressed content streams (node:zlib)
//
// Text is recovered from the standard text-showing operators (Tj, TJ, ' and ")
// and line breaks from T* and show-on-new-line operators. Nothing is ever
// invented: streams we cannot decode are skipped, and a PDF with no
// recoverable text raises a clear error instead of returning garbage.

import zlib from "node:zlib";

export const MAX_PDF_BYTES = 10 * 1024 * 1024;

function decodePdfString(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) break;
    if (next === "n") {
      out += "\n";
      i += 1;
    } else if (next === "r") {
      out += "\r";
      i += 1;
    } else if (next === "t") {
      out += "\t";
      i += 1;
    } else if (next === "b") {
      out += "\b";
      i += 1;
    } else if (next === "f") {
      out += "\f";
      i += 1;
    } else if (next >= "0" && next <= "7") {
      let octal = "";
      let j = i + 1;
      while (j < raw.length && octal.length < 3 && raw[j] >= "0" && raw[j] <= "7") {
        octal += raw[j];
        j += 1;
      }
      out += String.fromCharCode(parseInt(octal, 8));
      i = j - 1;
    } else {
      out += next;
      i += 1;
    }
  }
  return out;
}

function decodeHexString(raw) {
  const hex = raw.replace(/\s+/g, "");
  let out = "";
  for (let i = 0; i + 1 < hex.length; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return out;
}

function extractFromStream(content, lines) {
  const len = content.length;
  let i = 0;
  let lineBuf = "";
  const flushLine = () => {
    if (lineBuf.trim()) lines.push(lineBuf);
    lineBuf = "";
  };

  while (i < len) {
    const ch = content[i];

    if (ch === "(") {
      // Literal string, possibly followed by Tj / ' / " / T*
      let j = i + 1;
      let depth = 1;
      let raw = "";
      while (j < len && depth > 0) {
        const c = content[j];
        if (c === "\\") {
          raw += c;
          raw += content[j + 1] ?? "";
          j += 2;
          continue;
        }
        if (c === "(") depth += 1;
        if (c === ")") depth -= 1;
        if (depth > 0) raw += c;
        j += 1;
      }
      const rest = content.slice(j).match(/^\s*(Tj|'|"|TJ|T\*)/);
      const op = rest ? rest[1] : "";
      lineBuf += decodePdfString(raw);
      if (op === "'" || op === '"' || op === "T*") flushLine();
      i = j;
      continue;
    }

    if (ch === "<") {
      const hex = content.slice(i).match(/^<([0-9a-fA-F\s]+)>/);
      if (hex) {
        lineBuf += decodeHexString(hex[1]);
        i += hex[0].length;
        continue;
      }
      i += 1;
      continue;
    }

    if (ch === "[") {
      // Text array for TJ: collect string tokens until the matching ]
      let j = i + 1;
      let depth = 1;
      const parts = [];
      while (j < len && depth > 0) {
        const c = content[j];
        if (c === "[") depth += 1;
        else if (c === "]") {
          depth -= 1;
          if (depth === 0) break;
        } else if (c === "(") {
          let k = j + 1;
          let d2 = 1;
          let raw = "";
          while (k < len && d2 > 0) {
            const cc = content[k];
            if (cc === "\\") {
              raw += cc;
              raw += content[k + 1] ?? "";
              k += 2;
              continue;
            }
            if (cc === "(") d2 += 1;
            if (cc === ")") d2 -= 1;
            if (d2 > 0) raw += cc;
            k += 1;
          }
          parts.push(decodePdfString(raw));
          j = k;
          continue;
        } else if (c === "<") {
          const hex = content.slice(j).match(/^<([0-9a-fA-F\s]+)>/);
          if (hex) {
            parts.push(decodeHexString(hex[1]));
            j += hex[0].length;
            continue;
          }
        }
        j += 1;
      }
      const rest = content.slice(j).match(/^\s*(TJ|Tj|'|")/);
      const op = rest ? rest[1] : "";
      lineBuf += parts.join("");
      if (op === "'" || op === '"') flushLine();
      i = j;
      continue;
    }

    if (ch === "T" && content[i + 1] === "*") {
      flushLine();
      i += 2;
      continue;
    }

    i += 1;
  }
  flushLine();
}

function inflateOrNull(raw) {
  const candidates = [raw, raw.replace(/\s+$/, "")];
  for (const candidate of candidates) {
    try {
      return zlib.inflateSync(Buffer.from(candidate, "latin1")).toString("latin1");
    } catch {
      // try next candidate
    }
  }
  return null;
}

export function extractPdfText(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.byteLength > MAX_PDF_BYTES) {
    throw new Error("PDF:en är för stor (max 10 MB).");
  }
  if (!buffer.subarray(0, 16).toString("latin1").includes("%PDF")) {
    throw new Error("Filen är inte en giltig PDF.");
  }

  const latin = buffer.toString("latin1");
  const chunks = [];
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let match;
  while ((match = streamRe.exec(latin)) !== null) {
    const raw = match[1].replace(/\r?\n$/, "");
    const before = latin.slice(Math.max(0, match.index - 500), match.index);
    const isFlate = /\/Filter\s*\/FlateDecode/.test(before);
    let decoded = null;
    if (isFlate) {
      decoded = inflateOrNull(raw);
    } else {
      decoded = raw;
    }
    if (decoded === null) continue; // undecodable stream — never invent text
    const lines = [];
    extractFromStream(decoded, lines);
    chunks.push(lines.join("\n"));
  }

  const text = chunks
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!text) {
    throw new Error("Kunde inte extrahera text ur PDF:en — inga textlager hittades.");
  }
  return text;
}
