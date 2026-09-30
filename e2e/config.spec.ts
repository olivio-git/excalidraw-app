import { expect, openApp, test, WORKSPACE } from "./fixtures/app";

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
