import { create } from "zustand";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfirmOptions {
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
}

interface ConfirmState {
  open: boolean;
  options: ConfirmOptions;
  resolve: ((value: boolean) => void) | null;
  _show: (options: ConfirmOptions, resolve: (value: boolean) => void) => void;
  _settle: (value: boolean) => void;
}

// ---------------------------------------------------------------------------
// Store — holds the pending dialog state
// ---------------------------------------------------------------------------

const useConfirmStore = create<ConfirmState>()((set, get) => ({
  open: false,
  options: {},
  resolve: null,

  _show: (options, resolve) => set({ open: true, options, resolve }),

  _settle: (value) => {
    const { resolve } = get();
    resolve?.(value);
    set({ open: false, resolve: null });
  },
}));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function confirm(options: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState()._show(options, resolve);
  });
}

// ---------------------------------------------------------------------------
// ConfirmDialog — mount once in Shell
// ---------------------------------------------------------------------------

export function ConfirmDialog() {
  const { open, options, _settle } = useConfirmStore();

  const {
    title = "¿Estás seguro?",
    description,
    confirmLabel = "Confirmar",
    cancelLabel = "Cancelar",
    variant = "default",
  } = options;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && _settle(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => _settle(false)}>
            {cancelLabel}
          </Button>
          <Button variant={variant} onClick={() => _settle(true)}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
