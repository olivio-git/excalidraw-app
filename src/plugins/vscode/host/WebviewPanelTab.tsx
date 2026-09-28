import { useTabContext } from "@/core/tabs/hooks/use-tab-context";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { WebviewFrame } from "./WebviewFrame";

/** Editor tab hosting a webview panel (`window.createWebviewPanel`). */
export default function WebviewPanelTab() {
  const { tabId, isActive } = useTabContext();
  const handle = useTabStore((s) => s.getTab(tabId)?.instanceId);
  if (!handle) return null;
  return (
    <div className="h-full w-full bg-background" data-webview-panel>
      <WebviewFrame handle={handle} visible={isActive} />
    </div>
  );
}
