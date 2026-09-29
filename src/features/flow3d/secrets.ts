import type { StateStorage } from "zustand/middleware";

/**
 * Values for `{{secrets.NAME}}` in flow steps. Stored in the app's data
 * folder (like the AI keys), never in the `.flow3d` file, and hidden from run
 * data. Not encrypted: anyone with access to your user account can read them.
 */
export interface SecretStore {
  all: () => Promise<Record<string, string>>;
  names: () => Promise<string[]>;
  set: (name: string, value: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
}

export const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const KEY = "secrets";

export function createSecretStore(storage: StateStorage): SecretStore {
  let cache: Record<string, string> | null = null;
  const load = async () => {
    if (cache) return cache;
    try {
      const raw = await storage.getItem(KEY);
      cache = raw ? (JSON.parse(raw as string) as Record<string, string>) : {};
    } catch {
      cache = {};
    }
    return cache;
  };
  const save = async () => storage.setItem(KEY, JSON.stringify(cache ?? {}));
  return {
    all: async () => ({ ...(await load()) }),
    names: async () => Object.keys(await load()).sort(),
    set: async (name, value) => {
      if (!SECRET_NAME.test(name)) throw new Error("Usa letras, números y _ (sin espacios)");
      (await load())[name] = value;
      await save();
    },
    remove: async (name) => {
      delete (await load())[name];
      await save();
    },
  };
}
