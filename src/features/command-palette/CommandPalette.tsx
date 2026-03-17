import { useState, useEffect, useRef, useCallback, useMemo, startTransition } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { FileText, Terminal } from "lucide-react";
import { readDir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";

import { keybindingRegistry } from "@/core/keybindings/keybinding-registry";
import { KeybindingSource } from "@/core/keybindings/types";
import { keyNormalizer } from "@/core/keybindings/key-normalizer";
import { PluginManager } from "@/plugins/plugin-manager";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { fileHandlerRegistry } from "@/core/shell/panels/file-handler-registry";
import { cn } from "@/shared/lib/utils";
import type { KeybindingEntry } from "@/core/keybindings/types";

// ── Types ──────────────────────────────────────────────────────────────────────

interface CommandItem {
  kind: "command";
  commandId: string;
  label: string;
  keyHint: string | null;
}

interface FileItem {
  kind: "file";
  name: string;
  filePath: string;
  isOpen: boolean;
  tabId?: string;
}

type PaletteItem = CommandItem | FileItem;

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
      kind: "command",
      commandId: entry.commandId,
      label: labelMap.get(entry.commandId) ?? entry.commandId,
      keyHint: formatChord(entry),
    });
  }

  for (const cmd of pluginCommands) {
    if (!seen.has(cmd.id)) {
      seen.add(cmd.id);
      items.push({ kind: "command", commandId: cmd.id, label: cmd.name, keyHint: null });
    }
  }

  return items;
}

function fuzzyMatch(label: string, q: string): boolean {
  if (!q) return true;
  const lo = label.toLowerCase();
  const query = q.toLowerCase();
  return lo.startsWith(query) || lo.includes(query);
}

function fuzzySort<T extends { label?: string; name?: string }>(items: T[], q: string): T[] {
  if (!q) return items;
  const query = q.toLowerCase();
  const startsWith: T[] = [];
  const includes: T[] = [];
  for (const item of items) {
    const label = ((item.label ?? item.name ?? "") as string).toLowerCase();
    if (label.startsWith(query)) startsWith.push(item);
    else if (label.includes(query)) includes.push(item);
  }
  return [...startsWith, ...includes];
}

// ── CommandPalette ─────────────────────────────────────────────────────────────

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [commands, setCommands] = useState<CommandItem[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<FileItem[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const tabs = useTabStore((s) => s.tabs);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const addTab = useTabStore((s) => s.addTab);
  const workspaceDir = useWorkspaceStore((s) => s.workspaceDir);

  // ── Mode detection ──────────────────────────────────────────────────────────
  const isCommandMode = query.trimStart().startsWith(">");
  const commandQuery = isCommandMode ? query.trimStart().slice(1).trimStart() : "";
  const fileQuery = !isCommandMode ? query.trim() : "";

  // ── Register keybinding ─────────────────────────────────────────────────────
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
      PluginManager.unregisterCommandHandler(COMMAND_ID);
    };
  }, []);

  // ── On open: load commands + workspace files ────────────────────────────────
  useEffect(() => {
    if (!open) return;

    startTransition(() => {
      setCommands(buildCommandItems());
      setQuery("");
      setSelectedIndex(0);
    });

    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });

    if (!workspaceDir) {
      startTransition(() => setWorkspaceFiles([]));
      return;
    }

    void (async () => {
      try {
        const entries = await readDir(workspaceDir);
        const files: FileItem[] = [];

        for (const entry of entries) {
          if (entry.isDirectory || !entry.name?.endsWith(".excalidraw")) continue;
          const filePath = await join(workspaceDir, entry.name);
          const openTab = tabs.find((t) => t.metadata?.filePath === filePath);
          files.push({
            kind: "file",
            name: entry.name.replace(/\.excalidraw$/, ""),
            filePath,
            isOpen: !!openTab,
            tabId: openTab?.id,
          });
        }

        setWorkspaceFiles(files);
      } catch {
        setWorkspaceFiles([]);
      }
    })();
  }, [open, workspaceDir, tabs]);

  // ── Build displayed items ───────────────────────────────────────────────────
  const openFileTabs = useMemo<FileItem[]>(
    () =>
      tabs
        .filter((t) => t.metadata?.filePath)
        .map((t) => ({
          kind: "file" as const,
          name: t.title.replace(" •", ""),
          filePath: t.metadata!.filePath as string,
          isOpen: true,
          tabId: t.id,
        })),
    [tabs]
  );

  const workspaceOnlyFiles = useMemo(
    () => workspaceFiles.filter((f) => !f.isOpen),
    [workspaceFiles]
  );

  const filteredOpenFiles = useMemo(
    () =>
      fuzzySort(
        fileQuery ? openFileTabs.filter((f) => fuzzyMatch(f.name, fileQuery)) : openFileTabs,
        fileQuery
      ),
    [openFileTabs, fileQuery]
  );

  const filteredWorkspaceFiles = useMemo(
    () =>
      fuzzySort(
        fileQuery
          ? workspaceOnlyFiles.filter((f) => fuzzyMatch(f.name, fileQuery))
          : workspaceOnlyFiles,
        fileQuery
      ),
    [workspaceOnlyFiles, fileQuery]
  );

  const filteredCommands = useMemo(
    () =>
      fuzzySort(
        commandQuery ? commands.filter((c) => fuzzyMatch(c.label, commandQuery)) : commands,
        commandQuery
      ),
    [commands, commandQuery]
  );

  // Flat list for keyboard navigation
  const allItems = useMemo<PaletteItem[]>(
    () => (isCommandMode ? filteredCommands : [...filteredOpenFiles, ...filteredWorkspaceFiles]),
    [isCommandMode, filteredCommands, filteredOpenFiles, filteredWorkspaceFiles]
  );

  // ── Scroll selected item into view ─────────────────────────────────────────
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // ── Execute item ────────────────────────────────────────────────────────────
  const executeItem = useCallback(
    async (item: PaletteItem) => {
      setOpen(false);
      if (item.kind === "command") {
        await PluginManager.executeCommand(item.commandId);
        return;
      }
      // file item
      if (item.tabId) {
        setActiveTab(item.tabId);
        return;
      }
      const name = `${item.name}.excalidraw`;
      const handler = fileHandlerRegistry.resolveOrDefault(name);
      const title = handler.displayName ? handler.displayName(name) : name;
      addTab({
        routeId: handler.routeId,
        path: `/${handler.routeId}`,
        title,
        instanceId: item.filePath,
        metadata: { filePath: item.filePath },
      });
    },
    [setActiveTab, addTab]
  );

  // ── Keyboard handler ────────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, allItems.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (allItems[selectedIndex]) {
            void executeItem(allItems[selectedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          break;
      }
    },
    [allItems, selectedIndex, executeItem]
  );

  // ── Empty state messages ────────────────────────────────────────────────────
  const isEmpty = allItems.length === 0;
  const emptyMessage = isCommandMode
    ? "No commands found"
    : !workspaceDir
      ? "No workspace selected"
      : "No files found";

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showClose={false}
        className="p-0 gap-0 overflow-hidden max-w-xl top-[10%] translate-y-0 rounded-lg border border-border bg-background shadow-2xl"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Command Palette</DialogTitle>

        {/* Search input */}
        <div className="flex items-center border-b border-border px-3">
          {isCommandMode ? (
            <Terminal className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <svg
              className="size-4 shrink-0 text-muted-foreground"
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
          )}
          <input
            ref={inputRef}
            placeholder={isCommandMode ? "Run command..." : "Search files..."}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent px-3 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          <kbd className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results list */}
        <div ref={listRef} className="overflow-y-auto max-h-80 py-1">
          {isEmpty ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {emptyMessage}
            </div>
          ) : isCommandMode ? (
            filteredCommands.map((cmd, idx) => (
              <Button
                key={cmd.commandId}
                variant="ghost"
                data-index={idx}
                className={cn(
                  "w-full justify-between h-auto py-2 px-4 rounded-none font-normal",
                  idx === selectedIndex && "bg-accent text-accent-foreground"
                )}
                onMouseEnter={() => setSelectedIndex(idx)}
                onClick={() => void executeItem(cmd)}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{cmd.label}</span>
                </div>
                {cmd.keyHint && (
                  <kbd className="ml-4 shrink-0 inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
                    {cmd.keyHint}
                  </kbd>
                )}
              </Button>
            ))
          ) : (
            <>
              {filteredOpenFiles.length > 0 && (
                <>
                  <div className="px-4 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Open
                  </div>
                  {filteredOpenFiles.map((file, idx) => (
                    <FileRow
                      key={file.filePath}
                      file={file}
                      index={idx}
                      selectedIndex={selectedIndex}
                      onHover={setSelectedIndex}
                      onSelect={executeItem}
                    />
                  ))}
                </>
              )}
              {filteredWorkspaceFiles.length > 0 && (
                <>
                  <div
                    className={cn(
                      "px-4 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider",
                      filteredOpenFiles.length > 0 && "mt-1 border-t border-border"
                    )}
                  >
                    Workspace
                  </div>
                  {filteredWorkspaceFiles.map((file, idx) => (
                    <FileRow
                      key={file.filePath}
                      file={file}
                      index={filteredOpenFiles.length + idx}
                      selectedIndex={selectedIndex}
                      onHover={setSelectedIndex}
                      onSelect={executeItem}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 py-2 flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <kbd className="inline-flex items-center rounded border border-border bg-muted px-1 text-[10px] font-mono">
              ↑↓
            </kbd>
            navigate
          </span>
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <kbd className="inline-flex items-center rounded border border-border bg-muted px-1 text-[10px] font-mono">
              ↵
            </kbd>
            {isCommandMode ? "run" : "open"}
          </span>
          {!isCommandMode && (
            <span className="text-[11px] text-muted-foreground ml-auto">
              type{" "}
              <kbd className="inline-flex items-center rounded border border-border bg-muted px-1 text-[10px] font-mono">
                &gt;
              </kbd>{" "}
              for commands
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── FileRow sub-component ──────────────────────────────────────────────────────

function FileRow({
  file,
  index,
  selectedIndex,
  onHover,
  onSelect,
}: {
  file: FileItem;
  index: number;
  selectedIndex: number;
  onHover: (idx: number) => void;
  onSelect: (item: PaletteItem) => void;
}) {
  return (
    <Button
      variant="ghost"
      data-index={index}
      className={cn(
        "w-full justify-between h-auto py-2 px-4 rounded-none font-normal",
        index === selectedIndex && "bg-accent text-accent-foreground"
      )}
      onMouseEnter={() => onHover(index)}
      onClick={() => onSelect(file)}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{file.name}</span>
      </div>
      {file.isOpen && <span className="ml-4 shrink-0 text-[10px] text-muted-foreground">open</span>}
    </Button>
  );
}
