import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@excalidraw/excalidraw/index.css";
import "./styles/index.css";

// Required for Excalidraw library panel to install libraries in-app
// instead of opening a new browser tab
window.name = "excalidraw-app";

// Intercept window.open for external URLs and open them in the system browser
const _nativeOpen = window.open.bind(window);
window.open = (url?: string | URL, target?: string, features?: string) => {
  const href = url?.toString() ?? "";
  if (href.startsWith("http://") || href.startsWith("https://")) {
    import("@tauri-apps/plugin-opener").then(({ openUrl }) => void openUrl(href));
    return null;
  }
  return _nativeOpen(url, target, features);
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
