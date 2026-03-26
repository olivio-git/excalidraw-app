import { createReactBlockSpec } from "@blocknote/react";

// ---------------------------------------------------------------------------
// DiagramEmbedBlock
//
// Custom BlockNote block for embedding Excalidraw diagrams inside a document.
//
// Phase 2 limitation: renders the path as a simple image reference.
// SVG loading from Tauri filesystem is deferred to Phase 3+.
// ---------------------------------------------------------------------------

const DIAGRAM_EMBED_PROP_SCHEMA = {
  diagramPath: {
    default: "" as string,
    type: "string" as const,
  },
  caption: {
    default: "" as string,
    type: "string" as const,
  },
} as const;

export const DiagramEmbedBlock = createReactBlockSpec(
  {
    type: "diagramEmbed" as const,
    propSchema: DIAGRAM_EMBED_PROP_SCHEMA,
    content: "none" as const,
  },
  {
    render({ block }) {
      const { diagramPath, caption } = block.props;

      if (!diagramPath) {
        return (
          <figure className="my-2 rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            <p>No diagram path provided</p>
          </figure>
        );
      }

      return (
        <figure className="my-2">
          <DiagramEmbedRenderer diagramPath={diagramPath} caption={caption} />
        </figure>
      );
    },
  }
);

// ---------------------------------------------------------------------------
// DiagramEmbedRenderer — renders diagram path as image reference
// ---------------------------------------------------------------------------

interface DiagramEmbedRendererProps {
  diagramPath: string;
  caption: string;
}

function DiagramEmbedRenderer({ diagramPath, caption }: DiagramEmbedRendererProps) {
  const label = caption || diagramPath.split(/[\\/]/).pop() || diagramPath;

  // Phase 2: render as <img>. Tauri asset protocol URLs use "asset://" scheme.
  // If the path isn't a valid URL, show a placeholder instead of a broken image.
  const isTauriPath = diagramPath.startsWith("/") || diagramPath.includes(":\\");

  if (isTauriPath) {
    // Phase 3+ will convert this to a proper Tauri asset URL and read SVG content
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 p-6">
        <p className="text-xs text-muted-foreground font-mono break-all">{diagramPath}</p>
        <p className="text-xs text-muted-foreground">Diagram preview available in Phase 3+</p>
        {label !== diagramPath && (
          <figcaption className="text-xs text-center text-muted-foreground">{label}</figcaption>
        )}
      </div>
    );
  }

  return (
    <>
      <img src={diagramPath} alt={label} className="max-w-full rounded-md border border-border" />
      {label && (
        <figcaption className="mt-1 text-xs text-center text-muted-foreground">{label}</figcaption>
      )}
    </>
  );
}
