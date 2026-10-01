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

test("markdown = code opens .md like config.toml, with a live preview beside it", async ({
  page,
}) => {
  await openApp(page, {
    [CONFIG]: '[editor]\nmarkdown = "code"\n',
    [`${WORKSPACE}/guia.md`]: "# Guía\n\n- uno\n- dos\n",
  });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { markdownRouteId } = await import("/src/stores/editorPreferencesStore.ts");
        return markdownRouteId();
      })
    )
    .toBe("code-editor");
  await openFile(page, `${WORKSPACE}/guia.md`);
  const editor = page.locator("[data-code-editor] .cm-content");
  await expect(editor).toContainText("# Guía");
  await expect(page.locator("[data-code-editor] .cm-lineNumbers")).toBeVisible();

  await page.locator("[data-open-preview]").click();
  const preview = page.locator("[data-markdown-preview]");
  await expect(preview.locator("h1")).toHaveText("Guía");
  await expect(preview.locator("li")).toHaveCount(2);

  // Typing in the editor updates the preview before autosave.
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("- tres");
  await expect(preview.locator("li")).toHaveCount(3);
});

test("editor and preview scroll together", async ({ page }) => {
  const sections = Array.from(
    { length: 40 },
    (_, i) => `## Sección ${i + 1}\n\nTexto de la sección ${i + 1}.\n\n- punto a\n- punto b\n`
  ).join("\n");
  const file = `${WORKSPACE}/larga.md`;
  await openApp(page, {
    [CONFIG]: '[editor]\nmarkdown = "code"\n',
    [file]: `# Larga\n\n${sections}`,
  });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { markdownRouteId } = await import("/src/stores/editorPreferencesStore.ts");
        return markdownRouteId();
      })
    )
    .toBe("code-editor");
  await openFile(page, file);
  await expect(page.locator("[data-code-editor] .cm-content")).toContainText("Sección 1");
  await page.locator("[data-open-preview]").click();
  const preview = page.locator("[data-markdown-preview]");
  await expect(preview.locator("h2").first()).toBeVisible();

  // Distance from the top of the preview to a heading.
  const headingOffset = (n: number) =>
    preview.evaluate((container, title) => {
      const heading = [...container.querySelectorAll("h2")].find((h) => h.textContent === title);
      return heading!.getBoundingClientRect().top - container.getBoundingClientRect().top;
    }, `Sección ${n}`);

  // Editor → preview: put "## Sección 30" at the top of the editor.
  await page.evaluate(async (path) => {
    const { codeEditorRegistry } =
      await import("/src/features/code-editor/code-editor-registry.ts");
    const view = codeEditorRegistry.get(path)!.getView()!;
    const doc = view.state.doc;
    let line = 1;
    for (; line <= doc.lines; line++) if (doc.line(line).text === "## Sección 30") break;
    const block = view.lineBlockAt(doc.line(line).from);
    const scroller = view.scrollDOM;
    scroller.scrollTop += block.top - (scroller.getBoundingClientRect().top - view.documentTop);
  }, file);
  await expect.poll(() => headingOffset(30)).toBeLessThan(60);
  expect(await headingOffset(30)).toBeGreaterThan(-60);

  // Preview → editor: scroll the preview to "Sección 10".
  await preview.evaluate((container) => {
    const heading = [...container.querySelectorAll("h2")].find(
      (h) => h.textContent === "Sección 10"
    )!;
    container.scrollTop +=
      heading.getBoundingClientRect().top - container.getBoundingClientRect().top;
  });
  // The editor's top line is the heading (give or take a pixel of rounding).
  await expect
    .poll(() =>
      page.evaluate(async (path) => {
        const { codeEditorRegistry } =
          await import("/src/features/code-editor/code-editor-registry.ts");
        const view = codeEditorRegistry.get(path)!.getView()!;
        const doc = view.state.doc;
        let heading = 1;
        for (; heading <= doc.lines; heading++)
          if (doc.line(heading).text === "## Sección 10") break;
        const height = view.scrollDOM.getBoundingClientRect().top - view.documentTop;
        const top = doc.lineAt(view.lineBlockAtHeight(Math.max(0, height)).from).number;
        return Math.abs(top - heading);
      }, file)
    )
    .toBeLessThanOrEqual(1);
});

test("code blocks in the preview are colored like the editor", async ({ page }) => {
  const file = `${WORKSPACE}/codigo.md`;
  await openApp(page, {
    [CONFIG]: '[editor]\nmarkdown = "code"\n',
    [file]: '# Código\n\n```javascript\nfunction test() {\n  return "hola"; // saludo\n}\n```\n',
  });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { markdownRouteId } = await import("/src/stores/editorPreferencesStore.ts");
        return markdownRouteId();
      })
    )
    .toBe("code-editor");
  await openFile(page, file);
  await page.locator("[data-open-preview]").click();
  const block = page.locator('[data-markdown-preview] [data-code-block="javascript"]');
  await expect(block.locator(".tok-keyword").first()).toHaveText("function");
  await expect(block.locator(".tok-string")).toHaveText('"hola"');
  await expect(block.locator(".tok-comment")).toHaveText("// saludo");
});
