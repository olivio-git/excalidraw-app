import { useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/shared/components/ui/dialog";
import { cn } from "@/shared/lib/utils";
import { flattenAll, filterIndex } from "./explorer-utils";
import { fileIconRegistry } from "./file-icon-registry";
import type { FileEntry, FlatNode } from "./explorer-types";

// ---------------------------------------------------------------------------
// QuickOpenDialog — fuzzy-search file opener (Ctrl+P)
// Mounted at ExplorerPanel level — no portal needed beyond what Dialog provides.
// ---------------------------------------------------------------------------

interface QuickOpenDialogProps {
  open: boolean;
  onClose: () => void;
  tree: FileEntry[];
  workspaceDir: string;
  onOpenFile: (path: string, name: string) => void;
}

// Inner component — remounted on each open via `key` so state resets cleanly
// without useEffect setState patterns.
const QuickOpenContent = ({
  tree,
  workspaceDir,
  onOpenFile,
  onClose,
}: Omit<QuickOpenDialogProps, "open">) => {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build flat index on tree (all files, not just visible)
  const allNodes: FlatNode[] = flattenAll(tree);

  // Filter — only files (not dirs) for quick open, top 10
  const results = filterIndex(
    allNodes.filter((n) => !n.isDir),
    query
  ).slice(0, 10);

  // Clamp activeIndex inline (derive, don't sync in effect)
  const safeIndex = results.length === 0 ? 0 : Math.min(activeIndex, results.length - 1);

  // Auto-focus input on mount
  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  // Scroll active item into view
  useEffect(() => {
    const item = listRef.current?.querySelector(`[data-active="true"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [safeIndex]);

  const handleSelect = (node: FlatNode) => {
    onOpenFile(node.path, node.name);
    onClose();
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setActiveIndex(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (results.length === 0) break;
        setActiveIndex((prev) => (prev + 1) % results.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (results.length === 0) break;
        setActiveIndex((prev) => (prev - 1 + results.length) % results.length);
        break;
      case "Enter":
        e.preventDefault();
        if (results[safeIndex]) handleSelect(results[safeIndex]);
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  };

  const relativePath = (path: string) =>
    path.startsWith(workspaceDir + "/") ? path.slice(workspaceDir.length + 1) : path;

  return (
    <>
      {/* Search input */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
        <Search className="size-4 text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Buscar archivo..."
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {/* Results list */}
      <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
        {results.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6 px-4">
            {query ? `Sin resultados para "${query}"` : "Sin archivos en el workspace"}
          </p>
        ) : (
          results.map((node, i) => {
            const { icon: FileIcon, colorClass } = fileIconRegistry.resolve(node.name);
            const relPath = relativePath(node.path);
            const isActive = i === safeIndex;

            return (
              <button
                key={node.path}
                data-active={isActive}
                onClick={() => handleSelect(node)}
                onMouseEnter={() => setActiveIndex(i)}
                className={cn(
                  "flex items-center gap-2.5 w-full text-left px-3 py-1.5 text-sm",
                  "hover:bg-accent",
                  isActive && "bg-accent"
                )}
              >
                <FileIcon className={cn("size-3.5 shrink-0", colorClass)} />
                <span className="truncate font-medium text-foreground">{node.name}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground text-right max-w-[45%]">
                  {relPath}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Footer hint */}
      {results.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-1.5 border-t border-border/50 text-[10px] text-muted-foreground">
          <span>↑↓ navegar</span>
          <span>↵ abrir</span>
          <span>Esc cerrar</span>
        </div>
      )}
    </>
  );
};

export const QuickOpenDialog = ({
  open,
  onClose,
  tree,
  workspaceDir,
  onOpenFile,
}: QuickOpenDialogProps) => {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="p-0 gap-0 max-w-lg overflow-hidden" showClose={false}>
        {/* Accessible title/description (visually hidden) */}
        <DialogTitle className="sr-only">Abrir archivo rápido</DialogTitle>
        <DialogDescription className="sr-only">
          Escribe para buscar archivos en el workspace
        </DialogDescription>

        {/* Key forces remount on each open, cleanly resetting all inner state */}
        <QuickOpenContent
          key={open ? "open" : "closed"}
          tree={tree}
          workspaceDir={workspaceDir}
          onOpenFile={onOpenFile}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
};
