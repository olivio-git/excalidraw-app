import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

interface Rect {
  x: number;
  y: number;
  width: number;
  /** null: as tall as its content (up to the container). */
  height: number | null;
}

const MIN_WIDTH = 240;
const MIN_HEIGHT = 160;
const MARGIN = 8;
const DEFAULT_WIDTH = 300;

function loadRect(id: string): Rect | null {
  try {
    const raw = localStorage.getItem(`flow3d.panel.${id}`);
    const rect = raw ? (JSON.parse(raw) as Rect) : null;
    return rect && Number.isFinite(rect.x) && Number.isFinite(rect.width) ? rect : null;
  } catch {
    return null;
  }
}

function saveRect(id: string, rect: Rect) {
  try {
    localStorage.setItem(`flow3d.panel.${id}`, JSON.stringify(rect));
  } catch {
    // Private mode: the panel just doesn't remember its place.
  }
}

/**
 * A window over the 3D view: drag it by its title, resize it from the corner,
 * maximize it, and it remembers where you left it. Double-click the title to
 * put it back on the right.
 */
export function FloatingPanel({
  id,
  title,
  color,
  onClose,
  children,
  className,
}: {
  id: string;
  title: string;
  color?: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [rect, setRect] = useState<Rect | null>(() => loadRect(id));
  const [maximized, setMaximized] = useState(false);
  const [parentHeight, setParentHeight] = useState(800);

  const bounds = useCallback(() => {
    const parent = ref.current?.parentElement;
    return parent
      ? { width: parent.clientWidth, height: parent.clientHeight }
      : { width: 1200, height: 800 };
  }, []);

  /** Keep the panel inside its container (after resizes of the window or split). */
  const clamp = useCallback(
    (next: Rect): Rect => {
      const { width, height } = bounds();
      const w = Math.min(Math.max(next.width, MIN_WIDTH), Math.max(MIN_WIDTH, width - MARGIN * 2));
      const h =
        next.height === null
          ? null
          : Math.min(Math.max(next.height, MIN_HEIGHT), Math.max(MIN_HEIGHT, height - MARGIN * 2));
      return {
        width: w,
        height: h,
        x: Math.min(Math.max(next.x, MARGIN), Math.max(MARGIN, width - w - MARGIN)),
        y: Math.min(
          Math.max(next.y, MARGIN),
          Math.max(MARGIN, height - (h ?? MIN_HEIGHT) - MARGIN)
        ),
      };
    },
    [bounds]
  );

  const defaultRect = useCallback((): Rect => {
    const { width } = bounds();
    return { x: width - DEFAULT_WIDTH - MARGIN, y: MARGIN, width: DEFAULT_WIDTH, height: null };
  }, [bounds]);

  // First placement: on the right, like before; later the remembered rect, kept in view.
  // The observer fires once right after observe(): that places it; later, keeps it in view.
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(() => {
      setParentHeight(parent.clientHeight);
      setRect((current) => clamp(current ?? defaultRect()));
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, [clamp, defaultRect]);

  const startGesture = (
    event: React.PointerEvent,
    apply: (start: Rect, dx: number, dy: number) => Rect,
    /** Resizing fixes the height; moving keeps an auto height (content scrolls). */
    fixHeight = false
  ) => {
    if (event.button !== 0 || !rect) return;
    event.preventDefault();
    event.stopPropagation();
    const start = fixHeight
      ? { ...rect, height: rect.height ?? ref.current?.offsetHeight ?? MIN_HEIGHT }
      : rect;
    const origin = { x: event.clientX, y: event.clientY };
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    let last = start;
    const move = (e: PointerEvent) => {
      last = clamp(apply(start, e.clientX - origin.x, e.clientY - origin.y));
      setRect(last);
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      saveRect(id, last);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  const onDragTitle = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest("button")) return;
    setMaximized(false);
    startGesture(event, (start, dx, dy) => ({ ...start, x: start.x + dx, y: start.y + dy }));
  };
  const onResize = (event: React.PointerEvent) =>
    startGesture(
      event,
      (start, dx, dy) => ({
        ...start,
        width: start.width + dx,
        height: (start.height ?? MIN_HEIGHT) + dy,
      }),
      true
    );
  const onResizeLeft = (event: React.PointerEvent) =>
    startGesture(
      event,
      (start, dx, dy) => ({
        ...start,
        x: start.x + dx,
        width: start.width - dx,
        height: (start.height ?? MIN_HEIGHT) + dy,
      }),
      true
    );

  const style: React.CSSProperties = maximized
    ? { left: MARGIN, top: MARGIN, right: MARGIN, bottom: MARGIN }
    : rect
      ? {
          left: rect.x,
          top: rect.y,
          width: rect.width,
          ...(rect.height === null
            ? { maxHeight: parentHeight - rect.y - MARGIN }
            : { height: rect.height }),
        }
      : { right: MARGIN, top: MARGIN, width: DEFAULT_WIDTH, visibility: "hidden" };

  return (
    <aside
      ref={ref}
      aria-label="Propiedades"
      data-floating-panel={id}
      style={style}
      className={cn(
        "pointer-events-auto absolute z-20 flex flex-col overflow-hidden rounded-lg border border-border bg-popover/95 text-popover-foreground shadow-xl backdrop-blur",
        className
      )}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div
        data-panel-titlebar
        className="flex shrink-0 cursor-grab items-center gap-2 border-b border-border/60 px-3 py-2 select-none active:cursor-grabbing"
        onPointerDown={onDragTitle}
        onDoubleClick={() => {
          const next = clamp(defaultRect());
          setRect(next);
          setMaximized(false);
          saveRect(id, next);
        }}
        title="Arrastra para mover · doble clic para volver a la derecha"
      >
        {color && <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />}
        <h3 className="flex-1 truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={maximized ? "Restaurar" : "Maximizar"}
          onClick={() => setMaximized((value) => !value)}
        >
          {maximized ? <Minimize2 /> : <Maximize2 />}
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="Cerrar propiedades" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">{children}</div>
      {!maximized && (
        <>
          <div
            data-panel-resize
            aria-hidden
            className="absolute right-0 bottom-0 size-3.5 cursor-nwse-resize"
            onPointerDown={onResize}
          >
            <svg viewBox="0 0 10 10" className="size-full text-muted-foreground/60">
              <path d="M9 3 3 9M9 6 6 9" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
          </div>
          <div
            aria-hidden
            className="absolute bottom-0 left-0 size-3.5 cursor-nesw-resize"
            onPointerDown={onResizeLeft}
          />
        </>
      )}
    </aside>
  );
}
