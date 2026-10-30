// Read words and their boxes out of a PDF the print test generated.
// The web CI image has Chrome and no Poppler, so this stays inside Node.
import fs from "node:fs";
import zlib from "node:zlib";

function skip(s, i) {
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 12) { i++; continue; }
    if (s[i] === "%") {
      while (i < s.length && s[i] !== "\n" && s[i] !== "\r") i++;
      continue;
    }
    break;
  }
  return i;
}

function decodeName(raw) {
  return raw.replace(/#([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function parseName(s, i) {
  let j = i + 1;
  while (j < s.length && !"/()<>[]{}% \t\r\n\f".includes(s[j])) j++;
  return { i: j, v: decodeName(s.slice(i + 1, j)) };
}

function parseLiteral(s, i) {
  let j = i + 1;
  let out = "";
  let depth = 1;
  while (j < s.length && depth > 0) {
    const c = s[j++];
    if (c === "\\") {
      const e = s[j++] ?? "";
      const named = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
      if (named[e] != null) out += named[e];
      else if (e >= "0" && e <= "7") {
        let oct = e;
        for (let k = 0; k < 2 && s[j] >= "0" && s[j] <= "7"; k++) oct += s[j++];
        out += String.fromCharCode(Number.parseInt(oct, 8));
      } else if (e === "\r") { if (s[j] === "\n") j++; }
      else if (e !== "\n") out += e;
    } else if (c === "(") { depth++; out += "("; }
    else if (c === ")") { depth--; if (depth) out += ")"; }
    else out += c;
  }
  return { i: j, v: out };
}

function parseHex(s, i) {
  let j = i + 1;
  let hex = "";
  while (j < s.length && s[j] !== ">") {
    if (!/\s/.test(s[j])) hex += s[j];
    j++;
  }
  if (hex.length % 2) hex += "0";
  return { i: j + 1, v: Buffer.from(hex, "hex") };
}

function parseValue(s, i) {
  i = skip(s, i);
  if (s.startsWith("<<", i)) {
    i += 2;
    const dict = {};
    while (true) {
      i = skip(s, i);
      if (s.startsWith(">>", i)) return { i: i + 2, v: dict };
      if (s[i] !== "/") throw new Error("PDF dictionary key is missing");
      const name = parseName(s, i);
      const value = parseValue(s, name.i);
      dict[name.v] = value.v;
      i = value.i;
    }
  }
  if (s[i] === "[") {
    i += 1;
    const arr = [];
    while (true) {
      i = skip(s, i);
      if (s[i] === "]") return { i: i + 1, v: arr };
      const value = parseValue(s, i);
      arr.push(value.v);
      i = value.i;
    }
  }
  if (s[i] === "(") {
    const lit = parseLiteral(s, i);
    return { i: lit.i, v: lit.v };
  }
  if (s[i] === "<") {
    const hex = parseHex(s, i);
    return { i: hex.i, v: hex.v };
  }
  if (s[i] === "/") {
    const name = parseName(s, i);
    return { i: name.i, v: name.v };
  }
  if (s.startsWith("true", i) && !/[A-Za-z]/.test(s[i + 4] ?? "")) return { i: i + 4, v: true };
  if (s.startsWith("false", i) && !/[A-Za-z]/.test(s[i + 5] ?? "")) return { i: i + 5, v: false };
  if (s.startsWith("null", i) && !/[A-Za-z]/.test(s[i + 4] ?? "")) return { i: i + 4, v: null };
  const num = /^[+-]?(?:\d+\.\d*|\.\d+|\d+)/.exec(s.slice(i));
  if (!num) throw new Error(`PDF value is missing at ${i}`);
  const n = Number(num[0]);
  let j = skip(s, i + num[0].length);
  const gen = /^\d+/.exec(s.slice(j));
  if (gen) {
    const k = skip(s, j + gen[0].length);
    if (s.startsWith("R", k) && !/[A-Za-z]/.test(s[k + 1] ?? "")) {
      return { i: k + 1, v: { ref: n, gen: Number(gen[0]) } };
    }
  }
  return { i: i + num[0].length, v: n };
}

function readXref(latin, pos) {
  if (!latin.startsWith("xref", pos)) throw new Error("PDF cross-reference table is missing");
  let i = skip(latin, pos + 4);
  const entries = new Map();
  while (!latin.startsWith("trailer", i)) {
    const head = /^(\d+)\s+(\d+)/.exec(latin.slice(i));
    if (!head) throw new Error("PDF cross-reference subsection is missing");
    const start = Number(head[1]);
    const count = Number(head[2]);
    i = skip(latin, i + head[0].length);
    for (let n = 0; n < count; n++) {
      const line = latin.slice(i, i + 20);
      if (line[17] === "n") entries.set(start + n, Number(line.slice(0, 10)));
      i += 20;
    }
    i = skip(latin, i);
  }
  const trailer = parseValue(latin, i + 7);
  return { entries, root: trailer.v.Root };
}

function parseDocument(buf) {
  const latin = buf.toString("latin1");
  const startxref = latin.lastIndexOf("startxref");
  if (startxref < 0) throw new Error("PDF startxref is missing");
  const xrefAt = Number(/\d+/.exec(latin.slice(startxref + 9))[0]);
  const { entries, root } = readXref(latin, xrefAt);
  const cache = new Map();

  function parseAt(offset) {
    const head = /^(\d+)\s+(\d+)\s+obj/.exec(latin.slice(offset));
    if (!head) throw new Error(`PDF object is missing at ${offset}`);
    const parsed = parseValue(latin, offset + head[0].length);
    let i = skip(latin, parsed.i);
    let stream = null;
    if (latin.startsWith("stream", i)) {
      i += 6;
      if (latin[i] === "\r") i++;
      if (latin[i] === "\n") i++;
      let length = parsed.v.Length;
      if (length && typeof length === "object" && length.ref != null) length = getObject(length.ref).v;
      if (typeof length !== "number") throw new Error("PDF stream length is missing");
      stream = buf.subarray(i, i + length);
    }
    return { v: parsed.v, stream };
  }

  function getObject(num) {
    if (cache.has(num)) return cache.get(num);
    const offset = entries.get(num);
    if (offset == null) throw new Error(`PDF object ${num} is missing`);
    const parsed = parseAt(offset);
    cache.set(num, parsed);
    return parsed;
  }

  function resolve(value) {
    if (value && typeof value === "object" && value.ref != null) return getObject(value.ref).v;
    return value;
  }

  function streamBytes(ref) {
    const obj = getObject(ref);
    return decodeStream(obj.v, obj.stream);
  }

  if (!root || root.ref == null) throw new Error("PDF catalog is missing");
  return { getObject, resolve, streamBytes, catalog: getObject(root.ref).v };
}

function decodeStream(dict, stream) {
  if (!stream) throw new Error("PDF stream bytes are missing");
  if (dict.DecodeParms || dict.DP) throw new Error("PDF decode parameters are not supported");
  let filter = dict.Filter;
  if (!filter) return stream;
  if (!Array.isArray(filter)) filter = [filter];
  let data = stream;
  for (const name of filter) {
    if (name !== "FlateDecode") throw new Error(`PDF filter ${name} is not supported`);
    data = zlib.inflateSync(data);
  }
  return data;
}

function utf16be(hex) {
  const bytes = Buffer.from(hex, "hex");
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  return out;
}

function parseCMap(text) {
  const map = new Map();
  let twoByte = false;
  const take = (block, pattern, visit) => {
    for (const found of text.matchAll(new RegExp(`${block}\\s*([\\s\\S]*?)end${block.slice(5)}`, "g"))) {
      for (const item of found[1].matchAll(pattern)) visit(item);
    }
  };
  take("beginbfchar", /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g, (item) => {
    if (item[1].length > 2) twoByte = true;
    map.set(Number.parseInt(item[1], 16), utf16be(item[2]));
  });
  take("beginbfrange", /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g, (item) => {
    if (item[1].length > 2) twoByte = true;
    const src = Number.parseInt(item[1], 16);
    const end = Number.parseInt(item[2], 16);
    if (item[3]) {
      let code = Number.parseInt(item[3], 16);
      for (let cid = src; cid <= end; cid++) map.set(cid, String.fromCodePoint(code++));
    } else {
      const dests = [...item[4].matchAll(/<([0-9A-Fa-f]+)>/g)];
      dests.forEach((dest, index) => map.set(src + index, utf16be(dest[1])));
    }
  });
  return { map, twoByte };
}

function parseWidths(arr) {
  const widths = new Map();
  for (let i = 0; i < arr.length;) {
    const start = arr[i++];
    const next = arr[i++];
    if (Array.isArray(next)) next.forEach((width, index) => widths.set(start + index, width));
    else {
      const width = arr[i++];
      for (let cid = start; cid <= next; cid++) widths.set(cid, width);
    }
  }
  return widths;
}

const LIGATURES = [
  ["\uFB03", "ffi"],
  ["\uFB04", "ffl"],
  ["\uFB00", "ff"],
  ["\uFB01", "fi"],
  ["\uFB02", "fl"],
];

function expandLigatures(text) {
  return LIGATURES.reduce((out, [from, to]) => out.replaceAll(from, to), text);
}

function loadFont(doc, fontValue) {
  const font = doc.resolve(fontValue);
  const encoding = font.Encoding;
  let cmap = new Map();
  let twoByte = encoding === "Identity-H" || encoding === "Identity-V";
  if (font.ToUnicode?.ref != null) {
    const parsed = parseCMap(doc.streamBytes(font.ToUnicode.ref).toString("latin1"));
    cmap = parsed.map;
    twoByte = twoByte || parsed.twoByte;
  }
  const face = font.DescendantFonts ? doc.resolve(font.DescendantFonts[0]) : font;
  const descriptor = face.FontDescriptor ? doc.resolve(face.FontDescriptor) : font.FontDescriptor ? doc.resolve(font.FontDescriptor) : null;
  return {
    cmap,
    codeWidth: twoByte ? 2 : 1,
    widths: face.W ? parseWidths(face.W) : new Map(),
    dw: typeof face.DW === "number" ? face.DW : 1000,
    ascent: typeof descriptor?.Ascent === "number" ? descriptor.Ascent : 800,
    descent: typeof descriptor?.Descent === "number" ? descriptor.Descent : -200,
  };
}

function applyMatrix(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function multiply(left, right) {
  const [a0, b0, c0, d0, e0, f0] = left;
  const [a, b, c, d, e, f] = right;
  return [
    a0 * a + c0 * b,
    b0 * a + d0 * b,
    a0 * c + c0 * d,
    b0 * c + d0 * d,
    a0 * e + c0 * f + e0,
    b0 * e + d0 * f + f0,
  ];
}

function contentTokens(bytes) {
  const s = bytes.toString("latin1");
  const tokens = [];
  let i = 0;
  function valueAt(pos) {
    pos = skip(s, pos);
    if (s.startsWith("<<", pos)) {
      pos += 2;
      const dict = {};
      while (true) {
        pos = skip(s, pos);
        if (s.startsWith(">>", pos)) return { i: pos + 2, v: dict };
        if (s[pos] !== "/") throw new Error("PDF content dictionary key is missing");
        const name = parseName(s, pos);
        const inner = valueAt(name.i);
        dict[name.v] = inner.v;
        pos = inner.i;
      }
    }
    if (s[pos] === "[") {
      pos += 1;
      const arr = [];
      while (true) {
        pos = skip(s, pos);
        if (s[pos] === "]") return { i: pos + 1, v: arr };
        const inner = valueAt(pos);
        arr.push(inner.v);
        pos = inner.i;
      }
    }
    if (s[pos] === "(") {
      const lit = parseLiteral(s, pos);
      return { i: lit.i, v: { text: lit.v } };
    }
    if (s[pos] === "<") {
      const hex = parseHex(s, pos);
      return { i: hex.i, v: { hex: hex.v } };
    }
    if (s[pos] === "/") {
      const name = parseName(s, pos);
      return { i: name.i, v: { name: name.v } };
    }
    const num = /^[+-]?(?:\d+\.\d*|\.\d+|\d+)/.exec(s.slice(pos));
    if (num) return { i: pos + num[0].length, v: Number(num[0]) };
    if (s[pos] === "'" || s[pos] === '"') return { i: pos + 1, v: { op: s[pos] } };
    const word = /^[A-Za-z]+[*]?/.exec(s.slice(pos));
    if (!word) throw new Error(`PDF content is unreadable at ${pos}`);
    return { i: pos + word[0].length, v: { op: word[0] } };
  }
  while (i < s.length) {
    i = skip(s, i);
    if (i >= s.length) break;
    const next = valueAt(i);
    tokens.push(next.v);
    i = next.i;
  }
  return tokens;
}

function textOf(value) {
  if (typeof value === "string") return value;
  if (value?.text != null) return value.text;
  if (!value?.hex) return "";
  const bytes = value.hex;
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return utf16be(bytes.subarray(2).toString("hex"));
  return bytes.toString("latin1");
}

function paintContent(doc, resources, bytes, ctm, glyphs) {
  const fonts = new Map();
  const stack = [];
  const graphics = [];
  const marked = [];
  let tm = [1, 0, 0, 1, 0, 0];
  let tlm = [1, 0, 0, 1, 0, 0];
  let font = null;
  let fontSize = 0;
  let tc = 0;
  let tw = 0;
  let tz = 100;
  let tl = 0;
  const state = () => ({ ctm: ctm.slice(), tm: tm.slice(), tlm: tlm.slice(), font, fontSize, tc, tw, tz, tl });
  const restore = (saved) => {
    ctm = saved.ctm;
    tm = saved.tm;
    tlm = saved.tlm;
    font = saved.font;
    fontSize = saved.fontSize;
    tc = saved.tc;
    tw = saved.tw;
    tz = saved.tz;
    tl = saved.tl;
  };

  function fontFor(name) {
    if (!fonts.has(name)) {
      const ref = resources?.Font?.[name];
      if (!ref) throw new Error(`PDF font ${name} is missing`);
      fonts.set(name, loadFont(doc, ref));
    }
    return fonts.get(name);
  }

  function textToPage(x, y) {
    const user = applyMatrix(tm, x, y);
    return applyMatrix(ctm, user[0], user[1]);
  }

  function glyphBox(width) {
    const rise = fontSize * (font.ascent / 1000);
    const drop = fontSize * (font.descent / 1000);
    const points = [textToPage(0, drop), textToPage(0, rise), textToPage(width, drop), textToPage(width, rise)];
    return {
      xMin: Math.min(...points.map((p) => p[0])),
      yMin: Math.min(...points.map((p) => p[1])),
      xMax: Math.max(...points.map((p) => p[0])),
      yMax: Math.max(...points.map((p) => p[1])),
    };
  }

  function emit(text, box) {
    const value = expandLigatures(text);
    if (!value) return;
    const span = marked.findLast((item) => item);
    if (span) { span.boxes.push(box); return; }
    glyphs.push({ text: value, ...box });
  }

  function advance(tx) {
    tm = multiply(tm, [1, 0, 0, 1, tx, 0]);
  }

  function show(operand) {
    if (!font) throw new Error("PDF text has no font");
    const bytesOf = operand?.hex ?? (operand?.text != null ? Buffer.from(operand.text, "latin1") : null);
    if (!bytesOf) throw new Error("PDF text operand is missing");
    if (bytesOf.length % font.codeWidth !== 0) throw new Error("PDF character codes do not match the font");
    for (let i = 0; i < bytesOf.length; i += font.codeWidth) {
      const cid = font.codeWidth === 2 ? (bytesOf[i] << 8) | bytesOf[i + 1] : bytesOf[i];
      const mapped = font.cmap.get(cid);
      const unicode = mapped ?? (font.codeWidth === 1 ? String.fromCharCode(cid) : "");
      if (!mapped && font.cmap.size && font.codeWidth === 2 && !marked.some(Boolean)) {
        throw new Error(`PDF character ${cid.toString(16)} has no Unicode mapping`);
      }
      const units = font.widths.get(cid) ?? font.dw;
      // A default width of 0 would report a past-the-edge glyph as a point on the page.
      const em = (units || 500) / 1000;
      const ink = em * fontSize * (tz / 100);
      const box = glyphBox(ink);
      const shown = expandLigatures(unicode);
      if (shown && !marked.some(Boolean)) glyphs.push({ text: shown, ...box });
      else if (marked.some(Boolean)) marked.findLast((item) => item)?.boxes.push(box);
      const tx = (em * fontSize + tc + (shown === " " ? tw : 0)) * (tz / 100);
      advance(tx);
    }
  }

  function closeSpan() {
    const span = marked.pop();
    if (!span || !span.boxes.length) return;
    const box = span.boxes.reduce((acc, item) => ({
      xMin: Math.min(acc.xMin, item.xMin),
      yMin: Math.min(acc.yMin, item.yMin),
      xMax: Math.max(acc.xMax, item.xMax),
      yMax: Math.max(acc.yMax, item.yMax),
    }));
    emit(span.text, box);
  }

  for (const token of contentTokens(bytes)) {
    if (!token || token.op == null) { stack.push(token); continue; }
    const op = token.op;
    if (op === "q") { graphics.push(state()); continue; }
    if (op === "Q") { restore(graphics.pop()); continue; }
    if (op === "cm") {
      const [a, b, c, d, e, f] = [stack.pop(), stack.pop(), stack.pop(), stack.pop(), stack.pop(), stack.pop()].reverse();
      ctm = multiply(ctm, [a, b, c, d, e, f]);
      continue;
    }
    if (op === "BT") { tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); continue; }
    if (op === "ET") continue;
    if (op === "Tm") {
      const [a, b, c, d, e, f] = [stack.pop(), stack.pop(), stack.pop(), stack.pop(), stack.pop(), stack.pop()].reverse();
      tm = [a, b, c, d, e, f];
      tlm = tm.slice();
      continue;
    }
    if (op === "Td" || op === "TD") {
      const ty = stack.pop();
      const tx = stack.pop();
      if (op === "TD") tl = -ty;
      tm = multiply(tlm, [1, 0, 0, 1, tx, ty]);
      tlm = tm.slice();
      continue;
    }
    if (op === "T*") { tm = multiply(tlm, [1, 0, 0, 1, 0, -tl]); tlm = tm.slice(); continue; }
    if (op === "Tf") {
      fontSize = stack.pop();
      font = fontFor(stack.pop().name);
      continue;
    }
    if (op === "Tc") { tc = stack.pop(); continue; }
    if (op === "Tw") { tw = stack.pop(); continue; }
    if (op === "Tz") { tz = stack.pop(); continue; }
    if (op === "TL") { tl = stack.pop(); continue; }
    if (op === "Tj") { show(stack.pop()); continue; }
    if (op === "'") { tm = multiply(tlm, [1, 0, 0, 1, 0, -tl]); tlm = tm.slice(); show(stack.pop()); continue; }
    if (op === '"') {
      const text = stack.pop();
      tc = stack.pop();
      tw = stack.pop();
      tm = multiply(tlm, [1, 0, 0, 1, 0, -tl]);
      tlm = tm.slice();
      show(text);
      continue;
    }
    if (op === "TJ") {
      for (const item of stack.pop()) {
        if (typeof item === "number") advance((-item / 1000) * fontSize * (tz / 100));
        else show(item);
      }
      continue;
    }
    if (op === "BDC") {
      const dict = stack.pop();
      stack.pop();
      const actual = dict?.ActualText;
      marked.push(actual == null ? null : { text: expandLigatures(textOf(actual)), boxes: [] });
      continue;
    }
    if (op === "BMC") { stack.pop(); marked.push(null); continue; }
    if (op === "EMC") { closeSpan(); continue; }
    if (op === "Do") {
      const name = stack.pop().name;
      const ref = resources?.XObject?.[name];
      const form = ref ? doc.resolve(ref) : null;
      if (form?.Subtype !== "Form" || ref.ref == null) continue;
      const matrix = form.Matrix ?? [1, 0, 0, 1, 0, 0];
      graphics.push(state());
      ctm = multiply(ctm, matrix);
      paintContent(doc, form.Resources ?? resources, doc.streamBytes(ref.ref), ctm, glyphs);
      restore(graphics.pop());
      continue;
    }
    if (op === "d") { stack.pop(); stack.pop(); continue; }
    const arity = { re: 4, m: 2, l: 2, c: 6, v: 4, y: 4, rg: 3, RG: 3, g: 1, G: 1, k: 4, K: 4, w: 1, J: 1, j: 1, M: 1, i: 1, gs: 1, Tr: 1, Ts: 1, n: 0, S: 0, s: 0, f: 0, F: 0, h: 0, W: 0, "W*": 0, "f*": 0, b: 0, "b*": 0, B: 0, "B*": 0 };
    if (arity[op] == null) throw new Error(`PDF operator ${op} is not supported`);
    for (let n = 0; n < arity[op]; n++) stack.pop();
  }
}

function pageGlyphs(doc, page, inherited) {
  const box = page.MediaBox ?? inherited.MediaBox ?? [0, 0, 612, 792];
  const resources = page.Resources ?? inherited.Resources;
  const [llx, lly, urx, ury] = box;
  const glyphs = [];
  const contents = page.Contents ? (Array.isArray(page.Contents) ? page.Contents : [page.Contents]) : [];
  for (const ref of contents) {
    if (ref?.ref == null) continue;
    paintContent(doc, resources, doc.streamBytes(ref.ref), [1, 0, 0, 1, 0, 0], glyphs);
  }
  return {
    width: urx - llx,
    height: ury - lly,
    words: glyphs.map((glyph) => ({
      text: glyph.text,
      xMin: glyph.xMin - llx,
      yMin: glyph.yMin - lly,
      xMax: glyph.xMax - llx,
      yMax: glyph.yMax - lly,
    })),
  };
}

function walkPages(doc, node, inherited, out) {
  const next = {
    MediaBox: node.MediaBox ?? inherited.MediaBox,
    Resources: node.Resources ?? inherited.Resources,
  };
  if (node.Kids) {
    for (const kid of node.Kids) walkPages(doc, doc.resolve(kid), next, out);
    return;
  }
  out.push(pageGlyphs(doc, node, next));
}

// A narrow table wraps words onto new lines and drops the space glyph. A URL
// wrapped with overflow-wrap stays one token, so a line break is tried both
// as a space and as nothing.
function plainText(glyphs, lineBreak) {
  let text = "";
  const ranges = [];
  let prev = null;
  for (const glyph of glyphs) {
    if (!glyph.text) continue;
    for (const piece of glyph.text.split(/(\s+)/).filter(Boolean)) {
      if (/^\s+$/.test(piece)) {
        if (!text.endsWith(" ")) text += " ";
        prev = glyph;
        continue;
      }
      if (prev) {
        const height = Math.max(1, prev.yMax - prev.yMin);
        const newLine = Math.abs(glyph.yMin - prev.yMin) > height * 0.6;
        const gap = glyph.xMin - prev.xMax;
        if (newLine) {
          if (lineBreak && !text.endsWith(" ")) text += lineBreak;
        } else if (gap > Math.max(height * 0.8, 4) && !text.endsWith(" ")) text += " ";
      }
      const start = text.length;
      text += piece;
      ranges.push({ start, end: text.length, glyph });
      prev = glyph;
    }
  }
  return { text, ranges };
}

/**
 * @param {{ width: number, height: number, words: { text: string, xMin: number, yMin: number, xMax: number, yMax: number }[] }[]} pages
 * @param {string} phrase
 */
export function findPhrase(pages, phrase) {
  const wanted = phrase.split(/\s+/).filter(Boolean).join(" ");
  for (const lineBreak of ["", " "]) {
    for (const page of pages) {
      const { text, ranges } = plainText(page.words, lineBreak);
      const at = text.indexOf(wanted);
      if (at < 0) continue;
      const end = at + wanted.length;
      const hit = ranges.filter((range) => range.end > at && range.start < end && /\S/.test(range.glyph.text)).map((range) => range.glyph);
      const outside = hit.filter((word) => word.xMin < -1 || word.yMin < -1 || word.xMax > page.width + 1 || word.yMax > page.height + 1);
      return { words: hit, outside };
    }
  }
  return null;
}

/** @param {Buffer | string} input PDF bytes, or a path */
export function readPdfPages(input) {
  const buf = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const doc = parseDocument(buf);
  const catalog = doc.resolve(doc.catalog);
  const pages = [];
  walkPages(doc, doc.resolve(catalog.Pages), {}, pages);
  if (!pages.length) throw new Error("PDF has no pages");
  return pages;
}
