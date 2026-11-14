import { register } from 'node:module';

const stub = 'data:text/javascript,' + encodeURIComponent(
  'export function normalizeTextForATS(html){return {html,replacements:{}};}'
  + 'export function reportAtsReplacements(){}'
  // CAREER_OPS_TEST_COVER_OVERFLOW=1: the render ran over a warn-only page
  // budget, so it returns the sibling draft and wrote nothing to outputPath.
  + 'export async function renderHtmlToPdf(html,outputPath){'
  + 'if(process.env.CAREER_OPS_TEST_COVER_OVERFLOW==="1"){return {outputPath,draftPath:outputPath.replace(/\\.pdf$/,".overflow.pdf"),pageCount:2,size:0};}'
  + 'return {outputPath:"",pageCount:1,size:0};}',
);
const hooks = 'data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL || '';
  if (specifier === './generate-pdf.mjs' && parent.includes('generate-cover-letter.mjs')) {
    return { url: ${JSON.stringify(stub)}, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`);
register(hooks, import.meta.url);
