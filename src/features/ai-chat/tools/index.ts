import type { AIToolDefinition } from "../providers/types";
import type { AIChatContext } from "../utils/context-resolver";
import { DIAGRAM_TOOLS } from "./diagram-tools";
import { DOCUMENT_TOOLS } from "./document-tools";
import { COMMON_TOOLS } from "./common-tools";
import { WORKSPACE_TOOLS } from "./workspace-tools";
import { APP_TOOLS } from "./app-tools";

export { DIAGRAM_TOOLS } from "./diagram-tools";
export { DOCUMENT_TOOLS } from "./document-tools";
export { COMMON_TOOLS } from "./common-tools";
export { WORKSPACE_TOOLS } from "./workspace-tools";
export { APP_TOOLS } from "./app-tools";

export function getToolsForContext(context: AIChatContext): AIToolDefinition[] {
  switch (context.kind) {
    case "diagram":
      return [
        ...DIAGRAM_TOOLS,
        ...DOCUMENT_TOOLS,
        ...WORKSPACE_TOOLS,
        ...APP_TOOLS,
        ...COMMON_TOOLS,
      ];
    case "document":
      return [
        ...DOCUMENT_TOOLS,
        ...DIAGRAM_TOOLS,
        ...WORKSPACE_TOOLS,
        ...APP_TOOLS,
        ...COMMON_TOOLS,
      ];
    case "none":
      // ask_user excluded: workspace flows are create/open only, no questions needed.
      // Expose the high-level visual report tool even without an active document so
      // the model can satisfy "create a document with diagrams" in one call.
      return [
        ...WORKSPACE_TOOLS,
        ...APP_TOOLS,
        ...DOCUMENT_TOOLS.filter((tool) => tool.name === "document_create_visual_report"),
      ];
  }
}
