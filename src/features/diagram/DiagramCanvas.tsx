import { Excalidraw } from "@excalidraw/excalidraw";
import { useEffect, useRef, useCallback, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTabContext } from "@/core/tabs/hooks/use-tab-context";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { useDiagramStore } from "@/core/diagram/store/diagram-store";
import { DiagramController } from "@/core/diagram/DiagramController";
import { fileHandlerRegistry } from "@/core/shell/panels/file-handler-registry";
import { notify } from "@/shared/lib/notify";
import { useThemeStore } from "@/stores/themeStore";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

const AUTOSAVE_DEBOUNCE_MS = 1000;

const DiagramCanvas = () => {
  const { tabId } = useTabContext();
  const tab = useTabStore((s) => s.getTab(tabId));
  const updateTab = useTabStore((s) => s.updateTab);
  const instanceId = tab?.instanceId;
  const filePath = tab?.metadata?.filePath as string | undefined;

  const diagram = useDiagramStore((s) => (instanceId ? s.diagrams[instanceId] : undefined));
  const loadDiagram = useDiagramStore((s) => s.loadDiagram);
  const updateDiagram = useDiagramStore((s) => s.updateDiagram);
  const saveDiagram = useDiagramStore((s) => s.saveDiagram);

  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // OS drag-and-drop handler
  useEffect(() => {
    const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
    let unlisten: (() => void) | undefined;

    getCurrentWindow()
      .onDragDropEvent((event) => {
        const { type } = event.payload;

        if (type === "enter") {
          setIsDragging(true);
        } else if (type === "leave") {
          setIsDragging(false);
        } else if (type === "drop") {
          setIsDragging(false);
          const paths = event.payload.paths;

          const excalidrawPaths = paths.filter((p) => p.endsWith(".excalidraw"));
          const imagePaths = paths.filter((p) => {
            const ext = p.split(".").pop()?.toLowerCase() ?? "";
            return IMAGE_EXTENSIONS.has(ext);
          });
          const unsupportedPaths = paths.filter((p) => {
            if (p.endsWith(".excalidraw")) return false;
            const ext = p.split(".").pop()?.toLowerCase() ?? "";
            return !IMAGE_EXTENSIONS.has(ext);
          });

          for (const filePath of excalidrawPaths) {
            const name = filePath.split("/").pop() ?? filePath;
            const handler = fileHandlerRegistry.resolveOrDefault(name);
            const title = handler.displayName ? handler.displayName(name) : name;
            useTabStore.getState().addTab({
              routeId: handler.routeId,
              path: `/${handler.routeId}`,
              title,
              instanceId: filePath,
              metadata: { filePath },
            });
          }

          if (imagePaths.length > 0 && instanceId) {
            DiagramController.insertImages(instanceId, imagePaths).catch((err) => {
              console.error("DiagramController.insertImages failed:", err);
              notify("Failed to insert images", { type: "error" });
            });
          }

          if (unsupportedPaths.length > 0) {
            notify("Unsupported file", {
              type: "error",
              description: "Only .excalidraw and image files are supported",
            });
          }
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, [instanceId]);

  const handleExcalidrawAPI = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      if (instanceId && api) {
        DiagramController.register(instanceId, api);
      }
    },
    [instanceId]
  );

  // Unregister DiagramController on unmount
  useEffect(() => {
    return () => {
      if (instanceId) DiagramController.unregister(instanceId);
    };
  }, [instanceId]);

  // Load diagram on mount
  useEffect(() => {
    if (!instanceId || !filePath) return;
    loadDiagram(instanceId, filePath);
  }, [instanceId, filePath, loadDiagram]);

  // Update tab title when dirty state changes
  useEffect(() => {
    if (!diagram || !tab) return;
    const baseName = filePath
      ? (filePath.split("/").pop() ?? "diagram")
      : tab.title.replace(" •", "");
    const title = diagram.isDirty ? `${baseName} •` : baseName;
    if (tab.title !== title) {
      updateTab(tabId, { title });
    }
  }, [diagram?.isDirty, filePath, tab, tabId, updateTab]);

  const handleChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState) => {
      if (!instanceId) return;
      updateDiagram(instanceId, elements, appState);

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveDiagram(instanceId);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [instanceId, updateDiagram, saveDiagram]
  );

  const diagramName = filePath
    ? (filePath
        .split("/")
        .pop()
        ?.replace(/\.excalidraw$/, "") ?? "diagram")
    : "diagram";

  if (!instanceId || !diagram) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary pointer-events-none rounded-sm">
          <p className="text-primary font-medium text-sm">Drop files here</p>
        </div>
      )}
      <Excalidraw
        name={diagramName}
        excalidrawAPI={handleExcalidrawAPI}
        initialData={{
          elements: diagram.elements as ExcalidrawElement[],
          appState: { ...diagram.appState, name: diagramName },
        }}
        onChange={handleChange}
        theme={resolvedTheme}
        UIOptions={{
          welcomeScreen: false,
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
          },
        }}
      />
    </div>
  );
};

export default DiagramCanvas;
