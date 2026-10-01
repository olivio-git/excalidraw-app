import type { EditorView } from "@codemirror/view";

/**
 * Keeps a text editor and the preview of the same file scrolled to the same
 * place, by source line: each side says which line is at its top (with the
 * fraction scrolled past it) and the other side follows.
 */
export interface ScrollPosition {
  /** 1-based source line at the top of the view. */
  line: number;
  /** How far into that line (0–1). */
  fraction: number;
  from: "editor" | "preview";
}

type Listener = (position: ScrollPosition) => void;
const listeners = new Map<string, Set<Listener>>();

export const scrollSync = {
  publish(filePath: string, position: ScrollPosition): void {
    listeners.get(filePath)?.forEach((listener) => listener(position));
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

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Ignores the scroll event our own programmatic scroll causes, so the two
 * sides don't bounce positions back and forth.
 */
export function createEchoGuard() {
  let until = 0;
  return {
    mute: () => (until = performance.now() + 120),
    muted: () => performance.now() < until,
  };
}

/** Sync a CodeMirror editor with the preview of its file. Returns the cleanup. */
export function attachEditorScrollSync(view: EditorView, getPath: () => string): () => void {
  const guard = createEchoGuard();
  const scroller = view.scrollDOM;
  // Document height (from its top) currently at the top edge of the scroller.
  const topHeight = () => scroller.getBoundingClientRect().top - view.documentTop;

  const onScroll = () => {
    if (guard.muted()) return;
    const height = topHeight();
    const block = view.lineBlockAtHeight(Math.max(0, height));
    scrollSync.publish(getPath(), {
      line: view.state.doc.lineAt(block.from).number,
      fraction: block.height > 0 ? clamp01((height - block.top) / block.height) : 0,
      from: "editor",
    });
  };
  scroller.addEventListener("scroll", onScroll, { passive: true });

  let unsubscribe = scrollSync.subscribe(getPath(), follow);
  let path = getPath();
  function follow(position: ScrollPosition) {
    if (position.from === "editor") return;
    const doc = view.state.doc;
    const line = doc.line(Math.min(Math.max(position.line, 1), doc.lines));
    const block = view.lineBlockAt(line.from);
    guard.mute();
    scroller.scrollTop += block.top + position.fraction * block.height - topHeight();
  }
  // The file can be renamed while open.
  const resubscribe = window.setInterval(() => {
    if (getPath() === path) return;
    unsubscribe();
    path = getPath();
    unsubscribe = scrollSync.subscribe(path, follow);
  }, 1000);

  return () => {
    scroller.removeEventListener("scroll", onScroll);
    window.clearInterval(resubscribe);
    unsubscribe();
  };
}

/** Elements of a rendered document that carry their source line (`data-line`). */
function lineAnchors(container: HTMLElement): Array<{ line: number; top: number }> {
  const base = container.getBoundingClientRect().top - container.scrollTop;
  const anchors: Array<{ line: number; top: number }> = [];
  for (const element of container.querySelectorAll<HTMLElement>("[data-line]")) {
    const line = Number(element.dataset.line);
    if (!Number.isFinite(line)) continue;
    const top = element.getBoundingClientRect().top - base;
    // Keep anchors increasing in both line and position (nested blocks repeat lines).
    const last = anchors.at(-1);
    if (last && (line <= last.line || top < last.top)) continue;
    anchors.push({ line, top });
  }
  return anchors;
}

/** Scroll offset in a rendered document for a source position. */
export function previewOffsetFor(container: HTMLElement, position: ScrollPosition): number {
  const anchors = lineAnchors(container);
  if (anchors.length === 0) return 0;
  const target = position.line + position.fraction;
  let index = anchors.findIndex((anchor) => anchor.line > target) - 1;
  if (index === -2) index = anchors.length - 1;
  if (index < 0) return 0;
  const current = anchors[index];
  const next = anchors[index + 1];
  if (!next) return current.top;
  const ratio = (target - current.line) / (next.line - current.line);
  return current.top + ratio * (next.top - current.top);
}

/** Source position at the top of a rendered document. */
export function previewPositionAt(container: HTMLElement): Omit<ScrollPosition, "from"> {
  const anchors = lineAnchors(container);
  const offset = container.scrollTop;
  let index = anchors.findIndex((anchor) => anchor.top > offset) - 1;
  if (index === -2) index = anchors.length - 1;
  if (index < 0) return { line: 1, fraction: 0 };
  const current = anchors[index];
  const next = anchors[index + 1];
  if (!next) return { line: current.line, fraction: 0 };
  const exact =
    current.line + ((offset - current.top) / (next.top - current.top)) * (next.line - current.line);
  return { line: Math.floor(exact), fraction: exact - Math.floor(exact) };
}
