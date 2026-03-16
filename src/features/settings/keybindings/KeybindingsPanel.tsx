import { useState, useEffect, useRef, useCallback } from "react";
import { RotateCcw } from "lucide-react";
import { keybindingRegistry } from "@/core/keybindings/keybinding-registry";
import { keyNormalizer } from "@/core/keybindings/key-normalizer";
import { useKeybindingStore } from "@/core/keybindings/store/keybinding-store";
import { KeybindingSource } from "@/core/keybindings/types";
import type { KeybindingEntry, KeybindingConflict } from "@/core/keybindings/types";
import { PluginManager } from "@/plugins/plugin-manager";
import { cn } from "@/shared/lib/utils";

// ── Display helpers ────────────────────────────────────────────────────────────

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

function sourceBadgeClasses(source: KeybindingSource): string {
  switch (source) {
    case KeybindingSource.User:
      return "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700";
    case KeybindingSource.Plugin:
      return "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-700";
    default:
      return "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700";
  }
}

function sourceBadgeLabel(source: KeybindingSource): string {
  switch (source) {
    case KeybindingSource.User:
      return "user";
    case KeybindingSource.Plugin:
      return "plugin";
    default:
      return "builtin";
  }
}

function filterEntries(
  entries: KeybindingEntry[],
  labelMap: Map<string, string>,
  query: string
): KeybindingEntry[] {
  if (!query.trim()) return entries;
  const q = query.toLowerCase();
  return entries.filter((entry) => {
    const label = labelMap.get(entry.commandId) ?? entry.commandId;
    return (
      label.toLowerCase().includes(q) ||
      entry.commandId.toLowerCase().includes(q) ||
      formatChord(entry).toLowerCase().includes(q)
    );
  });
}

// ── Reassign capture ──────────────────────────────────────────────────────────

interface ReassignCaptureProps {
  entry: KeybindingEntry;
  onConfirm: (entry: KeybindingEntry, newEntry: KeybindingEntry) => void;
  onCancel: () => void;
}

function ReassignCapture({ entry, onConfirm, onCancel }: ReassignCaptureProps) {
  const [capturedKey, setCapturedKey] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        onCancel();
        return;
      }

      if (e.key === "Enter" && capturedKey) {
        const chord = keyNormalizer.normalizeChord(capturedKey);
        const newEntry: KeybindingEntry = {
          ...entry,
          chord,
          source: KeybindingSource.User,
        };
        onConfirm(entry, newEntry);
        return;
      }

      const mods: string[] = [];
      if (e.ctrlKey) mods.push("ctrl");
      if (e.altKey) mods.push("alt");
      if (e.shiftKey) mods.push("shift");
      if (e.metaKey) mods.push("meta");

      const key = e.key.toLowerCase();
      if (["control", "alt", "shift", "meta"].includes(key)) return;

      const combo = [...mods, key].join("+");
      setCapturedKey(combo);
    },
    [capturedKey, entry, onConfirm, onCancel]
  );

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        readOnly
        value={capturedKey ? capturedKey : "Press a key combo..."}
        onKeyDown={handleKeyDown}
        className="h-7 w-48 rounded border border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-800 px-2 text-xs font-mono text-zinc-700 dark:text-zinc-300 outline-none focus:border-blue-400 dark:focus:border-blue-500"
      />
      {capturedKey && (
        <button
          className="h-7 rounded border border-blue-500 dark:border-blue-400 bg-blue-500 dark:bg-blue-600 px-2 text-xs font-medium text-white hover:bg-blue-600 dark:hover:bg-blue-500 transition-colors"
          onClick={() => {
            const chord = keyNormalizer.normalizeChord(capturedKey);
            const newEntry: KeybindingEntry = {
              ...entry,
              chord,
              source: KeybindingSource.User,
            };
            onConfirm(entry, newEntry);
          }}
        >
          Save
        </button>
      )}
      <button
        className="h-7 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}

// ── KeybindingsPanel ──────────────────────────────────────────────────────────

export default function KeybindingsPanel() {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<KeybindingEntry[]>([]);
  const [conflicts, setConflicts] = useState<KeybindingConflict[]>([]);
  const [reassigningId, setReassigningId] = useState<string | null>(null);

  const overrides = useKeybindingStore((s) => s.overrides);
  const addOverride = useKeybindingStore((s) => s.addOverride);
  const removeOverride = useKeybindingStore((s) => s.removeOverride);
  const resetAll = useKeybindingStore((s) => s.resetAll);

  const pluginCommands = PluginManager.getCommands();
  const labelMap = new Map(pluginCommands.map((c) => [c.id, c.name]));

  useEffect(() => {
    setEntries(keybindingRegistry.getAll());
    setConflicts(keybindingRegistry.getConflicts());
  }, [overrides]);

  useEffect(() => {
    setEntries(keybindingRegistry.getAll());
    setConflicts(keybindingRegistry.getConflicts());
  }, []);

  const conflictSet = new Set<string>(
    conflicts.flatMap((c) => c.entries.map((e) => e.commandId + ":" + e.chord.join(" ")))
  );

  const isConflict = (entry: KeybindingEntry): boolean =>
    conflictSet.has(entry.commandId + ":" + entry.chord.join(" "));

  const isOverridden = (entry: KeybindingEntry): boolean =>
    overrides.some((o) => o.commandId === entry.commandId);

  const filtered = filterEntries(entries, labelMap, query);

  const handleReassign = useCallback(
    (originalEntry: KeybindingEntry, newEntry: KeybindingEntry) => {
      if (isOverridden(originalEntry)) {
        removeOverride(originalEntry.chord[0], originalEntry.commandId);
      }
      addOverride(newEntry);
      setReassigningId(null);
      setEntries(keybindingRegistry.getAll());
      setConflicts(keybindingRegistry.getConflicts());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overrides, addOverride, removeOverride]
  );

  const handleReset = useCallback(
    (entry: KeybindingEntry) => {
      removeOverride(entry.chord[0], entry.commandId);
      setEntries(keybindingRegistry.getAll());
      setConflicts(keybindingRegistry.getConflicts());
    },
    [removeOverride]
  );

  const handleResetAll = useCallback(() => {
    resetAll();
    setEntries(keybindingRegistry.getAll());
    setConflicts(keybindingRegistry.getConflicts());
  }, [resetAll]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative max-w-xs flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400 dark:text-zinc-500 pointer-events-none"
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
            placeholder="Search keybindings..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full h-9 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-9 pr-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 outline-none focus:border-zinc-400 dark:focus:border-zinc-500 transition-colors"
          />
        </div>
        {overrides.length > 0 && (
          <button
            onClick={handleResetAll}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 h-9 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors shrink-0"
          >
            <RotateCcw className="size-3.5" />
            Reset all ({overrides.length})
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-md border border-zinc-200 dark:border-zinc-700 overflow-hidden">
        <div className="overflow-y-auto max-h-[420px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/80">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Command
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 w-48">
                  Keybinding
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 w-24">
                  Source
                </th>
                <th className="px-4 py-2.5 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400"
                  >
                    No keybindings found
                  </td>
                </tr>
              ) : (
                filtered.map((entry) => {
                  const label = labelMap.get(entry.commandId) ?? entry.commandId;
                  const conflict = isConflict(entry);
                  const overridden = isOverridden(entry);
                  const isReassigning = reassigningId === entry.commandId;

                  return (
                    <tr
                      key={`${entry.commandId}-${entry.chord.join("-")}`}
                      className={cn(
                        "transition-colors",
                        conflict
                          ? "bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50"
                          : "bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/50",
                        !isReassigning && "cursor-pointer"
                      )}
                      onClick={() => {
                        if (!isReassigning) {
                          setReassigningId(entry.commandId);
                        }
                      }}
                    >
                      {/* Command name */}
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "font-medium",
                              conflict
                                ? "text-red-700 dark:text-red-400"
                                : "text-zinc-900 dark:text-zinc-100"
                            )}
                          >
                            {label}
                          </span>
                          {conflict && (
                            <span className="inline-flex items-center rounded border border-red-300 dark:border-red-700 bg-red-100 dark:bg-red-900/50 px-1.5 py-0 text-[10px] font-medium text-red-700 dark:text-red-300">
                              conflict
                            </span>
                          )}
                          {overridden && !conflict && (
                            <span className="inline-flex items-center rounded border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                              modified
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs font-mono text-zinc-400 dark:text-zinc-500">
                          {entry.commandId}
                        </div>
                      </td>

                      {/* Keybinding / Reassign input */}
                      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                        {isReassigning ? (
                          <ReassignCapture
                            entry={entry}
                            onConfirm={handleReassign}
                            onCancel={() => setReassigningId(null)}
                          />
                        ) : (
                          <kbd className="inline-flex items-center rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-xs font-mono text-zinc-600 dark:text-zinc-400">
                            {formatChord(entry)}
                          </kbd>
                        )}
                      </td>

                      {/* Source badge */}
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
                            sourceBadgeClasses(entry.source)
                          )}
                        >
                          {sourceBadgeLabel(entry.source)}
                        </span>
                      </td>

                      {/* Reset button */}
                      <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        {overridden && (
                          <button
                            title="Reset to default"
                            onClick={() => handleReset(entry)}
                            className="inline-flex items-center justify-center h-7 w-7 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                          >
                            <RotateCcw className="size-3" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
