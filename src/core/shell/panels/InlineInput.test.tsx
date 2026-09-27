import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InlineInput } from "./InlineInput";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe("InlineInput", () => {
  it("cancels Escape without committing again on blur", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<InlineInput depth={0} onCommit={onCommit} onCancel={onCancel} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "name" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("submits once when Enter is followed by blur", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(<InlineInput depth={0} onCommit={onCommit} onCancel={vi.fn()} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "diagram.excalidraw" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    await waitFor(() => expect(onCommit).toHaveBeenCalledExactlyOnceWith("diagram.excalidraw"));
  });

  it("retains a failed name and lets the user correct it", async () => {
    const onCommit = vi
      .fn()
      .mockRejectedValueOnce(new Error("Already exists"))
      .mockResolvedValue(undefined);
    render(<InlineInput depth={0} onCommit={onCommit} onCancel={vi.fn()} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "duplicate" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Already exists");
    expect(input).toHaveValue("duplicate");
    fireEvent.change(input, { target: { value: "unique" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onCommit).toHaveBeenLastCalledWith("unique"));
  });

  it("blocks traversal and selects the entire dotted folder name", () => {
    const onCommit = vi.fn();
    render(
      <InlineInput
        defaultValue="release.v2"
        autoSelectBasename={false}
        depth={0}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />
    );
    const input = screen.getByRole<HTMLInputElement>("textbox");
    expect(input.selectionEnd).toBe("release.v2".length);
    fireEvent.change(input, { target: { value: "../outside" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent("input.invalidName");
    expect(onCommit).not.toHaveBeenCalled();
  });
});
