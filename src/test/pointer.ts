import { fireEvent } from "@testing-library/react";
import { vi } from "vitest";

/** JSDOM does not implement pointer capture; preserve its lifecycle in resize tests. */
export function mockPointerCapture(element: HTMLElement) {
  const captured = new Set<number>();
  element.setPointerCapture = vi.fn((id: number) => {
    captured.add(id);
  });
  element.hasPointerCapture = vi.fn((id: number) => captured.has(id));
  element.releasePointerCapture = vi.fn((id: number) => {
    captured.delete(id);
  });
}

export function pointer(element: HTMLElement, type: string, clientX = 0, clientY = 0) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button: 0,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fireEvent(element, event);
}
