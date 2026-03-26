import { useState, useMemo, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { keybindingRegistry } from "@/core/keybindings/keybinding-registry";
import { keyNormalizer } from "@/core/keybindings/key-normalizer";
import { useKeybindingStore } from "@/core/keybindings/store/keybinding-store";
import { KeybindingSource } from "@/core/keybindings/types";
import type { KeybindingEntry, KeybindingConflict } from "@/core/keybindings/types";
import { PluginManager } from "@/plugins/plugin-manager";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { PanelSearch } from "@/shared/common/PanelSearch";
import { DataTable, createColumnHelper } from "@/shared/components/ui/data-table";

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

function sourceBadgeLabel(source: KeybindingSource, t: (key: string) => string): string {
  switch (source) {
    case KeybindingSource.User:
      return t("keybindings.badge.user");
    case KeybindingSource.Plugin:
      return t("keybindings.badge.plugin");
    default:
      return t("keybindings.badge.builtin");
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
  t: (key: string) => string;
  onConfirm: (entry: KeybindingEntry, newEntry: KeybindingEntry) => void;
  onCancel: () => void;
}

function ReassignCapture({ entry, t, onConfirm, onCancel }: ReassignCaptureProps) {
  const [capturedKey, setCapturedKey] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      onCancel();
      return;
    }

    if (e.key === "Enter" && capturedKey) {
      const chord = keyNormalizer.normalizeChord(capturedKey);
      const newEntry: KeybindingEntry = { ...entry, chord, source: KeybindingSource.User };
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

    setCapturedKey([...mods, key].join("+"));
  }

  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        readOnly
        value={capturedKey ? capturedKey : t("keybindings.capture.pressKey")}
        onKeyDown={handleKeyDown}
        className="h-7 w-48 rounded border border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-800 px-2 text-xs font-mono text-zinc-700 dark:text-zinc-300 outline-none focus:border-blue-400 dark:focus:border-blue-500"
      />
      {capturedKey && (
        <button
          className="h-7 rounded border border-blue-500 dark:border-blue-400 bg-blue-500 dark:bg-blue-600 px-2 text-xs font-medium text-white hover:bg-blue-600 dark:hover:bg-blue-500 transition-colors"
          onClick={() => {
            const chord = keyNormalizer.normalizeChord(capturedKey);
            const newEntry: KeybindingEntry = { ...entry, chord, source: KeybindingSource.User };
            onConfirm(entry, newEntry);
          }}
        >
          {t("keybindings.capture.save")}
        </button>
      )}
      <button
        className="h-7 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        onClick={onCancel}
      >
        {t("keybindings.capture.cancel")}
      </button>
    </div>
  );
}

// ── Column helper ─────────────────────────────────────────────────────────────

const helper = createColumnHelper<KeybindingEntry>();

// ── KeybindingsPanel ──────────────────────────────────────────────────────────

export default function KeybindingsPanel() {
  const { t } = useTranslation("settings");
  const [query, setQuery] = useState("");
  const [reassigningId, setReassigningId] = useState<string | null>(null);

  const overrides = useKeybindingStore((s) => s.overrides);
  const addOverride = useKeybindingStore((s) => s.addOverride);
  const removeOverride = useKeybindingStore((s) => s.removeOverride);
  const resetAll = useKeybindingStore((s) => s.resetAll);

  const pluginCommands = PluginManager.getCommands();
  const labelMap = new Map(pluginCommands.map((c) => [c.id, c.name]));

  const entries = useMemo(() => keybindingRegistry.getAll(), [overrides]);
  const conflicts = useMemo(() => keybindingRegistry.getConflicts(), [overrides]);

  const conflictSet = new Set<string>(
    conflicts.flatMap((c) => c.entries.map((e) => e.commandId + ":" + e.chord.join(" ")))
  );

  const isConflict = (entry: KeybindingEntry): boolean =>
    conflictSet.has(entry.commandId + ":" + entry.chord.join(" "));

  const isOverridden = (entry: KeybindingEntry): boolean =>
    overrides.some((o) => o.commandId === entry.commandId);

  const filtered = filterEntries(entries, labelMap, query);

  function handleReassign(originalEntry: KeybindingEntry, newEntry: KeybindingEntry) {
    if (isOverridden(originalEntry)) {
      removeOverride(originalEntry.chord[0], originalEntry.commandId);
    }
    addOverride(newEntry);
    setReassigningId(null);
  }

  // ── Column definitions ─────────────────────────────────────────────────────

  const columns = [
    helper.display({
      id: "command",
      header: () => t("keybindings.table.command"),
      cell: ({ row }) => {
        const entry = row.original;
        const label = labelMap.get(entry.commandId) ?? entry.commandId;
        const conflict = isConflict(entry);
        const overridden = isOverridden(entry);
        return (
          <div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "font-medium",
                  conflict ? "text-red-700 dark:text-red-400" : "text-foreground"
                )}
              >
                {label}
              </span>
              {conflict && (
                <span className="inline-flex items-center rounded border border-red-300 dark:border-red-700 bg-red-100 dark:bg-red-900/50 px-1.5 py-0 text-[10px] font-medium text-red-700 dark:text-red-300">
                  {t("keybindings.badge.conflict")}
                </span>
              )}
              {overridden && !conflict && (
                <span className="inline-flex items-center rounded border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                  {t("keybindings.badge.modified")}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs font-mono text-muted-foreground">{entry.commandId}</div>
          </div>
        );
      },
    }),
    helper.display({
      id: "keybinding",
      header: () => t("keybindings.table.keybinding"),
      size: 192,
      cell: ({ row }) => {
        const entry = row.original;
        const isReassigning = reassigningId === entry.commandId;
        if (isReassigning) {
          return (
            <ReassignCapture
              entry={entry}
              t={t}
              onConfirm={handleReassign}
              onCancel={() => setReassigningId(null)}
            />
          );
        }
        return (
          <kbd className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
            {formatChord(entry)}
          </kbd>
        );
      },
    }),
    helper.display({
      id: "source",
      header: () => t("keybindings.table.source"),
      size: 96,
      cell: ({ row }) => (
        <span
          className={cn(
            "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
            sourceBadgeClasses(row.original.source)
          )}
        >
          {sourceBadgeLabel(row.original.source, t)}
        </span>
      ),
    }),
    helper.display({
      id: "actions",
      size: 80,
      cell: ({ row }) => {
        const entry = row.original;
        return isOverridden(entry) ? (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <Button
              title={t("keybindings.capture.resetToDefault")}
              onClick={() => removeOverride(entry.chord[0], entry.commandId)}
              variant="outline"
            >
              <RotateCcw className="size-3" />
            </Button>
          </div>
        ) : null;
      },
    }),
  ];

  return (
    <div className="space-y-4">
      {/* Search + Reset All */}
      <div className="flex items-center justify-between gap-4">
        <PanelSearch
          placeholder={t("keybindings.searchPlaceholder")}
          value={query}
          onChange={setQuery}
          className="max-w-xs flex-1"
        />
        {overrides.length > 0 && (
          <Button onClick={resetAll} variant="default">
            <RotateCcw className="size-3.5" />
            {t("keybindings.resetAll", { count: overrides.length })}
          </Button>
        )}
      </div>

      {/* Table — data is pre-filtered via custom filterEntries which searches across label,
          commandId, AND formatted chord (e.g. "Ctrl+K"). DataTable's built-in globalFilter
          is NOT used here because TanStack's default filter only matches on accessor column
          values, and our columns are all `display` columns with no accessor value. */}
      <DataTable
        columns={columns}
        data={filtered}
        maxHeight="420px"
        empty={t("keybindings.noResults")}
        onRowClick={(entry) => {
          if (reassigningId !== entry.commandId) {
            setReassigningId(entry.commandId);
          }
        }}
        getRowClassName={(entry) =>
          isConflict(entry)
            ? "bg-red-50 dark:bg-red-950/30 hover:bg-red-100! dark:hover:bg-red-950/50!"
            : undefined
        }
        getRowId={(entry) => entry.commandId}
      />
    </div>
  );
}
