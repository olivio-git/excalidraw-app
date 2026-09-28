import { MoreHorizontal } from "lucide-react";
import { contextKeyService } from "@/core/keybindings/context-key-service";
import { useThemeStore } from "@/stores/themeStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Codicon } from "./codicons";
import { ExtensionIcon } from "./extension-assets";
import { extensionHost } from "./extension-host-service";
import type { ViewMenus } from "./view-containers";
import type { CommandContribution } from "../contributions";

/** Icon of a contributed command (`$(codicon)`, a path, or light/dark paths). */
export function CommandIcon({
  command,
}: {
  command?: CommandContribution & { extensionDir: string };
}) {
  const isDark = useThemeStore((s) => s.resolvedTheme === "dark");
  const icon = command?.icon;
  if (!icon)
    return <span className="text-[10px] leading-none">{command?.title?.slice(0, 2) ?? "·"}</span>;
  if (typeof icon === "string") {
    const codicon = /^\$\(([\w~-]+)\)$/.exec(icon);
    if (codicon) return <Codicon name={codicon[1]} className="text-[14px]" />;
    return (
      <ExtensionIcon
        icon={{ path: icon.replace(/^\.\//, ""), extensionDir: command.extensionDir }}
      />
    );
  }
  const path = (isDark ? icon.dark : icon.light).replace(/^\.\//, "");
  return <ExtensionIcon icon={{ path, extensionDir: command.extensionDir }} />;
}

/** `view/title` actions of a view: inline icons for "navigation", the rest in "…". */
export function ViewTitleActions({ viewId, menus }: { viewId: string; menus: ViewMenus }) {
  const entries = (menus.title.get(viewId) ?? []).filter((entry) =>
    contextKeyService.evaluateWith(entry.when, { view: viewId })
  );
  if (entries.length === 0) return null;
  const inline = entries.filter((entry) => entry.group?.startsWith("navigation"));
  const overflow = entries.filter((entry) => !entry.group?.startsWith("navigation"));
  const run = (command: string) =>
    void extensionHost.request("tree.executeMenuCommand", { viewId, command });

  return (
    <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      {inline.map((entry) => {
        const command = menus.commands.get(entry.command);
        return (
          <button
            key={entry.command}
            aria-label={command?.title ?? entry.command}
            title={command?.title ?? entry.command}
            onClick={() => run(entry.command)}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <CommandIcon command={command} />
          </button>
        );
      })}
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Más acciones"
              className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {overflow.map((entry) => (
              <DropdownMenuItem key={entry.command} onSelect={() => run(entry.command)}>
                {menus.commands.get(entry.command)?.title ?? entry.command}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </span>
  );
}
