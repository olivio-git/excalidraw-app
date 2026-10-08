// ---------------------------------------------------------------------------
// Write-tool registry and call description — pure TypeScript, no React
// ---------------------------------------------------------------------------

// ── Write-tool registry ──

export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  // document tools (write / disk)
  "document_create_visual_report",
  "document_create",
  "document_open",
  "document_set_content",
  "document_append",
  "document_replace_section",
  "document_insert_after_section",
  "document_delete_section",
  "document_insert_diagram",
  "document_insert_generated_diagram",
  "document_save",
  "document_delete",
  // diagram tools (write)
  "draw_elements",
  "clear_canvas",
  "update_element",
  "set_elements",
  "save_diagram",
  // workspace tools (creates files / changes tabs — user-visible side effect)
  "workspace_create_diagram",
  "workspace_create_document",
  "workspace_open_file",
  "workspace_create_folder",
  "workspace_copy_file",
  "workspace_rename_file",
  "workspace_delete_file",
  // flows (creates / rewrites a .flow3d)
  "flow3d_create",
  "flow3d_update",
  // runs the flow for real (commands, HTTP, notes)
  "flow3d_run",
  // runs a shell command
  "terminal_run",
  "activate_tab",
  "close_tab",
  "save_all_diagrams",
]);

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

/**
 * Tools confirmed on every call, whatever was allowed before: each call is an
 * arbitrary command on the user's machine, so one approval never covers the next.
 */
export const ALWAYS_ASK_TOOLS: ReadonlySet<string> = new Set(["terminal_run"]);

// ── Tool call description ──

export interface ToolCallDescription {
  titleKey: string;
  descriptionKey: string;
  descriptionArgs?: Record<string, string | number>;
  preview?: string;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export function describeToolCall(toolName: string, input: unknown): ToolCallDescription {
  const i = (input ?? {}) as Record<string, unknown>;
  const titleKey = "aiChat.permission.title";

  switch (toolName) {
    case "document_create_visual_report":
      return {
        titleKey,
        descriptionKey: "aiChat.permission.tools.generic.description",
        descriptionArgs: { name: `document_create_visual_report: ${String(i.title ?? "")}` },
        preview: truncate(String(i.markdown ?? ""), 120),
      };

    case "document_append": {
      const content = String(i.content ?? "");
      return {
        titleKey,
        descriptionKey: "aiChat.permission.tools.document_append.description",
        preview: truncate(content, 120),
      };
    }

    case "document_replace_section":
      return {
        titleKey,
        descriptionKey: "aiChat.permission.tools.document_replace_section.description",
        descriptionArgs: { heading: String(i.heading ?? "") },
        preview: truncate(String(i.newContent ?? ""), 120),
      };

    case "document_insert_after_section":
      return {
        titleKey,
        descriptionKey: "aiChat.permission.tools.document_insert_after_section.description",
        descriptionArgs: { heading: String(i.heading ?? "") },
        preview: truncate(String(i.content ?? ""), 120),
      };

    case "document_insert_generated_diagram": {
      const els = Array.isArray(i.elements) ? i.elements : [];
      return {
        titleKey,
        descriptionKey: "aiChat.permission.tools.generic.description",
        descriptionArgs: { name: `document_insert_generated_diagram (${els.length} elements)` },
      };
    }

    case "document_save":
      return {
        titleKey,
        descriptionKey: "aiChat.permission.tools.document_save.description",
      };

    case "draw_elements": {
      const els = Array.isArray(i.elements) ? i.elements : [];
      return {
        titleKey,
        descriptionKey: "aiChat.permission.tools.draw_elements.description",
        descriptionArgs: { count: els.length },
      };
    }

    case "clear_canvas":
      return {
        titleKey,
        descriptionKey: "aiChat.permission.tools.clear_canvas.description",
      };

    case "update_element":
      return {
        titleKey,
        descriptionKey: "aiChat.permission.tools.update_element.description",
        descriptionArgs: { id: String(i.elementId ?? "") },
      };

    case "set_elements": {
      const els = Array.isArray(i.elements) ? i.elements : [];
      return {
        titleKey,
        descriptionKey: "aiChat.permission.tools.set_elements.description",
        descriptionArgs: { count: els.length },
      };
    }

    case "workspace_create_diagram":
      return {
        titleKey,
        descriptionKey: "aiChat.permission.tools.workspace_create_diagram.description",
        descriptionArgs: { name: String(i.name ?? "") },
      };

    case "workspace_create_document":
      return {
        titleKey,
        descriptionKey: "aiChat.permission.tools.workspace_create_document.description",
        descriptionArgs: { title: String(i.title ?? "") },
      };

    case "workspace_open_file":
      return {
        titleKey,
        descriptionKey: "aiChat.permission.tools.workspace_open_file.description",
        descriptionArgs: { filePath: String(i.filePath ?? "") },
      };

    case "terminal_run":
      return {
        titleKey,
        descriptionKey: "aiChat.permission.tools.terminal_run.description",
        descriptionArgs: { cwd: String(i.cwd ?? "") || "workspace" },
        // The whole command: it is what the user approves.
        preview: String(i.command ?? ""),
      };

    default:
      return {
        titleKey,
        descriptionKey: "aiChat.permission.tools.generic.description",
        descriptionArgs: { name: toolName },
      };
  }
}
