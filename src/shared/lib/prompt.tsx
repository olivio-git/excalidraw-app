import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import { Input } from "@/shared/components/ui/input";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptField {
  id: string;
  label: string;
  type?: "text" | "email" | "password" | "number" | "url";
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
}

export interface PromptOptions {
  title?: string;
  description?: string;
  fields: PromptField[];
  confirmLabel?: string;
  cancelLabel?: string;
}

export type PromptResult = Record<string, string> | null;

interface PromptState {
  open: boolean;
  options: PromptOptions | null;
  resolve: ((value: PromptResult) => void) | null;
  _show: (options: PromptOptions, resolve: (value: PromptResult) => void) => void;
  _settle: (value: PromptResult) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const usePromptStore = create<PromptState>()((set, get) => ({
  open: false,
  options: null,
  resolve: null,

  _show: (options, resolve) => set({ open: true, options, resolve }),

  _settle: (value) => {
    const { resolve } = get();
    resolve?.(value);
    set({ open: false, resolve: null, options: null });
  },
}));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function prompt(options: PromptOptions): Promise<PromptResult> {
  return new Promise((resolve) => {
    usePromptStore.getState()._show(options, resolve);
  });
}

// ---------------------------------------------------------------------------
// PromptDialog — mount once in Shell
// ---------------------------------------------------------------------------

export function PromptDialog() {
  const { open, options, _settle } = usePromptStore();
  const { t } = useTranslation("common");
  const [values, setValues] = useState<Record<string, string>>({});

  if (!options) return null;

  const {
    title = t("dialog.enterData"),
    description,
    fields,
    confirmLabel = t("dialog.confirm"),
    cancelLabel = t("dialog.cancel"),
  } = options;

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setValues({});
      _settle(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result: Record<string, string> = {};
    for (const field of fields) {
      result[field.id] = values[field.id] ?? field.defaultValue ?? "";
    }
    setValues({});
    _settle(result);
  };

  const handleCancel = () => {
    setValues({});
    _settle(null);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            {fields.map((field) => (
              <div key={field.id} className="flex flex-col gap-1.5">
                <label htmlFor={field.id} className="text-sm font-medium leading-none">
                  {field.label}
                  {field.required && <span className="text-destructive ml-1">*</span>}
                </label>
                <Input
                  id={field.id}
                  type={field.type ?? "text"}
                  placeholder={field.placeholder}
                  required={field.required}
                  defaultValue={field.defaultValue}
                  value={values[field.id] ?? field.defaultValue ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
                  autoFocus={fields.indexOf(field) === 0}
                />
              </div>
            ))}
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={handleCancel}>
              {cancelLabel}
            </Button>
            <Button type="submit">{confirmLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
