import { noteActions, type BlockInput } from "./notes";
import { referenceActions } from "./references";
import { workbenchActions, type LayoutRequest } from "./workbench";
import { AutomationError, group, integer, object, optionalBoolean, text } from "./validation";

export const AUTOMATION_TOOLS = [
  "workspace_get_state",
  "workspace_set_layout",
  "workspace_focus_group",
  "workspace_move_tab",
  "workspace_close_group",
  "workspace_navigate",
  "open_to_side",
  "list_tabs",
  "save_tab",
  "save_all_tabs",
  "set_tab_pinned",
  "document_create_rich",
  "document_get_schema",
  "document_get_blocks",
  "document_insert_blocks",
  "document_update_block",
  "document_delete_blocks",
  "document_move_block",
  "document_get_outline",
  "document_insert_linked_diagram",
  "reference_create",
  "open_reference",
  "references_refresh",
  "references_get",
  "references_status",
] as const;

const target = (input: Record<string, unknown>) => ({
  tabId: input.tabId === undefined ? undefined : text(input.tabId, "tabId"),
  filePath: input.filePath === undefined ? undefined : text(input.filePath, "filePath"),
});
const placement = (input: Record<string, unknown>) => ({
  parentId:
    input.parentId == null
      ? (input.parentId as undefined | null)
      : text(input.parentId, "parentId"),
  index: input.index === undefined ? undefined : integer(input.index, "index"),
});
const mutation = (input: Record<string, unknown>) => ({
  filePath: text(input.filePath, "filePath"),
  expectedRevision:
    input.expectedRevision === undefined
      ? undefined
      : text(input.expectedRevision, "expectedRevision"),
});
function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value))
    throw new AutomationError("INVALID_INPUT", `${field} must be an array.`);
  return value.map((item) => text(item, field));
}
function blocks(value: unknown): BlockInput[] {
  if (!Array.isArray(value)) throw new AutomationError("INVALID_INPUT", "blocks must be an array.");
  return value as BlockInput[];
}

export async function dispatchAutomationTool(
  tool: string,
  input: Record<string, unknown>
): Promise<{ result: unknown; error: string | null } | null> {
  if (!(AUTOMATION_TOOLS as readonly string[]).includes(tool)) return null;
  try {
    let result: unknown;
    switch (tool) {
      case "workspace_get_state":
        result = workbenchActions.getState();
        break;
      case "workspace_set_layout":
        result = workbenchActions.setLayout({
          direction: input.direction as LayoutRequest["direction"],
          ratio: input.ratio as number | undefined,
        });
        break;
      case "workspace_focus_group":
        result = workbenchActions.focusGroup(group(input.groupId));
        break;
      case "workspace_move_tab":
        result = workbenchActions.moveTab(target(input), group(input.groupId));
        break;
      case "workspace_close_group":
        result = await workbenchActions.closeGroup(
          group(input.groupId),
          optionalBoolean(input.force, "force")
        );
        break;
      case "workspace_navigate":
        result = workbenchActions.navigate(
          text(input.direction, "direction") as "back" | "forward",
          input.groupId === undefined ? undefined : group(input.groupId)
        );
        break;
      case "open_to_side":
        result = await workbenchActions.openFile({
          filePath: text(input.filePath, "filePath"),
          beside: true,
          groupId: input.groupId === undefined ? undefined : group(input.groupId),
          anchor: input.anchor === undefined ? undefined : text(input.anchor, "anchor"),
        });
        break;
      case "list_tabs":
        result = workbenchActions.getState().tabs;
        break;
      case "save_tab":
        result = await workbenchActions.saveTab(target(input));
        break;
      case "save_all_tabs":
        result = await workbenchActions.saveAll(
          input.tabIds === undefined ? undefined : strings(input.tabIds, "tabIds")
        );
        break;
      case "set_tab_pinned": {
        if (typeof input.pinned !== "boolean")
          throw new AutomationError("INVALID_INPUT", "pinned must be boolean.");
        result = workbenchActions.setPinned(target(input), input.pinned);
        break;
      }
      case "document_create_rich":
        result = await noteActions.create({
          filePath: text(input.filePath, "filePath"),
          blocks: input.blocks === undefined ? undefined : blocks(input.blocks),
          markdown: input.markdown as string | undefined,
          open: optionalBoolean(input.open, "open"),
          groupId: input.groupId === undefined ? undefined : group(input.groupId),
        });
        break;
      case "document_get_schema":
        result = await noteActions.getSchema();
        break;
      case "document_get_blocks":
        result = await noteActions.getBlocks(text(input.filePath, "filePath"), {
          offset: input.offset === undefined ? undefined : integer(input.offset, "offset"),
          limit: input.limit === undefined ? undefined : integer(input.limit, "limit", 1, 200),
          includeDataUrls: optionalBoolean(input.includeDataUrls, "includeDataUrls"),
        });
        break;
      case "document_get_outline":
        result = await noteActions.getOutline(text(input.filePath, "filePath"));
        break;
      case "document_insert_blocks":
        result = await noteActions.insertBlocks({
          ...mutation(input),
          ...placement(input),
          blocks: blocks(input.blocks),
        });
        break;
      case "document_update_block": {
        if (!object(input.changes))
          throw new AutomationError("INVALID_INPUT", "changes must be an object.");
        result = await noteActions.updateBlock({
          ...mutation(input),
          blockId: text(input.blockId, "blockId"),
          changes: input.changes,
        });
        break;
      }
      case "document_delete_blocks":
        result = await noteActions.deleteBlocks({
          ...mutation(input),
          blockIds: strings(input.blockIds, "blockIds"),
        });
        break;
      case "document_move_block":
        result = await noteActions.moveBlock({
          ...mutation(input),
          ...placement(input),
          blockId: text(input.blockId, "blockId"),
        });
        break;
      case "document_insert_linked_diagram": {
        if (input.caption !== undefined && typeof input.caption !== "string")
          throw new AutomationError("INVALID_INPUT", "caption must be a string.");
        result = await noteActions.insertLinkedDiagram({
          ...mutation(input),
          ...placement(input),
          diagramPath: text(input.diagramPath, "diagramPath"),
          caption: input.caption,
        });
        break;
      }
      case "reference_create":
        result = await workbenchActions.createReference(
          text(input.filePath, "filePath"),
          input.anchor === undefined ? undefined : text(input.anchor, "anchor")
        );
        break;
      case "open_reference":
        result = await workbenchActions.openReference(
          text(input.href, "href"),
          text(input.sourcePath, "sourcePath"),
          {
            beside: optionalBoolean(input.beside, "beside"),
            groupId: input.groupId === undefined ? undefined : group(input.groupId),
          }
        );
        break;
      case "references_refresh":
        result = referenceActions.refresh(
          input.maxFiles === undefined ? undefined : integer(input.maxFiles, "maxFiles", 1, 1000)
        );
        break;
      case "references_status":
        result = referenceActions.getState();
        break;
      case "references_get":
        result = await referenceActions.query({
          filePath: text(input.filePath, "filePath"),
          direction: input.direction as "incoming" | "outgoing" | "both" | undefined,
          offset: input.offset === undefined ? undefined : integer(input.offset, "offset"),
          limit: input.limit === undefined ? undefined : integer(input.limit, "limit", 1, 200),
          jobId: input.jobId === undefined ? undefined : text(input.jobId, "jobId"),
        });
        break;
    }
    return { result, error: null };
  } catch (error) {
    return {
      result: {
        code: error instanceof AutomationError ? error.code : "OPERATION_FAILED",
        ...(error instanceof AutomationError ? error.details : {}),
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
