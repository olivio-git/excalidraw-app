import { useLayoutEffect, useRef, useState } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handlers = Record<string, (...args: any[]) => any>;

/**
 * Returns an object of functions whose identities never change but that always
 * call the latest handlers passed in (the idea behind React's useEffectEvent).
 * Passing these to memoized children keeps them from re-rendering just because
 * a parent re-created its callbacks. Only for event handlers — not for
 * functions called during render. The set of keys must not change.
 */
export function useStableHandlers<T extends Handlers>(handlers: T): T {
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  const [stable] = useState(() => {
    const result: Handlers = {};
    for (const key of Object.keys(handlers)) {
      result[key] = (...args: unknown[]) => latest.current[key](...args);
    }
    return result as T;
  });
  return stable;
}
