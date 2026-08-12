export function selectAssistantCli(currentId, clis) {
  const installed = clis.filter((cli) => cli?.installed);
  if (currentId && installed.some((cli) => cli.id === currentId)) return currentId;
  return installed[0]?.id ?? null;
}
