import { describe, expect, it } from "vitest";
import {
  effectiveActivationEvents,
  hasUsableContributions,
  keyForPlatform,
  localize,
  parseContributions,
} from "./contributions";

const powershellLike = {
  contributes: {
    commands: [
      {
        command: "PowerShell.ShowSessionMenu",
        title: "%command.showSessionMenu%",
        category: "PowerShell",
      },
      { command: "broken" },
    ],
    keybindings: {
      command: "PowerShell.RunSelection",
      key: "f8",
      mac: "cmd+f8",
      when: "editorLangId == 'powershell'",
    },
    languages: [
      {
        id: "powershell",
        aliases: ["PowerShell", "pwsh"],
        extensions: [".ps1", ".psm1", ".psd1"],
        configuration: "./language-configuration.json",
      },
    ],
    grammars: [
      { language: "powershell", scopeName: "source.powershell", path: "./syntaxes/ps.json" },
    ],
    snippets: [{ language: "powershell", path: "./snippets/PowerShell.json" }],
    configuration: {
      title: "PowerShell",
      properties: {
        "powershell.codeFormatting.preset": {
          type: "string",
          default: "Custom",
          enum: ["Custom", "OTBS"],
        },
      },
    },
    viewsContainers: {
      activitybar: [{ id: "PowerShell", title: "%views.title%", icon: "media/pwsh.svg" }],
    },
    views: {
      PowerShell: [{ id: "PowerShellCommands", name: "Command Explorer" }],
      explorer: [{ id: "someWebview", name: "Preview", type: "webview" }],
    },
    menus: {
      "view/title": [
        {
          command: "PowerShell.RefreshCommandsExplorer",
          when: "view == PowerShellCommands",
          group: "navigation",
        },
      ],
    },
  },
};

describe("parseContributions", () => {
  const nls = {
    "command.showSessionMenu": "Show Session Menu",
    "views.title": { message: "PowerShell Extension" },
  };
  const parsed = parseContributions(powershellLike, nls);

  it("normalizes commands and resolves %nls% strings", () => {
    expect(parsed.commands).toEqual([
      {
        command: "PowerShell.ShowSessionMenu",
        title: "Show Session Menu",
        category: "PowerShell",
        icon: undefined,
      },
    ]);
  });

  it("accepts single objects where arrays are expected", () => {
    expect(parsed.keybindings).toHaveLength(1);
    expect(parsed.keybindings[0]).toMatchObject({ key: "f8", mac: "cmd+f8" });
  });

  it("keeps languages, grammars, snippets and configuration", () => {
    expect(parsed.languages[0]).toMatchObject({
      id: "powershell",
      extensions: [".ps1", ".psm1", ".psd1"],
    });
    expect(parsed.grammars[0].scopeName).toBe("source.powershell");
    expect(parsed.snippets[0]).toEqual({
      language: "powershell",
      path: "./snippets/PowerShell.json",
    });
    expect(parsed.configuration["powershell.codeFormatting.preset"]).toMatchObject({
      default: "Custom",
      enum: ["Custom", "OTBS"],
    });
  });

  it("flattens views with their container", () => {
    expect(parsed.viewsContainers.activitybar).toEqual([
      { id: "PowerShell", title: "PowerShell Extension", icon: "media/pwsh.svg" },
    ]);
    expect(parsed.views).toEqual([
      expect.objectContaining({ id: "PowerShellCommands", container: "PowerShell", type: "tree" }),
      expect.objectContaining({ id: "someWebview", container: "explorer", type: "webview" }),
    ]);
    expect(parsed.menus["view/title"][0].command).toBe("PowerShell.RefreshCommandsExplorer");
  });

  it("detects usable contributions", () => {
    expect(hasUsableContributions(parsed)).toBe(true);
    expect(hasUsableContributions(parseContributions({}))).toBe(false);
  });

  it("infers activation events from contributions like VS Code 1.74+", () => {
    const events = effectiveActivationEvents(["onStartupFinished"], parsed);
    expect(events).toEqual(
      expect.arrayContaining([
        "onStartupFinished",
        "onCommand:PowerShell.ShowSessionMenu",
        "onView:PowerShellCommands",
        "onLanguage:powershell",
      ])
    );
  });
});

describe("helpers", () => {
  it("picks the platform-specific key", () => {
    const binding = { command: "x", key: "ctrl+k", mac: "cmd+k" };
    expect(keyForPlatform(binding, "mac")).toBe("cmd+k");
    expect(keyForPlatform(binding, "linux")).toBe("ctrl+k");
  });

  it("leaves unknown nls keys untouched", () => {
    expect(localize("%missing%", {})).toBe("%missing%");
    expect(localize("plain", {})).toBe("plain");
  });
});
