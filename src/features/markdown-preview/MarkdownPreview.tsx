import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTabContext } from "@/core/tabs/hooks/use-tab-context";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { liveBuffers } from "@/core/shell/services/live-buffers";
import { openFileReference, resolveFileReference } from "@/core/shell/services/file-navigation";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useThemeStore } from "@/stores/themeStore";
import { renderDiagramPreview } from "@/features/document-editor/diagram-preview";
import { notify } from "@/shared/lib/notify";
import "./markdown-preview.css";

/** The file's text: the open editor's buffer as you type, else the file on disk. */
function useLiveText(filePath: string): string | null {
  const [text, setText] = useState<string | null>(() => liveBuffers.get(filePath) ?? null);
  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    if (liveBuffers.get(filePath) === undefined)
      readTextFile(filePath).then(
        (content) => !cancelled && setText((current) => current ?? content),
        () => !cancelled && setText("")
      );
    const unsubscribe = liveBuffers.subscribe(filePath, setText);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [filePath]);
  return text;
}

/** An image from the workspace: Excalidraw diagrams rendered, other files served locally. */
function LocalImage({ src, alt, sourcePath }: { src: string; alt: string; sourcePath: string }) {
  const dark = useThemeStore((s) => s.resolvedTheme === "dark");
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      const { filePath } = await resolveFileReference(
        src,
        sourcePath,
        useWorkspaceStore.getState().workspaceDir
      );
      if (/\.excalidraw$/i.test(filePath)) {
        objectUrl = URL.createObjectURL(await renderDiagramPreview(filePath, dark));
        if (!cancelled) setUrl(objectUrl);
      } else if (!cancelled) setUrl(convertFileSrc(filePath));
    })().catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, sourcePath, dark]);
  if (failed) return <span className="qori-md-missing">No se encontró «{src}»</span>;
  return url ? <img src={url} alt={alt} /> : null;
}

const isExternal = (href: string) => /^[a-z][a-z\d+.-]*:/i.test(href);

export default function MarkdownPreview() {
  const { tabId } = useTabContext();
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === tabId));
  const sourcePath = (tab?.metadata?.filePath ?? "") as string;
  const text = useLiveText(sourcePath);

  return (
    <div className="h-full overflow-y-auto bg-background" data-markdown-preview>
      <article className="qori-md-preview">
        {text === null ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href = "", children }) => (
                <a
                  href={href}
                  onClick={(event) => {
                    event.preventDefault();
                    if (href.startsWith("#")) {
                      document
                        .getElementById(decodeURIComponent(href.slice(1)))
                        ?.scrollIntoView({ behavior: "smooth" });
                    } else if (isExternal(href) && !href.startsWith("file:")) {
                      void openUrl(href);
                    } else {
                      openFileReference(href, sourcePath).catch((error) =>
                        notify(String(error), { type: "error" })
                      );
                    }
                  }}
                >
                  {children}
                </a>
              ),
              img: ({ src = "", alt = "" }) =>
                typeof src === "string" && src && !isExternal(src) ? (
                  <LocalImage src={src} alt={alt} sourcePath={sourcePath} />
                ) : (
                  <img src={typeof src === "string" ? src : undefined} alt={alt} />
                ),
            }}
          >
            {text}
          </ReactMarkdown>
        )}
      </article>
    </div>
  );
}
