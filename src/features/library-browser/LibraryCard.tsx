import { useState, memo } from "react";
import { BookOpen, Check, Loader2, Info } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { TooltipWrapper } from "@/shared/common/TooltipWrapper";
import type { ExcalidrawLibraryEntry, InstallStatus } from "./types";
import { INSTALL_STATUS } from "./types";

interface LibraryCardProps {
  library: ExcalidrawLibraryEntry;
  status: InstallStatus;
  onInstall: (library: ExcalidrawLibraryEntry) => void;
  onViewMore: (library: ExcalidrawLibraryEntry) => void;
}

export const LibraryCard = memo(function LibraryCard({
  library,
  status,
  onInstall,
  onViewMore,
}: LibraryCardProps) {
  const [imgError, setImgError] = useState(false);

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card text-xs overflow-hidden">
      {/* Thumbnail */}
      <div className="relative h-24 w-full shrink-0 bg-muted flex items-center justify-center overflow-hidden">
        {imgError || !library.preview ? (
          <BookOpen className="size-6 text-muted-foreground" />
        ) : (
          <img
            src={library.preview}
            alt={library.name}
            loading="lazy"
            className="size-full object-cover"
            onError={() => setImgError(true)}
          />
        )}
        <TooltipWrapper tooltip="Ver detalle" side="left" delayDuration={500}>
          <button
            onClick={() => onViewMore(library)}
            className="absolute top-1 right-1 size-5 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center hover:bg-background transition-colors"
          >
            <Info className="size-3" />
          </button>
        </TooltipWrapper>
      </div>

      {/* Info + action */}
      <div className="flex flex-col gap-2 p-2">
        <span className="truncate font-semibold text-foreground leading-tight" title={library.name}>
          {library.name}
        </span>
        <AddButton status={status} onInstall={() => onInstall(library)} />
      </div>
    </div>
  );
});

interface AddButtonProps {
  status: InstallStatus;
  onInstall: () => void;
}

export function AddButton({ status, onInstall }: AddButtonProps) {
  if (status === INSTALL_STATUS.INSTALLED) {
    return (
      <Button size="sm" variant="secondary" className="w-full gap-1" disabled>
        <Check className="size-3" />
        Added
      </Button>
    );
  }
  if (status === INSTALL_STATUS.LOADING) {
    return (
      <Button size="sm" className="w-full" disabled>
        <Loader2 className="size-3 animate-spin" />
      </Button>
    );
  }
  if (status === INSTALL_STATUS.ERROR) {
    return (
      <Button size="sm" variant="destructive" className="w-full" onClick={onInstall}>
        Retry
      </Button>
    );
  }
  return (
    <Button size="sm" className="w-full" onClick={onInstall}>
      Add
    </Button>
  );
}
