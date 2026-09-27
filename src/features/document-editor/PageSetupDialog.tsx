import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { usePageSettingsStore, PAGE_SIZES } from "@/stores/pageSettingsStore";
import type { PageSizeKeyRaw, Orientation } from "@/stores/pageSettingsStore";
import { cn } from "@/shared/lib/utils";
import { RotateCcw } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PageSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Preset margin values in px (approximate inches at 96 DPI)
const MARGIN_PRESETS = [
  { labelKey: "documentEditor.marginNarrow", value: 48 },
  { labelKey: "documentEditor.marginNormal", value: 96 },
  { labelKey: "documentEditor.marginWide", value: 144 },
] as const;

// ---------------------------------------------------------------------------
// PageSetupDialog — page configuration dialog
//
// Allows configuring page size, orientation, margins, and zoom.
// Changes are applied immediately to the store (and thus the editor view).
// "Reset to Defaults" restores A4 portrait with 1" margins and 100% zoom.
// ---------------------------------------------------------------------------

export function PageSetupDialog({ open, onOpenChange }: PageSetupDialogProps) {
  const { t } = useTranslation("common");

  const pageSize = usePageSettingsStore((s) => s.pageSize);
  const orientation = usePageSettingsStore((s) => s.orientation);
  const margin = usePageSettingsStore((s) => s.margin);
  const zoom = usePageSettingsStore((s) => s.zoom);

  const setPageSize = usePageSettingsStore((s) => s.setPageSize);
  const setOrientation = usePageSettingsStore((s) => s.setOrientation);
  const setMargin = usePageSettingsStore((s) => s.setMargin);
  const setZoom = usePageSettingsStore((s) => s.setZoom);
  const resetDefaults = usePageSettingsStore((s) => s.resetDefaults);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("documentEditor.pageSetupTitle")}</DialogTitle>
          <DialogDescription>
            {PAGE_SIZES[pageSize].label} {t(`documentEditor.${orientation}`)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Page Size */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("documentEditor.pageSize")}</label>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                Object.entries(PAGE_SIZES) as [
                  PageSizeKeyRaw,
                  (typeof PAGE_SIZES)[PageSizeKeyRaw],
                ][]
              ).map(([key, size]) => (
                <Button
                  key={key}
                  variant={pageSize === key ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setPageSize(key)}
                >
                  {size.label}
                </Button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Orientation */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("documentEditor.orientation")}</label>
            <div className="flex gap-1.5">
              <Button
                variant={orientation === "portrait" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs flex-1"
                onClick={() => setOrientation("portrait")}
              >
                {t("documentEditor.portrait")}
              </Button>
              <Button
                variant={orientation === "landscape" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs flex-1"
                onClick={() => setOrientation("landscape")}
              >
                {t("documentEditor.landscape")}
              </Button>
            </div>
          </div>

          <Separator />

          {/* Margins */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("documentEditor.margins")}</label>
            <div className="flex gap-1.5">
              {MARGIN_PRESETS.map((preset) => (
                <Button
                  key={preset.value}
                  variant={margin === preset.value ? "default" : "outline"}
                  size="sm"
                  className={cn("h-8 text-xs flex-1", margin === preset.value && "font-medium")}
                  onClick={() => setMargin(preset.value)}
                >
                  {t(preset.labelKey)}
                </Button>
              ))}
            </div>
            {/* Custom margin slider */}
            {margin !== 48 && margin !== 96 && margin !== 144 && (
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="range"
                  min={24}
                  max={192}
                  step={12}
                  value={margin}
                  onChange={(e) => setMargin(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
                  {margin}px
                </span>
              </div>
            )}
          </div>

          <Separator />

          {/* Zoom */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("documentEditor.zoom")}</label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setZoom(0.5)}
              >
                50%
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setZoom(0.75)}
              >
                75%
              </Button>
              <Button
                variant={zoom === 1 ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs"
                onClick={() => setZoom(1)}
              >
                100%
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setZoom(1.25)}
              >
                125%
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setZoom(1.5)}
              >
                150%
              </Button>
            </div>
            {/* Zoom slider for fine control */}
            <div className="flex items-center gap-2 pt-1">
              <input
                type="range"
                min={25}
                max={200}
                step={5}
                value={Math.round(zoom * 100)}
                onChange={(e) => setZoom(Number(e.target.value) / 100)}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
                {Math.round(zoom * 100)}%
              </span>
            </div>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs gap-1"
            onClick={() => {
              resetDefaults();
            }}
          >
            <RotateCcw className="size-3" />
            {t("documentEditor.resetDefaults")}
          </Button>
          <Button variant="default" size="sm" onClick={() => onOpenChange(false)}>
            {t("actions.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
