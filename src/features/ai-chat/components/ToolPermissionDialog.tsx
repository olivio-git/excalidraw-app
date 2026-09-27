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
import { useAIPermissionStore } from "../store/ai-permission-store";

// ---------------------------------------------------------------------------
// ToolPermissionDialog — mount-once component (same pattern as ConfirmDialog)
//
// Reads state from useAIPermissionStore. When open === true it renders the
// dialog with the pending PermissionRequest data. Users must choose one of
// three explicit actions — Escape / outside click settles as "deny".
//
// Mount in Shell alongside <ConfirmDialog /> and <PromptDialog />.
// ---------------------------------------------------------------------------

export function ToolPermissionDialog() {
  const { t } = useTranslation("common");
  const open = useAIPermissionStore((s) => s.open);
  const request = useAIPermissionStore((s) => s.request);
  const _settle = useAIPermissionStore((s) => s._settle);

  // Guard: no pending request — render closed dialog (null body prevents any flash)
  if (!request) {
    return <Dialog open={false} />;
  }

  const title = t(request.titleKey);
  const description = request.descriptionArgs
    ? t(request.descriptionKey, request.descriptionArgs)
    : t(request.descriptionKey);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // Escape key or outside click → treat as deny
        if (!v) _settle({ decision: "deny" });
      }}
    >
      <DialogContent className="sm:max-w-md" showClose={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {request.preview && (
          <pre className="rounded-md border border-border bg-muted p-3 text-xs whitespace-pre-wrap break-words max-h-40 overflow-auto">
            {request.preview}
          </pre>
        )}

        <p className="text-xs text-muted-foreground">{t("aiChat.permission.sessionScopeHint")}</p>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="destructive" onClick={() => _settle({ decision: "deny" })}>
            {t("aiChat.permission.deny")}
          </Button>
          <Button variant="outline" onClick={() => _settle({ decision: "allow-once" })}>
            {t("aiChat.permission.allowOnce")}
          </Button>
          <Button variant="default" onClick={() => _settle({ decision: "allow-always" })}>
            {t("aiChat.permission.allowAlways")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
