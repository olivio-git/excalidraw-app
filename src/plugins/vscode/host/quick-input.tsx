import { useEffect, useMemo, useRef, useState } from "react";
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
import { cn } from "@/shared/lib/utils";
import { showNotification } from "@/shared/components/notification";
import { LabelWithIcons } from "./codicons";

/**
 * UI for `window.showQuickPick`, `showInputBox` and `show*Message`, driven
 * by requests from the extension host. Each call resolves when the user
 * picks, types or dismisses (dismiss = `undefined`, as in VS Code).
 */

// ── Quick pick ────────────────────────────────────────────────────────────────

export interface QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
  picked?: boolean;
  alwaysShow?: boolean;
  separator?: boolean;
}

export interface QuickPickOptions {
  title?: string;
  placeHolder?: string;
  canPickMany?: boolean;
  matchOnDescription?: boolean;
  matchOnDetail?: boolean;
  value?: string;
}

let requestCounter = 0;

interface QuickPickRequest {
  id: number;
  items: QuickPickItem[];
  options: QuickPickOptions;
  resolve: (result: number | number[] | undefined) => void;
}

interface InputRequest {
  id: number;
  title?: string;
  prompt?: string;
  placeHolder?: string;
  value?: string;
  password?: boolean;
  validationMessage?: string;
  resolve: (value: string | undefined) => void;
}

interface MessageRequest {
  id: number;
  level: "info" | "warning" | "error";
  message: string;
  detail?: string;
  /** Who raised it, shown like VS Code's "Source:" line. */
  source?: string;
  items: string[];
  resolve: (index: number | undefined) => void;
}

interface QuickInputState {
  pick: QuickPickRequest | null;
  input: InputRequest | null;
  message: MessageRequest | null;
}

const useQuickInputStore = create<QuickInputState>()(() => ({
  pick: null,
  input: null,
  message: null,
}));

function settleAll(): void {
  const { pick, input, message } = useQuickInputStore.getState();
  pick?.resolve(undefined);
  input?.resolve(undefined);
  message?.resolve(undefined);
  useQuickInputStore.setState({ pick: null, input: null, message: null });
}

export function showQuickPick(items: QuickPickItem[], options: QuickPickOptions = {}) {
  useQuickInputStore.getState().pick?.resolve(undefined);
  return new Promise<number | number[] | undefined>((resolve) =>
    useQuickInputStore.setState({ pick: { id: ++requestCounter, items, options, resolve } })
  );
}

export function showInputBox(request: Omit<InputRequest, "resolve" | "id">) {
  useQuickInputStore.getState().input?.resolve(undefined);
  return new Promise<string | undefined>((resolve) =>
    useQuickInputStore.setState({ input: { ...request, id: ++requestCounter, resolve } })
  );
}

/** Modal message with buttons. */
export function showModalMessage(request: Omit<MessageRequest, "resolve" | "id">) {
  useQuickInputStore.getState().message?.resolve(undefined);
  return new Promise<number | undefined>((resolve) =>
    useQuickInputStore.setState({ message: { ...request, id: ++requestCounter, resolve } })
  );
}

/** Non-modal notification; resolves with the clicked button index. */
export function showMessageToast(
  request: Omit<MessageRequest, "resolve" | "id">
): Promise<number | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: number | undefined) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    showNotification({
      level: request.level,
      message: <LabelWithIcons text={request.message} />,
      detail: request.detail,
      source: request.source,
      actions: request.items.map((item, index) => ({
        label: item,
        primary: index === 0,
        onClick: () => settle(index),
      })),
      onClose: () => settle(undefined),
    });
  });
}

// ── Components ───────────────────────────────────────────────────────────────

function matches(item: QuickPickItem, query: string, options: QuickPickOptions): boolean {
  if (!query || item.alwaysShow) return true;
  const q = query.toLowerCase();
  if (item.label.toLowerCase().includes(q)) return true;
  if (options.matchOnDescription && item.description?.toLowerCase().includes(q)) return true;
  if (options.matchOnDetail && item.detail?.toLowerCase().includes(q)) return true;
  return false;
}

function QuickPickDialog({ request }: { request: QuickPickRequest }) {
  const { items, options } = request;
  const [query, setQuery] = useState(options.value ?? "");
  const [active, setActive] = useState(0);
  const [checked, setChecked] = useState<Set<number>>(
    () => new Set(items.flatMap((item, index) => (item.picked ? [index] : [])))
  );
  const listRef = useRef<HTMLUListElement>(null);

  const visible = useMemo(
    () =>
      items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => !item.separator && matches(item, query, options)),
    [items, query, options]
  );

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const finish = (result: number | number[] | undefined) => {
    request.resolve(result);
    useQuickInputStore.setState({ pick: null });
  };

  const accept = (visibleIndex = active) => {
    if (options.canPickMany) finish([...checked].sort((a, b) => a - b));
    else if (visible[visibleIndex]) finish(visible[visibleIndex].index);
  };

  const toggle = (index: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <Dialog open onOpenChange={(open) => !open && finish(undefined)}>
      <DialogContent
        className="top-[20%] translate-y-0 gap-0 p-0 sm:max-w-xl"
        aria-describedby={undefined}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{options.title ?? options.placeHolder ?? "Elegir"}</DialogTitle>
        </DialogHeader>
        {options.title && (
          <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
            {options.title}
          </div>
        )}
        <div className="p-2">
          <Input
            autoFocus
            value={query}
            placeholder={options.placeHolder}
            aria-label={options.placeHolder ?? "Filtrar"}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, visible.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                accept();
              } else if (e.key === " " && options.canPickMany && visible[active] && !query) {
                e.preventDefault();
                toggle(visible[active].index);
              }
            }}
          />
        </div>
        <ul
          ref={listRef}
          role="listbox"
          aria-multiselectable={options.canPickMany}
          className="max-h-80 overflow-y-auto pb-2"
        >
          {visible.length === 0 && (
            <li className="px-4 py-2 text-xs text-muted-foreground">Sin resultados</li>
          )}
          {visible.map(({ item, index }, visibleIndex) => (
            <li
              key={index}
              role="option"
              data-index={visibleIndex}
              aria-selected={visibleIndex === active}
              onMouseEnter={() => setActive(visibleIndex)}
              onClick={() => (options.canPickMany ? toggle(index) : accept(visibleIndex))}
              className={cn(
                "mx-2 flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm",
                visibleIndex === active && "bg-accent text-accent-foreground"
              )}
            >
              {options.canPickMany && (
                <input
                  type="checkbox"
                  readOnly
                  checked={checked.has(index)}
                  className="mt-1"
                  tabIndex={-1}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate">
                    <LabelWithIcons text={item.label} />
                  </span>
                  {item.description && (
                    <span className="truncate text-xs text-muted-foreground">
                      <LabelWithIcons text={item.description} />
                    </span>
                  )}
                </div>
                {item.detail && (
                  <div className="truncate text-xs text-muted-foreground">
                    <LabelWithIcons text={item.detail} />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        {options.canPickMany && (
          <DialogFooter className="border-t border-border p-2">
            <Button size="sm" onClick={() => accept()}>
              Aceptar ({checked.size})
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InputBoxDialog({ request }: { request: InputRequest }) {
  const [value, setValue] = useState(request.value ?? "");
  const finish = (result: string | undefined) => {
    request.resolve(result);
    useQuickInputStore.setState({ input: null });
  };
  return (
    <Dialog open onOpenChange={(open) => !open && finish(undefined)}>
      <DialogContent className="top-[20%] translate-y-0 sm:max-w-xl">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            finish(value);
          }}
          className="space-y-3"
        >
          <DialogHeader>
            <DialogTitle className="text-sm">
              {request.title ?? request.prompt ?? "Entrada"}
            </DialogTitle>
            {request.title && request.prompt && (
              <DialogDescription>{request.prompt}</DialogDescription>
            )}
          </DialogHeader>
          <Input
            autoFocus
            type={request.password ? "password" : "text"}
            value={value}
            placeholder={request.placeHolder}
            aria-label={request.prompt ?? request.title ?? "Entrada"}
            aria-invalid={!!request.validationMessage}
            onChange={(e) => setValue(e.target.value)}
          />
          {request.validationMessage && (
            <p role="alert" className="text-xs text-destructive">
              {request.validationMessage}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => finish(undefined)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm">
              Aceptar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MessageDialog({ request }: { request: MessageRequest }) {
  const finish = (index: number | undefined) => {
    request.resolve(index);
    useQuickInputStore.setState({ message: null });
  };
  return (
    <Dialog open onOpenChange={(open) => !open && finish(undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">
            <LabelWithIcons text={request.message} />
          </DialogTitle>
          {request.detail && (
            <DialogDescription className="whitespace-pre-wrap">{request.detail}</DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => finish(undefined)}>
            Cancelar
          </Button>
          {(request.items.length > 0 ? request.items : ["Aceptar"]).map((item, index) => (
            <Button
              key={index}
              size="sm"
              variant={index === 0 ? "default" : "secondary"}
              onClick={() => finish(request.items.length > 0 ? index : undefined)}
            >
              {item}
            </Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Mount once (Shell). */
export function QuickInputHost() {
  const pick = useQuickInputStore((s) => s.pick);
  const input = useQuickInputStore((s) => s.input);
  const message = useQuickInputStore((s) => s.message);
  return (
    <>
      {pick && <QuickPickDialog key={pick.id} request={pick} />}
      {input && <InputBoxDialog key={input.id} request={input} />}
      {message && <MessageDialog key={message.id} request={message} />}
    </>
  );
}

/** Cancel whatever is open (the host went away). */
export function cancelQuickInputs(): void {
  settleAll();
}
