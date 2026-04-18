import { useTabStore } from "@/core/tabs/store/tab-store";
import { DiagramController } from "@/core/diagram/DiagramController";

export type AIChatContext =
  | { kind: "diagram"; instanceId: string }
  | { kind: "document"; filePath: string }
  | { kind: "none" };

export function resolveAIChatContext(): AIChatContext {
  const state = useTabStore.getState();
  const activeTab = state.tabs.find((t) => t.id === state.activeTabId);

  if (!activeTab) return { kind: "none" };

  // Primary: routeId-based detection
  if (activeTab.routeId === "document-editor") {
    const filePath = (activeTab.instanceId ?? activeTab.metadata?.filePath ?? "") as string;
    if (filePath) return { kind: "document", filePath };
  }

  // Secondary: check DiagramController
  const instanceId = DiagramController.getActiveInstanceId();
  if (instanceId) return { kind: "diagram", instanceId };

  return { kind: "none" };
}
