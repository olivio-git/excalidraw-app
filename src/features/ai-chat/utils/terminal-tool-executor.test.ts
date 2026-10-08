import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import {
  AGENT_TERMINAL,
  executeTerminalTool,
  outputForModel,
  resolveInsideWorkspace,
} from "./terminal-tool-executor";

const runInOutputTerminal = vi.fn();
vi.mock("@/features/terminal/output-terminal", () => ({
  runInOutputTerminal: (...args: unknown[]) => runInOutputTerminal(...args),
}));

beforeEach(() => {
  runInOutputTerminal.mockReset();
  useWorkspaceStore.setState({ workspaceDir: "/ws" });
});

describe("resolveInsideWorkspace", () => {
  it("resolves relative and absolute folders inside the workspace", () => {
    expect(resolveInsideWorkspace("/ws")).toBe("/ws");
    expect(resolveInsideWorkspace("/ws", "infra/./docker")).toBe("/ws/infra/docker");
    expect(resolveInsideWorkspace("/ws", "/ws/infra")).toBe("/ws/infra");
    expect(resolveInsideWorkspace("/ws", "infra/../codigo")).toBe("/ws/codigo");
  });

  it("rejects folders outside the workspace", () => {
    expect(resolveInsideWorkspace("/ws", "..")).toBeNull();
    expect(resolveInsideWorkspace("/ws", "../ws2")).toBeNull();
    expect(resolveInsideWorkspace("/ws", "/etc")).toBeNull();
    expect(resolveInsideWorkspace("/ws", "/ws2")).toBeNull();
  });

  it("handles Windows paths without case or separator surprises", () => {
    expect(resolveInsideWorkspace("C:\\Users\\ana\\ws", "infra")).toBe("C:\\Users\\ana\\ws\\infra");
    expect(resolveInsideWorkspace("C:\\Users\\ana\\ws", "c:/users/ana/ws/infra")).toBe(
      "c:\\users\\ana\\ws\\infra"
    );
    expect(resolveInsideWorkspace("C:\\Users\\ana\\ws", "..\\..\\..\\..\\Windows")).toBeNull();
    expect(resolveInsideWorkspace("C:\\Users\\ana\\ws", "D:\\ws")).toBeNull();
  });
});

describe("outputForModel", () => {
  it("drops colours and keeps the last state of progress lines", () => {
    const raw = "\x1b[32mok\x1b[0m\nDescargando 10%\rDescargando 60%\rDescargando 100%\r\nlisto\n";
    expect(outputForModel(raw, 1000)).toBe("ok\nDescargando 100%\nlisto\n");
  });

  it("keeps the end of long output, where errors usually are", () => {
    const text = `${"x".repeat(50)}ERROR final`;
    expect(outputForModel(text, 11)).toBe("[… 50 caracteres anteriores omitidos]\nERROR final");
  });
});

describe("terminal_run", () => {
  it("runs the command in the agent terminal and reports how it ended", async () => {
    runInOutputTerminal.mockResolvedValue({
      stdout: "abc123\n",
      stderr: "",
      code: 0,
      timedOut: false,
      killed: false,
    });
    const answer = await executeTerminalTool("terminal_run", {
      command: "docker ps -q",
      cwd: "infra",
      timeout: 5000,
    });
    expect(answer.isError).toBe(false);
    expect(JSON.parse(answer.result)).toEqual({ code: 0, stdout: "abc123\n", stderr: "" });
    expect(runInOutputTerminal).toHaveBeenCalledWith(AGENT_TERMINAL, {
      command: "docker ps -q",
      cwd: "/ws/infra",
      timeoutMs: 600_000,
      signal: undefined,
    });
  });

  it("marks failures, timeouts and stops as errors", async () => {
    runInOutputTerminal.mockResolvedValue({
      stdout: "",
      stderr: "",
      code: null,
      timedOut: false,
      killed: true,
    });
    const answer = await executeTerminalTool("terminal_run", { command: "sleep 100" });
    expect(answer.isError).toBe(true);
    expect(JSON.parse(answer.result).stopped).toContain("stopped");
    expect(runInOutputTerminal.mock.calls[0][1]).toMatchObject({ cwd: "/ws", timeoutMs: 60_000 });
  });

  it("refuses folders outside the workspace without running anything", async () => {
    const answer = await executeTerminalTool("terminal_run", { command: "ls", cwd: "/etc" });
    expect(answer.isError).toBe(true);
    expect(answer.result).toContain("inside the workspace");
    expect(runInOutputTerminal).not.toHaveBeenCalled();
  });

  it("needs a command and an open workspace", async () => {
    expect((await executeTerminalTool("terminal_run", { command: "  " })).isError).toBe(true);
    useWorkspaceStore.setState({ workspaceDir: null });
    const answer = await executeTerminalTool("terminal_run", { command: "ls" });
    expect(answer.result).toContain("No workspace");
    expect(runInOutputTerminal).not.toHaveBeenCalled();
  });
});
