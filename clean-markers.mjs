#!/usr/bin/env node
/**
 * clean-markers.mjs — audit/strip invisible "tells" from generated output files.
 *
 * Résumés rendered via generate-pdf.mjs (Playwright/Chromium) carry an Info dictionary stamped
 * Creator="Chromium", Producer="Skia/PDF" — harmless, but a recruiter or ATS may find "Chromium"
 * odd on a résumé. Text sources can also pick up invisible Unicode (zero-width, bidi, tag chars,
 * soft hyphen, NBSP) that read as machine-generated. This audits and (optionally) cleans both.
 *
 *   node clean-markers.mjs audit  <file...>                 # report only, never modifies
 *   node clean-markers.mjs clean  <file...>                 # strip markers, then report
 *   node clean-markers.mjs clean  --author "Jane Doe" cv.pdf
 *   node clean-markers.mjs clean  --ascii cover-letter.md   # also force plain-ASCII punctuation
 *
 * Exit code 1 if any file FAILS audit — usable as a pre-send gate. No hard dependency: PDF
 * metadata cleaning uses pdf-lib, auto-installed on demand; the text/byte audit is dependency-free.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';

const NAMED = {
  0x200B:'ZERO-WIDTH SPACE', 0x200C:'ZWNJ', 0x200D:'ZWJ', 0x2060:'WORD JOINER',
  0xFEFF:'BOM/ZWNBSP', 0x00AD:'SOFT HYPHEN', 0x180E:'MONGOLIAN VOWEL SEP',
  0x200E:'LRM', 0x200F:'RLM', 0x202A:'LRE', 0x202B:'RLE', 0x202C:'PDF(bidi)',
  0x202D:'LRO', 0x202E:'RLO', 0x2066:'LRI', 0x2067:'RLI', 0x2068:'FSI', 0x2069:'PDI',
  0x00A0:'NBSP',
};
const isTag = cp => cp >= 0xE0000 && cp <= 0xE007F;
const isVS  = cp => (cp>=0xFE00&&cp<=0xFE0F) || (cp>=0xE0100&&cp<=0xE01EF);
const label = cp => NAMED[cp] || (isTag(cp) ? `TAG U+${cp.toString(16).toUpperCase()}`
                    : isVS(cp) ? `VARIATION-SEL U+${cp.toString(16).toUpperCase()}` : null);

const TEXT_EXT = new Set(['.html','.htm','.md','.txt','.json','.csv','.svg','.xml','.tex']);
const PDF_TELLS = /chromium|skia/i;

function scanText(t){ const f={}; for(const ch of t){const l=label(ch.codePointAt(0)); if(l)f[l]=(f[l]||0)+1;} return f; }
function cleanText(t, ascii){
  let out='';
  for(const ch of t){ const cp=ch.codePointAt(0);
    if(cp===0x00A0){out+=' ';continue;}
    if(cp===0x00AD) continue;
    if((cp in NAMED && cp!==0x00A0)||isTag(cp)||isVS(cp)) continue;
    out+=ch;
  }
  if(ascii) out=out.replace(/[‘’‚‛]/g,"'").replace(/[“”„‟]/g,'"').replace(/[–—―]/g,'-').replace(/…/g,'...');
  return out;
}
async function loadPdfLib(){
  try { return await import('pdf-lib'); } catch {}
  try {
    const { execSync } = await import('node:child_process');
    execSync('npm i pdf-lib --no-save --no-audit --no-fund', { cwd: process.cwd(), stdio:'ignore' });
    return await import('pdf-lib');
  } catch { return null; }
}

async function processFile(file, mode, opts){
  if(!existsSync(file)){ console.log(`  ⚠️  ${file}: not found`); return false; }
  const ext = extname(file).toLowerCase();

  if(ext==='.pdf'){
    const bytes = readFileSync(file);
    const raw = bytes.toString('latin1');
    const byteTells = [...new Set((raw.match(new RegExp(PDF_TELLS,'gi'))||[]).map(s=>s.toLowerCase()))];
    if(mode==='clean' && byteTells.length){
      const lib = await loadPdfLib();
      if(!lib){ console.log(`  ⚠️  ${file}: tells present but pdf-lib unavailable — run \`npm i pdf-lib\``); return false; }
      const d = await lib.PDFDocument.load(bytes, { updateMetadata:false });
      d.setProducer(''); d.setCreator(''); d.setSubject(''); d.setKeywords([]);
      d.setAuthor(opts.author || '');
      const t = d.getTitle(); if(!t || PDF_TELLS.test(t)) d.setTitle(opts.author ? `${opts.author} - Document` : 'Document');
      writeFileSync(file, await d.save({ updateFieldAppearances:false }));
      const left = [...new Set((readFileSync(file).toString('latin1').match(new RegExp(PDF_TELLS,'gi'))||[]))];
      const ok = left.length===0;
      console.log(`  ${ok?'✅':'⚠️ '} ${file}: cleaned PDF metadata (Author="${opts.author||''}", Creator/Producer removed)`);
      return ok;
    }
    const ok = byteTells.length===0;
    console.log(`  ${ok?'✅ PASS':'❌ FAIL'} ${file}: byte tells: ${byteTells.length?byteTells.join(', '):'none'}`);
    return ok;
  }

  if(TEXT_EXT.has(ext)){
    const t = readFileSync(file,'utf8');
    const scan = (ext==='.html'||ext==='.htm') ? t.replace(/<style[\s\S]*?<\/style>/gi,'') : t;
    const found = scanText(scan);
    if(mode==='clean' && (Object.keys(found).length || opts.ascii)){
      writeFileSync(file, cleanText(t, opts.ascii));
      const re = scanText(readFileSync(file,'utf8').replace(/<style[\s\S]*?<\/style>/gi,''));
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
const opts = { author:'', ascii:false };
const files = [];
for(let i=(argv[0]==='clean'||argv[0]==='audit')?1:0; i<argv.length; i++){
  if(argv[i]==='--author') opts.author = argv[++i]||'';
  else if(argv[i]==='--ascii') opts.ascii = true;
  else files.push(argv[i]);
}
if(!files.length){ console.log('Usage: node clean-markers.mjs <audit|clean> [--author "Name"] [--ascii] <file...>'); process.exit(2); }

console.log(`\nclean-markers — ${mode.toUpperCase()} (${files.length} file${files.length>1?'s':''})`);
let allOk = true;
for(const f of files){ allOk = (await processFile(f, mode, opts)) && allOk; }
console.log(`\n${allOk ? '✅ ALL CLEAN' : '❌ ISSUES FOUND'}`);
process.exit(allOk ? 0 : 1);
