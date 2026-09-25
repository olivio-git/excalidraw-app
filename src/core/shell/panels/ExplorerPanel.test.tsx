import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readDir, rename, exists, writeTextFile, type DirEntry } from "@tauri-apps/plugin-fs";
import { ExplorerPanel } from "./ExplorerPanel";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import {
  useExplorerSelectionStore,
  useExplorerStore,
  useExplorerUiStore,
} from "@/stores/explorerStore";
import { useTabStore } from "@/core/tabs/store/tab-store";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("@/core/i18n/i18n", () => ({ default: { t: (key: string) => key } }));
function translate(key: string) {
  return key;
}
vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: vi.fn(),
  rename: vi.fn(),
  mkdir: vi.fn(),
  remove: vi.fn(),
  exists: vi.fn(),
  lstat: vi.fn(),
  stat: vi.fn(),
  writeTextFile: vi.fn(),
  readTextFile: vi.fn(),
  create: vi.fn(),
  copyFile: vi.fn(),
}));
vi.mock("@tauri-apps/api/path", () => ({
  join: (...parts: string[]) => Promise.resolve(parts.join("/")),
  dirname: (path: string) => Promise.resolve(path.slice(0, path.lastIndexOf("/"))),
  basename: (path: string) => Promise.resolve(path.split("/").pop()),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@/core/shell/useFileWatcher", () => ({ useFileWatcher: vi.fn() }));
vi.mock("@/shared/hooks/useHomeDir", () => ({ useHomeDir: () => "/home" }));
vi.mock("@/plugins/plugin-manager", () => ({
  PluginManager: { registerCommandHandler: vi.fn(), unregisterCommandHandler: vi.fn() },
}));
vi.mock("@/shared/lib/notify", () => ({ notify: vi.fn() }));
vi.mock("@/shared/lib/confirm", () => ({ confirm: vi.fn().mockResolvedValue(true) }));

const file = (name: string): DirEntry => ({
  name,
  isDirectory: false,
  isFile: true,
  isSymlink: false,
});
const folder = (name: string): DirEntry => ({
  name,
  isDirectory: true,
  isFile: false,
  isSymlink: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  useExplorerUiStore.setState({ quickOpenOpen: false });
  vi.mocked(exists).mockResolvedValue(false);
  vi.mocked(readDir).mockImplementation(async (path) =>
    path === "/ws" ? [folder("designs"), file("notes.txt"), file("drawing.excalidraw")] : []
  );
  useWorkspaceStore.setState({ workspaceDir: "/ws" });
  useExplorerStore.setState({ sortOrder: "type-first", showDotfiles: false });
  useTabStore.setState({ tabs: [], activeTabId: null });
});

describe("ExplorerPanel workflows", () => {
  it("opens quick open through its portal even when the explorer panel is hidden", async () => {
    render(
      <div style={{ display: "none" }}>
        <ExplorerPanel />
      </div>
    );
    await waitFor(() => expect(readDir).toHaveBeenCalledWith("/ws"));
    act(() => useExplorerUiStore.getState().setQuickOpenOpen(true));
    expect(await screen.findByRole("dialog")).toBeVisible();
    fireEvent.keyDown(screen.getByPlaceholderText("quickOpen.placeholder"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(useExplorerUiStore.getState().quickOpenOpen).toBe(false);
  });

  it("allows selecting and renaming a file without an internal viewer", async () => {
    render(<ExplorerPanel />);
    const entry = await screen.findByRole("treeitem", { name: "notes.txt" });
    fireEvent.click(within(entry).getByText("notes.txt"));
    expect(entry).toHaveAttribute("aria-selected", "true");
    expect(useExplorerSelectionStore.getState().selectedPaths).toEqual(["/ws/notes.txt"]);
    fireEvent.keyDown(screen.getByRole("tree"), { key: "F2" });
    const input = screen.getByRole("textbox", { name: "input.name" });
    fireEvent.change(input, { target: { value: "renamed.txt" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(rename).toHaveBeenCalledWith("/ws/notes.txt", "/ws/renamed.txt"));
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "input.name" })).not.toBeInTheDocument()
    );
  });

  it("renames a folder without appending a file extension", async () => {
    render(<ExplorerPanel />);
    const entry = await screen.findByRole("treeitem", { name: "designs" });
    fireEvent.click(within(entry).getByText("designs"));
    fireEvent.keyDown(screen.getByRole("tree"), { key: "F2" });
    const input = screen.getByRole("textbox", { name: "input.name" });
    fireEvent.change(input, { target: { value: "archive" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(rename).toHaveBeenCalledWith("/ws/designs", "/ws/archive"));
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "input.name" })).not.toBeInTheDocument()
    );
  });

  it("keeps conflicting names editable without overwriting existing entries", async () => {
    vi.mocked(exists).mockResolvedValue(true);
    render(<ExplorerPanel />);
    const entry = await screen.findByRole("treeitem", { name: "notes.txt" });
    fireEvent.click(within(entry).getByText("notes.txt"));
    fireEvent.keyDown(screen.getByRole("tree"), { key: "F2" });
    const input = screen.getByRole("textbox", { name: "input.name" });
    fireEvent.change(input, { target: { value: "taken.txt" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("input.exists");
    expect(rename).not.toHaveBeenCalled();
    expect(input).toHaveValue("taken.txt");
  });

  it("creates an ordinary file with an explicit extension", async () => {
    render(<ExplorerPanel />);
    await screen.findByRole("treeitem", { name: "notes.txt" });
    fireEvent.click(screen.getByRole("button", { name: "toolbar.newFile" }));
    const input = screen.getByRole("textbox", { name: "input.name" });
    fireEvent.change(input, { target: { value: "README.txt" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(writeTextFile).toHaveBeenCalledWith("/ws/README.txt", "", { createNew: true })
    );
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "input.name" })).not.toBeInTheDocument()
    );
  });

  it("does not collapse folders when adding them to a multi-selection", async () => {
    render(<ExplorerPanel />);
    const entry = await screen.findByRole("treeitem", { name: "designs" });
    fireEvent.click(within(entry).getByText("designs"));
    expect(entry).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(within(entry).getByText("designs"), { ctrlKey: true });
    expect(entry).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps the search input's Delete and clipboard shortcuts native", async () => {
    render(<ExplorerPanel />);
    await screen.findByRole("treeitem", { name: "notes.txt" });
    const search = screen.getByPlaceholderText("toolbar.filterPlaceholder");
    act(() => search.focus());
    expect(fireEvent.keyDown(search, { key: "Delete" })).toBe(true);
    expect(fireEvent.keyDown(search, { key: "a", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(search, { key: "v", ctrlKey: true })).toBe(true);
  });

  it("keeps readable siblings when one directory cannot be read", async () => {
    vi.mocked(readDir).mockImplementation(async (path) => {
      if (path === "/ws") return [folder("locked"), file("notes.txt")];
      throw new Error("permission denied");
    });
    render(<ExplorerPanel />);
    expect(await screen.findByRole("treeitem", { name: "notes.txt" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("locked"));
    expect(screen.getByText("panel.unreadableFolder")).toBeInTheDocument();
  });

  it("does not let a previous workspace's late response replace the current tree", async () => {
    let resolveOld: (entries: DirEntry[]) => void = () => undefined;
    vi.mocked(readDir).mockImplementation((path) =>
      path === "/ws"
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve([file("current.txt")])
    );
    render(<ExplorerPanel />);
    await act(async () => {
      useWorkspaceStore.setState({ workspaceDir: "/next" });
    });
    expect(await screen.findByRole("treeitem", { name: "current.txt" })).toBeInTheDocument();
    await act(async () => resolveOld([file("stale.txt")]));
    expect(screen.queryByRole("treeitem", { name: "stale.txt" })).not.toBeInTheDocument();
  });
});
