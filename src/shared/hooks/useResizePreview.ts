import { useEffect, useRef, type PointerEvent } from "react";

interface ResizePreview {
  element: HTMLElement;
  property: string;
  initial: number;
  measure: (event: PointerEvent<HTMLElement>) => number;
  format: (value: number) => string;
  onCommit: (value: number) => void;
  onFinish?: () => void;
}

interface ResizeSession extends ResizePreview {
  handle: HTMLElement;
  pointerId: number;
  value: number;
  frame: number | null;
  previousStyle: string;
  previousPriority: string;
  previousAria: string | null;
}

/** Preview layout at most once per frame; publish React/persisted state only on release. */
export function useResizePreview() {
  const session = useRef<ResizeSession | null>(null);

  function finish(commit: boolean) {
    const current = session.current;
    if (!current) return;
    session.current = null;
    if (current.frame !== null) cancelAnimationFrame(current.frame);
    if (current.previousStyle) {
      current.element.style.setProperty(
        current.property,
        current.previousStyle,
        current.previousPriority
      );
    } else {
      current.element.style.removeProperty(current.property);
    }
    if (current.previousAria !== null)
      current.handle.setAttribute("aria-valuenow", current.previousAria);
    if (current.handle.hasPointerCapture(current.pointerId))
      current.handle.releasePointerCapture(current.pointerId);
    try {
      if (commit && current.value !== current.initial) current.onCommit(current.value);
    } finally {
      current.onFinish?.();
    }
  }

  useEffect(() => {
    const cancel = () => finish(false);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      cancel();
    };
  }, []);

  return {
    start: (event: PointerEvent<HTMLElement>, preview: ResizePreview) => {
      if (event.button !== 0 || session.current) return false;
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      session.current = {
        ...preview,
        handle,
        pointerId: event.pointerId,
        value: preview.initial,
        frame: null,
        previousStyle: preview.element.style.getPropertyValue(preview.property),
        previousPriority: preview.element.style.getPropertyPriority(preview.property),
        previousAria: handle.getAttribute("aria-valuenow"),
      };
      return true;
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = session.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const value = current.measure(event);
      if (!Number.isFinite(value)) return;
      current.value = value;
      if (current.frame !== null) return;
      current.frame = requestAnimationFrame(() => {
        current.frame = null;
        current.element.style.setProperty(current.property, current.format(current.value));
        if (current.previousAria !== null)
          current.handle.setAttribute("aria-valuenow", String(Math.round(current.value)));
      });
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (session.current?.pointerId === event.pointerId) finish(true);
    },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => {
      if (session.current?.pointerId === event.pointerId) finish(false);
    },
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => {
      if (session.current?.pointerId === event.pointerId) finish(false);
    },
  };
}
