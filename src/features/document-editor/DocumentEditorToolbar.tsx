import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { ChevronDown, FileText, ZoomIn, ZoomOut } from "lucide-react";
import { usePageSettingsStore, PAGE_SIZES } from "@/stores/pageSettingsStore";
import { PageSetupDialog } from "./PageSetupDialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DocumentEditorToolbarProps {
  onExportHtml: () => void;
  onExportMarkdown: () => void;
}

// ---------------------------------------------------------------------------
// DocumentEditorToolbar — export actions bar
//
// Transparent over bg-muted, constrained to A4 width, positioned above paper.
// Rich text formatting is handled by BlockNote's built-in bubble menu.
// ---------------------------------------------------------------------------

export function DocumentEditorToolbar({
  onExportHtml,
  onExportMarkdown,
}: DocumentEditorToolbarProps) {
  const { t } = useTranslation("common");
  const [pageSetupOpen, setPageSetupOpen] = useState(false);

  const zoom = usePageSettingsStore((s) => s.zoom);
  const setZoom = usePageSettingsStore((s) => s.setZoom);
  const pageSize = usePageSettingsStore((s) => s.pageSize);
  const orientation = usePageSettingsStore((s) => s.orientation);

  return (
    <>
      <div className="document-toolbar bg-muted border-b border-border shrink-0">
        <div className="max-w-[794px] w-full mx-auto flex items-center justify-between py-2 px-1">
          {/* Left: page size indicator + page setup */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              onClick={() => setPageSetupOpen(true)}
            >
              <FileText className="size-3" />
              {PAGE_SIZES[pageSize].label} {t(`documentEditor.${orientation}`)}
            </Button>
          </div>

          {/* Right: zoom + export */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setZoom(Math.max(0.25, zoom - 0.1))}
            >
              <ZoomOut className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs tabular-nums min-w-[3rem]"
              onClick={() => setPageSetupOpen(true)}
            >
              {Math.round(zoom * 100)}%
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setZoom(Math.min(2, zoom + 0.1))}
            >
              <ZoomIn className="size-3.5" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                  {t("documentEditor.export")}
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-none">
                <DropdownMenuItem onClick={onExportHtml}>
                  {t("documentEditor.exportHtml")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onExportMarkdown}>
                  {t("documentEditor.exportMarkdown")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <PageSetupDialog open={pageSetupOpen} onOpenChange={setPageSetupOpen} />
    </>
  );
}
