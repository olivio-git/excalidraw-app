import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DocumentEditorToolbarProps {
  title: string;
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void;
}

// ---------------------------------------------------------------------------
// Save status constants
// ---------------------------------------------------------------------------

const SAVE_STATUS = {
  SAVING: "saving",
  UNSAVED: "unsaved",
  SAVED: "saved",
} as const;

type SaveStatus = (typeof SAVE_STATUS)[keyof typeof SAVE_STATUS];

// ---------------------------------------------------------------------------
// DocumentEditorToolbar — status bar + save action
//
// The rich formatting toolbar (bold, italic, etc.) is handled by BlockNote's
// built-in bubble menu — no manual implementation needed here.
// ---------------------------------------------------------------------------

export function DocumentEditorToolbar({
  title,
  isDirty,
  isSaving,
  onSave,
}: DocumentEditorToolbarProps) {
  const saveStatus: SaveStatus = isSaving
    ? SAVE_STATUS.SAVING
    : isDirty
      ? SAVE_STATUS.UNSAVED
      : SAVE_STATUS.SAVED;

  return (
    <div className="flex items-center justify-between px-4 py-1.5 border-b border-border bg-background shrink-0">
      {/* Document title */}
      <span className="text-sm font-medium text-foreground truncate max-w-xs">{title}</span>

      {/* Right section: save status + save button */}
      <div className="flex items-center gap-3">
        <SaveStatusIndicator status={saveStatus} />
        <Button
          variant="ghost"
          size="sm"
          onClick={onSave}
          disabled={isSaving || !isDirty}
          className="h-7 px-2 text-xs"
        >
          Save
          <span className="ml-1 text-muted-foreground">Ctrl+S</span>
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SaveStatusIndicator — sub-component
// ---------------------------------------------------------------------------

interface SaveStatusIndicatorProps {
  status: SaveStatus;
}

function SaveStatusIndicator({ status }: SaveStatusIndicatorProps) {
  if (status === SAVE_STATUS.SAVING) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
        Saving...
      </span>
    );
  }

  if (status === SAVE_STATUS.UNSAVED) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-yellow-500">
        <span className="h-2 w-2 rounded-full bg-yellow-400" />
        Unsaved changes
      </span>
    );
  }

  return (
    <span className={cn("flex items-center gap-1.5 text-xs", "text-muted-foreground")}>
      <span className="h-2 w-2 rounded-full bg-green-500" />
      Saved
    </span>
  );
}
