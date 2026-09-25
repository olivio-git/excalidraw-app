import { exists } from "@tauri-apps/plugin-fs";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { describeTab, saveTabResource, tabIsDirty } from "@/core/tabs/tab-resources";
import { closeTabManaged } from "@/core/tabs/tab-lifecycle";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import {
  openFileInWorkbench,
  createFileReference,
  resolveFileReference,
} from "@/core/shell/services/file-navigation";
import {
  AutomationError,
  group,
  optionalBoolean,
  pathKey,
  text,
  workspacePath,
} from "./validation";
import type { EditorGroupId, SplitDirection } from "@/core/tabs/types";
import { useTabsSettingsStore } from "@/stores/tabsSettingsStore";

export interface TabTarget {
  tabId?: string;
  filePath?: string;
}
export interface OpenFileRequest {
  filePath: string;
  groupId?: EditorGroupId;
  beside?: boolean;
  anchor?: string;
}
export interface LayoutRequest {
  direction?: SplitDirection | null;
  ratio?: number;
}

export function resolveTab(target: TabTarget, allowActive = false) {
  const state = useTabStore.getState();
  if (target.tabId !== undefined) text(target.tabId, "tabId");
  if (target.filePath !== undefined) text(target.filePath, "filePath");
  const byId = target.tabId ? state.getTab(target.tabId) : undefined;
  const byPath = target.filePath
    ? state.tabs.find(
        (tab) => tab.instanceId && pathKey(tab.instanceId) === pathKey(target.filePath!)
      )
    : undefined;
  if (target.tabId && target.filePath && byId?.id !== byPath?.id)
    throw new AutomationError(
      "TARGET_MISMATCH",
      "tabId and filePath must identify the same resource."
    );
  const tab = target.tabId
    ? byId
    : target.filePath
      ? byPath
      : allowActive && state.activeTabId
        ? state.getTab(state.activeTabId)
        : undefined;
  if (!tab)
    throw new AutomationError("TAB_NOT_FOUND", "Open tab not found. Supply its tabId or filePath.");
  return tab;
}

export const workbenchActions = {
  getState() {
    const state = useTabStore.getState();
    return {
      apiVersion: 1,
      allowCloseLastTab: useTabsSettingsStore.getState().allowCloseLastTab,
      workspaceDir: useWorkspaceStore.getState().workspaceDir,
      activeTabId: state.activeTabId,
      activeGroupId: state.activeGroupId,
      direction: state.splitDirection,
      ratio: state.splitRatio,
      groups: (state.splitDirection
        ? (["primary", "secondary"] as const)
        : (["primary"] as const)
      ).map((id) => ({
        id,
        activeTabId: state.groupActiveTabIds[id],
        canGoBack: state.navigation[id].index > 0,
        canGoForward: state.navigation[id].index < state.navigation[id].entries.length - 1,
      })),
      tabs: state.tabs.map(describeTab),
    };
  },
  setLayout(input: LayoutRequest) {
    if (
      input.direction !== undefined &&
      input.direction !== null &&
      input.direction !== "horizontal" &&
      input.direction !== "vertical"
    )
      throw new AutomationError("INVALID_INPUT", "direction must be horizontal, vertical or null.");
    if (
      input.ratio !== undefined &&
      (!Number.isFinite(input.ratio) || input.ratio < 20 || input.ratio > 80)
    )
      throw new AutomationError("INVALID_INPUT", "ratio must be between 20 and 80.");
    if (input.direction !== undefined) useTabStore.getState().setSplitDirection(input.direction);
    if (input.ratio !== undefined) useTabStore.getState().setSplitRatio(input.ratio);
    return workbenchActions.getState();
  },
  focusGroup(groupId: EditorGroupId) {
    group(groupId);
    if (groupId === "secondary" && !useTabStore.getState().splitDirection)
      throw new AutomationError(
        "GROUP_NOT_FOUND",
        "Create a split before focusing the secondary group."
      );
    useTabStore.getState().setActiveGroup(groupId);
    return workbenchActions.getState();
  },
  async openFile(input: OpenFileRequest) {
    optionalBoolean(input.beside, "beside");
    if (input.groupId !== undefined) group(input.groupId);
    const filePath = await workspacePath(input.filePath);
    if (!(await exists(filePath)))
      throw new AutomationError("FILE_NOT_FOUND", `File not found: ${filePath}`);
    const tabId = openFileInWorkbench(filePath, input);
    if (!tabId)
      throw new AutomationError(
        "UNSUPPORTED_FILE",
        "No file handler is registered for this extension."
      );
    return describeTab(resolveTab({ tabId }));
  },
  moveTab(target: TabTarget, groupId: EditorGroupId) {
    group(groupId);
    const tab = resolveTab(target);
    useTabStore.getState().moveTabToGroup(tab.id, groupId);
    return describeTab(resolveTab({ tabId: tab.id }));
  },
  activateTab(target: TabTarget) {
    const tab = resolveTab(target);
    useTabStore.getState().setActiveTab(tab.id);
    return describeTab(resolveTab({ tabId: tab.id }));
  },
  setPinned(target: TabTarget, pinned: boolean) {
    if (typeof pinned !== "boolean")
      throw new AutomationError("INVALID_INPUT", "pinned must be boolean.");
    const tab = resolveTab(target);
    if (pinned) useTabStore.getState().pinTab(tab.id);
    else useTabStore.getState().unpinTab(tab.id);
    return describeTab(resolveTab({ tabId: tab.id }));
  },
  navigate(direction: "back" | "forward", groupId?: EditorGroupId) {
    if (direction !== "back" && direction !== "forward")
      throw new AutomationError("INVALID_INPUT", "direction must be back or forward.");
    if (groupId) workbenchActions.focusGroup(groupId);
    useTabStore.getState().navigateHistory(direction === "back" ? -1 : 1);
    return workbenchActions.getState();
  },
  async closeTab(target: TabTarget, force = false) {
    optionalBoolean(force, "force");
    return closeTabManaged(resolveTab(target).id, { discard: force });
  },
  async closeGroup(groupId: EditorGroupId, force = false) {
    optionalBoolean(force, "force");
    group(groupId);
    const ids = useTabStore
      .getState()
      .tabs.filter((tab) => (tab.groupId ?? "primary") === groupId)
      .map((tab) => tab.id);
    const results = [];
    for (const tabId of ids)
      results.push({ tabId, ...(await closeTabManaged(tabId, { discard: force })) });
    useTabStore.getState().closeEmptyGroup(groupId);
    return { results, state: workbenchActions.getState() };
  },
  async saveTab(target: TabTarget = {}) {
    const tab = resolveTab(target, true);
    const saved = await saveTabResource(tab);
    return { saved, ...describeTab(resolveTab({ tabId: tab.id })) };
  },
  async saveAll(tabIds?: string[]) {
    const ids =
      tabIds ??
      useTabStore
        .getState()
        .tabs.filter(tabIsDirty)
        .map((tab) => tab.id);
    let saved = 0;
    const errors: Record<string, string> = {};
    for (const id of [...new Set(ids)]) {
      try {
        if ((await workbenchActions.saveTab({ tabId: id })).saved) saved++;
        else errors[id] = "Unsupported resource or newer unsaved changes.";
      } catch (error) {
        errors[id] = String(error);
      }
    }
    return { saved, failed: Object.keys(errors).length, errors };
  },
  async createReference(filePath: string, anchor?: string) {
    const path = await workspacePath(filePath);
    return {
      filePath: path,
      href:
        createFileReference(path, useWorkspaceStore.getState().workspaceDir) +
        (anchor ? `#${encodeURIComponent(anchor)}` : ""),
    };
  },
  async openReference(
    href: string,
    sourcePath: string,
    options: Omit<OpenFileRequest, "filePath"> = {}
  ) {
    const source = await workspacePath(sourcePath, "sourcePath");
    const target = await resolveFileReference(
      text(href, "href"),
      source,
      useWorkspaceStore.getState().workspaceDir
    );
    return workbenchActions.openFile({
      ...options,
      filePath: target.filePath,
      anchor: target.anchor,
    });
  },
};
