import { describe, it, expect } from "vitest";
import { strToU8, zipSync } from "fflate";
import { parseJsonc } from "./jsonc";
import { normalizeRelativePath, resolveRelative } from "./paths";
import { readVsix } from "./vsix";
import {
  getExtensionCandidates,
  normalizeIconTheme,
  resolveFileIconId,
  resolveFolderIconId,
  resolveIconFilePath,
} from "./icon-theme";

describe("parseJsonc", () => {
  it("accepts comments, trailing commas and a BOM", () => {
    const source = `\uFEFF{
      // line comment
      "a": 1, /* block */
      "b": ["x", "y",],
    }`;
    expect(parseJsonc(source)).toEqual({ a: 1, b: ["x", "y"] });
  });

  it("keeps comment-like text and commas inside strings", () => {
    expect(parseJsonc('{ "url": "http://a/*b*/", "s": "a,}", "q": "\\"//" }')).toEqual({
      url: "http://a/*b*/",
      s: "a,}",
      q: '"//',
    });
  });
});

describe("extension paths", () => {
  it("normalizes relative paths", () => {
    expect(normalizeRelativePath("./a/../b\\c.svg")).toBe("b/c.svg");
  });

  it("rejects paths escaping the extension root", () => {
    expect(normalizeRelativePath("../evil")).toBeNull();
    expect(normalizeRelativePath("a/../../evil")).toBeNull();
    expect(normalizeRelativePath("/etc/passwd")).toBeNull();
    expect(normalizeRelativePath("C:/Windows")).toBeNull();
  });

  it("resolves icon paths relative to the theme file directory", () => {
    expect(resolveRelative("dist", "../icons/ts.svg")).toBe("icons/ts.svg");
    expect(resolveRelative("", "./icons/ts.svg")).toBe("icons/ts.svg");
  });
});

describe("readVsix", () => {
  const manifest = {
    name: "My-Icons",
    publisher: "Acme",
    version: "1.2.3",
    contributes: { iconThemes: [{ id: "my", label: "My Icons", path: "./theme.json" }] },
  };

  it("reads the manifest and strips the extension/ prefix", () => {
    const bytes = zipSync({
      "extension.vsixmanifest": strToU8("<xml/>"),
      "extension/package.json": strToU8(JSON.stringify(manifest)),
      "extension/icons/a.svg": strToU8("<svg/>"),
    });
    const pkg = readVsix(bytes);
    expect(pkg.id).toBe("acme.my-icons");
    expect(pkg.manifest.contributes?.iconThemes?.[0].id).toBe("my");
    expect(Object.keys(pkg.files).sort()).toEqual(["icons/a.svg", "package.json"]);
  });

  it("rejects archives without a manifest", () => {
    const bytes = zipSync({ "extension/readme.md": strToU8("hi") });
    expect(() => readVsix(bytes)).toThrow(/package\.json/);
  });

  it("rejects zip-slip entries", () => {
    const bytes = zipSync({
      "extension/package.json": strToU8(JSON.stringify(manifest)),
      "extension/../../evil.sh": strToU8("rm -rf"),
    });
    expect(() => readVsix(bytes)).toThrow(/Ruta inválida/);
  });
});

describe("icon theme resolution", () => {
  const theme = normalizeIconTheme({
    iconDefinitions: {
      file: { iconPath: "../icons/file.svg" },
      ts: { iconPath: "../icons/ts.svg" },
      dts: { iconPath: "../icons/dts.svg" },
      pkg: { iconPath: "../icons/pkg.svg" },
      folder: { iconPath: "../icons/folder.svg" },
      folderOpen: { iconPath: "../icons/folder-open.svg" },
      src: { iconPath: "../icons/src.svg" },
      srcOpen: { iconPath: "../icons/src-open.svg" },
      git: { iconPath: "../icons/git.svg" },
      tsLight: { iconPath: "../icons/ts-light.svg" },
      glyph: { fontCharacter: "\\E001" },
    },
    file: "file",
    folder: "folder",
    folderExpanded: "folderOpen",
    fileExtensions: { "D.TS": "dts" },
    fileNames: { "Package.json": "pkg" },
    folderNames: { SRC: "src" },
    folderNamesExpanded: { src: "srcOpen" },
    languageIds: { typescript: "ts", ignore: "git" },
    light: { languageIds: { typescript: "tsLight" } },
  });

  it("lists compound extensions longest first", () => {
    expect(getExtensionCandidates("foo.d.ts")).toEqual(["d.ts", "ts"]);
    expect(getExtensionCandidates(".gitignore")).toEqual(["gitignore"]);
    expect(getExtensionCandidates("Makefile")).toEqual([]);
  });

  it("prefers file names, then compound extensions, then language ids", () => {
    expect(resolveFileIconId(theme, "PACKAGE.JSON")).toBe("pkg");
    expect(resolveFileIconId(theme, "index.d.ts")).toBe("dts");
    expect(resolveFileIconId(theme, "index.ts")).toBe("ts");
    expect(resolveFileIconId(theme, "notes.unknown")).toBe("file");
  });

  it("uses light overrides and falls back to the base theme", () => {
    expect(resolveFileIconId(theme, "index.ts", "light")).toBe("tsLight");
    expect(resolveFileIconId(theme, "index.d.ts", "light")).toBe("dts");
  });

  it("resolves folders case-insensitively with expanded variants", () => {
    expect(resolveFolderIconId(theme, "Src", false)).toBe("src");
    expect(resolveFolderIconId(theme, "Src", true)).toBe("srcOpen");
    expect(resolveFolderIconId(theme, "docs", false)).toBe("folder");
    expect(resolveFolderIconId(theme, "docs", true)).toBe("folderOpen");
  });

  it("resolves image paths relative to the theme file", () => {
    expect(resolveIconFilePath(theme, "dist/theme.json", "ts")).toBe("icons/ts.svg");
    expect(resolveIconFilePath(theme, "theme.json", "ts")).toBeNull();
    expect(resolveIconFilePath(theme, "dist/theme.json", "glyph")).toBeNull();
    expect(resolveIconFilePath(theme, "dist/theme.json", "missing")).toBeNull();
  });
});
