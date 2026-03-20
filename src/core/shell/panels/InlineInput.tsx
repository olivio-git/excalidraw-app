import { useState, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// InlineInput — used for both create and rename flows in the file tree
// ---------------------------------------------------------------------------

interface InlineInputProps {
  defaultValue?: string;
  depth: number;
  onCommit: (name: string) => void;
  onCancel: () => void;
  /** When true, selects only the basename (before the last dot) on mount. */
  autoSelectBasename?: boolean;
}

export const InlineInput = ({
  defaultValue = "",
  depth,
  onCommit,
  onCancel,
  autoSelectBasename = true,
}: InlineInputProps) => {
  const [value, setValue] = useState(defaultValue);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    if (autoSelectBasename) {
      const dot = defaultValue.lastIndexOf(".");
      if (dot > 0) {
        ref.current?.setSelectionRange(0, dot);
      } else {
        ref.current?.select();
      }
    } else {
      ref.current?.select();
    }
  }, [defaultValue, autoSelectBasename]);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed) onCommit(trimmed);
    else onCancel();
  };

  return (
    <div className="py-0.5 pr-2" style={{ paddingLeft: 8 + depth * 12 }}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={commit}
        className="w-full h-6 px-1.5 text-xs bg-background border border-ring rounded outline-none"
      />
    </div>
  );
};
