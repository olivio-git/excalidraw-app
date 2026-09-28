import { useEffect, useMemo, useRef } from "react";
import { useThemeStore } from "@/stores/themeStore";
import { getActiveThemeColors, onActiveThemeColorsChanged } from "../color-theme-service";
import { extensionHost } from "./extension-host-service";
import { useWebviewStore, webviewMessages } from "./view-stores";
import { buildWebviewDocument, currentWebviewTheme, sandboxFor } from "./webview-document";

/** `setState()` values survive re-renders of the iframe (hidden views, reloads). */
const webviewStates = new Map<string, unknown>();

/** Short content hash, used to give each document its own iframe element. */
function documentKey(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}-${(hash >>> 0).toString(36)}`;
}

/** Renders one extension webview in a sandboxed iframe and bridges its messages. */
export function WebviewFrame({ handle, visible = true }: { handle: string; visible?: boolean }) {
  const webview = useWebviewStore((s) => s.webviews[handle]);
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // The document is rebuilt only when the HTML or options change; theme
  // changes are pushed live so the page keeps its state.
  const srcDoc = useMemo(() => {
    if (!webview) return "";
    return buildWebviewDocument(webview.html, {
      handle,
      state: webviewStates.get(handle),
      theme: currentWebviewTheme(getActiveThemeColors()),
      enableScripts: webview.options.enableScripts,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- theme is applied live below
  }, [handle, webview?.html, webview?.options.enableScripts]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let unsubscribe: (() => void) | null = null;
    const deliver = (message: unknown) => iframe.contentWindow?.postMessage(message, "*");

    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data as { __qoriWebview?: string; type?: string; [key: string]: unknown };
      if (!data || data.__qoriWebview !== handle) return;
      switch (data.type) {
        case "ready":
          unsubscribe?.();
          unsubscribe = webviewMessages.subscribe(handle, deliver);
          break;
        case "message":
          extensionHost.notify("webview.message", { handle, message: data.message });
          break;
        case "state":
          webviewStates.set(handle, data.state);
          break;
        case "link":
          void extensionHost.executeCommand("vscode.open", [{ $uri: String(data.href) }]);
          break;
        case "command": {
          const match = /^command:([^?]+)(?:\?(.*))?$/i.exec(String(data.href));
          if (match && webview?.options.enableCommandUris) {
            let args: unknown[];
            try {
              const parsed = match[2] ? JSON.parse(decodeURIComponent(match[2])) : [];
              args = Array.isArray(parsed) ? parsed : [parsed];
            } catch {
              args = [];
            }
            void extensionHost.executeCommand(match[1], args);
          }
          break;
        }
        case "keydown":
          // Let workbench shortcuts (Ctrl+Shift+P, Ctrl+P, ...) work inside webviews.
          document.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: String(data.key),
              code: String(data.code),
              ctrlKey: !!data.ctrlKey,
              metaKey: !!data.metaKey,
              altKey: !!data.altKey,
              shiftKey: !!data.shiftKey,
              bubbles: true,
            })
          );
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      unsubscribe?.();
    };
  }, [handle, srcDoc, webview?.options.enableCommandUris]);

  // Live theme updates.
  useEffect(() => {
    const push = () =>
      requestAnimationFrame(() =>
        iframeRef.current?.contentWindow?.postMessage(
          { __qoriTheme: currentWebviewTheme(getActiveThemeColors()) },
          "*"
        )
      );
    push();
    return onActiveThemeColorsChanged(push);
  }, [resolvedTheme]);

  useEffect(() => {
    extensionHost.notify("webview.viewState", { handle, active: visible, visible });
  }, [handle, visible]);

  if (!webview || !webview.html) {
    return <p className="p-4 text-xs text-muted-foreground">Cargando vista…</p>;
  }
  return (
    <iframe
      // A new element per document: Chromium may ignore a srcdoc change made
      // while the previous document is still loading.
      key={documentKey(srcDoc)}
      ref={iframeRef}
      title={webview.title ?? webview.viewType}
      srcDoc={srcDoc}
      sandbox={sandboxFor(webview.options)}
      className="h-full w-full border-0 bg-transparent"
      data-webview-handle={handle}
    />
  );
}
