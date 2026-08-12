export interface AssistantCli {
  id: string;
  installed: boolean;
}

export function selectAssistantCli(
  currentId: string | null,
  clis: AssistantCli[],
): string | null;
