import { ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { isSameOrDescendant } from "./explorer-file-operations";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { selectActiveFilePath } from "./active-file";

// ---------------------------------------------------------------------------
// ExplorerBreadcrumb — Task 3.4
// Shows the relative path of the active file below the ExplorerToolbar.
// Each segment is clickable and expands all ancestors in the explorer tree.
// Only renders when an activeFilePath is present.
// ---------------------------------------------------------------------------

interface ExplorerBreadcrumbProps {
  workspaceDir: string;
  /** Called with all ancestor paths that should be added to expandedPaths */
  onExpandPaths: (paths: string[]) => void;
}

function getSegments(filePath: string, workspaceDir: string): string[] {
  // Strip workspace root prefix, split by '/', drop empty strings
  const relative = filePath.startsWith(workspaceDir)
    ? filePath.slice(workspaceDir.length)
    : filePath;
  return relative.split(/[\\/]/).filter(Boolean);
}

const BAR_CLASS =
  "flex h-5 items-center min-w-0 px-2 border-b border-border/50 shrink-0 bg-muted/30";

export const ExplorerBreadcrumb = ({ workspaceDir, onExpandPaths }: ExplorerBreadcrumbProps) => {
  // Subscribes on its own so the explorer doesn't re-render on tab switches.
  const activeFilePath = useTabStore(selectActiveFilePath);
  const segments =
    activeFilePath && isSameOrDescendant(activeFilePath, workspaceDir)
      ? getSegments(activeFilePath, workspaceDir)
      : [];
  // Always reserve the row: if it appeared only once a file was open, the tree
  // below would jump down by one row between the two clicks of a double-click.
  if (segments.length === 0) return <div className={BAR_CLASS} aria-hidden />;

  const handleSegmentClick = (segmentIndex: number) => {
    // Expand all ancestors up to (and including) the clicked folder segment
    const ancestors: string[] = [];
    let current = workspaceDir;
    const separator = workspaceDir.includes("\\") ? "\\" : "/";
    for (let i = 0; i <= segmentIndex; i++) {
      current = `${current}${current.endsWith(separator) ? "" : separator}${segments[i]}`;
      ancestors.push(current);
    }
    // Always include workspace root
    onExpandPaths([workspaceDir, ...ancestors]);
  };

  return (
    <div className={BAR_CLASS} title={activeFilePath}>
      {/* Overflow strategy: truncate from the left by reversing + hiding overflow */}
      <div className="flex items-center min-w-0 overflow-hidden flex-row-reverse">
        {[...segments].reverse().map((segment, reversedIndex) => {
          const originalIndex = segments.length - 1 - reversedIndex;
          const isLast = originalIndex === segments.length - 1;
          const isFirst = originalIndex === 0;
          const isClickable = !isLast; // folders are clickable; last segment is the file

          return (
            <div key={originalIndex} className="flex items-center flex-row-reverse shrink-0">
              {/* In a row-reverse container the button must come first in the DOM
                  so the separator is drawn before the name: "notes › nota.md". */}
              <button
                onClick={isClickable ? () => handleSegmentClick(originalIndex) : undefined}
                disabled={!isClickable}
                className={cn(
                  "text-[10px] leading-none truncate max-w-[120px]",
                  isLast
                    ? "text-foreground/80 font-medium cursor-default"
                    : "text-muted-foreground hover:text-foreground cursor-pointer"
                )}
              >
                {segment}
              </button>
              {!isFirst && (
                <ChevronRight className="size-3 text-muted-foreground/40 shrink-0 mx-0.5" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
