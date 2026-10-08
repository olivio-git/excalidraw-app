import { describe, expect, it } from "vitest";
import { formatToolText } from "./tool-text";

describe("formatToolText", () => {
  it("shows command output as it is, not escaped", () => {
    const result = JSON.stringify({ code: 1, stdout: "uno\ndos\n", stderr: "" });
    expect(formatToolText(result)).toBe("code: 1\nstdout:\nuno\ndos\nstderr: ");
  });

  it("keeps nested values as indented JSON", () => {
    expect(formatToolText('{"nodes":[{"id":"a"}]}')).toBe('nodes: [\n  {\n    "id": "a"\n  }\n]');
  });

  it("returns plain text and JSON still streaming in unchanged", () => {
    expect(formatToolText("Action denied by user.")).toBe("Action denied by user.");
    expect(formatToolText('{"command": "dock')).toBe('{"command": "dock');
  });

  it("cuts very long text", () => {
    const text = formatToolText("x".repeat(30_000));
    expect(text.length).toBeLessThan(20_100);
    expect(text.endsWith("…")).toBe(true);
  });
});
