import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { lazy, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import DiagramCanvas from "./DiagramCanvas";
import TabContent from "@/core/tabs/components/TabContent";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { initialEditorLayout } from "@/core/tabs/store/editor-layout";
import { useDiagramStore } from "@/core/diagram/store/diagram-store";
import { diagramFileService } from "@/core/diagram/services/diagram-file.service";
import { RouteRegistry } from "@/core/routing/route-registry";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/core/i18n/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/shared/hooks/useHomeDir", () => ({ useHomeDir: () => "" }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onDragDropEvent: vi.fn().mockResolvedValue(() => undefined) }),
}));
vi.mock("@/core/diagram/services/diagram-file.service", () => ({
  diagramFileService: {
    readDiagram: vi.fn().mockResolvedValue({ elements: [], appState: {}, files: {} }),
    writeDiagram: vi.fn().mockResolvedValue(undefined),
  },
}));

// Match Excalidraw 0.18's native radio names and onChange-on-every-update contract.
// Canvas drawing is omitted; browser radio grouping and our host/store/timers are real.
function TestExcalidraw(props: ExcalidrawProps) {
  const { excalidrawAPI } = props;
  const [appState, setAppState] = useState(
    () => ({ activeTool: { type: "selection" } }) as AppState
  );
  const [elements, setElements] = useState<OrderedExcalidrawElement[]>([]);
  const [files] = useState<BinaryFiles>({});
  const current = useRef({ appState, elements, files });
  useLayoutEffect(() => {
    current.current = { appState, elements, files };
  });
  const [api] = useState(
    () =>
      ({
        getAppState: () => current.current.appState,
        getSceneElements: () => current.current.elements,
        getFiles: () => current.current.files,
        refresh: () => setAppState((state) => ({ ...state })),
        updateScene: () => undefined,
      }) as unknown as ExcalidrawImperativeAPI
  );
  useLayoutEffect(() => {
    excalidrawAPI?.(api);
  }, [api, excalidrawAPI]);
  useEffect(() => {
    props.onChange?.(elements, appState, files);
  });
  return (
    <div>
      {(["selection", "hand"] as const).map((tool) => (
        <input
          key={tool}
          type="radio"
          name="editor-current-shape"
          aria-label={`${props.name}-${tool}`}
          checked={appState.activeTool.type === tool}
          onChange={() =>
            setAppState((state) => ({
              ...state,
              activeTool: { ...state.activeTool, type: tool, customType: null },
            }))
          }
        />
      ))}
      <button
        type="button"
        onClick={() =>
          setElements((previous) => [
            ...previous,
            {
              id: `${props.name}-${previous.length}`,
              version: 1,
              versionNonce: previous.length + 1,
            } as OrderedExcalidrawElement,
          ])
        }
      >
        {props.name}-draw
      </button>
      <button
        type="button"
        onClick={() => {
          // Excalidraw mutates scene elements without necessarily replacing their array.
          const element = api.getSceneElements()[0];
          Object.assign(element, {
            version: element.version + 1,
            versionNonce: element.versionNonce + 1,
          });
          setAppState((state) => ({ ...state }));
        }}
      >
        {props.name}-mutate
      </button>
      {createPortal(<form data-testid={`${props.name}-publication`} />, document.body)}
    </div>
  );
}
vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: TestExcalidraw,
  useHandleLibrary: () => undefined,
  exportToSvg: vi.fn(),
  hashElementsVersion: (elements: readonly OrderedExcalidrawElement[]) =>
    elements.reduce((hash, element) => (hash * 33 + element.versionNonce) >>> 0, 5381),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  useTabStore.setState({ ...initialEditorLayout(), tabs: [], activeTabId: null });
  useDiagramStore.setState({ diagrams: {} });
  RouteRegistry.clear();
  RouteRegistry.register([
    {
      id: "diagram",
      path: "/diagram",
      name: "diagram",
      type: "public",
      security: { requiresAuth: false },
      component: lazy(async () => ({ default: DiagramCanvas })),
      tabConfig: { keepMounted: true },
    },
  ]);
});
afterEach(() => vi.useRealTimers());

async function setup() {
  const ids = ["left", "right"].map((name) => {
    const filePath = `/ws/${name}.excalidraw`;
    return useTabStore.getState().addTab({
      routeId: "diagram",
      path: "/diagram",
      title: name,
      instanceId: filePath,
      metadata: { filePath },
    });
  });
  useTabStore.getState().openToSide(ids[1]);
  await act(async () => {
    render(<TabContent />);
  });
  return ids;
}

describe("parallel diagram editors", () => {
  it("does not mark idle or merely refreshed canvases dirty", async () => {
    await setup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(diagramFileService.writeDiagram).not.toHaveBeenCalled();
    expect(
      Object.values(useDiagramStore.getState().diagrams).every((diagram) => !diagram.isDirty)
    ).toBe(true);
  });

  it("still saves real in-place scene mutations after the previous save has settled", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "right-draw" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(diagramFileService.writeDiagram).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "right-mutate" }));
    expect(useDiagramStore.getState().getDiagram("/ws/right.excalidraw")?.isDirty).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(diagramFileService.writeDiagram).toHaveBeenCalledTimes(2);
    expect(diagramFileService.writeDiagram).toHaveBeenLastCalledWith(
      "/ws/right.excalidraw",
      expect.objectContaining({ elements: [expect.objectContaining({ version: 2 })] })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(diagramFileService.writeDiagram).toHaveBeenCalledTimes(2);
  });

  it("prevents implicit canvas submission without intercepting portaled library forms", async () => {
    await setup();
    const radio = screen.getByRole<HTMLInputElement>("radio", { name: "left-hand" });
    expect(radio.form).not.toBeNull();
    expect(fireEvent.submit(radio.form!)).toBe(false);
    const publication = screen.getByTestId("left-publication");
    expect(publication.parentElement?.closest("form")).toBeNull();
    expect(fireEvent.submit(publication)).toBe(true);
  });

  it("keeps each toolbar's native radio selection independent", async () => {
    await setup();
    const hand = screen.getByRole("radio", { name: "left-hand" });
    const selection = screen.getByRole("radio", { name: "right-selection" });
    fireEvent.click(hand);
    expect(hand).toBeChecked();
    expect(selection).toBeChecked();
    expect(screen.getByRole("radio", { name: "left-selection" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "right-hand" })).not.toBeChecked();
  });

  it("settles after autosave instead of alternating toolbar updates every second", async () => {
    const [, right] = await setup();
    fireEvent.click(screen.getByRole("radio", { name: "left-hand" }));
    const selection = screen.getByRole("radio", { name: "right-selection" });
    act(() => {
      selection.focus();
    });
    fireEvent.click(screen.getByRole("button", { name: "right-draw" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    const writes = vi.mocked(diagramFileService.writeDiagram).mock.calls.length;
    expect(writes).toBeGreaterThan(0);
    for (let index = 0; index < 5; index++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(diagramFileService.writeDiagram).toHaveBeenCalledTimes(writes);
      expect(screen.getByRole("radio", { name: "left-hand" })).toBeChecked();
      expect(selection).toBeChecked();
      expect(selection).toHaveFocus();
      expect(useTabStore.getState().activeTabId).toBe(right);
    }
    expect(useDiagramStore.getState().getDiagram("/ws/right.excalidraw")?.isDirty).toBe(false);
  });
});
