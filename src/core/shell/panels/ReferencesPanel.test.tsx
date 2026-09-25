import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ReferencesPanel } from "./ReferencesPanel";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { initialEditorLayout } from "@/core/tabs/store/editor-layout";
import { openFileReference } from "../services/file-navigation";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/core/i18n/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("../services/file-navigation", () => ({
  createFileReference: (path: string) => path,
  openFileReference: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../hooks/useWorkspaceReferences", () => ({
  useWorkspaceReferences: () => ({
    workspace: "/ws",
    loading: false,
    error: null,
    refresh: vi.fn(),
    index: {
      files: 2,
      failures: 0,
      truncated: false,
      references: [
        {
          sourcePath: "/ws/study.note",
          sourceAnchor: "paragraph-id",
          targetPath: "/ws/map.excalidraw",
          targetAnchor: "node-id",
          label: "Architecture",
        },
        {
          sourcePath: "/ws/map.excalidraw",
          sourceAnchor: "node-id",
          targetPath: "/ws/study.note",
          targetAnchor: "overview",
          label: "Notes",
        },
      ],
    },
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  useTabStore.setState({ ...initialEditorLayout(), tabs: [], activeTabId: null });
});

describe("reference navigation", () => {
  it("opens the source block for incoming references and the target for outgoing references", () => {
    useTabStore.getState().addTab({
      routeId: "diagram",
      path: "/diagram",
      title: "map",
      instanceId: "/ws/map.excalidraw",
      metadata: { filePath: "/ws/map.excalidraw" },
    });
    render(<ReferencesPanel />);
    const incoming = screen.getByText("connected.incoming").closest("section")!;
    fireEvent.click(within(incoming).getByRole("button"), { ctrlKey: true });
    expect(openFileReference).toHaveBeenLastCalledWith(
      "/ws/study.note#paragraph-id",
      "/ws/map.excalidraw",
      { beside: true }
    );
    const outgoing = screen.getByText("connected.outgoing").closest("section")!;
    fireEvent.click(within(outgoing).getByRole("button"));
    expect(openFileReference).toHaveBeenLastCalledWith(
      "/ws/study.note#overview",
      "/ws/map.excalidraw",
      { beside: false }
    );
  });
});
