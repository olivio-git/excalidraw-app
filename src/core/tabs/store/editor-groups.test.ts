import { beforeEach, describe, expect, it } from "vitest";
import { useTabStore } from "./tab-store";
import { initialEditorLayout, reconcileLayout } from "./editor-layout";
import { useTabsSettingsStore } from "@/stores/tabsSettingsStore";

const open = (name: string) =>
  useTabStore.getState().addTab({
    routeId: "document-editor",
    path: "/document-editor",
    title: name,
    instanceId: `/ws/${name}.md`,
  });
beforeEach(() => {
  useTabStore.setState({ ...initialEditorLayout(), tabs: [], activeTabId: null });
  useTabsSettingsStore.setState({ allowCloseLastTab: true });
});

describe("editor groups", () => {
  it("closes an empty primary pane without resetting the secondary navigation", () => {
    const first = open("first");
    useTabStore.getState().openToSide(first);
    const second = open("second");
    useTabStore.getState().setActiveGroup("primary");
    useTabStore.getState().closeEmptyGroup("primary");
    expect(useTabStore.getState().activeTabId).toBe(second);
    expect(useTabStore.getState().navigation.primary.entries).toEqual([first, second]);
    expect(useTabStore.getState().splitDirection).toBeNull();
  });
  it("keeps the source visible when opening a new file to the side", () => {
    const first = open("first");
    const second = useTabStore.getState().addTab({
      routeId: "diagram",
      path: "/diagram",
      title: "diagram",
      instanceId: "/ws/diagram.excalidraw",
      groupId: "secondary",
    });
    expect(useTabStore.getState()).toMatchObject({
      activeTabId: second,
      activeGroupId: "secondary",
      splitDirection: "horizontal",
      groupActiveTabIds: { primary: first, secondary: second },
    });
  });

  it("moves an existing editor instead of duplicating its resource", () => {
    const first = open("first");
    const second = open("second");
    useTabStore.getState().openToSide(second);
    expect(useTabStore.getState().tabs).toHaveLength(2);
    expect(useTabStore.getState().groupActiveTabIds).toEqual({ primary: first, secondary: second });
    useTabStore.getState().setSplitDirection("vertical");
    expect(useTabStore.getState().getTab(second)?.instanceId).toBe("/ws/second.md");
  });

  it("opens new files in the focused empty group", () => {
    open("first");
    useTabStore.getState().setSplitDirection("horizontal");
    useTabStore.getState().setActiveGroup("secondary");
    expect(useTabStore.getState().activeTabId).toBeNull();
    const second = open("second");
    expect(useTabStore.getState().getTab(second)?.groupId).toBe("secondary");
  });

  it("does not create a split when opening an existing file in its current group", () => {
    const first = open("first");
    useTabStore.getState().moveTabToGroup(first, "primary");
    expect(useTabStore.getState().splitDirection).toBeNull();
  });

  it("merges groups without closing or changing the focused resource", () => {
    const first = open("first");
    const second = open("second");
    useTabStore.getState().openToSide(second);
    useTabStore.getState().setSplitDirection(null);
    expect(useTabStore.getState().tabs.map((tab) => tab.groupId)).toEqual(["primary", "primary"]);
    expect(useTabStore.getState().groupActiveTabIds).toEqual({ primary: second, secondary: null });
    expect(useTabStore.getState().getTab(first)).toBeDefined();
  });

  it("maintains separate history cursors and truncates the forward branch", () => {
    const first = open("first");
    const second = open("second");
    const third = open("third");
    useTabStore.getState().navigateHistory(-1);
    expect(useTabStore.getState().activeTabId).toBe(second);
    useTabStore.getState().setActiveTab(first);
    expect(useTabStore.getState().navigation.primary.entries).toEqual([first, second, first]);
    useTabStore.getState().openToSide(third);
    expect(useTabStore.getState().navigation.secondary.entries).toEqual([third]);
    useTabStore.getState().setActiveGroup("primary");
    useTabStore.getState().navigateHistory(-1);
    expect(useTabStore.getState().activeTabId).toBe(second);
    expect(useTabStore.getState().groupActiveTabIds.secondary).toBe(third);
  });

  it("prunes closed references and retains the other group's visible file", () => {
    const first = open("first");
    const second = open("second");
    useTabStore.getState().openToSide(second);
    useTabStore.getState().removeTab(second);
    expect(useTabStore.getState().groupActiveTabIds).toEqual({ primary: first, secondary: null });
    expect(useTabStore.getState().navigation.secondary.entries).toEqual([]);
    expect(useTabStore.getState().splitDirection).toBeNull();
    expect(useTabStore.getState().activeTabId).toBe(first);
  });

  it("promotes the secondary group and preserves its visible tab and history", () => {
    const first = open("first");
    const second = open("second");
    useTabStore.getState().openToSide(second);
    const third = open("third");
    useTabStore.getState().navigateHistory(-1);
    useTabStore.getState().setActiveTab(first);
    useTabStore.getState().removeTab(first);
    expect(useTabStore.getState()).toMatchObject({
      splitDirection: null,
      activeTabId: second,
      activeGroupId: "primary",
      groupActiveTabIds: { primary: second, secondary: null },
    });
    expect(useTabStore.getState().tabs.map((tab) => tab.groupId)).toEqual(["primary", "primary"]);
    expect(useTabStore.getState().navigation.primary).toEqual({
      entries: [second, third],
      index: 0,
    });
    useTabStore.getState().navigateHistory(1);
    expect(useTabStore.getState().activeTabId).toBe(third);
  });

  it("keeps the split when the closed pane still has another tab", () => {
    const first = open("first");
    const second = open("second");
    useTabStore.getState().openToSide(second);
    const third = open("third");
    useTabStore.getState().removeTab(third);
    expect(useTabStore.getState()).toMatchObject({
      splitDirection: "horizontal",
      groupActiveTabIds: { primary: first, secondary: second },
    });
  });

  it("preserves an intentionally empty split when closing an unrelated tab", () => {
    const first = open("first");
    const second = open("second");
    useTabStore.getState().setSplitDirection("horizontal");
    useTabStore.getState().removeTab(first);
    expect(useTabStore.getState()).toMatchObject({
      splitDirection: "horizontal",
      groupActiveTabIds: { primary: second, secondary: null },
    });
  });

  it("collapses empty groups after bulk tab closure", () => {
    const first = open("first");
    const second = open("second");
    useTabStore.getState().openToSide(second);
    useTabStore.getState().closeOtherTabs(second);
    expect(useTabStore.getState().splitDirection).toBeNull();
    expect(useTabStore.getState().activeTabId).toBe(second);
    expect(useTabStore.getState().getTab(first)).toBeUndefined();
    useTabStore.getState().closeAllTabs();
    expect(useTabStore.getState().groupActiveTabIds).toEqual({ primary: null, secondary: null });
  });

  it("serializes and restores groups, ratio and per-group active tabs", () => {
    const first = open("first");
    const second = open("second");
    useTabStore.getState().openToSide(second);
    useTabStore.getState().setSplitDirection("vertical");
    useTabStore.getState().setSplitRatio(64);
    const persisted = JSON.parse(
      JSON.stringify(useTabStore.persist.getOptions().partialize!(useTabStore.getState()))
    );
    const restored = useTabStore.persist.getOptions().merge!(persisted, {
      ...useTabStore.getState(),
      ...initialEditorLayout(),
      tabs: [],
      activeTabId: null,
    });
    expect(restored).toMatchObject({
      splitDirection: "vertical",
      splitRatio: 64,
      activeTabId: second,
      groupActiveTabIds: { primary: first, secondary: second },
    });
  });

  it("migrates existing single-pane sessions into the primary group", async () => {
    const first = open("first");
    const legacy = {
      tabs: useTabStore.getState().tabs.map(({ groupId: _group, ...tab }) => tab),
      activeTabId: first,
    };
    const migrated = await useTabStore.persist.getOptions().migrate!(legacy, 1);
    const state = reconcileLayout({
      ...useTabStore.getState(),
      ...(migrated as Partial<ReturnType<typeof useTabStore.getState>>),
    });
    expect(state).toMatchObject({
      splitDirection: null,
      activeGroupId: "primary",
      groupActiveTabIds: { primary: first, secondary: null },
    });
  });
});
