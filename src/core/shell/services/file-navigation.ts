import { dirname, join, normalize } from "@tauri-apps/api/path";
import { exists } from "@tauri-apps/plugin-fs";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { otherGroup } from "@/core/tabs/store/editor-layout";
import type { EditorGroupId } from "@/core/tabs/types";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { fileHandlerRegistry } from "../panels/file-handler-registry";
import i18n from "@/core/i18n/i18n";

interface OpenFileOptions {
  beside?: boolean;
  groupId?: EditorGroupId;
  anchor?: string;
}

/** Root-relative syntax survives standard Markdown/Tiptap link sanitizers. */
export function createFileReference(filePath: string, workspaceDir: string | null): string {
  const path = filePath.replaceAll("\\", "/");
  const root = workspaceDir?.replaceAll("\\", "/").replace(/\/$/, "");
  if (root && path.startsWith(`${root}/`))
    return `/@workspace/${path
      .slice(root.length + 1)
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
  return `/@file/${encodeURIComponent(filePath)}`;
}

export function openFileInWorkbench(
  filePath: string,
  options: OpenFileOptions = {}
): string | null {
  const name = filePath.split(/[\\/]/).pop() ?? filePath;
  const handler = fileHandlerRegistry.resolve(name);
  if (!handler) return null;
  const store = useTabStore.getState();
  const source = options.groupId ?? store.activeGroupId;
  const tabId = store.addTab({
    routeId: handler.routeId,
    path: `/${handler.routeId}`,
    title: handler.displayName?.(name) ?? name,
    instanceId: filePath,
    metadata: { filePath },
    groupId: options.beside ? otherGroup(source) : options.groupId,
  });
  if (options.anchor) {
    const tab = useTabStore.getState().getTab(tabId);
    store.updateTab(tabId, {
      metadata: {
        ...tab?.metadata,
        navigationAnchor: { text: options.anchor, id: crypto.randomUUID() },
      },
    });
  }
  return tabId;
}

export function isLocalFileReference(href: string): boolean {
  return (
    href.startsWith("#") ||
    /^(workspace:|file:|[a-z]:[\\/])/i.test(href) ||
    (!/^[a-z][a-z\d+.-]*:/i.test(href) && !href.startsWith("//"))
  );
}

export async function resolveFileReference(
  href: string,
  sourcePath: string,
  workspaceDir: string | null
): Promise<{ filePath: string; anchor: string }> {
  const hash = href.indexOf("#");
  let raw = hash < 0 ? href : href.slice(0, hash);
  const anchor = hash < 0 ? "" : decodeURIComponent(href.slice(hash + 1));
  if (!raw) return { filePath: sourcePath, anchor };
  if (!isLocalFileReference(raw)) throw new Error(i18n.t("tabs:workbench.unsupportedReference"));
  if (raw.startsWith("/@file/")) {
    raw = decodeURIComponent(raw.slice("/@file/".length));
  } else if (raw.startsWith("/@workspace/")) {
    if (!workspaceDir) throw new Error(i18n.t("tabs:workbench.noWorkspace"));
    raw = await join(workspaceDir, decodeURIComponent(raw.slice("/@workspace/".length)));
  } else if (raw.startsWith("file:")) {
    const url = new URL(raw);
    raw = decodeURIComponent(url.pathname);
    if (url.hostname) raw = `//${url.hostname}${raw}`;
    if (/^\/[a-z]:\//i.test(raw)) raw = raw.slice(1);
  } else if (raw.startsWith("workspace:")) {
    if (!workspaceDir) throw new Error(i18n.t("tabs:workbench.noWorkspace"));
    raw = await join(
      workspaceDir,
      decodeURIComponent(raw.slice("workspace:".length).replace(/^[/\\]+/, ""))
    );
  } else {
    raw = decodeURIComponent(raw);
    if (!/^(\/|[a-z]:[\\/])/i.test(raw)) raw = await join(await dirname(sourcePath), raw);
  }
  return { filePath: await normalize(raw), anchor };
}

export async function openFileReference(
  href: string,
  sourcePath: string,
  options: OpenFileOptions = {}
): Promise<void> {
  const target = await resolveFileReference(
    href,
    sourcePath,
    useWorkspaceStore.getState().workspaceDir
  );
  if (!(await exists(target.filePath)))
    throw new Error(i18n.t("tabs:workbench.missingFile", { path: target.filePath }));
  if (!openFileInWorkbench(target.filePath, { ...options, anchor: target.anchor }))
    throw new Error(i18n.t("tabs:workbench.unsupportedReference"));
}
