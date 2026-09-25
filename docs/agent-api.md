# Control the workspace through MCP or the plugin SDK

External agents can arrange editor groups, operate on explicit files/tabs, edit native note blocks, insert live diagram references, and query incoming/outgoing links. MCP and the plugin SDK delegate to the same application services.

## Load the updated tools

The desktop app must be running with a workspace open. After updating the MCP sources:

```sh
npm --prefix excalidraw-mcp install
npm --prefix excalidraw-mcp run build
```

Restart the configured MCP server/client connection to refresh its tool catalogue, and reload the desktop application. The server entry remains `excalidraw-mcp/dist/index.js`. This builds the auxiliary MCP package, not the desktop frontend.

The transport is MCP over stdio → local HTTP `POST /api/tool` → the running Tauri frontend. Both processes use `MCP_PORT` (default `7888`). Direct HTTP requests use `{ "tool": "workspace_get_state", "input": {} }`; new tools also validate their inputs in the frontend.

## Quick path: a note beside a diagram

1. Call `workspace_get_state` to discover the workspace path, tab IDs, groups and close constraints.
2. Call `workspace_set_layout` with `{ "direction": "horizontal", "ratio": 55 }`.
3. Create a rich note using a path **inside that workspace**:

```json
{
  "name": "document_create_rich",
  "arguments": {
    "filePath": "/absolute/workspace/design.note",
    "groupId": "primary",
    "blocks": [
      {
        "id": "overview",
        "type": "heading",
        "props": { "level": 1 },
        "content": "Design overview"
      },
      { "id": "context", "type": "paragraph", "content": "Why this design exists." }
    ]
  }
}
```

4. Open an existing diagram with `open_file_or_focus`, supplying its absolute `filePath` and `groupId: "secondary"`.
5. Call `document_insert_linked_diagram` with the note's `filePath` and the existing `diagramPath`. The source diagram need not be open to insert its live reference.
6. Use `save_all_tabs`, then inspect its `saved`, `failed` and `errors` fields.

Examples use the MCP client's `callTool({name, arguments})` shape. Replace example paths with the actual workspace paths; they are not raw JSON-RPC envelopes.

## Workspace and tab tools

| Tool                        | Purpose                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `workspace_get_state`       | Both groups, visible/focused tabs, dirty flags, layout, history availability and last-tab policy |
| `workspace_set_layout`      | `horizontal`, `vertical`, or `null` to merge; first-pane ratio 20–80                             |
| `workspace_focus_group`     | Focus `primary` or `secondary`; secondary must exist                                             |
| `workspace_move_tab`        | Move a tab to a group without duplicating its live editor                                        |
| `workspace_close_group`     | Save/close group members; return per-tab blockers and resulting layout                           |
| `workspace_navigate`        | Back/forward through a group's open-tab history                                                  |
| `open_to_side`              | Open opposite the supplied **source** group, or current focus                                    |
| `list_tabs`                 | Documents and diagrams, with `groupId`, `isVisible`, `isActive`, `isDirty`                       |
| `save_tab`, `save_all_tabs` | Save documents and diagrams, with explicit targets and failure reports                           |
| `set_tab_pinned`            | Pin/unpin an explicit tab                                                                        |

Existing `open_file_or_focus` now also accepts `groupId`, `beside` and `anchor`. There are two editor groups and one live editor per file: opening an already-open resource in another group moves it. Closing a populated group can promote the surviving group to `primary`; read the returned state instead of retaining assumptions about group placement.

Where accepted, supply `tabId` or `filePath`. Supplying both requires them to identify the same resource. Diagram tools `get_elements`, `draw_elements`, `set_elements`, `update_element`, `clear_canvas` and `export_svg` accept these explicit targets without changing focus. Omit them only when intentionally acting on the active canvas. The diagram route ID is `diagram`.

## Safe close semantics

`close_tab` saves before closing, just like the tab bar. It returns `closed`, `wasDirty`, and a `reason` when blocked (`pinned`, `not_closable`, `last_tab`, `busy`, `unsaved_changes`, `save_failed`, or `not_found`). Failures retain the tab.

`force: true` explicitly discards the unsaved buffer: scheduled autosaves are paused, already queued writes are awaited, and the buffer is released only after successful closure. It does **not** undo completed autosaves or bypass pinned/last-tab constraints. Group closure is not atomic: successful members may close while blocked members stay open.

## Native `.note` tools

| Tool                             | Purpose                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `document_create_rich`           | Create a `.note` from blocks **or** Markdown; never overwrite; optional `open: false` |
| `document_get_schema`            | Discover supported block types, property types/defaults and content kinds             |
| `document_get_blocks`            | Read native blocks/IDs and an opaque revision token                                   |
| `document_get_outline`           | Headings with native block IDs                                                        |
| `document_insert_blocks`         | Insert at root or a parent's child index; IDs may be generated                        |
| `document_update_block`          | Update a block by ID; merge properties when its type is unchanged                     |
| `document_delete_blocks`         | Delete named blocks and descendants                                                   |
| `document_move_block`            | Reparent/reorder while keeping identity; reject cycles                                |
| `document_insert_linked_diagram` | Insert a persistent `diagramEmbed` with a saved-file preview                          |

Native mutations are for `.note`, not `.md`. They validate a detached candidate, apply it to the document store, and save through the same serialized document controller used by the UI. They work without a mounted editor. Parent IDs must exist, IDs must be unique, and an empty note retains a blank paragraph. A move's destination index is measured **after** removing the moved block.

Read before editing and echo `revision` unchanged as `expectedRevision`. It is an opaque token containing a buffer generation, not a number to increment. It detects edits and close/reload cycles. On `REVISION_CONFLICT`, reread and reconsider the change.

`document_get_blocks` pages top-level blocks (`offset`, `limit`, default 100/max 200; descendants stay with their parent). Follow `hasMore`. Data URLs are replaced by `[embedded-image]` unless `includeDataUrls: true`. Write only intended changes; placeholder URLs are rejected rather than overwriting embedded media.

If disk saving fails **after** an edit was applied, the tool returns `SAVE_FAILED` with `appliedRevision`. The dirty buffer is retained. Retry `document_save` or `save_tab`, not the insertion/deletion. On an uncertain transport failure, reread the resource before retrying a mutation.

Legacy document tools continue operating on Markdown/projections. `document_create` creates `.md`; use `document_create_rich` for native notes. `document_insert_diagram` remains a **static SVG snapshot**; use the linked-diagram tool for live references. Native block IDs from `document_get_outline` differ from Markdown section IDs returned by `document_get_sections`.

## References and navigation

- `reference_create`: generate an internal file link, optionally with a block/heading/diagram-element anchor.
- `open_reference`: resolve relative to `sourcePath`, optionally open beside a group, then navigate to the anchor.
- `references_refresh`: start an asynchronous index job and return immediately.
- `references_status`: poll until `ready` or `failed`.
- `references_get`: query `incoming`, `outgoing` or `both`; pages with `offset`/`limit` (max 200).

The index is a **snapshot**. Refresh after edits for a new one. `running` with an empty list is not proof of no references. A `jobId` can pin a query to the expected scan; a superseding scan returns `STALE_JOB`. Workspace changes invalidate the old job. Scans report unreadable files and truncation (up to 1000 files and 5000 directories); they skip symlinks, `.git`, and `node_modules`. Background scanning avoids the bridge's short request timeout.

File/block/reference actions require normalized absolute paths within the selected workspace; sibling-prefix paths and parent traversal are rejected. Internal links remain path-based, so renaming a target does not automatically rewrite authored links.

## Plugin SDK equivalents

```ts
const state = api.workbench.getState();
api.workbench.setLayout({ direction: "horizontal", ratio: 55 });
await api.workbench.openFile({ filePath, groupId: "secondary" });

const note = await api.notes.getBlocks(notePath);
await api.notes.updateBlock({
  filePath: notePath,
  blockId: note.blocks[0].id,
  expectedRevision: note.revision,
  changes: { props: { backgroundColor: "blue" } },
});

const job = api.references.refresh();
// Poll api.references.getState(), then api.references.query({filePath, jobId}).
const result = await api.workbench.closeTab({ filePath });
```

The SDK exposes `workbench`, `notes` and `references`. `tabs.save`/`saveAll` now include documents. For compatibility, synchronous `tabs.close` remains available but closes **clean tabs only**, returning the actual outcome. Use `tabs.closeAndSave` or `workbench.closeTab` for asynchronous saving/explicit discard; legacy `force` on synchronous close does not discard dirty content.

## Verification

```sh
pnpm exec vitest run excalidraw-mcp/test/automation.integration.test.ts
pnpm exec tsc --noEmit -p excalidraw-mcp/tsconfig.json
```

The integration suite uses a real MCP client/server linked transport, published schemas, JSON bridge messages and the real application services. Native filesystem/canvas boundaries are mocked. Desktop visual behavior and native process restart are separate deployment checks.
