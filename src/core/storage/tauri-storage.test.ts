import { describe, expect, it, vi } from "vitest";
import { Store } from "@tauri-apps/plugin-store";
import { createTauriStorage, tauriTabStorage } from "./tauri-storage";

describe("Tauri storage write policy", () => {
  it("updates native tab state immediately without forcing a disk save on every switch", async () => {
    const load = vi.mocked(Store.load);
    load.mockClear();
    await tauriTabStorage.setItem("tab-storage", "first");
    expect(load).toHaveBeenCalledWith("tab-storage.json", { defaults: {}, autoSave: 250 });
    const store = (await load.mock.results[0].value) as Store;
    vi.mocked(store.set).mockClear();
    vi.mocked(store.save).mockClear();
    for (let index = 0; index < 20; index++)
      await tauriTabStorage.setItem("tab-storage", String(index));
    expect(store.set).toHaveBeenCalledTimes(20);
    expect(store.set).toHaveBeenLastCalledWith("tab-storage", "19");
    expect(store.save).not.toHaveBeenCalled();
    // Explicit removal still flushes rather than leaving a deleted session on disk.
    await tauriTabStorage.removeItem("tab-storage");
    expect(store.delete).toHaveBeenCalledWith("tab-storage");
    expect(store.save).toHaveBeenCalledOnce();
  });

  it("retains immediate durable saves for other settings", async () => {
    const load = vi.mocked(Store.load);
    load.mockClear();
    const storage = createTauriStorage("settings-test.json");
    await storage.setItem("setting", "value");
    expect(load).toHaveBeenCalledWith("settings-test.json", { defaults: {}, autoSave: false });
    const store = (await load.mock.results[0].value) as Store;
    expect(store.set).toHaveBeenCalledWith("setting", "value");
    expect(store.save).toHaveBeenCalled();
  });
});
