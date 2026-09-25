import { useContext, useEffect, useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { useTranslation } from "react-i18next";
import { watch, type UnwatchFn } from "@tauri-apps/plugin-fs";
import { ExternalLink, RefreshCw, LoaderCircle } from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { openFileReference, resolveFileReference } from "@/core/shell/services/file-navigation";
import { notify } from "@/shared/lib/notify";
import { DocumentHostContext } from "../DocumentHostContext";
import { renderDiagramPreview } from "../diagram-preview";

export const DiagramEmbedBlock = createReactBlockSpec(
  {
    type: "diagramEmbed" as const,
    propSchema: { diagramPath: { default: "" }, caption: { default: "" } },
    content: "none" as const,
  },
  {
    render: ({ block, editor }) => (
      <figure
        className="my-2 w-full overflow-hidden rounded-lg border border-border"
        contentEditable={false}
      >
        <DiagramEmbedRenderer diagramPath={block.props.diagramPath} />
        <CaptionInput
          value={block.props.caption}
          onChange={(caption) => editor.updateBlock(block, { props: { caption } })}
        />
      </figure>
    ),
    // A portable text representation for Markdown tools; native notes retain the real block.
    toExternalHTML: ({ block }) => (
      <figure data-diagram-reference={block.props.diagramPath}>
        <a href={block.props.diagramPath}>{block.props.caption || "Diagram"}</a>
      </figure>
    ),
    parse: (element) =>
      element.hasAttribute("data-diagram-reference")
        ? {
            diagramPath: element.getAttribute("data-diagram-reference") ?? "",
            caption: element.textContent ?? "",
          }
        : undefined,
  }
);

function CaptionInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation("common");
  return (
    <input
      className="w-full border-t border-border bg-transparent px-3 py-2 text-center text-xs text-muted-foreground outline-none focus:bg-accent/40"
      aria-label={t("connected.caption")}
      placeholder={t("connected.caption")}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function DiagramEmbedRenderer({ diagramPath }: { diagramPath: string }) {
  const { t } = useTranslation("common");
  const host = useContext(DocumentHostContext);
  const workspace = useWorkspaceStore((state) => state.workspaceDir);
  const theme = useThemeStore((state) => state.resolvedTheme);
  const [preview, setPreview] = useState<{ url?: string; error?: string }>({});
  const [revision, setRevision] = useState(0);
  const [automatic, setAutomatic] = useState(true);
  const sourcePath = host?.filePath ?? "";
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    let objectUrl: string | undefined;
    let stop: UnwatchFn | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = async (path: string) => {
      const version = ++generation;
      try {
        const blob = await renderDiagramPreview(path, theme === "dark");
        if (disposed || version !== generation) return;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(blob);
        setPreview({ url: objectUrl });
      } catch (error) {
        if (!disposed && version === generation) setPreview({ error: String(error) });
      }
    };
    void (async () => {
      try {
        const { filePath } = await resolveFileReference(diagramPath, sourcePath, workspace);
        if (disposed) return;
        setPreview({});
        if (!/\.excalidraw$/i.test(filePath)) throw new Error(t("connected.invalidDiagram"));
        stop = await watch(
          filePath,
          (event) => {
            if (disposed) return;
            if (typeof event.type === "object" && "access" in event.type) return;
            clearTimeout(timer);
            timer = setTimeout(() => void update(filePath), 300);
          },
          { recursive: false }
        ).catch(() => undefined);
        if (disposed) {
          stop?.();
          return;
        }
        setAutomatic(Boolean(stop));
        await update(filePath);
      } catch (error) {
        if (!disposed) setPreview({ error: String(error) });
      }
    })();
    return () => {
      disposed = true;
      generation++;
      clearTimeout(timer);
      stop?.();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [diagramPath, sourcePath, workspace, theme, revision, t]);

  return (
    <div>
      <div className="flex items-center gap-2 bg-muted/40 px-3 py-2 text-xs">
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {t(automatic ? "connected.linkedDiagram" : "connected.linkedDiagramManual")}
        </span>
        <button
          aria-label={t("connected.refresh")}
          title={t("connected.refresh")}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw className="size-3.5" />
        </button>
        <button
          aria-label={t("connected.openBeside")}
          title={t("connected.openBeside")}
          onClick={() => {
            void openFileReference(diagramPath, sourcePath, {
              beside: true,
              groupId: host?.groupId,
            }).catch((error: unknown) => notify(String(error), { type: "error" }));
          }}
        >
          <ExternalLink className="size-3.5" />
        </button>
      </div>
      {preview.error ? (
        <p role="alert" className="break-words p-4 text-xs text-destructive">
          {preview.error}
        </p>
      ) : preview.url ? (
        <img
          src={preview.url}
          alt={t("connected.linkedDiagram")}
          className="max-h-96 w-full object-contain"
        />
      ) : (
        <div
          role="status"
          className="flex items-center justify-center gap-2 p-8 text-xs text-muted-foreground"
        >
          <LoaderCircle className="size-4 animate-spin" />
          {t("connected.loadingPreview")}
        </div>
      )}
    </div>
  );
}
