import { useDocumentStore } from "@/stores/documentStore";
import { useDiagramStore } from "@/core/diagram/store/diagram-store";
import { useTabStore } from "./store/tab-store";
import { tabGroup } from "./store/editor-layout";
import type { TabInstance } from "./types";

export function tabIsDirty(tab: TabInstance): boolean {
  const path = tab.instanceId ?? tab.metadata?.filePath;
  if (typeof path === "string") {
    if (tab.routeId === "document-editor")
      return useDocumentStore.getState().documents[path]?.isDirty ?? Boolean(tab.metadata?.isDirty);
    if (tab.routeId === "diagram")
      return useDiagramStore.getState().getDiagram(path)?.isDirty ?? Boolean(tab.metadata?.isDirty);
  }
  return Boolean(tab.metadata?.isDirty);
}

export function describeTab(tab: TabInstance) {
  const state = useTabStore.getState();
  const groupId = tabGroup(tab);
  return {
    id: tab.id,
    tabId: tab.id,
    title: tab.title,
    routeId: tab.routeId,
    path: tab.path,
    filePath: tab.instanceId,
    instanceId: tab.instanceId,
    groupId,
    isActive: state.activeTabId === tab.id,
    isVisible: state.groupActiveTabIds[groupId] === tab.id,
    isDirty: tabIsDirty(tab),
    isPinned: tab.isPinned,
    isClosable: tab.isClosable,
  };
}

export async function saveTabResource(tab: TabInstance): Promise<boolean> {
  const path = tab.instanceId;
  if (!path) return false;
  if (tab.routeId === "document-editor") {
    const { getDocumentController } =
      await import("@/features/document-editor/documentController.singleton");
    const controller = getDocumentController();
    if (!useDocumentStore.getState().documents[path]) {
      if (tab.metadata?.isDirty)
        throw new Error(
          "Unsaved document buffer is unavailable; refusing to replace it with disk content."
        );
      await controller.openDocument(path, false);
    }
    await controller.saveDocument(path);
    await controller.waitForSaves(path);
    return !useDocumentStore.getState().documents[path]?.isDirty;
  }
  if (tab.routeId === "diagram") {
    const { DiagramController } = await import("@/core/diagram/DiagramController");
    const api = DiagramController.getApi(path);
    if (!api) throw new Error("Diagram canvas is not ready. Open the file and retry.");
    const store = useDiagramStore.getState();
    if (!store.getDiagram(path)) await store.loadDiagram(path, path);
    await store.saveDiagram(path, api.getSceneElements(), api.getAppState(), api.getFiles());
    await store.waitForSaves(path);
    return !useDiagramStore.getState().getDiagram(path)?.isDirty;
  }
  return false;
}

export async function waitForResourceSaves(tab: TabInstance, ignoreErrors = false): Promise<void> {
  if (!tab.instanceId) return;
  if (tab.routeId === "document-editor") {
    const { getDocumentController } =
      await import("@/features/document-editor/documentController.singleton");
    await getDocumentController().waitForSaves(tab.instanceId, ignoreErrors);
  } else if (tab.routeId === "diagram")
    await useDiagramStore.getState().waitForSaves(tab.instanceId, ignoreErrors);
}

export function discardResourceBuffer(tab: TabInstance): void {
  if (!tab.instanceId) return;
  if (tab.routeId === "document-editor") useDocumentStore.getState().closeDocument(tab.instanceId);
  else if (tab.routeId === "diagram") useDiagramStore.getState().closeDiagram(tab.instanceId);
}
