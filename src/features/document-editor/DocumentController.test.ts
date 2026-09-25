import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentController } from "./DocumentController";
import { useDocumentStore } from "@/stores/documentStore";

beforeEach(() => useDocumentStore.setState({ documents: {}, activeDocumentId: null }));
function setup() {
  const service = {
    readDocumentFile: vi.fn().mockResolvedValue(""),
    writeDocumentFile: vi.fn().mockResolvedValue(undefined),
    deleteDocumentFile: vi.fn(),
    listDocumentFiles: vi.fn().mockResolvedValue([]),
  };
  useDocumentStore.getState().openDocument("/ws/note.md", "initial");
  return {
    controller: new DocumentController(useDocumentStore, service),
    write: service.writeDocumentFile,
  };
}

describe("document save consistency", () => {
  it("can settle failed queued writes when an explicit discard is requested", async () => {
    const { controller, write } = setup();
    write.mockRejectedValueOnce(new Error("disk full"));
    useDocumentStore.getState().updateContent("/ws/note.md", "unsaved");
    const saving = controller.saveDocument("/ws/note.md").catch(() => undefined);
    await expect(controller.waitForSaves("/ws/note.md", true)).resolves.toBeUndefined();
    await saving;
    expect(useDocumentStore.getState().documents["/ws/note.md"].isDirty).toBe(true);
  });
  it("keeps edits made during an in-flight save dirty", async () => {
    const { controller, write } = setup();
    let finish: () => void = () => undefined;
    write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    useDocumentStore.getState().updateContent("/ws/note.md", "first edit");
    const saving = controller.saveDocument("/ws/note.md");
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith("/ws/note.md", "first edit"));
    useDocumentStore.getState().updateContent("/ws/note.md", "newer edit");
    finish();
    await saving;
    expect(useDocumentStore.getState().documents["/ws/note.md"]).toMatchObject({
      content: "newer edit",
      isDirty: true,
    });
  });

  it("serializes writes to one file and snapshots the latest queued content", async () => {
    const { controller, write } = setup();
    let finish: () => void = () => undefined;
    write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    useDocumentStore.getState().updateContent("/ws/note.md", "first");
    const first = controller.saveDocument("/ws/note.md");
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    useDocumentStore.getState().updateContent("/ws/note.md", "second");
    const second = controller.saveDocument("/ws/note.md");
    expect(write).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([first, second]);
    expect(write).toHaveBeenNthCalledWith(2, "/ws/note.md", "second");
    expect(useDocumentStore.getState().documents["/ws/note.md"].isDirty).toBe(false);
  });

  it("retains dirty content after failure and allows a later retry", async () => {
    const { controller, write } = setup();
    write.mockRejectedValueOnce(new Error("disk full"));
    useDocumentStore.getState().updateContent("/ws/note.md", "valuable edit");
    await expect(controller.saveDocument("/ws/note.md")).rejects.toThrow("disk full");
    expect(useDocumentStore.getState().documents["/ws/note.md"].isDirty).toBe(true);
    await controller.saveDocument("/ws/note.md");
    expect(useDocumentStore.getState().documents["/ws/note.md"].isDirty).toBe(false);
  });

  it("loads a background document without stealing the active document", async () => {
    const { controller } = setup();
    await controller.openDocument("/ws/background.md", false);
    expect(useDocumentStore.getState().activeDocumentId).toBe("/ws/note.md");
  });
});
