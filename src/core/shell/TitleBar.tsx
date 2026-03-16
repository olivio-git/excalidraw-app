import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const INTERACTIVE_SELECTORS =
  'button, a, input, select, textarea, [role="button"], [role="tab"], [role="slider"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"]';

interface TitleBarProps {
  children?: React.ReactNode;
}

const TitleBar = ({ children }: TitleBarProps) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const lastMouseDownRef = useRef(0);

  // We already have `appWindow` declared globally at line 6, but we can redeclare it safely inside or just use the global one.
  // Using the global one to avoid dependency array issues with static singletons, or recreating it per render:
  const localAppWindow = getCurrentWindow();

  const handleMinimize = useCallback(() => localAppWindow.minimize(), [localAppWindow]);
  const handleMaximize = useCallback(() => localAppWindow.toggleMaximize(), [localAppWindow]);
  const handleClose = useCallback(() => localAppWindow.close(), [localAppWindow]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest(INTERACTIVE_SELECTORS)) return;

      const now = Date.now();
      const elapsed = now - lastMouseDownRef.current;
      lastMouseDownRef.current = now;

      if (elapsed < 300) {
        localAppWindow.toggleMaximize();
        return;
      }

      localAppWindow.startDragging();
    },
    [localAppWindow]
  );

  useEffect(() => {
    const unlisten = localAppWindow.onResized(async () => {
      const maximized = await localAppWindow.isMaximized();
      setIsMaximized(maximized);
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, [localAppWindow]);
  return (
    <div
      data-tauri-drag-region
      className="h-9 flex items-center bg-background border-b border-border select-none flex-shrink-0"
    >
      {/* Left: title or custom content (SidebarTrigger + TabBar) */}
      {children ? (
        <div
          data-tauri-drag-region
          onMouseDown={handleDragStart}
          className="flex-1 min-w-0 flex items-center h-full overflow-hidden"
        >
          {children}
        </div>
      ) : (
        <div data-tauri-drag-region className="flex-1 px-3">
          <span className="text-xs font-medium text-muted-foreground">Base Project</span>
        </div>
      )}

      {/* Right: controls */}
      <div className="flex items-center h-full flex-shrink-0">
        {/* <ThemeToggle /> */}
        <button
          onClick={handleMinimize}
          className="h-full px-3 hover:bg-accent transition-colors inline-flex items-center justify-center"
          aria-label="Minimize"
        >
          <Minus className="size-3" />
        </button>
        <button
          onClick={handleMaximize}
          className="h-full px-3 hover:bg-accent transition-colors inline-flex items-center justify-center"
          aria-label="Maximize"
        >
          {isMaximized ? (
            <Copy className="size-3 text-foreground rotate-270" />
          ) : (
            <Square className="size-3 text-foreground" />
          )}
        </button>
        <button
          onClick={handleClose}
          className="h-full px-3 hover:bg-destructive hover:text-destructive-foreground transition-colors inline-flex items-center justify-center"
          aria-label="Close"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
};

export default TitleBar;
