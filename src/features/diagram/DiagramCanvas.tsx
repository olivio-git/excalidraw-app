import { Excalidraw } from "@excalidraw/excalidraw";
import { useEffect, useRef, useCallback } from "react";
import { useTabContext } from "@/core/tabs/hooks/use-tab-context";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { useDiagramStore } from "@/core/diagram/store/diagram-store";
import { useThemeStore } from "@/stores/themeStore";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

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
    <div className="h-full w-full">
      <Excalidraw
        name={diagramName}
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
