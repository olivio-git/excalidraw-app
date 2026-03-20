import { forwardRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";

interface PanelSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  resultCount?: number;
  className?: string;
}

const PanelSearch = forwardRef<HTMLInputElement, PanelSearchProps>(
  ({ value, onChange, placeholder = "Filtrar...", resultCount, className }, ref) => {
    const isFiltering = value.length > 0;

    return (
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1",
          className
        )}
      >
        <Search className="size-3 text-muted-foreground shrink-0" />
        <input
          ref={ref}
          data-panel-search
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
        />
        {isFiltering && (
          <>
            {resultCount !== undefined && (
              <span className="text-[10px] text-muted-foreground shrink-0">{resultCount}</span>
            )}
            <button
              onClick={() => onChange("")}
              className="size-3.5 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground shrink-0"
              title="Limpiar"
            >
              <X className="size-2.5" />
            </button>
          </>
        )}
      </div>
    );
  }
);

PanelSearch.displayName = "PanelSearch";

export { PanelSearch };
