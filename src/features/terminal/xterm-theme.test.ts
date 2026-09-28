import { describe, expect, it } from "vitest";
import { buildXtermTheme, hslTripletToHex } from "./xterm-theme";

describe("hslTripletToHex", () => {
  it("converts the app's CSS variable format", () => {
    expect(hslTripletToHex("0 0% 100%")).toBe("#ffffff");
    expect(hslTripletToHex("0 0% 0%")).toBe("#000000");
    expect(hslTripletToHex("0 100% 50%")).toBe("#ff0000");
    expect(hslTripletToHex(" 120 100% 25% ")).toBe("#008000");
  });

  it("rejects other formats", () => {
    expect(hslTripletToHex("#fff")).toBeNull();
    expect(hslTripletToHex("")).toBeNull();
  });
});

describe("buildXtermTheme", () => {
  const vars: Record<string, string> = { "--background": "0 0% 100%", "--foreground": "0 0% 0%" };
  const cssVar = (name: string) => vars[name] ?? "";

  it("falls back to the app colors and the default ANSI palette", () => {
    const theme = buildXtermTheme(cssVar, false, {});
    expect(theme.background).toBe("#ffffff");
    expect(theme.foreground).toBe("#000000");
    expect(theme.red).toBe("#cd3131");
    expect(theme.green).toBe("#00bc00");
  });

  it("prefers the VS Code theme's terminal colors", () => {
    const theme = buildXtermTheme(cssVar, true, {
      "terminal.background": "#101010",
      "terminal.foreground": "#eeeeee",
      "terminal.ansiBrightBlue": "#123456",
      "terminalCursor.foreground": "#ff00ff",
    });
    expect(theme.background).toBe("#101010");
    expect(theme.foreground).toBe("#eeeeee");
    expect(theme.brightBlue).toBe("#123456");
    expect(theme.cursor).toBe("#ff00ff");
    expect(theme.blue).toBe("#2472c8");
  });
});
