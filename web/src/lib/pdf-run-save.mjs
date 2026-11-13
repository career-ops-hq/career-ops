/**
 * Build a tailored CV, then save and render it.
 * cancel() can flip closed during the build. Do not save or render after that.
 *
 * @param {{
 *   build: () => Promise<{ ok: true, html: string, warnings: string[], ats: { html: string, finalPdf: string } | null } | { ok: false, error: string }>,
 *   isClosed: () => boolean,
 *   onError: (message: string) => void,
 *   onWarnings: (warnings: string[]) => void,
 *   save: (built: { html: string }) => boolean,
 *   render: (built: { ats: { html: string, finalPdf: string } | null }) => Promise<unknown>,
 * }} args
 */
export async function saveBuiltCv({ build, isClosed, onError, onWarnings, save, render }) {
  const built = await build();
  if (isClosed()) return;
  if (!built.ok) {
    onError(built.error);
    return;
  }
  onWarnings(built.warnings);
  if (save(built)) await render(built);
}
