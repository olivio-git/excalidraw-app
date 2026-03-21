import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { DiagramController } from "@/core/diagram/DiagramController";
import type { AIToolResult } from "../providers/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

/**
 * Fixes the x (and y) anchor point of text elements that live inside a container.
 *
 * Excalidraw text positioning depends on textAlign:
 *   "left"   → x is the left edge  → no correction needed if already inside
 *   "center" → x is the CENTER     → must be container.x + container.width / 2
 *   "right"  → x is the right edge → must be container.x + container.width
 *
 * LLMs consistently treat x as the left edge regardless of textAlign, which causes
 * center-aligned text to render half outside the container on the left side.
 */
export function normalizeTextInContainers(elements: ExcalidrawElement[]): ExcalidrawElement[] {
  const containerMap = new Map<string, ExcalidrawElement>();
  for (const el of elements) {
    containerMap.set(el.id, el);
  }

  const PADDING = 8;

  return elements.map((el) => {
    if (el.type !== "text" || !el.containerId) return el;

    const container = containerMap.get(el.containerId);
    if (!container) return el;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textAlign: string = (el as any).textAlign ?? "left";

    let x: number;

    switch (textAlign) {
      case "center":
        x = container.x + container.width / 2;
        break;
      case "right":
        x = container.x + container.width - PADDING;
        break;
      default:
        // left: only clamp to container bounds, don't override explicit positioning
        x = Math.max(el.x, container.x + PADDING);
        break;
    }

    if (x === el.x) return el;

    return { ...el, x };
  });
}

export async function executeAITool(
  toolName: string,
  toolInput: unknown,
  instanceId: string | undefined
): Promise<AIToolResult> {
  if (!instanceId) {
    return {
      toolCallId: "",
      result: "No active diagram canvas. Open a diagram tab first.",
      isError: true,
    };
  }

  let api = DiagramController.getApi(instanceId);
  if (!api) {
    try {
      api = await DiagramController.waitForInstance(instanceId, 3000);
    } catch {
      return {
        toolCallId: "",
        result: `Canvas not ready (instanceId: ${instanceId}). Try again in a moment.`,
        isError: true,
      };
    }
  }

  try {
    switch (toolName) {
      case "draw_elements": {
        const input = toolInput as { elements?: unknown[] };
        if (!Array.isArray(input.elements)) {
          return {
            toolCallId: "",
            result: "Invalid input: elements must be an array.",
            isError: true,
          };
        }

        // Separate pseudo-elements from real elements
        const deleteOp = input.elements.find((el) => (el as { type: string }).type === "delete") as
          | { type: "delete"; ids: string }
          | undefined;
        const realElements = input.elements.filter(
          (el) => !["cameraUpdate", "delete"].includes((el as { type: string }).type)
        );

        // Handle delete pseudo-element: remove ids from existing scene
        let existing = [...api.getSceneElements()];
        if (deleteOp?.ids) {
          const toDelete = new Set(deleteOp.ids.split(",").map((s) => s.trim()));
          existing = existing.filter((el) => !toDelete.has(el.id));
        }

        // Convert skeleton elements (with label, etc.) to proper Excalidraw elements
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const converted = convertToExcalidrawElements(realElements as any);

        // Fix text anchor points: center-aligned text must use x = container center,
        // not x = container left edge (which is the LLM's common mistake).
        const normalized = normalizeTextInContainers(converted as ExcalidrawElement[]);

        // Merge additively with existing (minus deleted)
        type AnyEl = Parameters<typeof DiagramController.updateScene>[1]["elements"];
        api.updateScene({ elements: [...existing, ...(normalized as AnyEl)] });

        // Scroll canvas to show new content
        if (realElements.length > 0) {
          setTimeout(() => api.scrollToContent(), 150);
        }

        return {
          toolCallId: "",
          result: `Drew ${realElements.length} element(s).`,
          isError: false,
        };
      }

      case "get_elements": {
        const elements = DiagramController.getElements(instanceId);
        return { toolCallId: "", result: JSON.stringify(elements), isError: false };
      }

      case "clear_canvas": {
        const input = toolInput as { confirm?: boolean };
        if (!input.confirm) {
          return {
            toolCallId: "",
            result: "Must pass confirm: true to clear canvas.",
            isError: true,
          };
        }
        api.updateScene({ elements: [] });
        return { toolCallId: "", result: "Canvas cleared.", isError: false };
      }

      case "update_element": {
        const input = toolInput as {
          elementId?: string;
          updates?: Record<string, unknown>;
        };
        if (!input.elementId || !input.updates) {
          return {
            toolCallId: "",
            result: "Invalid input: elementId and updates required.",
            isError: true,
          };
        }
        const elements = api.getSceneElements();
        const updated = elements.map((el) =>
          el.id === input.elementId ? { ...el, ...input.updates } : el
        );
        api.updateScene({ elements: updated as typeof elements });
        return {
          toolCallId: "",
          result: `Updated element ${input.elementId}.`,
          isError: false,
        };
      }

      default:
        return {
          toolCallId: "",
          result: `Unknown tool: ${toolName}`,
          isError: true,
        };
    }
  } catch (err) {
    return { toolCallId: "", result: String(err), isError: true };
  }
}
