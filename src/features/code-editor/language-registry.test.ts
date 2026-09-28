import { describe, expect, it } from "vitest";
import { languages } from "@codemirror/language-data";
import { emptyContributions } from "@/plugins/vscode/contributions";
import { LanguageRegistry, globToRegExp, vscodeLanguageId } from "./language-registry";

function extensionWith(languagesList: ReturnType<typeof emptyContributions>["languages"]) {
  return { id: "acme.lang", contributions: { ...emptyContributions(), languages: languagesList } };
}

describe("LanguageRegistry", () => {
  it("knows common languages without any extension", () => {
    const registry = new LanguageRegistry(languages);
    expect(registry.resolve("/w/app.ts")).toBe("typescript");
    expect(registry.resolve("script.py")).toBe("python");
    expect(registry.resolve("C:\\x\\Profile.ps1")).toBe("powershell");
    expect(registry.resolve("main.cpp")).toBe("cpp");
    expect(registry.resolve("notes.txt")).toBe("plaintext");
    expect(registry.resolve("LICENSE")).toBe("plaintext");
    expect(registry.resolve("image.png")).toBeNull();
  });

  it("adds extension languages and extends existing ones", () => {
    const registry = new LanguageRegistry(languages);
    registry.rebuild([
      extensionWith([
        { id: "bicep", aliases: ["Bicep"], extensions: [".bicep"] },
        { id: "powershell", extensions: [".pssc"], filenames: ["profile.ps"] },
      ]),
    ]);
    expect(registry.resolve("main.bicep")).toBe("bicep");
    expect(registry.get("bicep")?.name).toBe("Bicep");
    expect(registry.resolve("session.pssc")).toBe("powershell");
    expect(registry.resolve("/home/u/profile.ps")).toBe("powershell");
    // The built-in parser is kept for the extended language.
    expect(registry.get("powershell")?.codemirror).toBeDefined();
    expect(registry.get("powershell")?.contributedBy).toEqual(["acme.lang"]);
  });

  it("prefers the longest extension and supports filename patterns and first lines", () => {
    const registry = new LanguageRegistry([]);
    registry.rebuild([
      extensionWith([
        { id: "ts", extensions: [".ts"] },
        { id: "dts", extensions: [".d.ts"] },
        { id: "compose", filenamePatterns: ["docker-compose.*.yml"] },
        { id: "shebang", firstLine: "^#!.*\\bnode\\b" },
      ]),
    ]);
    expect(registry.resolve("types.d.ts")).toBe("dts");
    expect(registry.resolve("docker-compose.prod.yml")).toBe("compose");
    expect(registry.resolve("run", "#!/usr/bin/env node")).toBe("shebang");
  });

  it("notifies subscribers on rebuild", () => {
    const registry = new LanguageRegistry([]);
    let calls = 0;
    registry.subscribe(() => calls++);
    registry.rebuild([]);
    expect(calls).toBe(1);
  });
});

describe("helpers", () => {
  it("maps language-data names to VS Code ids", () => {
    expect(vscodeLanguageId("C++")).toBe("cpp");
    expect(vscodeLanguageId("C#")).toBe("csharp");
    expect(vscodeLanguageId("Shell")).toBe("shellscript");
    expect(vscodeLanguageId("PowerShell")).toBe("powershell");
  });

  it("converts globs", () => {
    expect(globToRegExp("*.config.js").test("vite.config.js")).toBe(true);
    expect(globToRegExp("**/.vscode/*.json").test("a/b/.vscode/settings.json")).toBe(true);
    expect(globToRegExp("file?.txt").test("file10.txt")).toBe(false);
  });
});
