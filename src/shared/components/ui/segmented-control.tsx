import type React from "react";
import { cn } from "@/shared/lib/utils";

export interface SegmentedOption<V extends string> {
  value: V;
  label: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}

interface SegmentedControlProps<V extends string> {
  value: V;
  onChange: (value: V) => void;
  options: SegmentedOption<V>[];
  ariaLabel?: string;
  size?: "sm" | "default";
  disabled?: boolean;
  fullWidth?: boolean;
  className?: string;
}

/**
 * Contiguous buttons with a single active option (from keel). A quieter
 * alternative to a row of filled buttons for 2–5 mutually exclusive choices.
 */
export function SegmentedControl<V extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = "default",
  disabled,
  fullWidth,
  className,
}: SegmentedControlProps<V>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-slot="segmented-control"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5",
        fullWidth && "flex w-full",
        className
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => {
              if (!disabled && !active) onChange(option.value);
            }}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md px-3 font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-3.5",
              size === "sm" ? "h-6 text-xs" : "h-7 text-sm",
              fullWidth && "flex-1",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {Icon && <Icon />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
