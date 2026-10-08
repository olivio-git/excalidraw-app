import { expect, openApp, terminalText, test } from "./fixtures/app";

type Chunk = Record<string, unknown>;

/** A tool call the fake model makes, as stream chunks. */
const toolCall = (id: string, name: string, input: unknown): Chunk[] => [
  { type: "tool_use_start", toolCallId: id, toolName: name },
  { type: "tool_use_delta", toolCallId: id, delta: JSON.stringify(input) },
  { type: "tool_use_stop", toolCallId: id },
  { type: "done" },
];

const reply = (text: string): Chunk[] => [{ type: "text_delta", delta: text }, { type: "done" }];

/** Open the chat with a fake model that answers each turn with the next list of chunks. */
async function chatWithFakeModel(page: import("@playwright/test").Page, turns: Chunk[][]) {
  await page.evaluate(async (script) => {
    const { useAISettingsStore } = await import("/src/features/settings/ai/ai-settings-store.ts");
    const state = useAISettingsStore.getState();
    const provider = state.activeProvider;
    useAISettingsStore.setState({
      providers: { ...state.providers, [provider]: { ...state.providers[provider], apiKey: "k" } },
    });
    const { AIProviderFactory } = await import("/src/features/ai-chat/providers/factory.ts");
    const calls: unknown[] = [];
    (window as unknown as { __aiCalls: unknown[] }).__aiCalls = calls;
    let turn = 0;
    AIProviderFactory.create = async () => ({
      name: "anthropic",
      async *stream(messages, _system, _tools, _config, signal) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        calls.push(messages);
        for (const chunk of script[Math.min(turn++, script.length - 1)]) yield chunk as never;
      },
    });
  }, turns);
}

async function ask(page: import("@playwright/test").Page, text: string) {
  await page.evaluate(async (prompt) => {
    const { openAgent } = await import("/src/features/ai-chat/open-agent.ts");
    openAgent({ prompt, send: true });
  }, text);
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("the agent runs a command the user approves, in a terminal the user sees", async ({
  page,
}) => {
  await chatWithFakeModel(page, [
    toolCall("c1", "terminal_run", { command: "echo hola" }),
    reply("Listo, el comando respondió hola."),
  ]);
  await ask(page, "comprueba que la terminal funciona");

  // Every command asks, showing exactly what will run; there is no "allow always".
  // (The chat speaks the app language: English in the tests.)
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("echo hola");
  await expect(dialog.getByRole("button", { name: "Allow Always" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Allow Once" }).click();

  await expect
    .poll(() => terminalText(page, "Agente"))
    .toMatch(/\$ echo hola\s+hola\s+✓ Terminó bien/);
  const chat = page.locator("[data-ai-chat]");
  await expect(chat).toContainText("Listo, el comando respondió hola.");

  // The chip opens to show what the agent sent and what came back.
  await chat.getByRole("button", { name: /Running in the terminal/ }).click();
  await expect(chat).toContainText("command: echo hola");
  await expect(chat).toContainText("code: 0");

  // The model got the output.
  const second = await page.evaluate(() =>
    JSON.stringify((window as unknown as { __aiCalls: unknown[] }).__aiCalls[1])
  );
  expect(second).toContain("hola");
});

test("stopping the chat stops the command", async ({ page }) => {
  await chatWithFakeModel(page, [
    toolCall("c1", "terminal_run", { command: "sleep 30" }),
    reply("no debería llegar"),
  ]);
  await ask(page, "deja algo corriendo");
  await page.getByRole("dialog").getByRole("button", { name: "Allow Once" }).click();
  await expect.poll(() => terminalText(page, "Agente")).toContain("$ sleep 30");

  await page.locator("[data-ai-chat]").getByTitle("Stop generation").click();
  await expect.poll(() => terminalText(page, "Agente")).toContain("■ Detenido");
  const kills = await page.evaluate(() => (window as unknown as { __kills?: string[] }).__kills);
  expect(kills).toHaveLength(1);
});

test("a denied command never runs", async ({ page }) => {
  await chatWithFakeModel(page, [toolCall("c1", "terminal_run", { command: "echo nunca" })]);
  await ask(page, "intenta algo");
  await page.getByRole("dialog").getByRole("button", { name: "Deny" }).click();
  const chat = page.locator("[data-ai-chat]");
  await expect(chat).toContainText("Action denied by user.");
  const commands = await page.evaluate(
    () => (window as unknown as { __commands?: unknown[] }).__commands ?? []
  );
  expect(commands).toEqual([]);
});
