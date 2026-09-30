import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { executeKnowledgeTool } from "./knowledge-tool-executor";

vi.mock("@/features/notes-list/notes-index", async (original) => ({
  ...(await original<typeof import("@/features/notes-list/notes-index")>()),
  indexNotes: vi.fn(async () => [
    { path: "/ws/a.md", title: "Idea", snippet: "algo", notebook: "", updated: 1, tags: [] },
    {
      path: "/ws/Blog/post.md",
      title: "Post del blog",
      snippet: "CSS moderno",
      notebook: "Blog",
      updated: 2,
      tags: ["CSS"],
      status: "active",
    },
  ]),
}));
vi.mock("@/core/shell/services/workspace-search", () => ({
  searchWorkspace: vi.fn(async () => ({
    total: 1,
    scanned: 3,
    truncated: false,
    files: [
      {
        path: "/ws/Blog/post.md",
        matches: [{ text: "CSS moderno", start: 0, end: 3, anchor: "l1", line: 1 }],
      },
    ],
  })),
}));

beforeEach(() => useWorkspaceStore.setState({ workspaceDir: "/ws" }));

describe("knowledge tools", () => {
  it("lists notes newest first and filters by tag", async () => {
    const all = JSON.parse((await executeKnowledgeTool("notes_list", {})).result);
    expect(all.notes.map((n: { title: string }) => n.title)).toEqual(["Post del blog", "Idea"]);
    expect(all.notes[0].relativePath).toBe("Blog/post.md");
    const tagged = JSON.parse((await executeKnowledgeTool("notes_list", { tag: "css" })).result);
    expect(tagged.total).toBe(1);
  });

  it("searches with workspace-relative paths", async () => {
    const data = JSON.parse(
      (await executeKnowledgeTool("workspace_search", { query: "CSS" })).result
    );
    expect(data.files[0]).toMatchObject({ relativePath: "Blog/post.md", matches: [{ line: 1 }] });
  });

  it("needs a workspace and a query", async () => {
    expect((await executeKnowledgeTool("workspace_search", { query: " " })).isError).toBe(true);
    useWorkspaceStore.setState({ workspaceDir: null });
    expect((await executeKnowledgeTool("notes_list", {})).isError).toBe(true);
  });
});
