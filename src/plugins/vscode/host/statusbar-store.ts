import { create } from "zustand";

/** Status bar entries: extension items (`createStatusBarItem`) and transient messages. */

export interface StatusBarItem {
  id: string;
  extensionId?: string;
  alignment: "left" | "right";
  priority: number;
  text: string;
  name?: string;
  tooltip?: string;
  hasCommand: boolean;
  color?: string | { themeColor: string };
  backgroundColor?: string | { themeColor: string };
}

interface StatusBarState {
  items: Record<string, StatusBarItem>;
  messages: Record<string, string>;
  update: (item: StatusBarItem) => void;
  remove: (id: string) => void;
  setMessage: (id: string, text: string | null) => void;
  reset: () => void;
}

export const useStatusBarStore = create<StatusBarState>()((set) => ({
  items: {},
  messages: {},
  update: (item) => set((state) => ({ items: { ...state.items, [item.id]: item } })),
  remove: (id) =>
    set((state) => {
      if (!(id in state.items)) return state;
      const items = { ...state.items };
      delete items[id];
      return { items };
    }),
  setMessage: (id, text) =>
    set((state) => {
      const messages = { ...state.messages };
      if (text === null) delete messages[id];
      else messages[id] = text;
      return { messages };
    }),
  reset: () => set({ items: {}, messages: {} }),
}));

/** Items for one side in display order: higher priority further left (as in VS Code). */
export function sortStatusBarItems(
  items: StatusBarItem[],
  alignment: "left" | "right"
): StatusBarItem[] {
  return items
    .filter((item) => item.alignment === alignment)
    .sort((a, b) => b.priority - a.priority);
}
