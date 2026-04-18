import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { DiagramEmbedBlock } from "./blocks/DiagramEmbedBlock";

// Custom schema — extends default block specs with DiagramEmbedBlock.
// Defined at module level so it is created once and shared between
// DocumentEditorContainer (editor creation) and DocumentEditor (view).
export const documentSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    diagramEmbed: DiagramEmbedBlock(),
  },
});

export type DocumentSchema = typeof documentSchema;
