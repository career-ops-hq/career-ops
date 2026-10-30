const STUB = 'data:text/javascript,export const chromium = { launch: async () => ({ close: async () => {} }) };';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'playwright') return { url: STUB, shortCircuit: true };
  return nextResolve(specifier, context);
}
