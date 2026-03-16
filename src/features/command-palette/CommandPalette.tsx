import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/shared/components/ui/dialog";
import { keybindingRegistry } from "@/core/keybindings/keybinding-registry";
import { KeybindingSource } from "@/core/keybindings/types";
import { keyNormalizer } from "@/core/keybindings/key-normalizer";
import { PluginManager } from "@/plugins/plugin-manager";
import type { KeybindingEntry } from "@/core/keybindings/types";

// ── Command item shape ─────────────────────────────────────────────────────────

interface CommandItem {
  commandId: string;
  label: string;
  keyHint: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatChord(entry: KeybindingEntry): string {
  return entry.chord
    .map((key) =>
      key
        .split("+")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("+")
    )
    .join(" ");
}

function buildCommandItems(): CommandItem[] {
  const allEntries = keybindingRegistry.getAll();
  const pluginCommands = PluginManager.getCommands();
  const labelMap = new Map(pluginCommands.map((c) => [c.id, c.name]));

  const sourcePriority: Record<KeybindingSource, number> = {
    [KeybindingSource.User]: 0,
    [KeybindingSource.Plugin]: 1,
    [KeybindingSource.Builtin]: 2,
  };

  const sorted = [...allEntries].sort(
    (a, b) => sourcePriority[a.source] - sourcePriority[b.source]
  );

  const seen = new Set<string>();
  const items: CommandItem[] = [];

  for (const entry of sorted) {
    if (seen.has(entry.commandId)) continue;
    seen.add(entry.commandId);

    items.push({
      commandId: entry.commandId,
      label: labelMap.get(entry.commandId) ?? entry.commandId,
      keyHint: formatChord(entry),
    });
  }

  for (const cmd of pluginCommands) {
    if (!seen.has(cmd.id)) {
      seen.add(cmd.id);
      items.push({
        commandId: cmd.id,
        label: cmd.name,
        keyHint: null,
      });
    }
  }

  return items;
}

function fuzzyFilter(items: CommandItem[], query: string): CommandItem[] {
  if (!query.trim()) return items;
  const q = query.toLowerCase();

  const startsWith: CommandItem[] = [];
  const includes: CommandItem[] = [];

  for (const item of items) {
    const label = item.label.toLowerCase();
    if (label.startsWith(q)) {
      startsWith.push(item);
    } else if (label.includes(q)) {
      includes.push(item);
    }
  }

  return [...startsWith, ...includes];
}

// ── CommandPalette component ───────────────────────────────────────────────────

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [commands, setCommands] = useState<CommandItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const COMMAND_ID = "workbench.action.showCommands";
    const chord = keyNormalizer.normalizeChord("ctrl+shift+p");

    keybindingRegistry.registerDefault({
      commandId: COMMAND_ID,
      chord,
      source: KeybindingSource.Builtin,
    });

    PluginManager.registerCommandHandler(COMMAND_ID, () => {
      setOpen(true);
    });

    return () => {
      keybindingRegistry.unregister(chord[0], COMMAND_ID);
    };
  }, []);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCommands(buildCommandItems());

      setQuery("");

      setSelectedIndex(0);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  const filtered = fuzzyFilter(commands, query);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIndex(0);
  }, [query]);

  const executeCommand = useCallback(async (commandId: string) => {
    setOpen(false);
    await PluginManager.executeCommand(commandId);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filtered[selectedIndex]) {
            void executeCommand(filtered[selectedIndex].commandId);
          }
          break;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          break;
      }
    },
    [filtered, selectedIndex, executeCommand]
  );

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="p-0 gap-0 overflow-hidden max-w-xl top-[20%] translate-y-0 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Command Palette</DialogTitle>

        {/* Search input */}
        <div className="flex items-center border-b border-zinc-200 dark:border-zinc-700 px-3">
          <svg
            className="size-4 shrink-0 text-zinc-400 dark:text-zinc-500"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          <input
            ref={inputRef}
            placeholder="Type a command..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent px-3 py-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
            ESC
          </kbd>
        </div>

        {/* Command list */}
        <div ref={listRef} className="overflow-y-auto max-h-80 py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              No commands found
            </div>
          ) : (
            filtered.map((cmd, idx) => (
              <button
                key={cmd.commandId}
                data-index={idx}
                className={[
                  "flex w-full items-center justify-between px-4 py-2 text-sm text-left transition-colors",
                  idx === selectedIndex
                    ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                    : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/60",
                ].join(" ")}
                onMouseEnter={() => setSelectedIndex(idx)}
                onClick={() => void executeCommand(cmd.commandId)}
              >
                <span className="truncate">{cmd.label}</span>
                {cmd.keyHint && (
                  <kbd className="ml-4 shrink-0 inline-flex items-center rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                    {cmd.keyHint}
                  </kbd>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t border-zinc-200 dark:border-zinc-700 px-4 py-2 flex items-center gap-3">
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500 flex items-center gap-1">
            <kbd className="inline-flex items-center rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-1 text-[10px] font-mono">
              ↑↓
            </kbd>
            navigate
          </span>
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500 flex items-center gap-1">
            <kbd className="inline-flex items-center rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-1 text-[10px] font-mono">
              ↵
            </kbd>
            run
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
