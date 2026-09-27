/**
 * Fake Tauri backend for performance measurements in a plain browser.
 *
 * Mocks the IPC calls the app makes (fs, store, path, events, window, custom
 * commands) over an in-memory workspace, so the real app can run in Chromium
 * through Playwright. Loaded by perf/harness/app.html before src/main.tsx.
 *
 * URL options:
 *   ?md=markdown   open .md files in the Markdown (CodeMirror) editor
 *   ?restore=N     start with N tabs restored from the previous session
 */
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

type Payload = Record<string, unknown> & {
  path?: string;
  paths?: string[];
  rid?: number;
  key?: string;
  value?: unknown;
  directory?: number;
};

const params = new URLSearchParams(location.search);

// ---- In-memory workspace ----------------------------------------------------
const files = new Map<string, string>();
const dirs = new Set<string>(["/", "/home", "/home/user", "/ws"]);

function addFile(path: string, content: string): void {
  files.set(path, content);
  for (let dir = path.slice(0, path.lastIndexOf("/")); dir && dir !== "/"; ) {
    dirs.add(dir);
    dir = dir.slice(0, dir.lastIndexOf("/"));
  }
}

function diagram(seed: number): string {
  const elements = Array.from({ length: 60 }, (_, i) => ({
    id: `e${seed}-${i}`,
    type: i % 3 === 0 ? "ellipse" : "rectangle",
    x: (i % 10) * 160,
    y: Math.floor(i / 10) * 120,
    width: 120,
    height: 80,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: seed * 1000 + i,
    version: 1,
    versionNonce: i,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  }));
  return JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "perf-harness",
    elements,
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  });
}

function note(i: number): string {
  return (
    `# Nota ${i}\n\nTexto con **negrita**, [enlace](nota-${(i % 3) + 1}.md) y $x^2$.\n\n` +
    `![Diagrama](../diagrams/diagrama-${i}.excalidraw)\n\n- [ ] tarea\n- [x] hecha\n\n` +
    "Párrafo de relleno. ".repeat(80)
  );
}

for (let i = 1; i <= 3; i++) addFile(`/ws/diagrams/diagrama-${i}.excalidraw`, diagram(i));
for (let i = 1; i <= 3; i++) addFile(`/ws/notes/nota-${i}.md`, note(i));
for (let folder = 0; folder < 10; folder++) {
  for (let i = 0; i < 20; i++) {
    addFile(`/ws/proyecto/carpeta-${folder}/archivo-${i}.md`, `# Archivo ${i}\n`);
  }
}

// ---- Persisted stores (tauri-plugin-store) ----------------------------------
const persisted = (state: unknown) => JSON.stringify({ state, version: 0 });

function restoredTabs(count: number) {
  const paths = [
    ...[1, 2, 3].map((i) => `/ws/diagrams/diagrama-${i}.excalidraw`),
    ...[1, 2, 3].map((i) => `/ws/notes/nota-${i}.md`),
  ].slice(0, count);
  const tabs = paths.map((filePath, index) => {
    const isDiagram = filePath.endsWith(".excalidraw");
    const routeId = isDiagram ? "diagram" : "document-editor";
    return {
      id: `tab-restored-${index}`,
      routeId,
      path: `/${routeId}`,
      title: filePath
        .split("/")
        .pop()!
        .replace(/\.[^.]+$/, ""),
      isPinned: false,
      isClosable: true,
      scrollPosition: 0,
      metadata: { filePath },
      instanceId: filePath,
      openedAt: index,
      groupId: "primary",
    };
  });
  return {
    tabs,
    activeTabId: tabs.at(-1)?.id ?? null,
    activeGroupId: "primary",
    groupActiveTabIds: { primary: tabs.at(-1)?.id ?? null },
    splitDirection: null,
    splitRatio: 50,
  };
}

const seededStores: Record<string, Record<string, unknown>> = {
  "workspace-storage.json": {
    "workspace-storage": persisted({ workspaceDir: "/ws" }),
  },
  "editor-preferences.json": {
    "editor-preferences": persisted({ markdownEditor: params.get("md") ?? "classic" }),
  },
};
const restore = Number(params.get("restore") ?? 0);
if (restore > 0) {
  seededStores["tab-storage.json"] = { "tab-storage": persisted(restoredTabs(restore)) };
}

const stores = new Map<string, Map<string, unknown>>();
const storeByRid = new Map<number, Map<string, unknown>>();
let nextRid = 1;

// ---- IPC handler ------------------------------------------------------------
const encoder = new TextEncoder();
const unhandled = new Set<string>();

function fileInfo(path: string) {
  const isDirectory = dirs.has(path);
  return {
    isFile: !isDirectory,
    isDirectory,
    isSymlink: false,
    size: files.get(path)?.length ?? 0,
    mtime: 1_700_000_000_000,
    atime: null,
    birthtime: null,
    readonly: false,
    fileAttributes: null,
    dev: null,
    ino: null,
    mode: null,
    nlink: null,
    uid: null,
    gid: null,
    rdev: null,
    blksize: null,
    blocks: null,
  };
}

function readDir(path: string) {
  const base = path.replace(/\/$/, "");
  const names = new Set<string>();
  for (const entry of [...files.keys(), ...dirs]) {
    if (entry.startsWith(`${base}/`)) names.add(entry.slice(base.length + 1).split("/")[0]);
  }
  return [...names].map((name) => {
    const isDirectory = dirs.has(`${base}/${name}`);
    return { name, isDirectory, isFile: !isDirectory, isSymlink: false };
  });
}

function store(payload: Payload): Map<string, unknown> {
  return storeByRid.get(payload.rid!)!;
}

mockWindows("main");
mockIPC(
  (cmd, rawPayload) => {
    const payload = (rawPayload ?? {}) as Payload;
    switch (cmd) {
      case "plugin:store|load": {
        const path = payload.path!;
        if (!stores.has(path)) stores.set(path, new Map(Object.entries(seededStores[path] ?? {})));
        const rid = nextRid++;
        storeByRid.set(rid, stores.get(path)!);
        return rid;
      }
      case "plugin:store|get":
        return [store(payload).get(payload.key!) ?? null, store(payload).has(payload.key!)];
      case "plugin:store|set":
        store(payload).set(payload.key!, payload.value);
        return null;
      case "plugin:store|has":
        return store(payload).has(payload.key!);
      case "plugin:store|delete":
        return store(payload).delete(payload.key!);
      case "plugin:store|keys":
        return [...store(payload).keys()];
      case "plugin:store|entries":
        return [...store(payload).entries()];
      case "plugin:store|get_store":
      case "plugin:store|save":
      case "plugin:store|clear":
      case "plugin:store|reload":
        return null;

      case "plugin:fs|exists":
        return files.has(payload.path!) || dirs.has(payload.path!);
      case "plugin:fs|read_dir":
        return readDir(payload.path!);
      case "plugin:fs|read_text_file":
      case "plugin:fs|read_file": {
        const content = files.get(payload.path!);
        if (content === undefined) throw new Error(`ENOENT ${payload.path}`);
        return Array.from(encoder.encode(content));
      }
      case "plugin:fs|stat":
      case "plugin:fs|lstat":
        return fileInfo(payload.path!);
      case "plugin:fs|watch":
        return 1;
      case "plugin:fs|unwatch":
      case "plugin:fs|write_text_file":
      case "plugin:fs|write_file":
      case "plugin:fs|mkdir":
        return null;

      case "plugin:path|join":
        return payload.paths!.join("/").replace(/\/+/g, "/");
      case "plugin:path|dirname":
        return payload.path!.slice(0, payload.path!.lastIndexOf("/")) || "/";
      case "plugin:path|basename":
        return payload.path!.split("/").pop();
      case "plugin:path|extname":
        return payload.path!.split(".").pop();
      case "plugin:path|normalize":
        return payload.path;
      case "plugin:path|is_absolute":
        return payload.path!.startsWith("/");
      case "plugin:path|resolve_directory":
        return "/home/user";
      case "plugin:path|resolve":
        return payload.paths!.join("/");

      case "get_external_plugins":
      case "chat_list_conversations":
        return [];
      case "get_gateway_info":
        return { port: 0, token: "" };
      case "plugin:log|log":
      case "plugin:event|unlisten":
      case "plugin:event|emit":
      case "plugin:event|emit_to":
        return null;
      case "plugin:event|listen":
        return 1;

      default:
        if (cmd.startsWith("plugin:window|")) return cmd.endsWith("is_maximized") ? false : null;
        if (!unhandled.has(cmd)) {
          unhandled.add(cmd);
          console.warn("[perf-harness] unhandled IPC command", cmd);
        }
        return null;
    }
  },
  { shouldMockEvents: true }
);
