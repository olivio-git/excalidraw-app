import { expect, openApp, test } from "./fixtures/app";

// A theme extension as the app stores it after installing a .vsix.
const extension = {
  id: "demo.night-owl-lite",
  version: "1.0.0",
  displayName: "Night Owl Lite",
  dir: "demo.night-owl-lite-1.0.0",
  iconThemes: [],
  colorThemes: [
    { id: "night-lite", label: "Night Lite", uiTheme: "vs-dark", path: "./themes/night.json" },
  ],
  contributions: {},
  activationEvents: [],
};
const files = {
  "extensions/extensions.json": JSON.stringify([extension]),
  "extensions/demo.night-owl-lite-1.0.0/themes/night.json": JSON.stringify({
    name: "Night Lite",
    type: "dark",
    colors: {
      "editor.background": "#011627",
      "editor.foreground": "#d6deeb",
      "sideBar.background": "#01111d",
      focusBorder: "#7e57c2",
    },
    tokenColors: [],
  }),
};

const activeKey = (page: import("@playwright/test").Page) =>
  page.evaluate(async () => {
    const { getColorThemeState } = await import("/src/plugins/vscode/color-theme-service.ts");
    return getColorThemeState().activeKey;
  });

test("installed color themes are listed in the gear menu and can be picked", async ({ page }) => {
  await openApp(page, files);
  await page
    .getByRole("button", { name: "Settings" })
    .or(page.getByRole("button", { name: "Configuración" }))
    .last()
    .click();
  await page.locator('[data-slot="dropdown-menu-sub-trigger"]', { hasText: /Tema|Theme/ }).click();
  const item = page.locator('[data-color-theme="demo.night-owl-lite/night-lite"]');
  await expect(item).toContainText("Night Lite");
  await item.click();
  await expect.poll(() => activeKey(page)).toBe("demo.night-owl-lite/night-lite");
  // The theme's colors are applied to the app.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.cssText.length))
    .toBeGreaterThan(0);

  // Light/Dark go back to the app's own theme.
  await page
    .getByRole("button", { name: "Settings" })
    .or(page.getByRole("button", { name: "Configuración" }))
    .last()
    .click();
  await page.locator('[data-slot="dropdown-menu-sub-trigger"]', { hasText: /Tema|Theme/ }).click();
  await page.getByRole("menuitem", { name: /Light|Claro/ }).click();
  await expect.poll(() => activeKey(page)).toBeNull();
});

test("config.toml can pick an installed theme by name", async ({ page }) => {
  await openApp(page, {
    ...files,
    "/appdata/.config/qori/config.toml": '[appearance]\ncolor_theme = "night lite"\n',
  });
  await expect.poll(() => activeKey(page)).toBe("demo.night-owl-lite/night-lite");
});
