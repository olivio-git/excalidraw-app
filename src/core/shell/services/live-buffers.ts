/**
 * The text of files open in a text editor, as typed (before autosave), so
 * views like the Markdown preview follow the editor live.
 */
type Listener = (content: string) => void;

const buffers = new Map<string, string>();
const listeners = new Map<string, Set<Listener>>();

export const liveBuffers = {
  publish(filePath: string, content: string): void {
    buffers.set(filePath, content);
    listeners.get(filePath)?.forEach((listener) => listener(content));
  },
  /** The editor closed: readers go back to the file on disk. */
  release(filePath: string): void {
    buffers.delete(filePath);
  },
  get(filePath: string): string | undefined {
    return buffers.get(filePath);
  },
  subscribe(filePath: string, listener: Listener): () => void {
    const set = listeners.get(filePath) ?? new Set<Listener>();
    set.add(listener);
    listeners.set(filePath, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) listeners.delete(filePath);
    };
  },
};
