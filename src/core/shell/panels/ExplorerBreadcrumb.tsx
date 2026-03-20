import { ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";

// ---------------------------------------------------------------------------
// ExplorerBreadcrumb — Task 3.4
// Shows the relative path of the active file below the ExplorerToolbar.
// Each segment is clickable and expands all ancestors in the explorer tree.
// Only renders when an activeFilePath is present.
// ---------------------------------------------------------------------------

interface ExplorerBreadcrumbProps {
  activeFilePath: string | undefined;
  workspaceDir: string;
  /** Called with all ancestor paths that should be added to expandedPaths */
  onExpandPaths: (paths: string[]) => void;
}

function getSegments(filePath: string, workspaceDir: string): string[] {
  // Strip workspace root prefix, split by '/', drop empty strings
  const relative = filePath.startsWith(workspaceDir)
    ? filePath.slice(workspaceDir.length)
    : filePath;
  return relative.split("/").filter(Boolean);
}

function getAncestorPaths(filePath: string, workspaceDir: string): string[] {
  const segments = getSegments(filePath, workspaceDir);
  const ancestors: string[] = [];
  let current = workspaceDir;
  for (let i = 0; i < segments.length - 1; i++) {
    current = `${current}/${segments[i]}`;
    ancestors.push(current);
  }
  return ancestors;
}

export const ExplorerBreadcrumb = ({
  activeFilePath,
  workspaceDir,
  onExpandPaths,
}: ExplorerBreadcrumbProps) => {
  if (!activeFilePath) return null;

  const segments = getSegments(activeFilePath, workspaceDir);
  if (segments.length === 0) return null;

  const handleSegmentClick = (segmentIndex: number) => {
    // Expand all ancestors up to (and including) the clicked folder segment
    const ancestors: string[] = [];
    let current = workspaceDir;
    for (let i = 0; i <= segmentIndex; i++) {
      current = `${current}/${segments[i]}`;
      if (i < segmentIndex) {
        // Only folder segments (not the final file)
        ancestors.push(current);
      }
    }
    // Always include workspace root
    onExpandPaths([workspaceDir, ...ancestors]);
  };

  return (
    <div
      className={cn(
        "flex items-center min-w-0 px-2 py-0.5 border-b border-border/50 shrink-0",
        "bg-muted/30"
      )}
      title={activeFilePath}
    >
      {/* Overflow strategy: truncate from the left by reversing + hiding overflow */}
      <div className="flex items-center min-w-0 overflow-hidden flex-row-reverse">
        {[...segments].reverse().map((segment, reversedIndex) => {
          const originalIndex = segments.length - 1 - reversedIndex;
          const isLast = originalIndex === segments.length - 1;
          const isFirst = originalIndex === 0;
          const isClickable = !isLast; // folders are clickable; last segment is the file

          return (
            <div key={originalIndex} className="flex items-center flex-row-reverse shrink-0">
              {/* Separator (not after the last/leftmost item in reversed order, which is the first segment) */}
              {!isFirst && (
                <ChevronRight className="size-3 text-muted-foreground/40 shrink-0 mx-0.5" />
              )}
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
            </div>
          );
        })}
      </div>
    </div>
  );
};
