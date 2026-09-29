import { expect, flowStore, openApp, readFile, test, WORKSPACE } from "./fixtures/app";

const files = {
  [`${WORKSPACE}/notas.md`]:
    "# Pedidos\n\nEl pedido llega por el webhook.\n\n[Flujo](pedidos.flow3d)\n",
  [`${WORKSPACE}/pedidos.flow3d`]: JSON.stringify({
    type: "qori-flow3d",
    version: 1,
    nodes: [
      { id: "hook", kind: "trigger", label: "Webhook", position: [0, 0, 0] },
      {
        id: "check",
        kind: "condition",
        label: "¿Pedido válido?",
        position: [4.5, 0, 0],
        link: "/@workspace/notas.md",
      },
    ],
    edges: [{ id: "e", from: "hook", to: "check" }],
  }),
  [`${WORKSPACE}/src/app.ts`]: "export const pedido = 1;\n",
};

test.beforeEach(async ({ page }) => {
  await openApp(page, files);
});

test("finds text in notes, flows and code, and opens the flow on the step", async ({ page }) => {
  await page.keyboard.press("Control+Shift+F");
  const box = page.locator("[data-search-panel] input");
  await expect(box).toBeFocused();
  await box.fill("pedido");
  await expect(page.locator("[data-search-file]")).toHaveCount(3);
  await page.locator("[data-search-file='pedidos.flow3d'] [data-search-match]").first().click();
  await expect(page.locator("[data-flow3d-editor] canvas")).toBeAttached();
  await expect
    .poll(() =>
      flowStore<string | undefined>(
        page,
        `${WORKSPACE}/pedidos.flow3d`,
        "return s.getState().selection?.id"
      )
    )
    .toBe("check");
});

test("shows how files link to each other", async ({ page }) => {
  await page.evaluate(() =>
    (
      window as unknown as { __pluginManager: { executeCommand: (id: string) => Promise<void> } }
    ).__pluginManager.executeCommand("knowledgeGraph.open")
  );
  await expect(page.locator("[data-knowledge-graph]")).toContainText(/2 (files|archivos)/);
  await expect(page.locator("[data-graph-canvas] canvas")).toBeAttached();
});

test("creates a flow from a template", async ({ page }) => {
  await page.evaluate(() =>
    (
      window as unknown as { __pluginManager: { executeCommand: (id: string) => Promise<void> } }
    ).__pluginManager.executeCommand("templates.newFlow")
  );
  await page.locator("[data-template='flow-monitor']").click();
  await page.getByLabel(/File name|Nombre del archivo/).fill("monitor");
  await page.getByRole("button", { name: /^(Create|Crear)$/ }).click();
  await expect.poll(() => readFile(page, `${WORKSPACE}/monitor.flow3d`)).toContain('"schedule"');
  await expect(page.locator("[data-flow3d-editor]")).toBeVisible();
});
