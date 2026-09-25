import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDocumentStore } from "@/stores/documentStore";
import { useDocumentPersistence } from "./useDocumentPersistence";
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../documentController.singleton", () => ({
  getDocumentController: () => ({ saveDocument: mocks.save }),
}));
beforeEach(() => {
  vi.useFakeTimers();
  mocks.save.mockReset().mockResolvedValue(undefined);
  useDocumentStore.setState({ documents: {}, activeDocumentId: null });
  useDocumentStore.getState().openDocument("/note.md", "");
});
afterEach(() => {
  vi.useRealTimers();
});
describe("document autosave", () => {
  it("pauses scheduled autosaves for discard and can resume after a blocked close", async () => {
    const { result } = renderHook(() => useDocumentPersistence("/note.md"));
    act(() => useDocumentStore.getState().updateContent("/note.md", "Unsaved"));
    let resume = () => {};
    act(() => {
      resume = result.current.pause();
    });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(mocks.save).not.toHaveBeenCalled();
    act(() => resume());
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(mocks.save).toHaveBeenCalledOnce();
  });
  it("debounces each content change even when the dirty flag stays true", async () => {
    renderHook(() => useDocumentPersistence("/note.md"));
    act(() => useDocumentStore.getState().updateContent("/note.md", "first"));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    act(() => useDocumentStore.getState().updateContent("/note.md", "second"));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(mocks.save).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith("/note.md");
  });
  it("exposes save failures and retries on a new edit without a tight retry loop", async () => {
    mocks.save.mockRejectedValueOnce(new Error("permission denied"));
    const { result } = renderHook(() => useDocumentPersistence("/note.md"));
    act(() => useDocumentStore.getState().updateContent("/note.md", "first"));
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(result.current.error).toContain("permission denied");
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(mocks.save).toHaveBeenCalledOnce();
    act(() => useDocumentStore.getState().updateContent("/note.md", "second"));
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
  });
});
