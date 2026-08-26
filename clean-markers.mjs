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
 *
 * Exit code 1 if any file FAILS audit — usable as a pre-send gate. Dependency-free: text only,
 * no package installs, no PDF metadata editing.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';

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

function scanText(t){ const f={}; for(const ch of t){const l=label(ch.codePointAt(0)); if(l)f[l]=(f[l]||0)+1;} return f; }
function cleanText(t, ascii){
  let out='';
  for(const ch of t){ const cp=ch.codePointAt(0);
    if(cp===0x00AD) continue;
    if((cp in NAMED)||isTag(cp)||isVS(cp)) continue;
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
    const found = scanText(isHtml ? maskCode(t).masked : t);
    if(mode==='clean' && (Object.keys(found).length || opts.ascii)){
      let cleaned;
      if(isHtml){ const { masked, masks } = maskCode(t); cleaned = restoreCode(cleanText(masked, opts.ascii), masks); }
      else { cleaned = cleanText(t, opts.ascii); }
      writeFileSync(file, cleaned);
      const after = readFileSync(file,'utf8');
      const re = scanText(isHtml ? maskCode(after).masked : after);
      const ok = Object.keys(re).length===0;
      console.log(`  ${ok?'✅':'⚠️ '} ${file}: cleaned text (${Object.keys(found).length?JSON.stringify(found):'no hidden chars'}${opts.ascii?', ASCII-normalized':''})`);
      return ok;
    }
    const ok = Object.keys(found).length===0;
    console.log(`  ${ok?'✅ PASS':'❌ FAIL'} ${file}: hidden chars: ${ok?'none':JSON.stringify(found)}`);
    return ok;
  }

  console.log(`  ➖ ${file}: unsupported type (${ext||'no ext'}) — skipped`);
  return true;
}

const argv = process.argv.slice(2);
const mode = argv[0]==='clean' ? 'clean' : 'audit';
const opts = { ascii:false };
const files = [];
for(let i=(argv[0]==='clean'||argv[0]==='audit')?1:0; i<argv.length; i++){
  if(argv[i]==='--ascii') opts.ascii = true;
  else files.push(argv[i]);
}
if(!files.length){ console.log('Usage: node clean-markers.mjs <audit|clean> [--ascii] <file...>'); process.exit(2); }

console.log(`\nclean-markers — ${mode.toUpperCase()} (${files.length} file${files.length>1?'s':''})`);
let allOk = true;
for(const f of files){ allOk = processFile(f, mode, opts) && allOk; }
console.log(`\n${allOk ? '✅ ALL CLEAN' : '❌ ISSUES FOUND'}`);
process.exit(allOk ? 0 : 1);
