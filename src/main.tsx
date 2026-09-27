import { createRoot } from "react-dom/client";
import App from "./App";
import "@excalidraw/excalidraw/index.css";
import "./styles/index.css";

// Required for Excalidraw library panel to install libraries in-app
// instead of opening a new browser tab
window.name = "excalidraw-app";

// Tell Excalidraw where to find its font/asset files in production.
// In dev, we point at node_modules directly so fonts work offline too.
// In prod (Tauri bundle), vite-plugin-static-copy puts fonts under /excalidraw-assets/.
window.EXCALIDRAW_ASSET_PATH = import.meta.env.PROD
  ? "/excalidraw-assets/"
  : "/node_modules/@excalidraw/excalidraw/dist/prod/";

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

createRoot(document.getElementById("root")!).render(<App />);
