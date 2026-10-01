import { expect, flowStore, openApp, openFile, readFile, test, WORKSPACE } from "./fixtures/app";

const FLOW = `${WORKSPACE}/informe.flow3d`;

const flowFile = JSON.stringify({
  type: "qori-flow3d",
  version: 1,
  name: "Informe",
  nodes: [
    {
      id: "start",
      kind: "trigger",
      label: "Inicio",
      position: [0, 0, 0],
      config: { type: "manual", payload: '{"items": ["a", "b"]}' },
    },
    {
      id: "each",
      kind: "action",
      label: "Por cada uno",
      position: [4.5, 0, 0],
      config: { type: "command", command: "echo {{item}}", forEach: "items" },
    },
    {
      id: "save",
      kind: "output",
      label: "Guardar",
      position: [9, 0, 0],
      config: { type: "writeNote", path: "salida.md", content: "{{input}}" },
    },
  ],
  edges: [
    { id: "e1", from: "start", to: "each" },
    { id: "e2", from: "each", to: "save" },
  ],
});

test.beforeEach(async ({ page }) => {
  await openApp(page, { [FLOW]: flowFile });
  await openFile(page, FLOW);
  await expect(page.locator("[data-flow3d-editor] canvas")).toBeAttached();
});

test("simulates the flow on the timeline", async ({ page }) => {
  await page.getByRole("button", { name: /Reproducir/ }).click();
  await expect
    .poll(() => flowStore<number>(page, FLOW, "return s.getState().clock.time"))
    .toBeGreaterThan(0.5);
  await flowStore(page, FLOW, "s.getState().pause()");
});

test("executes for real, passing data between steps", async ({ page }) => {
  await page.getByRole("radio", { name: "Ejecutar" }).click();
  await page.locator("[data-flow3d-execute]").click();
  // Steps with side effects ask first.
  await page.getByRole("button", { name: "Ejecutar" }).last().click();
  await expect(page.locator("[data-flow3d-run-status='done']")).toBeVisible();

  const commands = await page.evaluate(() =>
    (window as unknown as { __commands: Array<{ command: string }> }).__commands.map(
      (c) => c.command
    )
  );
  expect(commands).toEqual(["echo a", "echo b"]);
  expect(await readFile(page, `${WORKSPACE}/salida.md`)).toContain('"stdout": "a\\n"');

  // The inspector shows what went in and out of a step.
  await flowStore(page, FLOW, "s.getState().select({ type: 'node', id: 'each' })");
  await page.getByRole("radio", { name: "Datos" }).click();
  await expect(page.locator("[data-step-data='done']")).toContainText('"stdout": "b\\n"');
  // …and the run is in the history.
  await expect
    .poll(() => flowStore<number>(page, FLOW, "return s.getState().history.length"))
    .toBe(1);
});

test("marks a failing step and stops its branch", async ({ page }) => {
  await flowStore(
    page,
    FLOW,
    "s.getState().updateNode('each', { config: { type: 'command', command: 'nope' } })"
  );
  await page.getByRole("radio", { name: "Ejecutar" }).click();
  await page.locator("[data-flow3d-execute]").click();
  await page.getByRole("button", { name: "Ejecutar" }).last().click();
  await expect(page.locator("[data-flow3d-run-status='error']")).toContainText("Por cada uno");
  const steps = await flowStore<Record<string, string>>(
    page,
    FLOW,
    "return Object.fromEntries(Object.entries(s.getState().run.steps).map(([k, v]) => [k, v.status]))"
  );
  expect(steps).toEqual({ start: "done", each: "error", save: "skipped" });
});

test("adds a connected step with Tab", async ({ page }) => {
  // Click the scene (focuses it for the keyboard), then pick the step to add after.
  await page
    .locator("[data-flow3d-editor] canvas")
    .first()
    .click({ position: { x: 40, y: 600 } });
  await flowStore(page, FLOW, "s.getState().select({ type: 'node', id: 'save' })");
  await page.keyboard.press("Tab");
  await expect(page.locator("[data-flow3d-search='add']")).toBeVisible();
  await page.keyboard.type("http");
  await page.keyboard.press("Enter");
  const added = await flowStore<[string, string | undefined, boolean]>(
    page,
    FLOW,
    `const d = s.getState().doc; const n = d.nodes.at(-1);
     return [n.label, n.config?.type, d.edges.some((e) => e.from === "save" && e.to === n.id)];`
  );
  expect(added).toEqual(["Petición HTTP", "http", true]);
});

test("asks the agent (right side bar) to change the open flow", async ({ page }) => {
  // The chat shows its input once a provider has a key.
  await page.evaluate(async () => {
    const { useAISettingsStore } = await import("/src/features/settings/ai/ai-settings-store.ts");
    const state = useAISettingsStore.getState();
    const provider = state.activeProvider;
    useAISettingsStore.setState({
      providers: { ...state.providers, [provider]: { ...state.providers[provider], apiKey: "k" } },
    });
  });
  await page.getByRole("button", { name: /Crear o cambiar con el agente/ }).click();
  const chat = page.locator("[data-panel='secondary'] [data-ai-chat]");
  const input = chat.locator("[data-ai-chat-input]");
  await expect(input).toHaveValue("Cambia este flujo para que ");
  await expect(input).toBeFocused();
  // The agent knows which flow "this flow" is.
  await expect(chat).toContainText("informe");
});

test("the inspector is a window you can drag, resize and use to restyle a node", async ({
  page,
}) => {
  await flowStore(page, FLOW, 's.getState().select({ type: "node", id: "each" })');
  const panel = page.locator('[data-floating-panel="inspector"]');
  await expect(panel).toBeVisible();
  const before = (await panel.boundingBox())!;

  // Drag by the title bar.
  const title = panel.locator("[data-panel-titlebar]");
  const t = (await title.boundingBox())!;
  await page.mouse.move(t.x + 40, t.y + t.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x - 260, t.y + 80, { steps: 8 });
  await page.mouse.up();
  const moved = (await panel.boundingBox())!;
  expect(moved.x).toBeLessThan(before.x - 200);
  expect(moved.y).toBeGreaterThan(before.y + 50);

  // Resize from the corner.
  const grip = (await panel.locator("[data-panel-resize]").boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 120, grip.y + 60, { steps: 8 });
  await page.mouse.up();
  expect((await panel.boundingBox())!.width).toBeGreaterThan(moved.width + 80);

  // Appearance: turn the step into a glowing sphere with an icon.
  await panel.getByRole("combobox", { name: "Forma" }).click();
  await page.getByRole("option", { name: "Esfera" }).click();
  await panel.getByPlaceholder("🧠  DB  ⚙️").fill("⚙️");
  await expect
    .poll(() =>
      flowStore<unknown>(
        page,
        FLOW,
        'return s.getState().doc.nodes.find((n) => n.id === "each").style'
      )
    )
    .toMatchObject({ shape: "sphere", icon: "⚙️" });
});
