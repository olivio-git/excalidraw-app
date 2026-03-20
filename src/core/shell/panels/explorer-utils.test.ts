import { describe, it, expect } from "vitest";
import {
  flattenVisible,
  flattenAll,
  filterTree,
  getFilteredExpandedPaths,
  sortTree,
  sortEntries,
  scoreMatch,
  filterIndex,
  formatFileSize,
  formatDate,
} from "./explorer-utils";
import type { FileEntry, FlatNode } from "./explorer-types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Tree structure:
 *
 * src/              (dir)
 *   components/     (dir)
 *     Button.tsx    (file)
 *     Input.tsx     (file)
 *   index.ts        (file)
 * README.md         (file)
 */
const makeTree = (): FileEntry[] => [
  {
    name: "src",
    path: "/ws/src",
    isDir: true,
    children: [
      {
        name: "components",
        path: "/ws/src/components",
        isDir: true,
        children: [
          { name: "Button.tsx", path: "/ws/src/components/Button.tsx", isDir: false },
          { name: "Input.tsx", path: "/ws/src/components/Input.tsx", isDir: false },
        ],
      },
      { name: "index.ts", path: "/ws/src/index.ts", isDir: false },
    ],
  },
  { name: "README.md", path: "/ws/README.md", isDir: false },
];

// ---------------------------------------------------------------------------
// flattenVisible
// ---------------------------------------------------------------------------

describe("flattenVisible", () => {
  it("returns only root nodes when nothing is expanded", () => {
    const tree = makeTree();
    const result = flattenVisible(tree, new Set());

    expect(result).toHaveLength(2); // src, README.md
    expect(result.map((n) => n.name)).toEqual(["src", "README.md"]);
  });

  it("includes direct children when parent dir is expanded", () => {
    const tree = makeTree();
    const result = flattenVisible(tree, new Set(["/ws/src"]));

    // src, components, index.ts, README.md  (components not expanded → no grandchildren)
    const names = result.map((n) => n.name);
    expect(names).toContain("src");
    expect(names).toContain("components");
    expect(names).toContain("index.ts");
    expect(names).toContain("README.md");
    expect(names).not.toContain("Button.tsx");
  });

  it("includes grandchildren when both ancestor dirs are expanded", () => {
    const tree = makeTree();
    const expanded = new Set(["/ws/src", "/ws/src/components"]);
    const result = flattenVisible(tree, expanded);

    const names = result.map((n) => n.name);
    expect(names).toContain("Button.tsx");
    expect(names).toContain("Input.tsx");
  });

  it("assigns correct depth values", () => {
    const tree = makeTree();
    const expanded = new Set(["/ws/src", "/ws/src/components"]);
    const result = flattenVisible(tree, expanded);

    const src = result.find((n) => n.name === "src")!;
    const components = result.find((n) => n.name === "components")!;
    const button = result.find((n) => n.name === "Button.tsx")!;

    expect(src.depth).toBe(0);
    expect(components.depth).toBe(1);
    expect(button.depth).toBe(2);
  });

  it("assigns sequential index values", () => {
    const tree = makeTree();
    const result = flattenVisible(tree, new Set(["/ws/src"]));

    result.forEach((node, i) => {
      expect(node.index).toBe(i);
    });
  });

  it("assigns correct parentPath", () => {
    const tree = makeTree();
    const expanded = new Set(["/ws/src"]);
    const result = flattenVisible(tree, expanded);

    const components = result.find((n) => n.name === "components")!;
    const indexTs = result.find((n) => n.name === "index.ts")!;
    const src = result.find((n) => n.name === "src")!;
    const readme = result.find((n) => n.name === "README.md")!;

    expect(src.parentPath).toBeNull();
    expect(readme.parentPath).toBeNull();
    expect(components.parentPath).toBe("/ws/src");
    expect(indexTs.parentPath).toBe("/ws/src");
  });
});

// ---------------------------------------------------------------------------
// flattenAll
// ---------------------------------------------------------------------------

describe("flattenAll", () => {
  it("returns all nodes regardless of expansion state", () => {
    const tree = makeTree();
    const result = flattenAll(tree);

    expect(result).toHaveLength(6); // src, components, Button.tsx, Input.tsx, index.ts, README.md
  });

  it("nodes include correct depth", () => {
    const tree = makeTree();
    const result = flattenAll(tree);

    const button = result.find((n) => n.name === "Button.tsx")!;
    expect(button.depth).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// scoreMatch
// ---------------------------------------------------------------------------

describe("scoreMatch", () => {
  it("returns 100 for exact name match (case-insensitive)", () => {
    expect(scoreMatch("Button.tsx", "/ws/src/Button.tsx", "button.tsx")).toBe(100);
    expect(scoreMatch("Button.tsx", "/ws/src/Button.tsx", "Button.tsx")).toBe(100);
  });

  it("returns 80 for prefix match on name", () => {
    expect(scoreMatch("Button.tsx", "/ws/src/Button.tsx", "butt")).toBe(80);
  });

  it("returns 60 for mid-string match on name", () => {
    expect(scoreMatch("MyButton.tsx", "/ws/src/MyButton.tsx", "button")).toBe(60);
  });

  it("returns 30 for path-only match", () => {
    expect(scoreMatch("index.ts", "/ws/src/components/index.ts", "components")).toBe(30);
  });

  it("returns 0 for no match", () => {
    expect(scoreMatch("Button.tsx", "/ws/src/Button.tsx", "zzznomatch")).toBe(0);
  });

  it("prefix match scores higher than mid-string match", () => {
    const prefix = scoreMatch("index.ts", "/ws/src/index.ts", "ind");
    const mid = scoreMatch("MyIndex.ts", "/ws/src/MyIndex.ts", "ind");
    expect(prefix).toBeGreaterThan(mid);
  });
});

// ---------------------------------------------------------------------------
// filterIndex
// ---------------------------------------------------------------------------

describe("filterIndex", () => {
  const nodes: FlatNode[] = [
    {
      path: "/ws/src/Button.tsx",
      name: "Button.tsx",
      isDir: false,
      depth: 2,
      parentPath: "/ws/src/components",
      index: 0,
    },
    {
      path: "/ws/src/Input.tsx",
      name: "Input.tsx",
      isDir: false,
      depth: 2,
      parentPath: "/ws/src/components",
      index: 1,
    },
    {
      path: "/ws/README.md",
      name: "README.md",
      isDir: false,
      depth: 0,
      parentPath: null,
      index: 2,
    },
  ];

  it("returns first 50 nodes for empty query", () => {
    const result = filterIndex(nodes, "");
    expect(result).toHaveLength(3);
  });

  it("returns matching nodes for a query", () => {
    const result = filterIndex(nodes, "button");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Button.tsx");
  });

  it("orders results by descending score", () => {
    // "in" matches "Input.tsx" as prefix (80), and "README.md" via path not at all
    const result = filterIndex(nodes, "in");
    expect(result[0].name).toBe("Input.tsx");
  });
});

// ---------------------------------------------------------------------------
// filterTree
// ---------------------------------------------------------------------------

describe("filterTree", () => {
  it("returns the full tree for empty query", () => {
    const tree = makeTree();
    const result = filterTree(tree, "");
    expect(result).toHaveLength(2);
  });

  it("returns files matching the query (case-insensitive)", () => {
    const tree = makeTree();
    const result = filterTree(tree, "button");
    // Should return src > components > Button.tsx
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("src");
    expect(result[0].children![0].name).toBe("components");
    expect(result[0].children![0].children![0].name).toBe("Button.tsx");
  });

  it("excludes non-matching files", () => {
    const tree = makeTree();
    const result = filterTree(tree, "button");
    const components = result[0]?.children?.[0];
    expect(components?.children?.find((n) => n.name === "Input.tsx")).toBeUndefined();
  });

  it("includes the directory itself when its name matches", () => {
    const tree = makeTree();
    const result = filterTree(tree, "components");
    // 'components' dir name matches, so it should be included even with no file-name match
    expect(result[0].children?.some((c) => c.name === "components")).toBe(true);
  });

  it("excludes a file not matching the query", () => {
    const tree = makeTree();
    const result = filterTree(tree, "zzznomatch");
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getFilteredExpandedPaths
// ---------------------------------------------------------------------------

describe("getFilteredExpandedPaths", () => {
  it("returns an empty set for empty query", () => {
    const tree = makeTree();
    const result = getFilteredExpandedPaths(tree, "");
    expect(result.size).toBe(0);
  });

  it("returns ancestor dir paths for a matched file", () => {
    const tree = makeTree();
    const result = getFilteredExpandedPaths(tree, "button");
    // Button.tsx is under src/components, so both /ws/src and /ws/src/components should be expanded
    expect(result.has("/ws/src")).toBe(true);
    expect(result.has("/ws/src/components")).toBe(true);
  });

  it("does not include leaf file paths", () => {
    const tree = makeTree();
    const result = getFilteredExpandedPaths(tree, "button");
    expect(result.has("/ws/src/components/Button.tsx")).toBe(false);
  });

  it("returns empty set when query has no matches", () => {
    const tree = makeTree();
    const result = getFilteredExpandedPaths(tree, "zzznomatch");
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// sortEntries / sortTree
// ---------------------------------------------------------------------------

describe("sortEntries", () => {
  const mixed: FileEntry[] = [
    { name: "zebra.ts", path: "/zebra.ts", isDir: false },
    { name: "alpha", path: "/alpha", isDir: true },
    { name: "apple.ts", path: "/apple.ts", isDir: false },
    { name: "beta", path: "/beta", isDir: true },
  ];

  it("type-first: directories come before files, each group alphabetically", () => {
    const result = sortEntries(mixed, "type-first");
    const names = result.map((e) => e.name);
    expect(names).toEqual(["alpha", "beta", "apple.ts", "zebra.ts"]);
  });

  it("name-asc: all entries sorted alphabetically ascending", () => {
    const result = sortEntries(mixed, "name-asc");
    const names = result.map((e) => e.name);
    expect(names).toEqual(["alpha", "apple.ts", "beta", "zebra.ts"]);
  });

  it("name-desc: all entries sorted alphabetically descending", () => {
    const result = sortEntries(mixed, "name-desc");
    const names = result.map((e) => e.name);
    expect(names).toEqual(["zebra.ts", "beta", "apple.ts", "alpha"]);
  });
});

describe("sortTree", () => {
  it("recursively sorts nested children", () => {
    const tree: FileEntry[] = [
      {
        name: "src",
        path: "/src",
        isDir: true,
        children: [
          { name: "zebra.ts", path: "/src/zebra.ts", isDir: false },
          { name: "alpha.ts", path: "/src/alpha.ts", isDir: false },
        ],
      },
    ];

    const result = sortTree(tree, "name-asc");
    const childNames = result[0].children!.map((c) => c.name);
    expect(childNames).toEqual(["alpha.ts", "zebra.ts"]);
  });

  it("does not mutate the original tree", () => {
    const tree = makeTree();
    const original = JSON.stringify(tree);
    sortTree(tree, "name-asc");
    expect(JSON.stringify(tree)).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// formatFileSize
// ---------------------------------------------------------------------------

describe("formatFileSize", () => {
  it("formats 0 bytes", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });

  it("formats bytes below 1 KB", () => {
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it("formats exactly 1 KB", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
  });

  it("formats value between 1 KB and 1 MB", () => {
    expect(formatFileSize(2048)).toBe("2.0 KB");
  });

  it("formats exactly 1 MB", () => {
    expect(formatFileSize(1048576)).toBe("1.0 MB");
  });

  it("formats multi-MB value", () => {
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe("formatDate", () => {
  it("returns a non-empty string for a valid timestamp", () => {
    const result = formatDate(Date.now());
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns a non-empty string for an epoch-zero timestamp", () => {
    const result = formatDate(0);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("different timestamps produce different strings", () => {
    const a = formatDate(1000000000000);
    const b = formatDate(1700000000000);
    expect(a).not.toBe(b);
  });
});
