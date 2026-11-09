const stub = new URL('./playwright-marker.mjs', import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'playwright') {
    return { shortCircuit: true, url: stub.href };
  }
  return nextResolve(specifier, context);
}
