import { expect, openApp, openFile, test, WORKSPACE } from "./fixtures/app";

// The mocked backend resolves the home folder to /appdata.
const CONFIG = "/appdata/.config/qori/config.toml";

test("applies config.toml and follows edits", async ({ page }) => {
  await openApp(page, {
    [CONFIG]: '[appearance]\ntheme = "dark"\ntranslucency = "transparent"\naccent = "#7c3aed"\n',
    [`${WORKSPACE}/a.md`]: "# Nota A\n\ntexto",
  });
  const root = page.locator("html");
  await expect(root).toHaveClass(/qori-translucent/);
  await expect(root).toHaveClass(/dark/);
  expect(
    await page.evaluate(() => document.documentElement.style.getPropertyValue("--primary"))
  ).toBe("262 83% 58%");

  // Edit the file (as the watcher would report) → applied again; a typo keeps the last good values.
  await page.evaluate(async (path) => {
    const files = (window as unknown as { __files: Record<string, string> }).__files;
    files[path] = '[appearance]\ntranslucency = "none"\n';
    const { reloadConfig } = await import("/src/core/config/user-config.ts");
    await reloadConfig();
    files[path] = '[appearance]\ntranslucency = "wallpaper\n';
    await reloadConfig();
  }, CONFIG);
  await expect(root).not.toHaveClass(/qori-translucent/);
  const issues = await page.evaluate(async () => {
    const { useConfigStore } = await import("/src/core/config/config-store.ts");
    return useConfigStore.getState().issues.map((i) => i.message);
  });
  expect(issues[0]).toContain("línea 2");
});

test("lists every note by date in the Notes view", async ({ page }) => {
  await openApp(page, {
    [`${WORKSPACE}/Blog/post.md`]:
      "---\ntags: [CSS]\nstatus: active\n---\n# Post del blog\n\nPrimer párrafo",
    [`${WORKSPACE}/idea.md`]: "# Una idea\n\nalgo",
  });
  await page.evaluate(async () => {
    const { useLayoutStore } = await import("/src/core/layout/layout-store.ts");
    useLayoutStore.getState().showView("notes");
  });
  const titles = page.locator("[data-notes-panel] [data-note-title]");
  await expect(titles).toHaveCount(2);
  await expect(page.locator("[data-notes-panel]")).toContainText("CSS");
  await page.locator("[data-notes-panel] input[data-panel-search]").fill("blog");
  await expect(titles).toHaveCount(1);
  await expect(titles.first()).toHaveText("Post del blog");
});

test("edits with Vim keys when config.toml asks for it", async ({ page }) => {
  await openApp(page, {
    [CONFIG]: '[editor]\nkeymap = "vim"\n',
    "/appdata/.config/qori/vimrc": "inoremap jk <Esc>\n",
    [`${WORKSPACE}/codigo.txt`]: "uno\ndos\ntres\n",
  });
  await openFile(page, `${WORKSPACE}/codigo.txt`);
  const content = page.locator(".cm-content").first();
  await content.click();
  await expect(page.locator(".cm-vim-panel")).toBeVisible();
  // Normal mode: gg, dd deletes the first line; i…jk inserts and leaves insert mode.
  await page.keyboard.type("ggdd");
  await expect(content).not.toContainText("uno");
  await page.keyboard.type("iHola jk");
  await expect(content).toContainText("Hola dos");
  // Back in normal mode the cursor sits on the space (like Vim): x deletes it.
  await page.keyboard.type("x");
  await expect(content).toContainText("Holados");
});

test("Markdown uses the whole width unless content_width = readable", async ({ page }) => {
  await openApp(page, { [`${WORKSPACE}/nota.md`]: "# Nota\n\ntexto" });
  await page.evaluate(async () => {
    const { useEditorPreferencesStore } = await import("/src/stores/editorPreferencesStore.ts");
    useEditorPreferencesStore.getState().setMarkdownEditor("markdown");
  });
  await openFile(page, `${WORKSPACE}/nota.md`);
  const content = page.locator(".cm-content").first();
  await expect(content).toContainText("texto");
  expect(await content.evaluate((el) => getComputedStyle(el).maxWidth)).toBe("none");
});
