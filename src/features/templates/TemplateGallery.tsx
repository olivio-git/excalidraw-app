import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Boxes, FileText, PenTool } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { SegmentedControl } from "@/shared/components/ui/segmented-control";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { notify } from "@/shared/lib/notify";
import { cn } from "@/shared/lib/utils";
import { TEMPLATES, type Template, type TemplateKind, type TemplateLang } from "./templates";
import { useTemplateGallery } from "./gallery-store";
import { createFromTemplate } from "./create";

const ICONS: Record<TemplateKind, typeof FileText> = {
  note: FileText,
  diagram: PenTool,
  flow: Boxes,
};
const COLORS: Record<TemplateKind, string> = {
  note: "text-sky-600 bg-sky-500/10",
  diagram: "text-violet-600 bg-violet-500/10",
  flow: "text-emerald-600 bg-emerald-500/10",
};

/** Dialog listing every template; mounted once in the shell. */
export function TemplateGallery() {
  const { t, i18n } = useTranslation("common");
  const language: TemplateLang = i18n.language?.startsWith("es") ? "es" : "en";
  const { open, kind: initialKind, folder, hide } = useTemplateGallery();
  const workspace = useWorkspaceStore((s) => s.workspaceDir);
  const [kind, setKind] = useState<TemplateKind | "all">("all");
  const [selected, setSelected] = useState<Template | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  // Each opening starts on the requested category, nothing selected.
  const [openedAt, setOpenedAt] = useState(0);
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      setKind(initialKind);
      setSelected(null);
      setName("");
      setOpenedAt(Date.now());
    });
    return () => cancelAnimationFrame(id);
  }, [open, initialKind]);

  const visible = TEMPLATES.filter((template) => kind === "all" || template.kind === kind);
  const create = async () => {
    const dir = folder ?? workspace;
    if (!selected || !dir) return;
    setBusy(true);
    try {
      const path = await createFromTemplate(
        selected,
        name || selected.title[language],
        dir,
        language
      );
      notify(t("templates.created", { name: path.split(/[\\/]/).pop() }), { type: "success" });
      hide();
    } catch (error) {
      notify(t("templates.failed"), { type: "error", description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && hide()}>
      <DialogContent className="sm:max-w-2xl" data-template-gallery={openedAt}>
        <DialogHeader>
          <DialogTitle>{t("templates.title")}</DialogTitle>
          <DialogDescription>{t("templates.description")}</DialogDescription>
        </DialogHeader>
        <SegmentedControl
          size="sm"
          ariaLabel={t("templates.title")}
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: t("templates.all") },
            { value: "note", label: t("templates.note") },
            { value: "diagram", label: t("templates.diagram") },
            { value: "flow", label: t("templates.flow") },
          ]}
        />
        <div
          className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2"
          role="listbox"
        >
          {visible.map((template) => {
            const Icon = ICONS[template.kind];
            const active = selected?.id === template.id;
            return (
              <button
                key={template.id}
                type="button"
                role="option"
                aria-selected={active}
                data-template={template.id}
                onClick={() => {
                  setSelected(template);
                  setName(template.title[language]);
                }}
                onDoubleClick={() => void create()}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg border border-border p-2.5 text-left transition-colors hover:bg-accent",
                  active && "border-primary bg-primary/5 ring-1 ring-primary"
                )}
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-md",
                    COLORS[template.kind]
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {template.title[language]}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {template.description[language]}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground/70">
                    .{template.extension}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <Input
            aria-label={t("templates.name")}
            placeholder={t("templates.name")}
            className="h-8 sm:max-w-72"
            value={name}
            disabled={!selected}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void create()}
          />
          <Button
            onClick={() => void create()}
            disabled={!selected || busy || !(folder ?? workspace)}
          >
            {workspace ? t("templates.create") : t("templates.noWorkspace")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
