import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";

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

  return (
    <div className="bg-muted border-b border-border shrink-0">
      <div className="max-w-[794px] w-full mx-auto flex justify-end py-2 px-1">
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
  );
}
