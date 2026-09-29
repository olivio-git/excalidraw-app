import { useTabStore } from "@/core/tabs/store/tab-store";
import { openFileInWorkbench } from "@/core/shell/services/file-navigation";
import type { TextPosition } from "./editor-contributions";

/** Tab metadata that asks the code editor to select a range and scroll to it. */
export interface RevealRequest {
  start: TextPosition;
  end?: TextPosition;
  /** Changes on every request so revealing the same range twice still works. */
  token: number;
}

let token = 0;

/** Open `filePath` (or focus its tab) and select `start`–`end` in the code editor. */
export function revealInEditor(filePath: string, start: TextPosition, end?: TextPosition): boolean {
  const tabId = openFileInWorkbench(filePath);
  if (!tabId) return false;
  const store = useTabStore.getState();
  const tab = store.getTab(tabId);
  store.updateTab(tabId, {
    metadata: { ...tab?.metadata, reveal: { start, end, token: ++token } },
  });
  store.setActiveTab(tabId);
  return true;
}
