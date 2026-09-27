import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchMock }));

import {
  compareVersions,
  downloadOpenVsxExtension,
  openVsxExtensionId,
  searchOpenVsx,
} from "./open-vsx";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

describe("Open VSX client", () => {
  beforeEach(() => fetchMock.mockReset());

  it("searches themes by popularity when there is no query", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        offset: 0,
        totalSize: 2,
        extensions: [
          {
            namespace: "dracula-theme",
            name: "theme-dracula",
            version: "2.24.3",
            files: { icon: "https://open-vsx.org/icon.png" },
          },
          { namespace: "broken" }, // malformed entries are dropped
        ],
      })
    );

    const result = await searchOpenVsx({ category: "Themes" });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://open-vsx.org/api/-/search");
    expect(url.searchParams.get("category")).toBe("Themes");
    expect(url.searchParams.get("sortBy")).toBe("downloadCount");
    expect(url.searchParams.has("query")).toBe(false);
    expect(result.extensions).toHaveLength(1);
    expect(openVsxExtensionId(result.extensions[0])).toBe("dracula-theme.theme-dracula");
  });

  it("sorts by relevance when searching text", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ extensions: [] }));
    await searchOpenVsx({ query: "one dark" });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("query")).toBe("one dark");
    expect(url.searchParams.get("sortBy")).toBe("relevance");
    expect(url.searchParams.has("category")).toBe(false);
  });

  it("surfaces HTTP and API errors", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));
    await expect(searchOpenVsx()).rejects.toThrow(/503/);
    fetchMock.mockResolvedValue(jsonResponse({ error: "Invalid query" }));
    await expect(searchOpenVsx()).rejects.toThrow("Invalid query");
  });

  it("downloads the .vsix of the latest version", async () => {
    const bytes = new Uint8Array([80, 75, 3, 4]);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          namespace: "PKief",
          name: "material-icon-theme",
          version: "5.38.1",
          files: {
            download: "https://open-vsx.org/api/PKief/material-icon-theme/5.38.1/file/x.vsix",
          },
        })
      )
      .mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer });

    const result = await downloadOpenVsxExtension("PKief", "material-icon-theme");
    expect(fetchMock.mock.calls[0][0]).toBe("https://open-vsx.org/api/PKief/material-icon-theme");
    expect(fetchMock.mock.calls[1][0]).toMatch(/\.vsix$/);
    expect([...result]).toEqual([80, 75, 3, 4]);
  });

  it("compares versions numerically", () => {
    expect(compareVersions("1.10.0", "1.9.2")).toBe(1);
    expect(compareVersions("2.24.3", "2.24.3")).toBe(0);
    expect(compareVersions("5.0.0", "5.0.1")).toBe(-1);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.2.0-beta", "1.1.9")).toBe(1);
  });
});
