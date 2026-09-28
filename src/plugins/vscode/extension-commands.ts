import { notify } from "@/shared/lib/notify";

/**
 * Bridge between the workbench (command palette, keybindings, views) and
 * whatever runs extension code. The extension host registers itself as the
 * executor; until then, running an extension command explains why nothing
 * happens instead of failing silently.
 */

export type ExtensionCommandExecutor = (command: string, args: unknown[]) => Promise<unknown>;

let executor: ExtensionCommandExecutor | null = null;

export function setExtensionCommandExecutor(next: ExtensionCommandExecutor | null): void {
  executor = next;
}

export async function executeExtensionCommand(
  command: string,
  ...args: unknown[]
): Promise<unknown> {
  if (!executor) {
    notify("Este comando necesita el Extension Host", {
      type: "warning",
      description: `"${command}" lo aporta una extensión con código, pero el Extension Host no está disponible.`,
    });
    return undefined;
  }
  return executor(command, args);
}
