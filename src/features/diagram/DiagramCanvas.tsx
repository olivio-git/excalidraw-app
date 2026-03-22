import { Excalidraw, useHandleLibrary } from "@excalidraw/excalidraw";
import { useEffect, useRef, useCallback, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTabContext } from "@/core/tabs/hooks/use-tab-context";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { useDiagramStore } from "@/core/diagram/store/diagram-store";
import { DiagramController } from "@/core/diagram/DiagramController";
import { fileHandlerRegistry } from "@/core/shell/panels/file-handler-registry";
import { notify } from "@/shared/lib/notify";
import { useThemeStore } from "@/stores/themeStore";
import { useLanguageStore } from "@/stores/languageStore";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

const AUTOSAVE_DEBOUNCE_MS = 1000;

const DiagramCanvas = () => {
  const { tabId, isActive } = useTabContext();
  const tab = useTabStore((s) => s.getTab(tabId));
  const updateTab = useTabStore((s) => s.updateTab);
  const instanceId = tab?.instanceId;
  const filePath = tab?.metadata?.filePath as string | undefined;

  const diagram = useDiagramStore((s) => (instanceId ? s.diagrams[instanceId] : undefined));
  const loadDiagram = useDiagramStore((s) => s.loadDiagram);
  const markDirty = useDiagramStore((s) => s.markDirty);
  const saveDiagram = useDiagramStore((s) => s.saveDiagram);

  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const language = useLanguageStore((s) => s.language);
  const excalidrawLang = language === "es" ? "es-ES" : "en";
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filesRef = useRef<BinaryFiles>({});
  const isActiveRef = useRef(isActive);
  // Excalidraw fires onChange once on mount with initialData — skip that init fire
  const skipInitChangeRef = useRef(true);
  const [isDragging, setIsDragging] = useState(false);
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);

  useHandleLibrary({ excalidrawAPI });
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Block Excalidraw's native HTML5 file drop handler via capture on the wrapper div.
  // Tauri fires onDragDropEvent through IPC (independent of DOM events), so
  // stopPropagation here only blocks Excalidraw — not our Tauri handler.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const block = (e: DragEvent) => {
      if (e.dataTransfer?.files.length || e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    el.addEventListener("dragover", block, true);
    el.addEventListener("drop", block, true);
    return () => {
      el.removeEventListener("dragover", block, true);
      el.removeEventListener("drop", block, true);
    };
  }, []);

  // OS drag-and-drop handler
  useEffect(() => {
    const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    getCurrentWindow()
      .onDragDropEvent((event) => {
        const { type } = event.payload;

        if (type === "enter") {
          setIsDragging(true);
        } else if (type === "leave") {
          setIsDragging(false);
        } else if (type === "drop") {
          setIsDragging(false);
          // Only the active tab handles the drop
          if (DiagramController.getActiveInstanceId() !== instanceId) return;
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
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [instanceId]);

  const handleExcalidrawAPI = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      if (instanceId && api) {
        DiagramController.register(instanceId, api);
        setExcalidrawAPI(api);
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

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  // Sync Excalidraw UI state when tab visibility changes
  useEffect(() => {
    if (!instanceId) return;
    const api = DiagramController.getApi(instanceId);
    if (!api) return;
    if (!isActive) {
      // Clear selection so Excalidraw's portal toolbar disappears when tab is hidden.
      // isActiveRef guard in handleChange suppresses the resulting onChange.
      api.updateScene({
        appState: { selectedElementIds: {}, selectedGroupIds: {} } as Partial<AppState>,
      });
    } else {
      // refresh() re-syncs Excalidraw UI (zoom indicator, etc.) after becoming visible
      // and fires onChange internally — suppress it the same way as the init onChange.
      skipInitChangeRef.current = true;
      api.refresh();
    }
  }, [isActive, instanceId]);

  // Load diagram on mount — reset init-skip so each new diagram load suppresses one onChange
  useEffect(() => {
    skipInitChangeRef.current = true;
    if (!instanceId || !filePath) return;
    loadDiagram(instanceId, filePath);
  }, [instanceId, filePath, loadDiagram]);

  // Sync dirty state into tab metadata (title stays clean — dot is rendered by the Tab component)
  useEffect(() => {
    if (!diagram || !tab) return;
    if (tab.metadata?.isDirty !== diagram.isDirty) {
      updateTab(tabId, { metadata: { ...tab.metadata, isDirty: diagram.isDirty } });
    }
  }, [diagram?.isDirty, tab, tabId, updateTab]);

  const handleChange = useCallback(
    (_elements: readonly ExcalidrawElement[], _appState: AppState, files: BinaryFiles) => {
      if (!instanceId) return;
      // Inactive tabs can receive onChange from internal scene updates (e.g. updateScene
      // clearing selections on tab switch). Ignore these — only active tabs can have
      // real user-driven changes.
      if (!isActiveRef.current) return;
      // Skip Excalidraw's initialization onChange fired on mount with initialData
      if (skipInitChangeRef.current) {
        skipInitChangeRef.current = false;
        return;
      }
      filesRef.current = files;
      // Mark dirty WITHOUT storing elements/appState — keeps initialData stable
      // and avoids feedback loops that freeze Excalidraw's zoom indicator.
      // Live state is read from the API at save time.
      markDirty(instanceId);

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const api = DiagramController.getApi(instanceId);
        if (!api) return;
        saveDiagram(instanceId, api.getSceneElements(), api.getAppState(), filesRef.current);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [instanceId, markDirty, saveDiagram]
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
    <div ref={wrapperRef} className="relative h-full w-full">
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
          files: diagram.files,
        }}
        onChange={handleChange}
        theme={resolvedTheme}
        langCode={excalidrawLang}
        libraryReturnUrl={window.location.origin}
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
