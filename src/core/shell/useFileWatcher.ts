import { useEffect, useRef } from "react";
import { watch, type UnwatchFn } from "@tauri-apps/plugin-fs";

export const useFileWatcher = (dir: string | null, onChanged: () => void) => {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!dir) return;

    let stopWatcher: UnwatchFn | null = null;

    let cancelled = false;

    watch(
      dir,
      (event) => {
        // Filter out access events — they fire every time readDir opens the
        // directory, creating an infinite feedback loop on Linux/inotify.
        const kind = Object.keys((event as any).type ?? {})[0];
        if (kind === "access") return;

        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(onChanged, 300);
      },
      { recursive: true }
    ).then((stop) => {
      if (cancelled) {
        // Effect was already cleaned up before watch() resolved — stop immediately
        stop();
      } else {
        stopWatcher = stop;
      }
    });

    return () => {
      cancelled = true;
      stopWatcher?.();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [dir, onChanged]);
};
