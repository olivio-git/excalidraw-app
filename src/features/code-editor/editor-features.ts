import { Compartment, type Extension } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  crosshairCursor,
  highlightTrailingWhitespace,
  rectangularSelection,
} from "@codemirror/view";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { showMinimap } from "@replit/codemirror-minimap";

/**
 * VS Code-style comforts of the code editor, switched by config.toml
 * (`[editor] minimap`, `indent_guides`) and applied to every open editor:
 * minimap, indentation guides, Alt+drag column selection and multi-cursor,
 * trailing whitespace.
 */

export interface EditorFeatures {
  minimap: boolean;
  indentGuides: boolean;
}

let features: EditorFeatures = { minimap: true, indentGuides: true };
const compartment = new Compartment();
const views = new Set<EditorView>();

const tracker = ViewPlugin.define((view) => {
  views.add(view);
  return { destroy: () => views.delete(view) };
});

const minimap = showMinimap.compute(["doc"], () => ({
  create: () => {
    const dom = document.createElement("div");
    dom.className = "qori-minimap";
    return { dom };
  },
  displayText: "blocks",
  showOverlay: "mouse-over",
}));

const guides = indentationMarkers({
  highlightActiveBlock: true,
  hideFirstIndent: false,
  markerType: "fullScope",
  thickness: 1,
  colors: {
    light: "#d4d4d4",
    dark: "#404040",
    activeLight: "#939393",
    activeDark: "#707070",
  },
});

function build(current: EditorFeatures): Extension {
  return [current.minimap ? minimap : [], current.indentGuides ? guides : []];
}

/** Add to the code editor's extensions. */
export function editorFeaturesExtension(): Extension {
  return [
    compartment.of(build(features)),
    tracker,
    // Alt+drag: column (box) selection; Alt+click adds cursors (crosshair while Alt is held).
    rectangularSelection({ eventFilter: (event) => event.altKey }),
    crosshairCursor({ key: "Alt" }),
    EditorView.clickAddsSelectionRange.of((event) => event.altKey),
    highlightTrailingWhitespace(),
  ];
}

export function setEditorFeatures(next: Partial<EditorFeatures>): void {
  const merged = { ...features, ...next };
  if (merged.minimap === features.minimap && merged.indentGuides === features.indentGuides) return;
  features = merged;
  for (const view of views) view.dispatch({ effects: compartment.reconfigure(build(features)) });
}
