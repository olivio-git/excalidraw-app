import { describe, expect, it } from "vitest";
import {
  configCompletions,
  configProblems,
  keymapCompletions,
  keymapProblems,
  optionDoc,
  sectionAt,
  vimrcCompletions,
  vimrcProblems,
} from "./config-intellisense";

const labels = (result: ReturnType<typeof configCompletions>) =>
  result?.options.map((o) => o.label) ?? [];

describe("config.toml suggestions", () => {
  it("knows the section of a line", () => {
    const text = '[appearance]\ntheme = "dark"\n\n[editor]\nkey';
    expect(sectionAt(text, text.length)).toBe("editor");
    expect(sectionAt(text, 15)).toBe("appearance");
  });

  it("suggests sections after [", () => {
    expect(labels(configCompletions("[", 1, "["))).toEqual(
      expect.arrayContaining(["appearance", "editor", "notes", "flow3d"])
    );
  });

  it("suggests the options of the current section, with their default", () => {
    const text = "[editor]\nmi";
    const result = configCompletions(text, text.length, "mi");
    expect(result?.from).toBe(text.length - 2);
    const minimap = result?.options.find((o) => o.label === "minimap");
    expect(minimap?.apply).toBe("minimap = true");
    expect(minimap?.detail).toBe("true | false");
  });

  it("suggests the accepted values after =", () => {
    const text = '[appearance]\ntranslucency = "wa';
    const result = configCompletions(text, text.length, 'translucency = "wa');
    expect(labels(result)).toEqual(['"none"', '"native"', '"transparent"', '"wallpaper"']);
    expect(result?.options[3].apply).toBe('wallpaper"');
  });

  it("documents an option", () => {
    expect(optionDoc("editor", "keymap")).toContain("vim");
    expect(optionDoc("editor", "nope")).toBeNull();
  });
});

describe("problems on their line", () => {
  it("points at the wrong option", () => {
    const problems = configProblems('[appearance]\ntheme = "pink"\nopacity = 9\nfoo = 1\n');
    expect(problems).toEqual([
      expect.objectContaining({ line: 2, severity: "error" }),
      expect.objectContaining({ line: 3, severity: "warning" }),
      expect.objectContaining({ line: 4, message: expect.stringContaining("foo") }),
    ]);
  });

  it("reports syntax errors with their line", () => {
    expect(configProblems('[editor]\nkeymap = "vim\n')[0]).toMatchObject({ line: 2 });
  });

  it("keymap: unknown commands and missing fields", () => {
    const commands = () => [{ id: "config.open", name: "Abrir" }];
    const problems = keymapProblems(
      '[[bind]]\nkey = "ctrl+k"\ncommand = "nope.cmd"\n\n[[bind]]\ncommand = "config.open"\n',
      commands
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ line: 3, message: expect.stringContaining("nope.cmd") }),
        expect.objectContaining({ line: 5, message: expect.stringContaining("key") }),
      ])
    );
  });

  it("vimrc: unsupported lines", () => {
    expect(vimrcProblems("set number\n")[0]).toMatchObject({ line: 1, severity: "warning" });
  });
});

describe("keymap.toml and vimrc suggestions", () => {
  const commands = () => [
    { id: "config.open", name: "Preferencias: Abrir config.toml" },
    { id: "workbench.action.toggleAgent", name: "IA: Abrir/cerrar el agente" },
  ];
  it("suggests the app's commands", () => {
    const line = 'command = "work';
    const result = keymapCompletions(line.length, line, commands);
    expect(result?.options.map((o) => o.label)).toContain("workbench.action.toggleAgent");
    expect(result?.options[1].apply).toBe('workbench.action.toggleAgent"');
  });
  it("suggests :qori commands and map commands in vimrc", () => {
    const line = "nnoremap <Space>a :qori work";
    expect(vimrcCompletions(line.length, line, commands)?.from).toBe(line.length - 4);
    expect(vimrcCompletions(3, "nno", commands)?.options.map((o) => o.label)).toContain("nnoremap");
  });
});
