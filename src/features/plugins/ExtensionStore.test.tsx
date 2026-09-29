import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  install: vi.fn(),
}));

vi.mock("@/plugins/vscode/open-vsx", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/plugins/vscode/open-vsx")>()),
  searchOpenVsx: mocks.search,
}));
vi.mock("@/plugins/vscode/extension-manager", () => ({ installFromOpenVsx: mocks.install }));
vi.mock("@/plugins/vscode/icon-theme-service", () => ({
  useIconThemeState: () => ({
    extensions: [
      { id: "dracula-theme.theme-dracula", version: "2.24.3" },
      { id: "pkief.material-icon-theme", version: "5.0.0" },
    ],
  }),
}));
vi.mock("@/shared/lib/notify", () => ({ notify: vi.fn() }));

import { ExtensionStore } from "./ExtensionStore";

const ext = (namespace: string, name: string, version: string, displayName: string) => ({
  namespace,
  name,
  version,
  displayName,
  files: {},
});

describe("ExtensionStore", () => {
  it("lists Open VSX themes with install / installed / update states", async () => {
    mocks.search.mockResolvedValue({
      offset: 0,
      totalSize: 3,
      extensions: [
        ext("dracula-theme", "theme-dracula", "2.24.3", "Dracula Official"),
        ext("PKief", "material-icon-theme", "5.38.1", "Material Icon Theme"),
        ext("zhuangtongfa", "material-theme", "3.19.0", "One Dark Pro"),
      ],
    });
    mocks.install.mockResolvedValue({ displayName: "One Dark Pro", version: "3.19.0" });

    render(<ExtensionStore />);

    expect(await screen.findByText("Dracula Official")).toBeInTheDocument();
    expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({ category: "Themes" }));
    expect(screen.getByRole("button", { name: /Instalado/ })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Actualizar \(v5\.0\.0 → v5\.38\.1\)/ })
    ).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /^Instalar$/ }));
    await waitFor(() =>
      expect(mocks.install).toHaveBeenCalledWith("zhuangtongfa", "material-theme")
    );
  });

  it("shows a retryable error when Open VSX is unreachable", async () => {
    mocks.search.mockRejectedValueOnce(new Error("forbidden url")).mockResolvedValue({
      offset: 0,
      totalSize: 0,
      extensions: [],
    });

    render(<ExtensionStore />);

    expect(await screen.findByText("No se pudo conectar con Open VSX")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    await waitFor(() => expect(screen.queryByText("No se pudo conectar con Open VSX")).toBeNull());
  });
});
