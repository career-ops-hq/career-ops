import { register } from 'node:module';

const stub = 'data:text/javascript,' + encodeURIComponent(
  'export async function renderHtmlToPdf(){return {outputPath:"",pageCount:1,size:0};}',
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
