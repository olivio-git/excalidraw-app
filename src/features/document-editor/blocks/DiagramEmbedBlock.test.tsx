import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { DiagramEmbedRenderer } from "./DiagramEmbedBlock";
import { DocumentHostContext } from "../DocumentHostContext";
import { renderDiagramPreview } from "../diagram-preview";
import { watch, type WatchEvent } from "@tauri-apps/plugin-fs";

function translate(key: string) {
  return key;
}
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("../diagram-preview", () => ({ renderDiagramPreview: vi.fn() }));
vi.mock("@/core/shell/services/file-navigation", () => ({
  resolveFileReference: async (path: string) => ({ filePath: path }),
  openFileReference: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ watch: vi.fn() }));
const create = vi.fn();
const revoke = vi.fn();
const stop = vi.fn();
const NativeURL = URL;
beforeEach(() => {
  vi.clearAllMocks();
  create.mockReturnValueOnce("blob:preview-one").mockReturnValue("blob:preview-two");
  vi.stubGlobal(
    "URL",
    Object.assign(class extends NativeURL {}, { createObjectURL: create, revokeObjectURL: revoke })
  );
  vi.mocked(renderDiagramPreview).mockResolvedValue(new Blob(["svg"]));
  vi.mocked(watch).mockResolvedValue(stop);
});
afterEach(() => vi.unstubAllGlobals());

describe("linked diagram preview", () => {
  it("renders the saved diagram, refreshes on modification and cleans up resources", async () => {
    let onChange: ((event: WatchEvent) => void) | undefined;
    vi.mocked(watch).mockImplementation(async (_path, callback) => {
      onChange = callback;
      return stop;
    });
    const { unmount } = render(
      <DocumentHostContext.Provider value={{ filePath: "/ws/a.note", groupId: "primary" }}>
        <DiagramEmbedRenderer diagramPath="/ws/map.excalidraw" />
      </DocumentHostContext.Provider>
    );
    expect(await screen.findByRole("img")).toHaveAttribute("src", "blob:preview-one");
    await waitFor(() => expect(watch).toHaveBeenCalledOnce());
    act(() =>
      onChange?.({
        type: { modify: { kind: "data", mode: "any" } },
        paths: ["/ws/map.excalidraw"],
      } as WatchEvent)
    );
    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("src", "blob:preview-two"));
    expect(revoke).toHaveBeenCalledWith("blob:preview-one");
    unmount();
    expect(stop).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith("blob:preview-two");
  });
  it("ignores late preview results after the block unmounts", async () => {
    let finish: (blob: Blob) => void = () => undefined;
    vi.mocked(renderDiagramPreview).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { unmount } = render(<DiagramEmbedRenderer diagramPath="/ws/map.excalidraw" />);
    await waitFor(() => expect(renderDiagramPreview).toHaveBeenCalledOnce());
    unmount();
    await act(async () => finish(new Blob(["svg"])));
    expect(create).not.toHaveBeenCalled();
  });
  it("shows a read error without using unsafe inline SVG markup", async () => {
    vi.mocked(renderDiagramPreview).mockRejectedValue(new Error("permission denied"));
    const { unmount } = render(<DiagramEmbedRenderer diagramPath="/ws/map.excalidraw" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("permission denied");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    unmount();
  });
});
