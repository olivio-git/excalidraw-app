import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DocumentOutline } from "./DocumentOutline";
import { getDocumentCodec } from "./note-codec";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/core/i18n/i18n", () => ({ default: { t: (key: string) => key } }));
describe("document outline", () => {
  it("navigates and copies the exact block identity even with duplicate heading titles", () => {
    const blocks = getDocumentCodec().tryParseMarkdownToBlocks("# Overview\n\n## Overview");
    const jump = vi.fn();
    const copy = vi.fn();
    render(<DocumentOutline blocks={blocks} onJump={jump} onCopy={copy} onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Overview" })[1]);
    expect(jump).toHaveBeenCalledWith(blocks[1].id);
    fireEvent.click(
      screen.getAllByRole("button", { name: "connected.copySectionLink: Overview" })[0]
    );
    expect(copy).toHaveBeenCalledWith(blocks[0].id, "Overview");
  });
});
