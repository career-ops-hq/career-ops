#!/usr/bin/env node
/**
 * clean-markers.mjs — audit/strip invisible Unicode from generated text outputs.
 *
 * Job descriptions, forms, and pasted recruiter messages are untrusted data. They can carry
 * invisible Unicode that gets copied into generated CVs, cover letters, or emails without the
 * user ever seeing it. This audits and optionally removes those hidden characters before output
 * leaves the user's machine.
 *
 *   node clean-markers.mjs audit  <file...>                 # report only, never modifies
 *   node clean-markers.mjs clean  <file...>                 # strip markers, then report
 *   node clean-markers.mjs clean  --ascii cover-letter.md   # also force plain-ASCII punctuation
 *   node clean-markers.mjs audit  --keep-script-joiners f.md  # keep joiners emoji/Persian/Indic spelling needs
 *   node clean-markers.mjs --help                           # show this message (-h is an alias)
 *
 * Exit code 1 if any file FAILS audit — usable as a pre-send gate. Dependency-free: text only,
 * no package installs, no PDF metadata editing.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';
import { validateFlags } from './lib/cli-flags.mjs';

const NAMED = {
  0x200B:'ZERO-WIDTH SPACE', 0x200C:'ZWNJ', 0x200D:'ZWJ', 0x2060:'WORD JOINER',
  0xFEFF:'BOM/ZWNBSP', 0x00AD:'SOFT HYPHEN', 0x180E:'MONGOLIAN VOWEL SEP',
  0x200E:'LRM', 0x200F:'RLM', 0x202A:'LRE', 0x202B:'RLE', 0x202C:'PDF(bidi)',
  0x202D:'LRO', 0x202E:'RLO', 0x2066:'LRI', 0x2067:'RLI', 0x2068:'FSI', 0x2069:'PDI',
};
const isTag = cp => cp >= 0xE0000 && cp <= 0xE007F;
const isVS  = cp => (cp>=0xFE00&&cp<=0xFE0F) || (cp>=0xE0100&&cp<=0xE01EF);
const label = cp => NAMED[cp] || (isTag(cp) ? `TAG U+${cp.toString(16).toUpperCase()}`
                    : isVS(cp) ? `VARIATION-SEL U+${cp.toString(16).toUpperCase()}` : null);

const TEXT_EXT = new Set(['.html','.htm','.md','.txt','.json','.csv','.svg','.xml','.tex']);

// --keep-script-joiners (#5268): ZWJ, ZWNJ and VS16 are part of the spelling in emoji sequences,
// Persian and Brahmic scripts. A single joiner is kept only between the characters that need it;
// anything else — next to Latin letters or spaces, at a line edge, or in a run of two or more,
// the shape a zero-width payload takes — is still stripped and reported. audit and clean both
// call this one predicate, so they cannot disagree about a character.
const ZWNJ = 0x200C, ZWJ = 0x200D, VS16 = 0xFE0F;
const PICTO = /\p{Extended_Pictographic}/u;
const SKIN_TONE = /\p{Emoji_Modifier}/u;
// Letters only (with combining marks for the Brahmic virama): Arabic-Indic and Devanagari digits
// share the script, and a joiner between two digits spells nothing.
const ARABIC = /(?=\p{L})\p{Script=Arabic}/u;
const BRAHMIC = ['Devanagari','Bengali','Gurmukhi','Gujarati','Oriya','Tamil','Telugu','Kannada','Malayalam','Sinhala']
  .map(s => new RegExp(`(?=[\\p{L}\\p{M}])\\p{Script=${s}}`, 'u'));
const is = (re, ch) => ch !== undefined && re.test(ch);
const sameBrahmic = (a, b) => BRAHMIC.some(re => is(re, a) && is(re, b));
// The emoji a ZWJ continues: a pictograph, optionally followed by one skin tone or one VS16.
function endsWithPictograph(chars, i){
  if(is(SKIN_TONE, chars[i]) || chars[i]?.codePointAt(0) === VS16) i--;
  return is(PICTO, chars[i]);
}
function isScriptJoiner(chars, i){
  const cp = chars[i].codePointAt(0), prev = chars[i-1], next = chars[i+1];
  if(cp === VS16) return is(PICTO, prev);
  if(cp === ZWJ && is(PICTO, next) && endsWithPictograph(chars, i-1)) return true;
  if(cp === ZWNJ && is(ARABIC, prev) && is(ARABIC, next)) return true;
  return (cp === ZWJ || cp === ZWNJ) && sameBrahmic(prev, next);
}

function scanText(t, keepJoiners){
  const f={}; let kept=0; const chars=[...t];
  for(let i=0; i<chars.length; i++){
    const l=label(chars[i].codePointAt(0)); if(!l) continue;
    if(keepJoiners && isScriptJoiner(chars, i)){ kept++; continue; }
    f[l]=(f[l]||0)+1;
  }
  return { found:f, kept };
}
function cleanText(t, ascii, keepJoiners){
  let out=''; const chars=[...t];
  for(let i=0; i<chars.length; i++){ const ch=chars[i], cp=ch.codePointAt(0);
    if(cp===0x00AD) continue;
    if(((cp in NAMED)||isTag(cp)||isVS(cp)) && !(keepJoiners && isScriptJoiner(chars, i))) continue;
    out+=ch;
  }
  if(ascii) out=out.replace(/[‘’‚‛]/g,"'").replace(/[“”„‟]/g,'"').replace(/[–—―]/g,'-').replace(/…/g,'...');
  return out;
}
// Never scan or transform inside <style>/<script> — marker removal and --ascii must not touch CSS/JS.
// Mask both block types before scanning/cleaning, restore them after (same approach as generate-pdf.mjs).
const CODE_BLOCK = /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi;
function maskCode(html){
  const masks=[];
  const masked=html.replace(CODE_BLOCK, m => { const tok=`__CLEAN_MARKERS_MASK_${masks.length}__`; masks.push(m); return tok; });
  return { masked, masks };
}
function restoreCode(s, masks){ return s.replace(/__CLEAN_MARKERS_MASK_(\d+)__/g, (_,n)=>masks[Number(n)]); }

function processFile(file, mode, opts){
  if(!existsSync(file)){ console.log(`  ⚠️  ${file}: not found`); return false; }
  const ext = extname(file).toLowerCase();

  if(TEXT_EXT.has(ext)){
    const t = readFileSync(file,'utf8');
    const isHtml = ext==='.html'||ext==='.htm';
    // For HTML, exclude BOTH <style> and <script> from scanning AND cleaning (mask, then restore).
    const { found, kept } = scanText(isHtml ? maskCode(t).masked : t, opts.keepJoiners);
    // Kept joiners are named on every line, so the exception stays visible rather than silent.
    const keptNote = opts.keepJoiners ? `; kept ${kept} script joiner${kept===1?'':'s'}` : '';
    if(mode==='clean' && (Object.keys(found).length || opts.ascii)){
      let cleaned;
      if(isHtml){ const { masked, masks } = maskCode(t); cleaned = restoreCode(cleanText(masked, opts.ascii, opts.keepJoiners), masks); }
      else { cleaned = cleanText(t, opts.ascii, opts.keepJoiners); }
      writeFileSync(file, cleaned);
      const after = readFileSync(file,'utf8');
      const re = scanText(isHtml ? maskCode(after).masked : after, opts.keepJoiners).found;
      const ok = Object.keys(re).length===0;
      console.log(`  ${ok?'✅':'⚠️ '} ${file}: cleaned text (${Object.keys(found).length?JSON.stringify(found):'no hidden chars'}${opts.ascii?', ASCII-normalized':''}${keptNote})`);
      return ok;
    }
    const ok = Object.keys(found).length===0;
    console.log(`  ${ok?'✅ PASS':'❌ FAIL'} ${file}: hidden chars: ${ok?'none':JSON.stringify(found)}${keptNote}`);
    return ok;
  }

  console.log(`  ➖ ${file}: unsupported type (${ext||'no ext'}) — skipped`);
  return true;
}

const KNOWN_FLAGS = ['--ascii', '--keep-script-joiners', '--help', '-h'];
const USAGE = `Usage:
  node clean-markers.mjs audit <file...>            # report only, never modifies
  node clean-markers.mjs clean <file...>            # strip markers, then report
  node clean-markers.mjs clean --ascii <file...>    # also force plain-ASCII punctuation
  node clean-markers.mjs audit --keep-script-joiners <file...>
  node clean-markers.mjs clean --keep-script-joiners <file...>
                                                    # keep single joiners that emoji, Persian and Indic text need
  node clean-markers.mjs audit -- -draft.md         # -- ends the flags, for a path starting with a dash
  node clean-markers.mjs --help                     # print this usage block and exit`;

const argv = process.argv.slice(2);
// Everything after `--` is a path, so a file named -draft.md is not read as a flag.
const endOfOptions = argv.indexOf('--');
validateFlags(endOfOptions === -1 ? argv : argv.slice(0, endOfOptions), KNOWN_FLAGS, USAGE);
const mode = argv[0]==='clean' ? 'clean' : 'audit';
const opts = { ascii:false, keepJoiners:false };
const files = [];
for(let i=(argv[0]==='clean'||argv[0]==='audit')?1:0; i<argv.length; i++){
  if(i===endOfOptions){ files.push(...argv.slice(i+1)); break; }
  if(argv[i]==='--ascii') opts.ascii = true;
  else if(argv[i]==='--keep-script-joiners') opts.keepJoiners = true;
  else files.push(argv[i]);
}
if(!files.length){ console.log(USAGE); process.exit(2); }

console.log(`\nclean-markers — ${mode.toUpperCase()} (${files.length} file${files.length>1?'s':''})`);
let allOk = true;
for(const f of files){ allOk = processFile(f, mode, opts) && allOk; }
console.log(`\n${allOk ? '✅ ALL CLEAN' : '❌ ISSUES FOUND'}`);
process.exit(allOk ? 0 : 1);
