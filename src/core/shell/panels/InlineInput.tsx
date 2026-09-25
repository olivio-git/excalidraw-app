import { useState, useEffect, useRef, useId } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle } from "lucide-react";
import { isValidEntryName } from "./explorer-file-operations";

interface InlineInputProps {
  defaultValue?: string;
  depth: number;
  onCommit: (name: string) => void | Promise<void>;
  onCancel: () => void;
  autoSelectBasename?: boolean;
}

export const InlineInput = ({
  defaultValue = "",
  depth,
  onCommit,
  onCancel,
  autoSelectBasename = true,
}: InlineInputProps) => {
  const { t } = useTranslation("explorer");
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  const errorId = useId();

  useEffect(() => {
    ref.current?.focus();
    const dot = defaultValue.lastIndexOf(".");
    if (autoSelectBasename && dot > 0) ref.current?.setSelectionRange(0, dot);
    else ref.current?.select();
  }, [defaultValue, autoSelectBasename]);

  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    onCancel();
  };

  const commit = async () => {
    if (settled.current) return;
    const name = value.trim();
    if (!name || name === defaultValue) {
      cancel();
      return;
    }
    if (!isValidEntryName(name)) {
      setError(t("input.invalidName"));
      ref.current?.focus();
      return;
    }
    settled.current = true;
    setPending(true);
    setError("");
    try {
      await onCommit(name);
    } catch (reason) {
      settled.current = false;
      setPending(false);
      setError(reason instanceof Error ? reason.message : String(reason));
      ref.current?.focus();
    }
  };

  return (
    <div
      className="min-w-0 flex-1 py-0.5 pr-2"
      style={{ paddingLeft: depth ? 8 + depth * 16 : 0 }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="relative">
        <input
          ref={ref}
          value={value}
          readOnly={pending}
          aria-label={t("input.name")}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setError("");
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              void commit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
          onBlur={() => {
            if (!error) void commit();
          }}
          className="h-6 w-full border border-ring bg-background px-1.5 text-xs outline-none aria-invalid:border-destructive"
        />
        {pending && (
          <LoaderCircle className="absolute right-1 top-1 size-4 animate-spin text-muted-foreground" />
        )}
      </div>
      {error && (
        <p
          id={errorId}
          role="alert"
          className="border border-destructive bg-background px-2 py-1 text-xs text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
};
