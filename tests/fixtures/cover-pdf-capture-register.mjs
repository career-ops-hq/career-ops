import { register } from 'node:module';

const stub = new URL('./cover-pdf-capture-stub.mjs', import.meta.url).href;
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
