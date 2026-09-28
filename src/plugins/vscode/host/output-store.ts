import { create } from "zustand";

/** Output channels shown in the "Salida" panel (extensions + the host log). */

export interface OutputChannel {
  id: string;
  name: string;
  text: string;
}

/** Keep the tail of very chatty channels. */
export const MAX_CHANNEL_LENGTH = 512 * 1024;

export const HOST_LOG_CHANNEL = "exthost-log";

interface OutputState {
  channels: OutputChannel[];
  activeId: string | null;
  create: (id: string, name: string) => void;
  append: (id: string, text: string) => void;
  clear: (id: string) => void;
  remove: (id: string) => void;
  setActive: (id: string) => void;
  reset: () => void;
}

function trim(text: string): string {
  if (text.length <= MAX_CHANNEL_LENGTH) return text;
  const cut = text.length - MAX_CHANNEL_LENGTH;
  const newline = text.indexOf("\n", cut);
  return text.slice(newline === -1 ? cut : newline + 1);
}

export const useOutputStore = create<OutputState>()((set) => ({
  channels: [],
  activeId: null,
  create: (id, name) =>
    set((state) =>
      state.channels.some((c) => c.id === id)
        ? state
        : {
            channels: [...state.channels, { id, name, text: "" }],
            activeId: state.activeId ?? id,
          }
    ),
  append: (id, text) =>
    set((state) => ({
      channels: state.channels.map((c) => (c.id === id ? { ...c, text: trim(c.text + text) } : c)),
    })),
  clear: (id) =>
    set((state) => ({
      channels: state.channels.map((c) => (c.id === id ? { ...c, text: "" } : c)),
    })),
  remove: (id) =>
    set((state) => {
      const channels = state.channels.filter((c) => c.id !== id);
      return {
        channels,
        activeId: state.activeId === id ? (channels[0]?.id ?? null) : state.activeId,
      };
    }),
  setActive: (id) => set({ activeId: id }),
  reset: () =>
    set((state) => {
      const log = state.channels.find((c) => c.id === HOST_LOG_CHANNEL);
      return { channels: log ? [log] : [], activeId: log ? log.id : null };
    }),
}));
