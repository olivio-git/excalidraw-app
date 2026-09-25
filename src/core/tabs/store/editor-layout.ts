import {
  EDITOR_GROUP,
  type EditorGroupId,
  type EditorLayoutState,
  type TabInstance,
} from "../types";

export const tabGroup = (tab: TabInstance): EditorGroupId =>
  tab.groupId === EDITOR_GROUP.SECONDARY ? EDITOR_GROUP.SECONDARY : EDITOR_GROUP.PRIMARY;
export const otherGroup = (group: EditorGroupId): EditorGroupId =>
  group === EDITOR_GROUP.PRIMARY ? EDITOR_GROUP.SECONDARY : EDITOR_GROUP.PRIMARY;

export function initialEditorLayout(): EditorLayoutState {
  return {
    activeGroupId: EDITOR_GROUP.PRIMARY,
    groupActiveTabIds: { primary: null, secondary: null },
    navigation: { primary: { entries: [], index: -1 }, secondary: { entries: [], index: -1 } },
    splitDirection: null,
    splitRatio: 50,
  };
}

interface WorkspaceSnapshot extends EditorLayoutState {
  tabs: TabInstance[];
  activeTabId: string | null;
}

/** Close an emptied pane after tab removal, preserving the surviving pane's history. */
export function collapseEmptyGroups(state: WorkspaceSnapshot): WorkspaceSnapshot {
  if (!state.splitDirection) return state;
  const primary = state.tabs.filter((tab) => tabGroup(tab) === EDITOR_GROUP.PRIMARY);
  const secondary = state.tabs.filter((tab) => tabGroup(tab) === EDITOR_GROUP.SECONDARY);
  if (primary.length && secondary.length) return state;

  const survivingGroup = primary.length ? EDITOR_GROUP.PRIMARY : EDITOR_GROUP.SECONDARY;
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  const previous = state.tabs.find((tab) => tab.id === state.groupActiveTabIds[survivingGroup]);
  const activeTabId = active?.id ?? previous?.id ?? state.tabs[0]?.id ?? null;
  return {
    ...state,
    tabs: state.tabs.map((tab) => ({ ...tab, groupId: EDITOR_GROUP.PRIMARY })),
    splitDirection: null,
    activeGroupId: EDITOR_GROUP.PRIMARY,
    activeTabId,
    groupActiveTabIds: { primary: activeTabId, secondary: null },
    navigation: {
      primary: state.navigation[survivingGroup],
      secondary: { entries: [], index: -1 },
    },
  };
}

/** Reconcile closed/moved tabs and legacy sessions without leaving dangling view references. */
export function reconcileLayout(
  state: WorkspaceSnapshot,
  recordNavigation = true
): WorkspaceSnapshot {
  const tabs = state.tabs.map((tab) => ({
    ...tab,
    groupId: state.splitDirection ? tabGroup(tab) : EDITOR_GROUP.PRIMARY,
  }));
  const active = tabs.find((tab) => tab.id === state.activeTabId);
  const activeGroupId = active
    ? tabGroup(active)
    : state.splitDirection
      ? state.activeGroupId
      : EDITOR_GROUP.PRIMARY;
  const groupActiveTabIds = { ...state.groupActiveTabIds };
  const navigation = { ...state.navigation };
  for (const group of Object.values(EDITOR_GROUP)) {
    const members = tabs.filter((tab) => tabGroup(tab) === group);
    const candidate = active && tabGroup(active) === group ? active.id : groupActiveTabIds[group];
    groupActiveTabIds[group] = members.some((tab) => tab.id === candidate)
      ? candidate
      : (members[0]?.id ?? null);
    const previous = navigation[group];
    const currentEntry = previous.entries[previous.index];
    const entries = previous.entries.filter((id) => members.some((tab) => tab.id === id));
    let index = Math.min(previous.index, entries.length - 1);
    if (currentEntry && entries.includes(currentEntry)) {
      // Preserve the cursor even when an earlier history entry was closed.
      index =
        previous.entries
          .slice(0, previous.index + 1)
          .filter((id) => members.some((tab) => tab.id === id)).length - 1;
    }
    const nextId = groupActiveTabIds[group];
    if (recordNavigation && group === activeGroupId && nextId && entries[index] !== nextId) {
      entries.splice(index + 1);
      entries.push(nextId);
      if (entries.length > 100) entries.shift();
      index = entries.length - 1;
    }
    navigation[group] = { entries, index };
  }
  return {
    ...state,
    tabs,
    activeGroupId,
    groupActiveTabIds,
    navigation,
    activeTabId: groupActiveTabIds[activeGroupId],
    splitRatio: Number.isFinite(state.splitRatio)
      ? Math.max(20, Math.min(80, state.splitRatio))
      : 50,
  };
}
