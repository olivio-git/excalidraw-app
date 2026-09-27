export const BASE_ELEMENT_FIELDS = {
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid" as const,
  strokeWidth: 2,
  strokeStyle: "solid" as const,
  roughness: 1,
  opacity: 100,
  groupIds: [] as string[],
  frameId: null,
  roundness: null,
  seed: 1,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  boundElements: null,
  updated: Date.now(),
  link: null,
  locked: false,
};

export const RECTANGLE_EXAMPLE = {
  type: "rectangle" as const,
  id: "example-rect-id",
  x: 100,
  y: 100,
  width: 200,
  height: 100,
  ...BASE_ELEMENT_FIELDS,
  roundness: { type: 3 },
};

export const TEXT_EXAMPLE = {
  type: "text" as const,
  id: "example-text-id",
  x: 100,
  y: 100,
  width: 80, // ~8-10px per char at fontSize 16. "Label" = 5 chars → ~80px
  height: 24, // fontSize * 1.5 minimum. fontSize 16 → height 24
  ...BASE_ELEMENT_FIELDS,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  text: "Label",
  fontSize: 16,
  fontFamily: 1,
  textAlign: "center" as const,
  verticalAlign: "middle" as const,
  baseline: 14, // approximately (height / 2) + (fontSize * 0.35)
  containerId: null, // ALWAYS null — never bind text to shapes
  originalText: "Label",
  autoResize: true,
};

export const ARROW_EXAMPLE = {
  type: "arrow" as const,
  id: "example-arrow-id",
  x: 100,
  y: 100,
  width: 200,
  height: 0,
  ...BASE_ELEMENT_FIELDS,
  points: [
    [0, 0],
    [200, 0],
  ] as [number, number][],
  lastCommittedPoint: null,
  startBinding: null,
  endBinding: null,
  startArrowhead: null,
  endArrowhead: "arrow" as const,
  elbowed: false,
};

export const ELLIPSE_EXAMPLE = {
  type: "ellipse" as const,
  id: "example-ellipse-id",
  x: 100,
  y: 100,
  width: 150,
  height: 150,
  ...BASE_ELEMENT_FIELDS,
};
