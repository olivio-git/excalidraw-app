import { useTabStore } from "./store/tab-store";
import { confirm } from "@/shared/lib/confirm";
import { notify } from "@/shared/lib/notify";
import i18n from "@/core/i18n/i18n";
import { isSameOrDescendant } from "@/core/shell/panels/explorer-file-operations";
import { useTabsSettingsStore } from "@/stores/tabsSettingsStore";
import { exists } from "@tauri-apps/plugin-fs";
import {
  tabIsDirty,
  saveTabResource,
  waitForResourceSaves,
  discardResourceBuffer,
} from "./tab-resources";

type CloseHandler = () => Promise<boolean>;
const handlers = new Map<string, CloseHandler>();
type DiscardHandler = () => Promise<(() => void) | void>;
const discardHandlers = new Map<string, DiscardHandler>();
const pending = new Set<string>();

export async function prepareResourceMove(path: string): Promise<void> {
  for (const tab of useTabStore.getState().tabs) {
    const filePath = tab.metadata?.filePath ?? tab.instanceId;
    if (typeof filePath !== "string" || !isSameOrDescendant(filePath, path)) continue;
    if (pending.has(tab.id)) throw new Error(i18n.t("common:connected.pendingChanges"));
    const handler = handlers.get(tab.id);
    if (handler ? !(await handler()) : tab.metadata?.isDirty)
      throw new Error(i18n.t("common:connected.pendingChanges"));
  }
}

export function registerTabCloseHandler(
  tabId: string,
  handler: CloseHandler,
  discard?: DiscardHandler
): () => void {
  handlers.set(tabId, handler);
  if (discard) discardHandlers.set(tabId, discard);
  return () => {
    if (handlers.get(tabId) === handler) handlers.delete(tabId);
    if (discardHandlers.get(tabId) === discard) discardHandlers.delete(tabId);
  };
}

export interface CloseTabResult {
  closed: boolean;
  wasDirty: boolean;
  reason?: string;
  error?: string;
}

async function resourceWasDeletedExternally(
  tab: ReturnType<typeof useTabStore.getState>["tabs"][number]
): Promise<boolean> {
  if (!tab.instanceId || !["document-editor", "diagram"].includes(tab.routeId)) return false;
  try {
    // Never let a filesystem probe block the close lifecycle (for example while
    // the Tauri FS plugin is reconnecting). A short timeout falls back to the
    // normal save path.
    const probe = exists(tab.instanceId);
    const available = await Promise.race([
      probe,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 150)),
    ]);
    return !available;
  } catch {
    // If the path cannot be inspected, retain the normal save/error behavior.
    return false;
  }
}

function closeBlocker(tabId: string): string | null {
  const state = useTabStore.getState();
  const tab = state.getTab(tabId);
  if (!tab) return "not_found";
  if (tab.isPinned) return "pinned";
  if (!tab.isClosable) return "not_closable";
  if (state.tabs.length === 1 && !useTabsSettingsStore.getState().allowCloseLastTab)
    return "last_tab";
  return null;
}

/** Legacy synchronous SDK close is clean-only; mutations requiring I/O use closeTabManaged. */
export function closeCleanTab(tabId: string): boolean {
  const tab = useTabStore.getState().getTab(tabId);
  if (!tab || closeBlocker(tabId) || pending.has(tabId) || tabIsDirty(tab)) return false;
  useTabStore.getState().removeTab(tabId);
  return !useTabStore.getState().getTab(tabId);
}

export async function closeTabManaged(
  tabId: string,
  options: { discard?: boolean } = {}
): Promise<CloseTabResult> {
  const tab = useTabStore.getState().getTab(tabId);
  const wasDirty = tab ? tabIsDirty(tab) : false;
  const reason = closeBlocker(tabId);
  if (reason || pending.has(tabId)) return { closed: false, wasDirty, reason: reason ?? "busy" };
  pending.add(tabId);
  let resume: (() => void) | void = undefined;
  try {
    // The user may delete an open file from the system file manager. In that
    // case saving on close can only fail with ENOENT; the on-disk resource is
    // already gone, so release the in-memory buffer and close the tab cleanly.
    if (tab && (await resourceWasDeletedExternally(tab))) {
      useTabStore.getState().removeTab(tabId);
      discardResourceBuffer(tab);
      return { closed: true, wasDirty, reason: "resource_deleted" };
    }

    if (options.discard) {
      resume = await discardHandlers.get(tabId)?.();
      await waitForResourceSaves(tab!, true);
    } else {
      const handler = handlers.get(tabId);
      const saved = handler ? await handler() : !wasDirty || (await saveTabResource(tab!));
      if (!saved) return { closed: false, wasDirty, reason: "unsaved_changes" };
    }
    const blocked = closeBlocker(tabId);
    if (blocked) return { closed: false, wasDirty, reason: blocked };
    useTabStore.getState().removeTab(tabId);
    const closed = !useTabStore.getState().getTab(tabId);
    if (closed && options.discard) discardResourceBuffer(tab!);
    return { closed, wasDirty, ...(closed ? {} : { reason: "blocked" }) };
  } catch (error) {
    return { closed: false, wasDirty, reason: "save_failed", error: String(error) };
  } finally {
    pending.delete(tabId);
    if (useTabStore.getState().getTab(tabId)) resume?.();
  }
}

/** UI close paths flush the live editor before releasing its component. */
export async function requestCloseTab(tabId: string): Promise<void> {
  const result = await closeTabManaged(tabId);
  if (result.error)
    notify(i18n.t("tabs:workbench.saveFailed", { message: result.error }), { type: "error" });
  if (result.reason === "unsaved_changes" && !handlers.has(tabId)) {
    const tab = useTabStore.getState().getTab(tabId);
    if (
      tab &&
      (await confirm({
        title: i18n.t("tabs:workbench.unsavedTitle"),
        description: i18n.t("tabs:workbench.unsavedDescription", { name: tab.title }),
        confirmLabel: i18n.t("tabs:workbench.discard"),
        variant: "destructive",
      }))
    )
      await closeTabManaged(tabId, { discard: true });
  }
}

export async function requestCloseTabs(ids: string[]): Promise<void> {
  for (const id of ids) await requestCloseTab(id);
}
