import { test as base, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const MOCK = fileURLToPath(new URL("./tauri-mock.js", import.meta.url));

export const WORKSPACE = "/work";

/** A page running the app on a mocked Tauri backend, with `files` in the workspace. */
export async function openApp(page: Page, files: Record<string, string> = {}) {
  await page.addInitScript((initial) => {
    (window as unknown as { __files: Record<string, string> }).__files = { ...initial };
  }, files);
  await page.addInitScript({ path: MOCK });
  await page.goto("/");
  await page.waitForSelector("[data-part='primary'] [role=tab]", { timeout: 60_000 });
  await page.evaluate(async (root) => {
    const { useWorkspaceStore } = await import("/src/stores/workspaceStore.ts");
    useWorkspaceStore.getState().setWorkspaceDir(root);
  }, WORKSPACE);
}

export async function openFile(page: Page, filePath: string) {
  await page.evaluate(async (path) => {
    const { workbenchActions } = await import("/src/core/automation/workbench.ts");
    await workbenchActions.openFile({ filePath: path });
  }, filePath);
}

/** Run code against the flow editor store of an open `.flow3d` tab. */
export async function flowStore<T>(page: Page, filePath: string, body: string): Promise<T> {
  return page.evaluate(
    async ([path, source]) => {
      const { flow3dRegistry } = await import("/src/features/flow3d/flow3d-registry.ts");
      const store = flow3dRegistry.get(path)?.store;
      if (!store) throw new Error(`No editor for ${path}`);
      return new Function("s", source)(store);
    },
    [filePath, body] as const
  ) as Promise<T>;
}

/** What the terminal titled `title` shows (null when there is no such terminal). */
export async function terminalText(page: Page, title: string): Promise<string | null> {
  return page.evaluate(async (name) => {
    const { useTerminalStore, getTerminalSession } =
      await import("/src/features/terminal/terminal-service.ts");
    const info = useTerminalStore.getState().terminals.find((t) => t.title === name);
    const buffer = info && getTerminalSession(info.id)?.term.buffer.active;
    if (!buffer) return null;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++)
      lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
    return lines.join("\n");
  }, title);
}

export async function readFile(page: Page, filePath: string): Promise<string | undefined> {
  return page.evaluate(
    (path) => (window as unknown as { __files: Record<string, string> }).__files[path],
    filePath
  );
}

/** Fails the test on uncaught page errors. */
export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await use(errors);
      expect(errors, "uncaught errors in the page").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
