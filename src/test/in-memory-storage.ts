import type { StateStorage } from "zustand/middleware";

/**
 * Creates a fresh, independent in-memory StateStorage instance for test isolation.
 * Each call returns a new storage backed by its own Map — no shared state between tests.
 */
export function createInMemoryStorage(): StateStorage {
  const store = new Map<string, string>();

  return {
    getItem(name: string): string | null {
      return store.get(name) ?? null;
    },
    setItem(name: string, value: string): void {
      store.set(name, value);
    },
    removeItem(name: string): void {
      store.delete(name);
    },
  };
}
