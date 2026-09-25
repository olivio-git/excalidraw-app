import { useTranslation } from "react-i18next";
import { Link, X } from "lucide-react";
import { documentOutline, type DocumentBlock } from "./note-format";

interface DocumentOutlineProps {
  blocks: DocumentBlock[];
  onJump: (id: string) => void;
  onCopy: (id: string, title: string) => void;
  onClose: () => void;
}

export function DocumentOutline({ blocks, onJump, onCopy, onClose }: DocumentOutlineProps) {
  const { t } = useTranslation("common");
  const headings = documentOutline(blocks);
  return (
    <aside
      aria-label={t("connected.outline")}
      className="max-h-52 shrink-0 overflow-auto border-t border-border bg-background px-3 py-2"
    >
      <div className="mb-2 flex items-center justify-between text-xs font-medium">
        <span>{t("connected.outline")}</span>
        <button onClick={onClose} aria-label={t("actions.close")}>
          <X className="size-3.5" />
        </button>
      </div>
      {!headings.length && (
        <p className="py-2 text-xs text-muted-foreground">{t("connected.noHeadings")}</p>
      )}
      {headings.map((heading) => (
        <div
          key={heading.id}
          className="group flex items-center gap-1 rounded hover:bg-accent"
          style={{ paddingLeft: (heading.level - 1) * 12 }}
        >
          <button
            className="min-w-0 flex-1 truncate px-2 py-1 text-left text-xs"
            onClick={() => onJump(heading.id)}
          >
            {heading.title || t("connected.untitledHeading")}
          </button>
          <button
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            title={t("connected.copySectionLink")}
            aria-label={`${t("connected.copySectionLink")}: ${heading.title}`}
            onClick={() => onCopy(heading.id, heading.title)}
          >
            <Link className="size-3" />
          </button>
        </div>
      ))}
    </aside>
  );
}
